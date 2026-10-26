import { createHash, randomUUID } from 'node:crypto';
import {
  chatKeySchema,
  memoryRecordSchema,
  type MemoryRecord,
  type ScratchpadNote,
} from '@qq-harness/contracts';
import type {
  AccessService,
  ConfigService,
  MemoryIndex,
  MemoryRepository,
  MemoryService,
  StorageService,
  IndexableMemory,
} from '@qq-harness/domain';

const DAY = 86_400_000;
const sensitivePattern =
  /住址|地址|身份证|手机号|病|诊断|治疗|工资|收入|银行卡|债务|恋爱|婚姻|家属|家庭关系/u;
export const indexable = (record: MemoryRecord): IndexableMemory => ({
  id: record.id,
  revision: record.revision,
  text: record.text,
  scope: record.scope,
  tier: record.tier,
  chatKey: record.chatKey,
  personId: record.personId,
  visibility: record.visibility,
  sensitive: record.sensitive,
});
const legacyId = (chatKey: string) => {
  const hex = createHash('sha256').update(`legacy:${chatKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const lexical = (query: string, text: string) => {
  const q = query.toLowerCase().trim();
  const value = text.toLowerCase();
  if (!q) return 0;
  if (value.includes(q)) return 1;
  const words = [...q.matchAll(/[a-z0-9]+|[\p{Script=Han}]/gu)].map((match) => match[0]);
  return words.length ? words.filter((word) => value.includes(word)).length / words.length : 0;
};

export function createMemoryService(deps: {
  repo: MemoryRepository;
  index: MemoryIndex;
  storage: StorageService;
  access: AccessService;
  config: ConfigService;
  onImportant: (id: string) => void;
  onChanged: () => void;
}): MemoryService {
  const { repo, index, storage, access, config } = deps;
  const checkChat = (chatKey: string) => {
    chatKeySchema.parse(chatKey);
    access.assert(chatKey);
  };
  const hasPerson = (chatKey: string, personId: string) =>
    chatKey === `private:${personId}` || storage.hasSender(chatKey, personId);
  const validRecord = (record: MemoryRecord) => {
    memoryRecordSchema.parse(record);
    if (record.scope === 'chat' && (!record.chatKey || record.personId)) throw new Error('会话记忆维度无效');
    if (record.scope === 'chat_person' && (!record.chatKey || !record.personId))
      throw new Error('会话成员维度无效');
    if (record.scope === 'person' && (record.chatKey || !record.personId))
      throw new Error('通用个人维度无效');
    if (record.chatKey) chatKeySchema.parse(record.chatKey);
    if (record.personId && !/^[0-9]+$/.test(record.personId)) throw new Error('QQ 号无效');
    if (record.scope === 'person' && (record.sensitive || record.visibility !== 'cross_chat'))
      throw new Error('敏感或限定会话内容不得写入通用个人记忆');
    if (record.scope !== 'person' && record.visibility !== 'chat_only')
      throw new Error('会话记忆不得跨会话可见');
    if (record.scope !== 'person' && record.sources.some((source) => source.chatKey !== record.chatKey))
      throw new Error('会话记忆来源必须属于当前会话');
    if (
      record.tier === 'medium' &&
      record.status === 'active' &&
      (!record.expiresAt || record.expiresAt <= Date.now())
    )
      throw new Error('中期记忆必须有未来到期时间');
    if (record.tier === 'long' && record.expiresAt !== null) throw new Error('长期记忆不得自动到期');
    if (
      record.origin === 'automatic' &&
      record.scope === 'person' &&
      (!record.sources.length || record.sources.some((source) => !source.chatKey.startsWith('group:')))
    )
      throw new Error('私聊来源不能自动写入通用个人记忆');
  };
  const visible = (record: MemoryRecord, chatKey: string, people: Set<string>) => {
    if (record.status !== 'active' || (record.expiresAt !== null && record.expiresAt <= Date.now()))
      return false;
    if (record.scope === 'chat') return record.chatKey === chatKey;
    if (!record.personId || !people.has(record.personId)) return false;
    if (record.scope === 'chat_person') return record.chatKey === chatKey;
    return (
      record.visibility === 'cross_chat' &&
      !record.sensitive &&
      record.sources.every((source) => access.allowed(source.chatKey, source.senderId))
    );
  };
  const legacy = (chatKey: string): MemoryRecord | undefined => {
    const text = storage.memory(chatKey);
    if (!text) return undefined;
    return {
      id: legacyId(chatKey),
      scope: 'chat',
      tier: 'long',
      chatKey,
      personId: null,
      key: 'legacy-text',
      text,
      visibility: 'chat_only',
      sensitive: false,
      confidence: 0.7,
      importance: 0.5,
      pinned: false,
      sources: [],
      origin: 'admin',
      status: 'active',
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
      lastConfirmedAt: 0,
      expiresAt: null,
    };
  };
  const list = (chatKey: string, personId?: string) => {
    checkChat(chatKey);
    if (personId && !hasPerson(chatKey, personId)) throw new Error('此人不属于当前会话');
    const people = new Set(personId ? [personId] : storage.recent(chatKey, 100, 0).map((m) => m.senderId));
    if (chatKey.startsWith('private:')) people.add(chatKey.slice(8));
    const records = repo
      .candidates(chatKey, [...people])
      .filter((record) => visible(record, chatKey, people));
    const old = legacy(chatKey);
    if (old && !personId) records.push(old);
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  };
  const save = (input: MemoryRecord, expectedRevision?: number) => {
    const record = { ...input, sensitive: input.sensitive || sensitivePattern.test(input.text) };
    validRecord(record);
    if (record.chatKey && record.status === 'active') checkChat(record.chatKey);
    const prior = repo.record(record.id);
    const existing = new Set(prior?.sources.map((source) => `${source.chatKey}/${source.localId}`) ?? []);
    for (const source of record.sources)
      if (!existing.has(`${source.chatKey}/${source.localId}`)) {
        access.assert(source.chatKey, source.senderId);
        const message = storage
          .messages(source.chatKey)
          .find((item) => item.localId === source.localId && !item.self);
        if (!message || message.senderId !== source.senderId) throw new Error('记忆来源消息不存在');
      }
    const result = repo.saveRecord(record, expectedRevision);
    deps.onChanged();
    return result;
  };
  const expire = () => repo.expireNotes(Date.now());
  return {
    list,
    search: async (chatKey, query, personId, limit = 8) => {
      checkChat(chatKey);
      if (personId && !hasPerson(chatKey, personId)) throw new Error('此人不属于当前会话');
      const people = new Set(
        personId ? [personId] : storage.recent(chatKey, 30, Date.now() - 2 * DAY).map((m) => m.senderId),
      );
      if (chatKey.startsWith('private:')) people.add(chatKey.slice(8));
      const capped = Math.max(1, Math.min(20, limit));
      const eligible = repo
        .candidates(chatKey, [...people])
        .filter((record) => visible(record, chatKey, people));
      const allowed = new Map(eligible.map((record) => [record.id, record]));
      let ranked: { id: string; relevance: number }[];
      const checkpoint = repo.indexCheckpoint(index.id);
      const pending = repo.indexEvents(checkpoint, 1001);
      try {
        if (!index.health().ready) throw new Error('索引未就绪');
        ranked = await index.search(
          query,
          {
            chatKey,
            personIds: [...people],
            allowedIds: [...allowed.keys()],
          },
          Math.max(40, capped * 8),
        );
        ranked = ranked.filter((item) => allowed.has(item.id));
        if (pending.length > 1000) throw new Error('索引积压');
        for (const event of pending) {
          const record = allowed.get(event.recordId);
          ranked = ranked.filter((item) => item.id !== event.recordId);
          if (record) ranked.push({ id: record.id, relevance: lexical(query, record.text) });
        }
      } catch {
        ranked = eligible.map((record) => ({ id: record.id, relevance: lexical(query, record.text) }));
      }
      const old = legacy(chatKey);
      if (old) ranked.push({ id: old.id, relevance: lexical(query, old.text) });
      const unique = new Map<string, number>();
      for (const item of ranked) unique.set(item.id, Math.max(unique.get(item.id) ?? 0, item.relevance));
      return [...unique]
        .map(([id, relevance]) => ({
          record: id === old?.id ? old : repo.record(id),
          relevance: Math.max(0, Math.min(1, relevance)),
        }))
        .filter(
          (item): item is { record: MemoryRecord; relevance: number } =>
            !!item.record && item.relevance > 0 && visible(item.record, chatKey, people),
        )
        .map(({ record, relevance }) => {
          const age = Math.max(0, Date.now() - record.lastConfirmedAt);
          const freshness = record.pinned
            ? 1
            : record.tier === 'medium'
              ? 2 ** (-age / (14 * DAY))
              : Math.max(0.3, 2 ** (-age / (90 * DAY)));
          const scopeFit = record.scope === 'chat_person' ? 1 : record.scope === 'chat' ? 0.9 : 0.8;
          const score =
            0.4 * relevance +
            0.25 * record.confidence +
            0.15 * record.importance +
            0.15 * freshness +
            0.05 * scopeFit;
          return { record, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, capped);
    },
    remember: (input) => {
      const now = Date.now();
      return save(
        {
          ...input,
          id: randomUUID(),
          revision: 1,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          lastConfirmedAt: now,
        },
        0,
      );
    },
    update: (id, patch, expectedRevision) => {
      const prior = repo.record(id);
      if (!prior) throw new Error('记忆不存在');
      const now = Date.now();
      return save(
        {
          ...prior,
          ...patch,
          id: prior.id,
          revision: prior.revision + 1,
          createdAt: prior.createdAt,
          updatedAt: now,
          lastConfirmedAt:
            patch.text !== undefined || patch.sources !== undefined ? now : prior.lastConfirmedAt,
        },
        expectedRevision ?? prior.revision,
      );
    },
    remove: (id, expectedRevision) => {
      const prior = repo.record(id);
      if (!prior) throw new Error('记忆不存在');
      return save(
        { ...prior, status: 'deleted', revision: prior.revision + 1, updatedAt: Date.now() },
        expectedRevision ?? prior.revision,
      );
    },
    notes: (chatKey) => {
      checkChat(chatKey);
      expire();
      return repo.notes(chatKey);
    },
    note: (chatKey, text, sourceIds = [], ttlMs) => {
      checkChat(chatKey);
      const now = Date.now();
      const max = config.effective(chatKey).scratchpadMaxDays * DAY;
      const ttl = ttlMs === undefined ? max : Math.min(max, Math.max(60_000, ttlMs));
      return repo.saveNote(
        {
          id: randomUUID(),
          chatKey,
          text,
          important: false,
          promotion: 'none',
          sourceIds,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + ttl,
          revision: 1,
        },
        0,
      );
    },
    updateNote: (chatKey, id, patch) => {
      checkChat(chatKey);
      const prior = repo.note(id);
      if (!prior || prior.chatKey !== chatKey || prior.expiresAt <= Date.now())
        throw new Error('记事本条目不存在或已过期');
      const now = Date.now();
      const max = config.effective(chatKey).scratchpadMaxDays * DAY;
      const ttl =
        patch.ttlMs === undefined
          ? Math.min(max, prior.expiresAt - prior.updatedAt)
          : Math.min(max, Math.max(60_000, patch.ttlMs));
      const changedContent = patch.text !== undefined || patch.sourceIds !== undefined;
      const note: ScratchpadNote = {
        ...prior,
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.sourceIds !== undefined ? { sourceIds: patch.sourceIds } : {}),
        ...(patch.important !== undefined ? { important: patch.important } : {}),
        updatedAt: now,
        expiresAt: now + ttl,
        revision: prior.revision + 1,
        promotion:
          patch.important === false
            ? 'none'
            : patch.important === true || (prior.important && changedContent)
              ? 'pending'
              : prior.promotion,
      };
      const saved = repo.saveNote(note, prior.revision);
      if (saved.important && saved.promotion === 'pending') deps.onImportant(saved.id);
      return saved;
    },
    deleteNote: (chatKey, id) => {
      checkChat(chatKey);
      if (repo.note(id)?.chatKey !== chatKey) throw new Error('记事本条目不存在');
      repo.deleteNote(id);
    },
    history: (id, chatKey) => {
      checkChat(chatKey);
      const record = repo.record(id);
      if (!record) throw new Error('记忆不存在');
      const people = new Set(storage.recent(chatKey, 100, 0).map((message) => message.senderId));
      if (chatKey.startsWith('private:')) people.add(chatKey.slice(8));
      if (
        (record.scope === 'person' &&
          (!record.personId ||
            !people.has(record.personId) ||
            record.sensitive ||
            record.visibility !== 'cross_chat' ||
            !record.sources.every((source) => access.allowed(source.chatKey, source.senderId)))) ||
        (record.scope !== 'person' && record.chatKey !== chatKey)
      )
        throw new Error('记忆不属于当前会话');
      return repo.history(id);
    },
    indexStatus: () => ({
      provider: index.id,
      ...index.health(),
      pending: repo.latestIndexSequence() - repo.indexCheckpoint(index.id),
    }),
  };
}
