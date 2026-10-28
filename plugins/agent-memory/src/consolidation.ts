import { traceService,type TraceService } from '@qq-harness/domain';
import { textContent } from '@qq-harness/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginContext, RunContext } from '@qq-harness/plugin-sdk';
import type {
  AccessService,
  ConfigService,
  MemoryIndex,
  MemoryRepository,
  MemoryService,
  ModelService,
  StorageService,
} from '@qq-harness/domain';
import {
  chatKeySchema,
  memoryTierSchema,
  type Archive,
  type MemoryRecord,
  type MemoryTier,
  type MemoryConsolidationStatus,
  type MemorySchedule,
} from '@qq-harness/contracts';
import { factId, indexable, sourceId, retained } from './service.js';

const tiers: MemoryTier[] = ['short', 'medium', 'long'];
const extraction = z.object({
  candidates: z
    .array(
      z.object({
        scope: z.enum(['chat', 'chat_person', 'person']),
        key: z.string().min(1).max(160),
        text: z.string().min(1).max(4000),
        personId: z.string().nullable().optional(),
        sensitive: z.boolean().default(false),
        direct: z.boolean().default(false),
        confidence: z.number().min(0).max(1).default(0.5),
        importance: z.number().min(0).max(1).default(0.5),
        sourceIds: z.array(z.number().int().positive()).min(1).max(30),
      }),
    )
    .max(30),
});
interface ScheduleState {
  stages: MemoryConsolidationStatus['stages'];
  settings: MemorySchedule;
  notes: Record<string, number>;
}

export function memoryBackground(
  ctx: PluginContext,
  deps: {
    repo: MemoryRepository;
    index: MemoryIndex;
    memory: MemoryService;
    storage: StorageService;
    access: AccessService;
    model: ModelService;
    config: ConfigService;
    enabled?: (chatKey: string) => boolean;
  },
) {
  const { repo, index, memory, storage, access, model, config } = deps;
  const enabled = (key: string) =>
    !ctx.signal.aborted && access.allowed(key) && deps.enabled?.(key) !== false;
  const active = new Map<string, string>();
  const known = new Set<string>((storage.state('memory-scheduler', 'chats') ?? []) as string[]);
  const register = (key: string) => {
    if (!known.has(key)) {
      known.add(key);
      storage.setState('memory-scheduler', 'chats', [...known]);
    }
  };
  const interval = (settings: MemorySchedule, tier: MemoryTier) => settings[`${tier}IntervalMs`];
  const state = (chatKey: string): ScheduleState => {
    register(chatKey);
    const settings = config.effective(chatKey).memory;
    const saved = storage.state('memory-schedules', chatKey) as ScheduleState | undefined;
    const value = saved ?? {
      settings,
      notes: {},
      stages: Object.fromEntries(
        tiers.map((tier) => [tier, { nextAt: Date.now() + interval(settings, tier) }]),
      ) as ScheduleState['stages'],
    };
    let changed = !saved;
    for (const tier of tiers)
      if (interval(value.settings, tier) !== interval(settings, tier)) {
        value.stages[tier].nextAt =
          (value.stages[tier].lastSuccessAt ?? Date.now()) + interval(settings, tier);
        changed = true;
      }
    value.settings = settings;
    if (changed) storage.setState('memory-schedules', chatKey, value);
    return value;
  };
  const status = (chatKey: string): MemoryConsolidationStatus => {
    const value = state(chatKey);
    return { settings: value.settings, stages: value.stages, activeRunId: active.get(chatKey) };
  };
  let syncing = false;
  const sync = async () => {
    if (syncing || ctx.signal.aborted) return;
    syncing = true;
    try {
      for (;;) {
        const events = repo.indexEvents(repo.indexCheckpoint(index.id), 100);
        if (!events.length) break;
        for (const event of events) {
          const record = repo.record(event.recordId);
          if (record && retained(record)) await index.upsert(indexable(record));
          else await index.remove(event.recordId, event.revision);
          ctx.assertActive();
          repo.setIndexCheckpoint(index.id, event.sequence);
        }
      }
    } catch (error) {
      ctx.log(`记忆索引等待重试：${String(error)}`);
    } finally {
      syncing = false;
    }
  };
  const scheduleSync = () => {
    queueMicrotask(() => {
      void sync();
    });
  };
  const rebuild = async () => {
    const sequence = repo.latestIndexSequence();
    await index.rebuild(
      repo
        .records()
        .filter((record) => retained(record))
        .map(indexable),
    );
    ctx.assertActive();
    repo.setIndexCheckpoint(index.id, sequence);
    scheduleSync();
  };
  const current = (key: string) =>
    repo
      .records()
      .filter((r) => (r.factId ?? factId(r)) === key)
      .sort((a, b) => (b.factVersion ?? 1) - (a.factVersion ?? 1) || b.updatedAt - a.updatedAt)[0];
  const shortFact = (input: Parameters<MemoryService['remember']>[0]) => {
    const key = input.factId ?? factId(input),
      prior = current(key);
    if (
      prior &&
      prior.text === input.text &&
      prior.status === 'active' &&
      prior.sources.map(sourceId).join() === input.sources.map(sourceId).join()
    )
      return;
    if (prior?.origin === 'admin' && input.origin === 'automatic') return;
    memory.remember({ ...input, factId: key, factVersion: (prior?.factVersion ?? (prior ? 1 : 0)) + 1 });
  };
  const assertEnabled = (run: RunContext, key: string) => {
    run.assertActive();
    ctx.assertActive();
    if (!enabled(key)) throw new Error('会话记忆已停用或撤销准入');
  };
  const stage = async (
    run: RunContext,
    chatKey: string,
    tier: MemoryTier,
    schedule: ScheduleState,
    archive: Archive,
  ) => {
    assertEnabled(run, chatKey);
    if (tier === 'short') {
      const batch = storage.messagesAfter(chatKey, repo.cursor(chatKey), 100);
      let candidates: z.infer<typeof extraction>['candidates'] = [];
      if (batch.length) {
        const result = await model.complete(
          [
            {
              role: 'system',
              content:
                '从消息提炼值得记住的事实，只输出 JSON {"candidates":[{"scope":"chat|chat_person|person","key":"稳定属性键","text":"简短事实","personId":null,"sensitive":false,"direct":true,"confidence":0.8,"importance":0.5,"sourceIds":[本批本地ID]}]}。只保留明确事实，忽略玩笑、引用、不确定推测。person 仅用于群聊本人明确说出的非敏感稳定事实。无事实输出空数组。',
            },
            {
              role: 'user',
              content: batch
                .map((m) => `${m.localId} | ${m.senderId} | ${m.senderName} | ${m.text.slice(0, 1000)}`)
                .join('\n'),
            },
          ],
          [],
          run.signal,
          { chatKey,runId:run.id,purpose:'memory' },
        );
        archive.usage.input += result.usage.input;
        archive.usage.output += result.usage.output;
        if (result.billing) (archive.usage.models ??= []).push({ ...result.billing, ...result.usage });
        candidates = extraction.parse(
          JSON.parse(
            textContent(result.message.content)
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/, ''),
          ),
        ).candidates;
        if (candidates.some((c) => c.sourceIds.some((id) => !batch.some((m) => m.localId === id))))
          throw new Error('提炼结果引用了本批之外的消息');
      }
      assertEnabled(run, chatKey);
      memory.publishDrafts(chatKey);
      for (const candidate of candidates) {
        const evidence = batch.filter((m) => candidate.sourceIds.includes(m.localId));
        const personId = candidate.scope === 'chat' ? null : (candidate.personId ?? null);
        if (candidate.scope !== 'chat' && (!personId || !evidence.some((m) => m.senderId === personId)))
          continue;
        const sensitive =
          candidate.sensitive ||
          /住址|地址|身份证|手机号|诊断|治疗|工资|收入|银行卡|恋爱|婚姻|家属/u.test(candidate.text);
        if (
          candidate.scope === 'person' &&
          (chatKey.startsWith('private:') ||
            sensitive ||
            !candidate.direct ||
            evidence.some((m) => m.senderId !== personId))
        )
          continue;
        shortFact({
          scope: candidate.scope,
          tier,
          chatKey: candidate.scope === 'person' ? null : chatKey,
          personId,
          key: candidate.key,
          text: candidate.text,
          visibility: candidate.scope === 'person' ? 'cross_chat' : 'chat_only',
          sensitive,
          confidence: candidate.confidence,
          importance: candidate.importance,
          pinned: false,
          origin: 'automatic',
          sources: evidence.map((m) => ({ chatKey, localId: m.localId, senderId: m.senderId })),
          expiresAt: Date.now() + schedule.settings.shortRetentionMs,
        });
      }
      const notes = new Map(repo.notes(chatKey).map((note) => [note.id, note]));
      for (const id of Object.keys(schedule.notes)) {
        const note = repo.note(id);
        if (note) notes.set(id, note);
      }
      for (const note of notes.values()) {
        if (schedule.notes[note.id] === note.revision) continue;
        const key = factId({ scope: 'chat', chatKey, personId: null, key: `scratchpad:${note.id}` });
        if (note.status === 'expired') {
          schedule.notes[note.id] = note.revision;
          continue;
        }
        if (note.status === 'deleted') {
          const prior = current(key);
          if (prior && prior.status !== 'deleted') memory.remove(prior.id);
        } else {
          shortFact({
            scope: 'chat',
            tier: 'short',
            chatKey,
            personId: null,
            key: `scratchpad:${note.id}`,
            text: note.text.slice(0, 4000),
            visibility: 'chat_only',
            sensitive: true,
            confidence: 0.8,
            importance: note.important ? 1 : 0.5,
            pinned: false,
            origin: 'scratchpad',
            sources: [{ chatKey, noteId: note.id, noteRevision: note.revision }],
            expiresAt: Date.now() + schedule.settings.shortRetentionMs,
          });
          if (note.promotion !== 'done' || note.consolidatedAt === undefined) {
            const saved = repo.saveNote(
              { ...note, promotion: 'done', consolidatedAt: Date.now(), revision: note.revision + 1 },
              note.revision,
            );
            schedule.notes[note.id] = saved.revision;
            continue;
          }
        }
        schedule.notes[note.id] = note.revision;
      }
      if (batch.length) repo.setCursor(chatKey, batch.at(-1)!.localId);
    } else {
      const from = tier === 'medium' ? 'short' : 'medium';
      for (const source of repo
        .records()
        .filter(
          (r) =>
            r.tier === from &&
            (r.chatKey === chatKey || (r.scope === 'person' && r.sources.some((s) => s.chatKey === chatKey))),
        )) {
        const key = source.factId ?? factId(source),
          head = current(key);
        if (!head || (source.factVersion ?? 1) !== (head.factVersion ?? 1)) continue;
        if (source.status !== 'deleted' && !retained(source)) continue;
        const target = repo
          .records()
          .find(
            (r) =>
              r.tier === tier &&
              (r.factId ?? factId(r)) === key &&
              (r.factVersion ?? 1) === (source.factVersion ?? 1),
          );
        if (target) {
          if (source.status === 'active' && source.consolidatedAt === undefined)
            memory.publish(source.id, { consolidatedAt: Date.now() }, source.revision);
          continue;
        }
        assertEnabled(run, chatKey);
        repo.saveRecord(
          {
            ...source,
            id: randomUUID(),
            revision: 1,
            tier,
            factId: key,
            factVersion: source.factVersion ?? 1,
            consolidatedAt: undefined,
            derivedFrom: [{ id: source.id, revision: source.revision }],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiresAt: tier === 'long' ? null : Date.now() + schedule.settings.mediumRetentionMs,
          },
          0,
        );
        if (source.status === 'active')
          memory.publish(source.id, { consolidatedAt: Date.now() }, source.revision);
      }
    }
    scheduleSync();
  };
  ctx.mode({
    id: 'memory.consolidate',
    partitionKey: (input) => input.chatKey,
    input: z.object({
      chatKey: chatKeySchema,
      tier: memoryTierSchema.optional(),
      dueOnly: z.boolean().default(false),
    }),
    execute: async (run, input) => {
      const schedule = state(input.chatKey);
      const archive: Archive = {
        id: run.id,
        chatKey: input.chatKey,
        startedAt: Date.now(),
        endedAt: 0,
        status: 'running',
        sent: 0,
        trace: [],
        usage: { input: 0, output: 0 },
        mode: 'memory.consolidate',
      };
      let trace:TraceService|undefined;
      try{trace=ctx.use(traceService);}catch{/* 详情服务可停用 */}
      trace?.start(run.id,input.chatKey);
      trace?.record(run.id,'trigger','记忆整理任务',{chatKey:input.chatKey,tier:input.tier??'all',settings:schedule.settings});
      try {
        for (const tier of tiers) {
          if (input.tier && input.tier !== tier) continue;
          if (input.dueOnly && schedule.stages[tier].nextAt > Date.now()) continue;
          const value = schedule.stages[tier];
          try {
            await stage(run, input.chatKey, tier, schedule, archive);
            value.lastSuccessAt = Date.now();
            value.error = undefined;
            value.nextAt = Date.now() + interval(schedule.settings, tier);
            archive.trace.push({ type: 'memory', text: `${tier} 整理完成`, timestamp: Date.now() });
            trace?.record(run.id,'finish',`${tier} 整理完成`,{stage:tier,status:value});
          } catch (error) {
            value.lastFailureAt = Date.now();
            value.error = run.signal.aborted ? '整理已取消' : '整理失败，请检查模型配置或任务记录';
            value.nextAt = Date.now() + Math.min(60000, interval(schedule.settings, tier));
            throw error;
          } finally {
            if (!ctx.signal.aborted) storage.setState('memory-schedules', input.chatKey, schedule);
          }
        }
        archive.status = 'completed';
        return { stages: schedule.stages };
      } catch (error) {
        archive.status = run.signal.aborted ? 'cancelled' : 'failed';
        archive.reason = '记忆整理未完成';
        trace?.record(run.id,'error','记忆整理失败',{message:error instanceof Error?error.message:String(error)});
        throw error;
      } finally {
        trace?.end(run.id,archive.status);
        if (!ctx.signal.aborted) {
          archive.endedAt = Date.now();
          storage.archive(archive);
        }
      }
    },
  });
  const submit = (chatKey: string, tier?: MemoryTier, dueOnly = false) => {
    if (!enabled(chatKey)) throw new Error('当前会话未启用记忆');
    const existing = active.get(chatKey);
    if (existing) return existing;
    register(chatKey);
    const run = ctx.host.submit({
      mode: 'memory.consolidate',
      partitionKey: chatKey,
      input: { chatKey, tier, dueOnly },
      timeoutMs: config.effective(chatKey).runTimeoutMs,
    });
    active.set(chatKey, run.id);
    void ctx.host.wait(run.id).finally(() => {
      if (active.get(chatKey) === run.id) active.delete(chatKey);
    });
    return run.id;
  };
  const tick = () => {
    if (ctx.signal.aborted) return;
    const cfg = config.get();
    const chats = new Set([
      ...known,
      ...cfg.admissions,
      ...Object.keys(cfg.profiles),
      ...storage.chats().map((c) => c.chatKey),
    ]);
    for (const chatKey of chats) {
      if (!enabled(chatKey)) {
        const id = active.get(chatKey);
        if (id) ctx.host.cancel(id);
        continue;
      }
      if (!config.effective(chatKey).memory.enabled || !config.effective(chatKey).online) continue;
      const schedule = state(chatKey);
      if (tiers.some((tier) => schedule.stages[tier].nextAt <= Date.now())) submit(chatKey, undefined, true);
    }
    repo.expireNotes(Date.now());
    for (const record of repo.records())
      if (
        record.status === 'active' &&
        record.expiresAt !== null &&
        record.expiresAt <= Date.now() &&
        record.consolidatedAt !== undefined
      )
        memory.publish(record.id, { status: 'superseded' });
    scheduleSync();
  };
  let lastMaintenanceError = 0;
  const safeTick = () => {
    try {
      tick();
    } catch {
      if (Date.now() - lastMaintenanceError > 60000) {
        lastMaintenanceError = Date.now();
        ctx.log('记忆维护暂缓，将自动重试；请检查存储与插件状态');
      }
    }
  };
  safeTick();
  const timer = setInterval(safeTick, 1000);
  timer.unref?.();
  ctx.effect(() => {
    clearInterval(timer);
    for (const id of active.values()) ctx.host.cancel(id);
    active.clear();
  });
  return {
    rebuild,
    scheduleSync,
    onMessage: (chatKey: string) => {
      if (enabled(chatKey)) state(chatKey);
    },
    promoteNote: async (id: string) => {
      const note = repo.note(id);
      if (note && enabled(note.chatKey)) state(note.chatKey);
    },
    process: (chatKey: string, tier?: MemoryTier) => submit(chatKey, tier),
    status,
    sync,
  };
}
