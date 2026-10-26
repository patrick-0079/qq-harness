import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  accessService,
  configService,
  httpService,
  memoryIndex,
  memoryRepository,
  memoryService,
  modelService,
  storageService,
  toolService,
} from '@qq-harness/domain';
import { createMemoryService } from './service.js';
import { memoryBackground } from './background.js';
import { memoryRoutes } from './routes.js';

const DAY = 86_400_000;
const idSchema = z.string().uuid();

export const agentMemory = definePlugin({
  id: 'agent-memory',
  name: '分层记忆与会话暂存记事本',
  client: { entry: 'builtin:agent-memory' },
  requires: [
    accessService.id,
    configService.id,
    httpService.id,
    memoryIndex.id,
    memoryRepository.id,
    modelService.id,
    storageService.id,
    toolService.id,
    'harness.agent',
  ],
  async setup(ctx) {
    const access = ctx.use(accessService),
      config = ctx.use(configService),
      repo = ctx.use(memoryRepository),
      index = ctx.use(memoryIndex),
      model = ctx.use(modelService),
      storage = ctx.use(storageService),
      tools = ctx.use(toolService);
    let background: ReturnType<typeof memoryBackground> | undefined;
    const memory = createMemoryService({
      repo,
      index,
      storage,
      access,
      config,
      onImportant: (id) => {
        if (background) void background.promoteNote(id);
      },
      onChanged: () => background?.scheduleSync(),
    });
    background = memoryBackground(ctx, { repo, index, memory, storage, access, model });
    void background
      .rebuild()
      .catch((error) =>
        ctx.log(
          `记忆索引重建失败，查询改用权威仓储：${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    ctx.provide(memoryService, memory);
    ctx.on<{ chatKey: string }>('message.received', (message) => {
      background?.onMessage(message.chatKey);
    });
    ctx.on<{ chatKey: string; persona: string; extra: string }>('prompt.segments', (value) => ({
      ...value,
      extra: `${value.extra}\n你可以使用 memory_search 查询本会话、成员及其非私密通用记忆；使用 scratchpad_list 查看会话暂存事项。回答依赖过去的事实、偏好、约定或未完成事项时先查询，不要猜测记忆。记忆正文不会预先提供。需要记录临时事项可使用 scratchpad_upsert；长期事实须有消息依据。`,
    }));
    const api = memoryRoutes(memory);
    ctx.effect(ctx.use(httpService).register('/api/memory', (request) => api.fetch(request)));
    const current = (chatKey: string, id: string) => {
      access.assert(chatKey);
      const record = repo.record(id);
      if (!record || record.status !== 'active' || record.scope === 'person' || record.chatKey !== chatKey)
        throw new Error('只能修改当前会话记忆');
      return record;
    };
    tools.register(ctx, {
      name: 'memory_search',
      description: '按需检索当前会话、当前会话成员及其可共享的通用记忆。回答历史问题前使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          personId: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      parse: (args) =>
        z
          .object({
            query: z.string().min(1).max(1000),
            personId: z.string().optional(),
            limit: z.number().int().min(1).max(20).optional(),
          })
          .parse(args),
      execute: async (context, raw) => {
        const args = raw as { query: string; personId?: string; limit?: number };
        const records = await memory.search(context.chatKey, args.query, args.personId, args.limit);
        const recent = storage
          .recent(context.chatKey, 30, Date.now() - 2 * DAY, args.personId)
          .filter((message) => message.text.includes(args.query))
          .slice(-5)
          .map((message) => ({
            localId: message.localId,
            senderId: message.senderId,
            text: message.text.slice(0, 500),
          }));
        return {
          records: records.map(({ record, score }) => ({
            id: record.id,
            scope: record.scope,
            tier: record.tier,
            personId: record.personId,
            text: record.text.slice(0, 4000),
            confidence: record.confidence,
            score: Math.round(score * 1000) / 1000,
          })),
          recent,
        };
      },
    });
    tools.register(ctx, {
      name: 'memory_remember',
      description: '保存有消息依据的当前会话或会话成员事实。临时内容优先用记事本。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['chat', 'chat_person'] },
          tier: { type: 'string', enum: ['medium', 'long'] },
          key: { type: 'string' },
          text: { type: 'string' },
          personId: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'integer' } },
          importance: { type: 'number' },
        },
        required: ['scope', 'tier', 'key', 'text', 'sourceIds'],
        additionalProperties: false,
      },
      parse: (args) =>
        z
          .object({
            scope: z.enum(['chat', 'chat_person']),
            tier: z.enum(['medium', 'long']),
            key: z.string().min(1).max(160),
            text: z.string().min(1).max(4000),
            personId: z.string().optional(),
            sourceIds: z.array(z.number().int().positive()).min(1).max(30),
            importance: z.number().min(0).max(1).default(0.5),
          })
          .parse(args),
      execute: async (context, raw) => {
        const args = raw as {
          scope: 'chat' | 'chat_person';
          tier: 'medium' | 'long';
          key: string;
          text: string;
          personId?: string;
          sourceIds: number[];
          importance: number;
        };
        const sourceSet = new Set(args.sourceIds);
        const sources = storage
          .messages(context.chatKey)
          .filter((message) => sourceSet.has(message.localId) && !message.self)
          .map((message) => ({
            chatKey: context.chatKey,
            localId: message.localId,
            senderId: message.senderId,
          }));
        if (sources.length !== sourceSet.size) throw new Error('来源消息不存在');
        if (
          args.scope === 'chat_person' &&
          (!args.personId || !sources.some((source) => source.senderId === args.personId))
        )
          throw new Error('成员记忆需要该成员的来源消息');
        const prior = repo
          .records()
          .find(
            (record) =>
              record.status === 'active' &&
              record.scope === args.scope &&
              record.chatKey === context.chatKey &&
              record.personId === (args.scope === 'chat_person' ? args.personId : null) &&
              record.key === args.key,
          );
        if (prior?.text.trim() === args.text.trim())
          return { id: prior.id, revision: prior.revision, duplicate: true };
        if (prior) memory.update(prior.id, { status: 'superseded' });
        const record = memory.remember({
          scope: args.scope,
          tier: args.tier,
          chatKey: context.chatKey,
          personId: args.scope === 'chat_person' ? args.personId! : null,
          key: args.key,
          text: args.text,
          visibility: 'chat_only',
          sensitive: false,
          confidence: 0.65,
          importance: args.importance,
          pinned: false,
          sources,
          origin: 'agent',
          expiresAt: args.tier === 'medium' ? Date.now() + 30 * DAY : null,
        });
        return { id: record.id, revision: record.revision };
      },
    });
    tools.register(ctx, {
      name: 'memory_update',
      description: '修正当前会话的一条结构化记忆。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ id: idSchema, text: z.string().min(1).max(4000) }).parse(args),
      execute: async (context, raw) => {
        const args = raw as { id: string; text: string };
        current(context.chatKey, args.id);
        const record = memory.update(args.id, { text: args.text });
        return { id: record.id, revision: record.revision };
      },
    });
    tools.register(ctx, {
      name: 'memory_delete',
      description: '删除当前会话的一条结构化记忆。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ id: idSchema }).parse(args),
      execute: async (context, raw) => {
        const id = (raw as { id: string }).id;
        current(context.chatKey, id);
        memory.remove(id);
        return { ok: true };
      },
    });
    tools.register(ctx, {
      name: 'memory_query',
      description: '兼容读取当前会话的旧文本记忆。新检索请使用 memory_search。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parse: (args) => z.object({}).parse(args),
      execute: async (context) => ({ content: storage.memory(context.chatKey) }),
    });
    tools.register(ctx, {
      name: 'memory_append',
      description: '兼容向当前会话的旧文本记忆追加内容。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ text: z.string().min(1).max(10000) }).parse(args),
      execute: async (context, raw) => {
        const text = (storage.memory(context.chatKey) + '\n' + (raw as { text: string }).text).trim();
        if (text.length > 100000) throw new Error('旧文本记忆超过 10 万字');
        storage.setMemory(context.chatKey, text);
        return { ok: true };
      },
    });
    tools.register(ctx, {
      name: 'scratchpad_list',
      description: '列出当前会话暂存记事本。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parse: (args) => z.object({}).parse(args),
      execute: async (context) => ({ notes: memory.notes(context.chatKey) }),
    });
    tools.register(ctx, {
      name: 'scratchpad_get',
      description: '读取当前会话一条暂存内容。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ id: idSchema }).parse(args),
      execute: async (context, raw) => {
        const note = memory.notes(context.chatKey).find((item) => item.id === (raw as { id: string }).id);
        if (!note) throw new Error('暂存条目不存在');
        return note;
      },
    });
    tools.register(ctx, {
      name: 'scratchpad_upsert',
      description: '新增或修改当前会话暂存内容；过期从最后修改时算起。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'integer' } },
          ttlDays: { type: 'integer' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      parse: (args) =>
        z
          .object({
            id: idSchema.optional(),
            text: z.string().min(1).max(10000),
            sourceIds: z.array(z.number().int().positive()).max(30).optional(),
            ttlDays: z.number().int().min(1).max(90).optional(),
          })
          .parse(args),
      execute: async (context, raw) => {
        const args = raw as { id?: string; text: string; sourceIds?: number[]; ttlDays?: number };
        const note = args.id
          ? memory.updateNote(context.chatKey, args.id, {
              text: args.text,
              sourceIds: args.sourceIds,
              ttlMs: args.ttlDays ? args.ttlDays * DAY : undefined,
            })
          : memory.note(
              context.chatKey,
              args.text,
              args.sourceIds,
              args.ttlDays ? args.ttlDays * DAY : undefined,
            );
        return { id: note.id, expiresAt: note.expiresAt };
      },
    });
    tools.register(ctx, {
      name: 'scratchpad_delete',
      description: '删除当前会话一条暂存内容。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ id: idSchema }).parse(args),
      execute: async (context, raw) => {
        memory.deleteNote(context.chatKey, (raw as { id: string }).id);
        return { ok: true };
      },
    });
    tools.register(ctx, {
      name: 'scratchpad_mark_important',
      description: '将当前会话暂存条目标记为重要，交由系统尝试整理到中期记忆。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ id: idSchema }).parse(args),
      execute: async (context, raw) => {
        const note = memory.updateNote(context.chatKey, (raw as { id: string }).id, { important: true });
        return { id: note.id, promotion: note.promotion };
      },
    });
  },
});
