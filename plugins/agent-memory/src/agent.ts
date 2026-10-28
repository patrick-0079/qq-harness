import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  memoryRequestInputSchema,
  textContent,
  type MemoryAgentService,
  type MemoryRequest,
  type MemoryRecord,
  type MemoryTier,
  type ScratchpadNote,
  type Archive,
  type MemoryConsolidationStatus,
} from '@qq-harness/contracts';
import {
  traceService,
  type AccessService,
  type ConfigService,
  type MemoryRepository,
  type MemoryService,
  type MemoryIndex,
  type ModelService,
  type ModelMessage,
  type StorageService,
} from '@qq-harness/domain';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import { indexable, retained } from './service.js';

interface Control {
  version: 2;
  tasks: MemoryRequest[];
  personas: Record<string, { selection: string; epoch: string; id: string }>;
  schedules: Record<string, MemoryConsolidationStatus>;
  forgotten: { chatKey: string; tier: string; text: string; at: number }[];
}
const day = 86400000;
const documentFactId = (r: Pick<MemoryRecord, 'scope' | 'chatKey' | 'personId' | 'tier' | 'key'>) =>
  createHash('sha256')
    .update(JSON.stringify(['document', r.scope, r.chatKey, r.personId, r.tier, r.key]))
    .digest('hex');
const tiers: MemoryTier[] = ['short', 'medium', 'long'];
const empty = (): Control => ({ version: 2, tasks: [], personas: {}, schedules: {}, forgotten: [] });
export function memoryError(error: unknown): string {
  if (error instanceof z.ZodError)
    return (
      '记忆参数格式错误：' + error.issues.map((i) => `${i.path.join('.') || '参数'}：${i.message}`).join('；')
    );
  if (error instanceof SyntaxError) return '模型返回的 JSON 格式无效，请查看任务详情后重试';
  return error instanceof Error ? error.message : String(error);
}

/** Only this runner receives maintenance tools. Conversation tools submit durable requests. */
export function createMemoryAgent(
  ctx: PluginContext,
  deps: {
    repo: MemoryRepository;
    memory: MemoryService;
    index: MemoryIndex;
    model: ModelService;
    config: ConfigService;
    storage: StorageService;
    access: AccessService;
  },
) {
  const { repo, memory, index, model, config, storage, access } = deps;
  const load = (): Control => structuredClone((repo.control() as Control | undefined) ?? empty());
  const change = <T>(edit: (state: Control) => T): T =>
    repo.transaction(() => {
      const state = load();
      const result = edit(state);
      repo.saveControl(state);
      return result;
    });
  const enabled = (key: string) => access.allowed(key) && config.effective(key).plugins[ctx.id] !== false;
  const check = (key: string) => {
    ctx.assertActive();
    if (!enabled(key)) throw Error('当前会话记忆未启用或已撤销准入');
  };
  let activeRun: string | undefined,
    syncing = false,
    stopping = false;
  const sync = async () => {
    if (syncing || ctx.signal.aborted) return;
    syncing = true;
    try {
      for (;;) {
        const events = repo.indexEvents(repo.indexCheckpoint(index.id), 100);
        if (!events.length) break;
        for (const event of events) {
          ctx.assertActive();
          const record = repo.record(event.recordId);
          if (record && retained(record)) await index.upsert(indexable(record));
          else await index.remove(event.recordId, event.revision);
          repo.setIndexCheckpoint(index.id, event.sequence);
        }
      }
    } catch (error) {
      if (!ctx.signal.aborted) ctx.log('记忆索引等待重试：' + memoryError(error));
    } finally {
      syncing = false;
    }
  };
  const importLegacy = (chatKey: string) => {
    const text = storage.memory(chatKey);
    if (!text || repo.records().some((r) => r.chatKey === chatKey && r.key.startsWith('legacy-text'))) return;
    repo.transaction(() => {
      for (let offset = 0; offset < text.length; offset += 4000)
        memory.remember({
          scope: 'chat',
          tier: 'short',
          chatKey,
          personId: null,
          key:
            text.length <= 4000 ? 'legacy-text' : `legacy-text:${String(offset / 4000 + 1).padStart(4, '0')}`,
          text: text.slice(offset, offset + 4000),
          visibility: 'chat_only',
          sensitive: false,
          confidence: 0.7,
          importance: 0.5,
          pinned: false,
          sources: [],
          origin: 'migration',
          expiresAt: Date.now() + config.effective(chatKey).memory.shortRetentionMs,
        });
    });
  };
  for (const key of new Set([
    ...config.get().admissions,
    ...Object.keys(config.get().profiles),
    ...storage.chats().map((c) => c.chatKey),
  ]))
    if (enabled(key)) importLegacy(key);
  // Additive migration: existing bodies remain intact, including old revisions and pending drafts.
  repo.transaction(() => {
    if (!repo.control()) {
      for (const record of repo.records())
        if (record.status === 'active' && record.tier !== 'short' && !record.document)
          repo.saveRecord(
            {
              ...record,
              factId: documentFactId(record),
              document: { title: record.key, topic: record.key, role: 'knowledge' },
              revision: record.revision + 1,
            },
            record.revision,
          );
      repo.saveControl(empty());
    }
    const state = load();
    for (const task of state.tasks)
      if (task.status === 'running') {
        task.status = 'queued';
        task.updatedAt = Date.now();
      }
    repo.saveControl(state);
  });

  const list = (chatKey: string, tier?: MemoryTier) => {
    check(chatKey);
    return memory.list(chatKey).filter((r) => !tier || r.tier === tier);
  };
  const persona = (chatKey: string, seed?: string) => {
    check(chatKey);
    const settings = config.effective(chatKey),
      cfg = config.get();
    const selection = settings.personaSelection.personaId || '__default__';
    const saved = load().personas[chatKey];
    const existing = saved && repo.record(saved.id);
    if (saved?.selection === selection && existing?.status === 'active') return existing.text;
    return repo.transaction(() => {
      const epoch = randomUUID();
      const text =
        seed ??
        cfg.personas.find((p) => p.id === settings.personaSelection.personaId)?.text ??
        settings.persona;
      const record = memory.remember({
        scope: 'chat',
        tier: 'long',
        chatKey,
        personId: null,
        key: '__persona__',
        text: text || '你是群聊中的助手。',
        document: { title: '人设与自我认知', topic: '自我认知', role: 'persona', personaEpoch: epoch },
        visibility: 'chat_only',
        sensitive: false,
        confidence: 1,
        importance: 1,
        pinned: true,
        sources: [],
        origin: 'admin',
        expiresAt: null,
      });
      change((state) => {
        state.personas[chatKey] = { selection, epoch, id: record.id };
      });
      return record.text;
    });
  };
  const status = (chatKey: string): MemoryConsolidationStatus => {
    check(chatKey);
    const settings = config.effective(chatKey).memory;
    const saved = load().schedules[chatKey];
    const stages = Object.fromEntries(
      tiers.map((tier) => [
        tier,
        saved?.stages[tier] ?? { nextAt: Date.now() + settings[`${tier}IntervalMs`] },
      ]),
    ) as MemoryConsolidationStatus['stages'];
    if (saved)
      for (const tier of tiers)
        if (saved.settings[`${tier}IntervalMs`] !== settings[`${tier}IntervalMs`])
          stages[tier].nextAt =
            (stages[tier].lastSuccessAt ?? stages[tier].nextAt - saved.settings[`${tier}IntervalMs`]) +
            settings[`${tier}IntervalMs`];
    const task = load().tasks.find((t) => t.chatKey === chatKey && t.status === 'running');
    return { settings, stages, activeRunId: task?.runId };
  };
  const request: MemoryAgentService['request'] = (raw) => {
    const input = memoryRequestInputSchema.parse(raw);
    check(input.chatKey);
    importLegacy(input.chatKey);
    for (const id of input.sourceIds)
      if (
        !storage
          .messages(input.chatKey)
          .some((m) => m.localId === id && !m.self && access.allowed(input.chatKey, m.senderId))
      )
        throw Error('记忆依据必须是当前会话获准读取的来源消息');
    for (const id of input.targetIds)
      if (
        !list(input.chatKey).some((r) => r.id === id) &&
        !repo.notes(input.chatKey).some((n) => n.id === id)
      )
        throw Error('申请目标不属于当前会话');
    const result = change((state) => {
      const prior =
        input.idempotencyKey &&
        state.tasks.find((t) => t.chatKey === input.chatKey && t.idempotencyKey === input.idempotencyKey);
      if (prior) return prior;
      const task: MemoryRequest = {
        ...input,
        id: randomUUID(),
        status: 'queued',
        changes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.tasks.push(task);
      return task;
    });
    ctx.host.publish('memory.changed', { chatKey: input.chatKey, requestId: result.id });
    pump();
    return structuredClone(result);
  };

  const writeSchema = z
    .object({
      id: z.string().uuid().optional(),
      expectedRevision: z.number().int().positive().optional(),
      tier: z.enum(['short', 'medium', 'long']),
      scope: z.enum(['chat', 'chat_person', 'person']).default('chat'),
      personId: z
        .union([z.string().regex(/^\d+$/), z.number().int().safe().positive().transform(String)])
        .optional(),
      key: z.string().min(1).max(160),
      title: z.string().min(1).max(160).optional(),
      content: z.string().trim().min(1).max(100000),
      sourceIds: z.array(z.number().int().positive()).max(100).default([]),
      sourceRecordIds: z.array(z.string().uuid()).max(50).default([]),
      noteIds: z.array(z.string().uuid()).max(30).default([]),
      supersedes: z.array(z.string().uuid()).max(50).default([]),
      forgottenText: z.string().max(4000).optional(),
      importance: z.number().min(0).max(1).default(0.5),
      sensitive: z.boolean().default(false),
    })
    .strict();
  const forgetSchema = z
    .object({
      id: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      reason: z.string().trim().min(1).max(4000),
    })
    .strict();
  const noteSchema = z
    .object({
      id: z.string().uuid().optional(),
      expectedRevision: z.number().int().positive().optional(),
      text: z.string().trim().min(1).max(10000),
      sourceIds: z.array(z.number().int().positive()).max(30).default([]),
      important: z.boolean().default(false),
    })
    .strict();
  const finishSchema = z
    .object({ summary: z.string().trim().min(1).max(4000), clarification: z.string().max(2000).optional() })
    .strict();
  const inspectSchema = z
    .object({
      query: z.string().max(1000).optional(),
      id: z.string().uuid().optional(),
      tier: z.enum(['short', 'medium', 'long']).optional(),
      offset: z.number().int().min(0).default(0),
    })
    .strict();
  const definitions = [
    ['memory_inspect', '读取相关记忆正文、来源与版本；offset 可翻页。', inspectSchema],
    [
      'memory_write',
      '根据旧文档和新证据融合后保存完整内容；指定id时必须提供expectedRevision。短期为条目，中长期为Markdown主题文档。supersedes用于替换其他旧条目；遗忘文档部分内容时填写forgottenText。',
      writeSchema,
    ],
    [
      'memory_forget',
      '遗忘整条短期条目、整份文档或草稿；局部遗忘文档应调用memory_write保留其他内容。',
      forgetSchema,
    ],
    ['scratchpad_write', '新增或更新草稿本条目，保留版本。', noteSchema],
    [
      'memory_finish',
      '提交本次维护。summary必须准确说明实际修改或未修改；有歧义时使用clarification，暂不提交修改。',
      finishSchema,
    ],
  ] as const;

  ctx.mode({
    id: 'memory.agent',
    partitionKey: () => 'memory-maintenance',
    input: z.object({ id: z.string().uuid() }),
    execute: async (run, input) => {
      const task = load().tasks.find((t) => t.id === input.id);
      if (!task || task.status !== 'queued') return;
      check(task.chatKey);
      persona(task.chatKey);
      const epoch = load().personas[task.chatKey]!.epoch;
      change((state) => {
        const t = state.tasks.find((t) => t.id === task.id)!;
        t.status = 'running';
        t.updatedAt = Date.now();
      });
      const archive: Archive = {
        id: run.id,
        chatKey: task.chatKey,
        startedAt: Date.now(),
        endedAt: 0,
        status: 'running',
        sent: 0,
        trace: [],
        usage: { input: 0, output: 0 },
        mode: 'memory.agent',
      };
      let trace: import('@qq-harness/domain').TraceService | undefined;
      try {
        trace = ctx.use(traceService);
      } catch {
        /* Optional diagnostics. */
      }
      trace?.start(run.id, task.chatKey);
      trace?.record(run.id, 'trigger', '记忆申请', task);
      const staged = new Map<string, z.infer<typeof writeSchema>>(),
        deleted = new Map<string, z.infer<typeof forgetSchema>>(),
        notes = new Map<string, z.infer<typeof noteSchema>>();
      const known = new Map(list(task.chatKey).map((r) => [r.id, r]));
      const knownNotes = new Map(repo.notes(task.chatKey).map((n) => [n.id, n]));
      const evidence = task.sourceIds.length
        ? storage.messages(task.chatKey).filter((m) => task.sourceIds.includes(m.localId))
        : task.origin === 'schedule' && task.tier === 'short'
          ? storage.messagesAfter(task.chatKey, repo.cursor(task.chatKey), 100)
          : [];
      const permittedSources = new Set([...task.sourceIds, ...evidence.map((m) => m.localId)]);
      for (const record of known.values())
        for (const source of record.sources)
          if (source.chatKey === task.chatKey && source.localId) permittedSources.add(source.localId);
      const system = `【记忆Agent】你独立维护记忆，只使用本次提供的维护工具。先检查已有记忆，结合当前人设、相关记忆和新证据，自主选择记住、淡化、融合、更正、拆分或遗忘；人设会影响保留倾向和细节程度（如胆小倾向少记恐怖细节），不机械追加。短期与草稿本存条目；中长期存按主题划分的Markdown文档。更正应同步处理相关旧结论，使用supersedes防止其他层旧结论复现。用户指定层级时严格限制修改范围。遗忘只移除匹配内容，保留其他内容与较新事实，遵循遗忘账本，不能从旧来源复活已遗忘内容。人设文档可演进，不能删除整份初始人设。来源ID只能使用真实localId；不要编造依据。没有证据可不记。中长期整理应归纳并选择保留内容，完成后可用supersedes退出已整合条目。使用memory_finish提交，有歧义则clarification。`;
      const messages: ModelMessage[] = [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({
            request: task,
            persona: persona(task.chatKey),
            memoryIndex: [...known.values()].map((r) => ({
              id: r.id,
              key: r.key,
              title: r.document?.title,
              tier: r.tier,
              revision: r.revision,
            })),
            memories: [...known.values()].slice(0, 25).map((r) => ({ ...r, text: r.text.slice(0, 6000) })),
            notes: [...knownNotes.values()].slice(0, 30),
            drafts: memory.drafts(task.chatKey).filter((d) => d.status === 'pending'),
            evidence: evidence.map((m) => ({
              localId: m.localId,
              messageId: m.id,
              senderId: m.senderId,
              text: m.text.slice(0, 1200),
            })),
            forgotten: load()
              .forgotten.filter((f) => f.chatKey === task.chatKey)
              .slice(-100),
          }),
        },
      ];
      const verifyTarget = (id: string, expected?: number, derived = false) => {
        const prior = known.get(id);
        if (!prior || prior.revision !== expected) throw Error('目标版本无效，请先读取当前记忆与revision');
        if (task.tier && task.tier !== prior.tier && !(derived && task.origin === 'schedule'))
          throw Error('修改超出了申请指定的记忆层级');
        if (prior.scope === 'person') throw Error('通用个人记忆需要在其来源范围内维护，当前申请不能直接修改');
        return prior;
      };
      let lastToolError = '';
      try {
        let finished: z.infer<typeof finishSchema> | undefined;
        for (let round = 0; round < config.effective(task.chatKey).maxRounds && !finished; round++) {
          run.assertActive();
          check(task.chatKey);
          const result = await model.complete(
            messages,
            definitions.map(([name, description, schema]) => ({
              type: 'function' as const,
              function: { name, description, parameters: z.toJSONSchema(schema, { io: 'input' }) },
            })),
            run.signal,
            { chatKey: task.chatKey, runId: run.id, purpose: 'memory', round: round + 1 },
          );
          archive.usage.input += result.usage.input;
          archive.usage.output += result.usage.output;
          if (result.billing) (archive.usage.models ??= []).push({ ...result.billing, ...result.usage });
          // Imported model adapters may still produce the old extraction envelope.
          // Translate it into the same validated maintenance operations, never a second write path.
          if (
            !result.message.tool_calls?.length &&
            textContent(result.message.content).trim().startsWith('{')
          ) {
            const envelope = z
              .object({
                candidates: z
                  .array(
                    z.object({
                      scope: z.enum(['chat', 'chat_person', 'person']),
                      key: z.string(),
                      text: z.string(),
                      personId: z
                        .union([z.string(), z.number().int().safe().positive().transform(String)])
                        .nullable()
                        .optional(),
                      sourceIds: z.array(z.number().int().positive()),
                      sensitive: z.boolean().default(false),
                      direct: z.boolean().default(false),
                      importance: z.number().default(0.5),
                    }),
                  )
                  .max(30),
              })
              .parse(JSON.parse(textContent(result.message.content)));
            result.message.tool_calls = envelope.candidates
              .filter(
                (c) =>
                  c.scope !== 'person' || (c.direct && !c.sensitive && !task.chatKey.startsWith('private:')),
              )
              .map((c) => ({
                id: randomUUID(),
                type: 'function' as const,
                function: {
                  name: 'memory_write',
                  arguments: JSON.stringify({
                    tier: 'short',
                    scope: c.scope,
                    key: c.key,
                    content: c.text,
                    personId: c.personId ?? undefined,
                    sourceIds: c.sourceIds,
                    sensitive: c.sensitive,
                    importance: c.importance,
                  }),
                },
              }));
            result.message.tool_calls.push({
              id: randomUUID(),
              type: 'function',
              function: {
                name: 'memory_finish',
                arguments: JSON.stringify({ summary: '兼容提炼结果已处理' }),
              },
            });
          }
          messages.push(result.message);
          trace?.record(run.id, 'model.response', '记忆维护模型输出', result);
          if (!result.message.tool_calls?.length) {
            messages.push({ role: 'user', content: '请使用维护工具；完成或无需修改时调用memory_finish。' });
            continue;
          }
          for (const call of result.message.tool_calls) {
            run.assertActive();
            let output: unknown;
            trace?.record(run.id, 'tool.call', call.function.name, { arguments: call.function.arguments });
            try {
              const raw: unknown = JSON.parse(call.function.arguments);
              switch (call.function.name) {
                case 'memory_inspect': {
                  const v = inspectSchema.parse(raw);
                  let rows = list(task.chatKey, v.tier);
                  if (v.id) rows = rows.filter((r) => r.id === v.id);
                  if (v.query)
                    rows = rows.filter((r) =>
                      `${r.key} ${r.text}`.toLowerCase().includes(v.query!.toLowerCase()),
                    );
                  rows = rows.slice(v.offset, v.offset + 20);
                  for (const r of rows) known.set(r.id, r);
                  output = { records: rows };
                  break;
                }
                case 'memory_write': {
                  const v = writeSchema.parse(raw);
                  const prior = v.id ? verifyTarget(v.id, v.expectedRevision) : undefined;
                  if (task.tier && task.tier !== v.tier) throw Error('写入超出了申请指定的层级');
                  if (prior && (v.scope !== prior.scope || (v.personId ?? null) !== prior.personId))
                    throw Error('修改不能改变记忆的可见范围');
                  if (v.tier === 'short' && v.content.length > 4000) throw Error('短期条目不能超过4000字');
                  if (v.sourceRecordIds.some((id) => !known.has(id))) throw Error('引用的记忆来源尚未读取');
                  if (v.noteIds.some((id) => !knownNotes.has(id)))
                    throw Error('引用的草稿来源不属于当前会话');
                  if (v.sourceIds.some((id) => !permittedSources.has(id)))
                    throw Error('引用了未读取或不属于当前申请的来源ID');
                  if (
                    v.scope === 'person' &&
                    (v.sensitive ||
                      task.chatKey.startsWith('private:') ||
                      !v.personId ||
                      !v.sourceIds.length ||
                      v.sourceIds.some(
                        (id) =>
                          storage.messages(task.chatKey).find((m) => m.localId === id)?.senderId !==
                          v.personId,
                      ))
                  )
                    throw Error('通用个人记忆需要群聊本人明确的非敏感来源');
                  if (
                    v.scope === 'chat_person' &&
                    (!v.personId || !storage.hasSender(task.chatKey, v.personId))
                  )
                    throw Error('成员必须来自当前会话');
                  for (const id of v.supersedes) {
                    const old = known.get(id);
                    verifyTarget(id, old?.revision, true);
                    if (old?.document?.role === 'persona') throw Error('不能替换删除初始人设文档');
                  }
                  const normalized = (s: string) => s.replace(/\s+/g, '').toLowerCase();
                  if (
                    load().forgotten.some(
                      (f) =>
                        f.chatKey === task.chatKey &&
                        f.tier === v.tier &&
                        f.text.length > 0 &&
                        normalized(v.content).includes(normalized(f.text)),
                    )
                  )
                    throw Error('内容包含已明确遗忘的旧结论，请保留其他内容');
                  const existing =
                    !v.id &&
                    [...known.values()].find(
                      (r) =>
                        r.key === v.key &&
                        r.tier === v.tier &&
                        r.scope === v.scope &&
                        r.personId === (v.scope === 'chat' ? null : (v.personId ?? null)),
                    );
                  if (existing) {
                    if (existing.text === v.content) {
                      output = { duplicate: true, id: existing.id };
                      break;
                    }
                    throw Error(
                      `已有同主题记忆 ${existing.id} revision=${existing.revision}，请用id和expectedRevision更正`,
                    );
                  }
                  const id = v.id ?? randomUUID();
                  staged.set(id, { ...v, id });
                  deleted.delete(id);
                  output = { staged: true, id };
                  break;
                }
                case 'memory_forget': {
                  const v = forgetSchema.parse(raw);
                  const note = knownNotes.get(v.id);
                  if (note) {
                    if (task.tier && task.tier !== 'scratchpad') throw Error('删除超出申请层级');
                    if (note.revision !== v.expectedRevision) throw Error('草稿版本冲突');
                  } else {
                    const prior = verifyTarget(v.id, v.expectedRevision);
                    if (prior.document?.role === 'persona') throw Error('人设文档应融合修改，不能整份删除');
                  }
                  deleted.set(v.id, v);
                  staged.delete(v.id);
                  output = { staged: true };
                  break;
                }
                case 'scratchpad_write': {
                  const v = noteSchema.parse(raw);
                  if (task.tier && task.tier !== 'scratchpad') throw Error('写入超出申请层级');
                  if (v.sourceIds.some((id) => !permittedSources.has(id))) throw Error('草稿来源无效');
                  if (v.id && knownNotes.get(v.id)?.revision !== v.expectedRevision)
                    throw Error('草稿版本冲突');
                  const id = v.id ?? randomUUID();
                  notes.set(id, { ...v, id });
                  output = { staged: true, id };
                  break;
                }
                case 'memory_finish':
                  finished = finishSchema.parse(raw);
                  output = { ready: true };
                  break;
                default:
                  throw Error('记忆Agent只能调用维护工具');
              }
            } catch (error) {
              lastToolError = memoryError(error);
              output = { isError: true, error: lastToolError };
            }
            trace?.record(run.id, 'tool.result', call.function.name, output);
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
            if (finished) break;
          }
        }
        if (!finished) throw Error('记忆维护达到最大工具轮数，未提交任何修改');
        if (!finished.clarification && lastToolError && !staged.size && !deleted.size && !notes.size)
          throw Error('没有可提交的修改：' + lastToolError);
        run.assertActive();
        check(task.chatKey);
        if (load().personas[task.chatKey]?.epoch !== epoch) throw Error('PERSONA_CHANGED');
        const changes: MemoryRequest['changes'] = [];
        repo.transaction(() => {
          if (!finished!.clarification) {
            for (const [id, v] of staged) {
              const prior = known.get(id);
              if (prior && repo.record(id)?.revision !== v.expectedRevision)
                throw Error('记忆版本冲突，请重试申请');
              const sources = v.sourceIds.length
                ? storage
                    .messages(task.chatKey)
                    .filter((m) => v.sourceIds.includes(m.localId))
                    .map((m) => ({ chatKey: task.chatKey, localId: m.localId, senderId: m.senderId }))
                : (prior?.sources ?? []);
              for (const sourceId of v.sourceRecordIds)
                for (const source of known.get(sourceId)!.sources)
                  if (!sources.some((s) => JSON.stringify(s) === JSON.stringify(source)))
                    sources.push(source as any);
              sources.push(
                ...(v.noteIds.map((id) => ({
                  chatKey: task.chatKey,
                  noteId: id,
                  noteRevision: knownNotes.get(id)!.revision,
                })) as any),
              );
              const document =
                v.tier !== 'short'
                  ? {
                      title: v.title ?? prior?.document?.title ?? v.key,
                      topic: v.key,
                      role: prior?.document?.role ?? ('knowledge' as const),
                      ...(prior?.document?.personaEpoch ? { personaEpoch: epoch } : {}),
                    }
                  : undefined;
              const value = {
                derivedFrom: v.sourceRecordIds.map((id) => ({ id, revision: known.get(id)!.revision })),
                scope: v.scope,
                tier: v.tier,
                chatKey: v.scope === 'person' ? null : task.chatKey,
                personId: v.scope === 'chat' ? null : (v.personId ?? null),
                key: v.key,
                text: v.content,
                document,
                visibility: v.scope === 'person' ? ('cross_chat' as const) : ('chat_only' as const),
                sensitive: v.sensitive,
                confidence: prior?.confidence ?? 0.8,
                importance: v.importance,
                pinned: prior?.pinned ?? false,
                sources,
                origin:
                  task.origin === 'schedule'
                    ? ('automatic' as const)
                    : task.origin === 'user'
                      ? ('admin' as const)
                      : ('agent' as const),
                expiresAt:
                  v.tier === 'long'
                    ? null
                    : (prior?.expiresAt ??
                      Date.now() +
                        (v.tier === 'short'
                          ? config.effective(task.chatKey).memory.shortRetentionMs
                          : config.effective(task.chatKey).memory.mediumRetentionMs)),
              };
              let saved: MemoryRecord;
              if (prior)
                saved = memory.publish(
                  id,
                  { ...value, factVersion: (prior.factVersion ?? 1) + 1 },
                  v.expectedRevision,
                );
              else
                saved = memory.remember({ ...value, ...(document ? { factId: documentFactId(value) } : {}) });
              for (const sourceId of v.sourceRecordIds) {
                const old = repo.record(sourceId)!;
                if (old.tier !== v.tier && old.status === 'active' && old.consolidatedAt === undefined)
                  memory.publish(old.id, { consolidatedAt: Date.now() }, old.revision);
              }
              for (const noteId of v.noteIds) {
                const note = repo.note(noteId)!;
                repo.saveNote(
                  { ...note, promotion: 'done', consolidatedAt: Date.now(), revision: note.revision + 1 },
                  note.revision,
                );
              }
              changes.push({
                id: saved.id,
                action: prior ? 'update' : 'create',
                before: prior?.text,
                after: saved.text,
              });
              for (const oldId of v.supersedes) {
                const old = known.get(oldId)!;
                const live = repo.record(oldId)!;
                if (live.status === 'active') memory.publish(oldId, { status: 'superseded' }, live.revision);
                changes.push({ id: oldId, action: 'supersede', before: old.text });
              }
            }
            for (const [id, v] of deleted) {
              const note = knownNotes.get(id);
              if (note) {
                if (repo.note(id)?.revision !== v.expectedRevision) throw Error('草稿版本冲突');
                repo.deleteNote(id);
                changes.push({ id, action: 'forget', before: note.text });
              } else {
                const old = known.get(id)!;
                memory.remove(id, v.expectedRevision);
                changes.push({ id, action: 'forget', before: old.text });
              }
            }
            for (const [id, v] of notes) {
              const old = knownNotes.get(id),
                now = Date.now();
              const note: ScratchpadNote = {
                id,
                chatKey: task.chatKey,
                text: v.text,
                sourceIds: v.sourceIds,
                important: v.important,
                promotion: 'pending',
                createdAt: old?.createdAt ?? now,
                updatedAt: now,
                expiresAt: now + config.effective(task.chatKey).scratchpadMaxDays * day,
                revision: (old?.revision ?? 0) + 1,
                status: 'active',
              };
              repo.saveNote(note, old?.revision ?? 0);
              changes.push({ id, action: old ? 'update' : 'create', before: old?.text, after: v.text });
            }
            if (task.origin === 'schedule' && task.tier === 'short') {
              memory.publishDrafts(task.chatKey);
              if (evidence.length) repo.setCursor(task.chatKey, evidence.at(-1)!.localId);
            }
          }
          change((state) => {
            const t = state.tasks.find((t) => t.id === task.id)!;
            t.status = finished!.clarification ? 'needs_clarification' : 'completed';
            t.summary = finished!.clarification || finished!.summary;
            t.changes = changes;
            t.updatedAt = Date.now();
            if (!finished!.clarification) {
              for (const v of staged.values())
                if (v.forgottenText)
                  state.forgotten.push({
                    chatKey: task.chatKey,
                    tier: v.tier,
                    text: v.forgottenText,
                    at: Date.now(),
                  });
              for (const id of deleted.keys()) {
                const old = known.get(id);
                if (old)
                  state.forgotten.push({
                    chatKey: task.chatKey,
                    tier: old.tier,
                    text: old.text.slice(0, 4000),
                    at: Date.now(),
                  });
              }
            }
            if (task.origin === 'schedule' && task.tier && task.tier !== 'scratchpad') {
              const schedule = status(task.chatKey);
              const stage = schedule.stages[task.tier];
              stage.lastSuccessAt = Date.now();
              stage.error = undefined;
              stage.nextAt = Date.now() + schedule.settings[`${task.tier}IntervalMs`];
              state.schedules[task.chatKey] = schedule;
            }
          });
        });
        archive.status = 'completed';
        archive.reason = finished.summary;
        trace?.record(run.id, 'finish', '记忆申请处理完成', {
          requestId: task.id,
          changes,
          summary: finished.summary,
        });
        void sync();
        return { requestId: task.id, changes };
      } catch (error) {
        const changedPersona = error instanceof Error && error.message === 'PERSONA_CHANGED';
        stopping ||=
          run.signal.aborted &&
          run.signal.reason instanceof Error &&
          run.signal.reason.message === '运行时关闭';
        archive.status = run.signal.aborted ? 'cancelled' : 'failed';
        archive.reason = memoryError(error);
        if (!ctx.signal.aborted)
          change((state) => {
            const t = state.tasks.find((t) => t.id === task.id)!;
            t.status = changedPersona || stopping ? 'queued' : run.signal.aborted ? 'cancelled' : 'failed';
            t.error = changedPersona || stopping ? undefined : memoryError(error);
            t.updatedAt = Date.now();
            if (!stopping && task.origin === 'schedule' && task.tier && task.tier !== 'scratchpad') {
              const schedule = status(task.chatKey);
              schedule.stages[task.tier].lastFailureAt = Date.now();
              schedule.stages[task.tier].error = t.error;
              schedule.stages[task.tier].nextAt =
                Date.now() + Math.min(60000, schedule.settings[`${task.tier}IntervalMs`]);
              state.schedules[task.chatKey] = schedule;
            }
          });
        trace?.record(run.id, 'error', '记忆维护失败', { message: archive.reason, requestId: task.id });
        if (!changedPersona) throw error;
      } finally {
        if (!ctx.signal.aborted) {
          archive.endedAt = Date.now();
          storage.archive(archive);
          ctx.host.publish('memory.changed', { chatKey: task.chatKey, requestId: task.id });
        }
        trace?.end(run.id, archive.status);
      }
    },
  });
  function pump() {
    if (ctx.signal.aborted || stopping || activeRun) return;
    const task = load().tasks.find((t) => t.status === 'queued');
    if (!task) return;
    if (!enabled(task.chatKey)) {
      change((state) => {
        const t = state.tasks.find((t) => t.id === task.id)!;
        t.status = 'cancelled';
        t.error = '会话记忆已关闭或撤销准入';
      });
      queueMicrotask(pump);
      return;
    }
    let run: ReturnType<typeof ctx.host.submit>;
    try {
      run = ctx.host.submit({
        mode: 'memory.agent',
        partitionKey: 'memory-maintenance',
        input: { id: task.id },
        timeoutMs: config.effective(task.chatKey).runTimeoutMs,
      });
    } catch (error) {
      // The request is already durable. Queue pressure must not turn acceptance into an HTTP failure.
      ctx.log('记忆申请已排队，等待运行容量：' + memoryError(error));
      return;
    }
    activeRun = run.id;
    change((state) => {
      const t = state.tasks.find((t) => t.id === task.id)!;
      t.runId = run.id;
    });
    void ctx.host
      .wait(run.id)
      .catch((error) => {
        if (!ctx.signal.aborted) ctx.log('记忆运行等待失败：' + memoryError(error));
      })
      .finally(() => {
        activeRun = undefined;
        if (!ctx.signal.aborted) queueMicrotask(pump);
      });
  }
  const tick = () => {
    if (ctx.signal.aborted || stopping) return;
    // Memory maintenance remains available while outward activity is offline.
    for (const key of new Set([
      ...config.get().admissions,
      ...Object.keys(config.get().profiles),
      ...storage.chats().map((c) => c.chatKey),
    ])) {
      if (!enabled(key) || !config.effective(key).online || !config.effective(key).memory.enabled) continue;
      const schedule = status(key);
      if (
        !load().schedules[key] ||
        JSON.stringify(load().schedules[key]?.settings) !== JSON.stringify(schedule.settings)
      )
        change((state) => {
          state.schedules[key] = schedule;
        });
      for (const tier of tiers)
        if (schedule.stages[tier].nextAt <= Date.now()) {
          const dirty =
            tier === 'short'
              ? storage.messagesAfter(key, repo.cursor(key), 1).length > 0 ||
                memory.drafts(key).some((d) => d.status === 'pending') ||
                repo.notes(key).some((n) => n.promotion !== 'done')
              : memory
                  .list(key)
                  .some(
                    (r) =>
                      r.tier === (tier === 'medium' ? 'short' : 'medium') &&
                      r.consolidatedAt === undefined &&
                      r.document?.role !== 'persona',
                  );
          if (!dirty) {
            change((state) => {
              const s = status(key);
              s.stages[tier].nextAt = Date.now() + s.settings[`${tier}IntervalMs`];
              state.schedules[key] = s;
            });
            continue;
          }
          request({
            chatKey: key,
            tier,
            origin: 'schedule',
            instruction:
              tier === 'short'
                ? '从新消息和草稿本提炼值得记住的短期事实，并处理待生效更正；结合当前人设和旧记忆取舍。'
                : `将相关${tier === 'medium' ? '短期条目' : '中期文档'}与已有${tier}文档进行语义融合，选择保留的内容，并处理过期内容。`,
            idempotencyKey: `schedule:${tier}:${schedule.stages[tier].nextAt}`,
          });
        }
    }
    repo.expireNotes(Date.now());
    for (const record of repo.records())
      if (
        record.status === 'active' &&
        record.document?.role !== 'persona' &&
        record.expiresAt !== null &&
        record.expiresAt <= Date.now() &&
        record.consolidatedAt !== undefined
      )
        memory.publish(record.id, { status: 'superseded' }, record.revision);
    void sync();
    pump();
  };
  const timer = setInterval(() => {
    try {
      tick();
    } catch (error) {
      if (!ctx.signal.aborted) ctx.log('记忆维护暂缓：' + memoryError(error));
    }
  }, 1000);
  timer.unref?.();
  ctx.effect(() => {
    clearInterval(timer);
    if (activeRun) ctx.host.cancel(activeRun);
  });
  const knownChats = () =>
    new Set([
      ...Object.keys(load().personas),
      ...config.get().admissions,
      ...Object.keys(config.get().profiles),
      ...storage.chats().map((c) => c.chatKey),
    ]);
  ctx.effect(
    ctx.host.subscribe((event) => {
      if (event.type === 'config.changed') for (const key of knownChats()) if (enabled(key)) persona(key);
    }),
  );
  queueMicrotask(() => {
    for (const key of knownChats()) if (enabled(key)) persona(key);
    tick();
    void index
      .rebuild(
        repo
          .records()
          .filter((r) => retained(r))
          .map(indexable),
      )
      .then(() => sync())
      .catch(() => {});
    pump();
  });
  const service: MemoryAgentService = {
    request,
    list,
    persona,
    status,
    requests: (chatKey) => {
      check(chatKey);
      return load()
        .tasks.filter((t) => t.chatKey === chatKey)
        .reverse();
    },
    clarify: (chatKey, id, instruction) => {
      check(chatKey);
      const task = change((state) => {
        const t = state.tasks.find((t) => t.id === id && t.chatKey === chatKey);
        if (!t || !['needs_clarification', 'failed', 'cancelled'].includes(t.status))
          throw Error('任务不能补充或重试');
        t.instruction += '\n补充说明：' + z.string().trim().min(1).max(10000).parse(instruction);
        t.status = 'queued';
        t.error = undefined;
        t.updatedAt = Date.now();
        return t;
      });
      queueMicrotask(pump);
      return task;
    },
    read: (chatKey, id) => {
      check(chatKey);
      return list(chatKey).find((r) => r.id === id) ?? repo.notes(chatKey).find((n) => n.id === id);
    },
  };
  return { service, sync };
}
