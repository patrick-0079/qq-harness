import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import type {
  AccessService,
  MemoryIndex,
  MemoryRepository,
  MemoryService,
  ModelService,
  StorageService,
} from '@qq-harness/domain';
import type { StoredMessage } from '@qq-harness/contracts';
import { indexable } from './service.js';

const DAY = 86_400_000;
const candidateSchema = z.object({
  scope: z.enum(['chat', 'chat_person', 'person']),
  tier: z.enum(['medium', 'long']),
  key: z.string().min(1).max(160),
  text: z.string().min(1).max(4000),
  personId: z.string().nullable().optional(),
  sensitive: z.boolean().default(false),
  direct: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
  importance: z.number().min(0).max(1).default(0.5),
  sourceIds: z.array(z.number().int().positive()).min(1).max(30),
});
const extractionSchema = z.object({ candidates: z.array(candidateSchema).max(30) });
const sensitivePattern =
  /住址|地址|身份证|手机号|病|诊断|治疗|工资|收入|银行卡|债务|恋爱|婚姻|家属|家庭关系/u;

export function memoryBackground(
  ctx: PluginContext,
  deps: {
    repo: MemoryRepository;
    index: MemoryIndex;
    memory: MemoryService;
    storage: StorageService;
    access: AccessService;
    model: ModelService;
  },
) {
  const { repo, index, memory, storage, access, model } = deps;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const active = new Set<string>();
  let syncing = false;
  let rebuilding = false;
  let syncScheduled = false;
  const sync = async () => {
    if (syncing || rebuilding || ctx.signal.aborted) return;
    syncing = true;
    try {
      for (;;) {
        const events = repo.indexEvents(repo.indexCheckpoint(index.id), 100);
        if (!events.length) break;
        for (const event of events) {
          const record = repo.record(event.recordId);
          if (record?.status === 'active' && (!record.expiresAt || record.expiresAt > Date.now()))
            await index.upsert(indexable(record));
          else await index.remove(event.recordId, event.revision);
          ctx.assertActive();
          repo.setIndexCheckpoint(index.id, event.sequence);
        }
      }
    } catch (error) {
      ctx.log(`记忆索引等待重试：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      syncing = false;
    }
  };
  const scheduleSync = () => {
    if (syncScheduled) return;
    syncScheduled = true;
    queueMicrotask(() => {
      syncScheduled = false;
      void sync();
    });
  };
  const rebuild = async () => {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const sequence = repo.latestIndexSequence();
      await index.rebuild(
        repo
          .records()
          .filter(
            (record) => record.status === 'active' && (!record.expiresAt || record.expiresAt > Date.now()),
          )
          .map(indexable),
      );
      ctx.assertActive();
      repo.setIndexCheckpoint(index.id, sequence);
    } finally {
      rebuilding = false;
      scheduleSync();
    }
  };
  const parseExtraction = (text: string | null) => {
    if (!text) throw new Error('提炼模型没有返回 JSON');
    const clean = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    return extractionSchema.parse(JSON.parse(clean));
  };
  const applyCandidate = (
    chatKey: string,
    batch: StoredMessage[],
    candidate: z.infer<typeof candidateSchema>,
  ) => {
    const ids = new Set(candidate.sourceIds);
    const evidence = batch.filter((message) => ids.has(message.localId));
    if (evidence.length !== ids.size) return;
    const personId = candidate.scope === 'chat' ? null : (candidate.personId ?? null);
    if (candidate.scope !== 'chat' && !personId) return;
    if (personId && !evidence.some((message) => message.senderId === personId)) return;
    if (!candidate.direct && candidate.tier === 'long' && evidence.length < 2) return;
    const sensitive = candidate.sensitive || sensitivePattern.test(candidate.text);
    if (
      candidate.scope === 'person' &&
      (chatKey.startsWith('private:') || sensitive || (!candidate.direct && evidence.length < 2))
    )
      return;
    if (candidate.scope === 'person' && evidence.some((message) => message.senderId !== personId)) return;
    const sources = evidence.map((message) => ({
      chatKey,
      localId: message.localId,
      senderId: message.senderId,
    }));
    const recordChat = candidate.scope === 'person' ? null : chatKey;
    const prior = repo
      .records()
      .find(
        (record) =>
          record.status === 'active' &&
          record.scope === candidate.scope &&
          record.chatKey === recordChat &&
          record.personId === personId &&
          record.key === candidate.key,
      );
    if (prior?.text.trim() === candidate.text.trim()) {
      const known = new Set(prior.sources.map((source) => `${source.chatKey}/${source.localId}`));
      const additional = sources.filter((source) => !known.has(`${source.chatKey}/${source.localId}`));
      if (additional.length)
        memory.update(prior.id, {
          sources: [...prior.sources, ...additional].slice(-30),
          confidence: Math.min(1, Math.max(prior.confidence, candidate.confidence) + 0.05),
          importance: Math.max(prior.importance, candidate.importance),
          expiresAt: prior.tier === 'medium' ? Date.now() + 30 * DAY : null,
        });
      return;
    }
    if (prior) memory.update(prior.id, { status: 'superseded' });
    memory.remember({
      scope: candidate.scope,
      tier: candidate.tier,
      chatKey: recordChat,
      personId,
      key: candidate.key,
      text: candidate.text,
      visibility: candidate.scope === 'person' ? 'cross_chat' : 'chat_only',
      sensitive,
      confidence: candidate.confidence,
      importance: candidate.importance,
      pinned: false,
      sources,
      origin: 'automatic',
      expiresAt: candidate.tier === 'medium' ? Date.now() + 30 * DAY : null,
    });
  };
  const process = async (chatKey: string) => {
    if (active.has(chatKey) || ctx.signal.aborted || !access.allowed(chatKey)) return;
    active.add(chatKey);
    try {
      const batch = storage.messagesAfter(chatKey, repo.cursor(chatKey), 30);
      if (!batch.length) return;
      const response = await model.complete(
        [
          {
            role: 'system',
            content:
              '从聊天消息提取值得记住的事实或阶段摘要。只输出 JSON：{"candidates":[{"scope":"chat|chat_person|person","tier":"medium|long","key":"稳定属性键","text":"简短事实或摘要","personId":"QQ号或null","sensitive":false,"direct":true,"confidence":0.8,"importance":0.5,"sourceIds":[本批本地ID]}]}。不确定、玩笑、引用他人的话不记。敏感信息标 sensitive=true。person 只用于群聊中本人明确且非私密的稳定特征。没有候选输出空数组。',
          },
          {
            role: 'user',
            content: batch
              .map(
                (message) =>
                  `${message.localId} | ${message.senderId} | ${message.senderName} | ${message.text.slice(0, 1000)}`,
              )
              .join('\n'),
          },
        ],
        [],
        AbortSignal.any([ctx.signal, AbortSignal.timeout(60_000)]),
      );
      ctx.assertActive();
      const extracted = parseExtraction(response.message.content);
      for (const candidate of extracted.candidates) {
        ctx.assertActive();
        applyCandidate(chatKey, batch, candidate);
      }
      repo.setCursor(chatKey, batch.at(-1)!.localId);
      scheduleSync();
      if (storage.messagesAfter(chatKey, repo.cursor(chatKey), 1).length) schedule(chatKey);
    } catch (error) {
      ctx.log(`记忆提炼等待重试：${error instanceof Error ? error.message : String(error)}`);
      schedule(chatKey);
    } finally {
      active.delete(chatKey);
    }
  };
  const schedule = (chatKey: string) => {
    if (timers.has(chatKey) || ctx.signal.aborted) return;
    timers.set(
      chatKey,
      setTimeout(() => {
        timers.delete(chatKey);
        void process(chatKey);
      }, 300_000),
    );
  };
  const onMessage = (chatKey: string) => {
    if (!access.allowed(chatKey)) return;
    if (storage.messagesAfter(chatKey, repo.cursor(chatKey), 30).length >= 30) {
      const timer = timers.get(chatKey);
      if (timer) clearTimeout(timer);
      timers.delete(chatKey);
      void process(chatKey);
    } else schedule(chatKey);
  };
  const promoteNote = async (id: string) => {
    if (ctx.signal.aborted) return;
    const note = repo.note(id);
    if (!note || !note.important || note.promotion !== 'pending' || note.expiresAt <= Date.now()) return;
    try {
      const messages = storage.messages(note.chatKey);
      const sources = note.sourceIds
        .map((localId) => messages.find((message) => message.localId === localId && !message.self))
        .filter((message): message is StoredMessage => !!message)
        .map((message) => ({ chatKey: note.chatKey, localId: message.localId, senderId: message.senderId }));
      const prior = repo
        .records()
        .find(
          (record) =>
            record.status === 'active' &&
            record.scope === 'chat' &&
            record.chatKey === note.chatKey &&
            record.key === `scratchpad:${note.id}`,
        );
      if (!sources.length) {
        if (prior) memory.remove(prior.id);
        throw new Error('缺少来源消息');
      }
      if (prior)
        memory.update(prior.id, {
          text: note.text.slice(0, 4000),
          sources,
          expiresAt: Date.now() + 30 * DAY,
        });
      else
        memory.remember({
          scope: 'chat',
          tier: 'medium',
          chatKey: note.chatKey,
          personId: null,
          key: `scratchpad:${note.id}`,
          text: note.text.slice(0, 4000),
          visibility: 'chat_only',
          sensitive: true,
          confidence: 0.5,
          importance: 1,
          pinned: false,
          sources,
          origin: 'scratchpad',
          expiresAt: Date.now() + 30 * DAY,
        });
      const current = repo.note(id);
      if (current?.promotion === 'pending')
        repo.saveNote({ ...current, promotion: 'done', revision: current.revision + 1 }, current.revision);
      scheduleSync();
    } catch {
      const current = repo.note(id);
      if (current?.promotion === 'pending')
        repo.saveNote({ ...current, promotion: 'failed', revision: current.revision + 1 }, current.revision);
    }
  };
  const maintenance = setInterval(() => {
    repo.expireNotes(Date.now());
    for (const chat of storage.chats()) {
      if (storage.messagesAfter(chat.chatKey, repo.cursor(chat.chatKey), 1).length) schedule(chat.chatKey);
    }
    for (const chat of storage.chats())
      for (const note of repo.notes(chat.chatKey))
        if (note.important && note.promotion === 'pending') void promoteNote(note.id);
    scheduleSync();
  }, 300_000);
  for (const chat of storage.chats())
    if (storage.messagesAfter(chat.chatKey, repo.cursor(chat.chatKey), 1).length) schedule(chat.chatKey);
  ctx.effect(() => {
    clearInterval(maintenance);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });
  return { rebuild, scheduleSync, onMessage, promoteNote, process, sync };
}
