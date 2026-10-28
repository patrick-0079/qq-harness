import { createHash } from 'node:crypto';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  accessService,
  configService,
  conversationService,
  httpService,
  memoryIndex,
  memoryRepository,
  memoryService,
  memoryAgentService,
  modelService,
  storageService,
  toolService,
  memberMemoryService,
} from '@qq-harness/domain';
import { createMemoryService } from './service.js';
import { createMemoryAgent } from './agent.js';
import { memoryRoutes } from './routes.js';

export const agentMemory = definePlugin({
  id: 'agent-memory',
  name: '独立记忆 Agent 与分层记忆',
  client: { entry: 'builtin:agent-memory' },
  requires: [
    accessService.id,
    configService.id,
    conversationService.id,
    httpService.id,
    memoryIndex.id,
    memoryRepository.id,
    modelService.id,
    storageService.id,
    toolService.id,
    'harness.agent',
  ],
  setup(ctx) {
    const access = ctx.use(accessService),
      config = ctx.use(configService),
      repo = ctx.use(memoryRepository),
      index = ctx.use(memoryIndex),
      model = ctx.use(modelService),
      storage = ctx.use(storageService),
      tools = ctx.use(toolService);
    let runner: ReturnType<typeof createMemoryAgent> | undefined;
    const memory = createMemoryService({
      repo,
      index,
      storage,
      access,
      config,
      onImportant: () => {},
      onChanged: () => {
        if (runner)
          queueMicrotask(() => {
            void runner?.sync();
          });
      },
      consolidation: (key) => runner!.service.status(key),
      consolidate: (key, tier) => {
        const task = runner!.service.request({
          chatKey: key,
          tier: tier ?? 'short',
          instruction: '立即整理相关记忆，与已有内容语义融合，处理待生效更正。',
          origin: 'schedule',
        });
        return task.id;
      },
    });
    ctx.provide(memoryService, memory);
    runner = createMemoryAgent(ctx, { repo, memory, index, model, storage, config, access });
    const agent = runner.service;
    ctx.provide(memoryAgentService, agent);
    ctx.provide(memberMemoryService, {
      query: (key, userId) =>
        agent
          .list(key)
          .filter((r) => r.personId && (!userId || r.personId === userId))
          .map((r) => ({
            id: r.id,
            userId: r.personId!,
            target: r.personName || r.personId!,
            content: r.text,
            tier: r.tier,
            revision: r.revision,
          })),
      append: (key, input) =>
        agent.request({
          chatKey: key,
          instruction: '记录成员印象：' + JSON.stringify(input),
          tier: 'short',
          origin: 'compatibility',
        }),
      remove: (key, selector) =>
        agent.request({
          chatKey: key,
          instruction: '遗忘成员印象：' + JSON.stringify(selector),
          origin: 'compatibility',
        }),
    });
    ctx.on<{
      chatKey: string;
      persona: string;
      extra: string;
      roleText?: string;
      template?: string;
      rules?: string;
      botName?: string;
    }>('prompt.segments', (value) => {
      if (config.effective(value.chatKey).plugins[ctx.id] === false) return value;
      const role = agent.persona(value.chatKey, value.roleText ?? value.persona);
      const template = value.template
        ?.replaceAll('{roleText}', role)
        .replaceAll('{botName}', value.botName ?? '助手')
        .replaceAll('{participation}', '根据语境自然参与对话');
      return {
        ...value,
        roleText: role,
        // Only the persona evolves. Templates and administrator rules remain
        // part of the prompt, including for later compatibility providers.
        persona:
          value.roleText === undefined ? role : [role, template, value.rules].filter(Boolean).join('\n\n'),
        extra:
          value.extra +
          '\n【记忆接口】记忆由独立Agent维护。历史事实、偏好、约定和待办相关回答先调用memory_search，必要时memory_get读取来源和版本，不猜测记忆。发现值得保留的新事实、信息变化、需要遗忘或临时事项时，调用memory_request以自然语言提交申请，可带真实sourceIds（消息localId）。临时事项指定scratchpad；短期存条目，中长期按主题存文档。申请返回queued只表示已受理，不能说已记住或已遗忘；用memory_request_status查询实际结果，有歧义时向用户澄清。',
      };
    });
    const register = <T extends z.ZodType>(
      name: string,
      description: string,
      schema: T,
      execute: (key: string, args: z.output<T>, runId: string) => unknown | Promise<unknown>,
    ) =>
      tools.register(ctx, {
        name,
        displayName: name,
        category: 'memory',
        description,
        parameters: z.toJSONSchema(schema, { io: 'input' }),
        parse: (raw) => schema.parse(raw),
        execute: async (c, a) => execute(c.chatKey, a as z.output<T>, c.run.id),
      });
    register(
      'memory_search',
      '查询当前会话与获准共享的相关有效记忆，回答历史问题前使用。',
      z
        .object({
          query: z.string().trim().min(1).max(1000),
          personId: z.string().regex(/^\d+$/).optional(),
          limit: z.number().int().min(1).max(20).default(8),
        })
        .strict(),
      async (key, a) => ({
        records: (await memory.search(key, a.query, a.personId, a.limit)).map(({ record, score }) => ({
          ...record,
          score,
        })),
        notes: repo
          .notes(key)
          .filter((n) => n.text.includes(a.query))
          .slice(0, 5),
      }),
    );
    register(
      'memory_get',
      '读取当前范围的一条记忆或一份文档，返回正文、来源和版本。',
      z.object({ id: z.string().uuid() }).strict(),
      (key, a) => {
        const item = agent.read(key, a.id);
        if (!item) throw Error('当前会话没有这条有效记忆');
        return item;
      },
    );
    register(
      'memory_request',
      '向独立记忆Agent提交新增、更正、融合、遗忘或草稿本维护申请。异步返回任务ID，queued不代表修改完成。',
      z
        .object({
          instruction: z.string().trim().min(1).max(20000),
          tier: z.enum(['short', 'medium', 'long', 'scratchpad']).optional(),
          sourceIds: z.array(z.number().int().positive()).max(100).optional(),
          targetIds: z.array(z.string().uuid()).max(50).optional(),
        })
        .strict(),
      (key, a, runId) =>
        agent.request({
          ...a,
          chatKey: key,
          origin: 'conversation',
          idempotencyKey: `${runId}:${createHash('sha256').update(JSON.stringify(a)).digest('hex')}`,
        }),
    );
    register(
      'memory_request_status',
      '查询记忆申请的实际处理状态、修改摘要及待澄清问题。',
      z.object({ id: z.string().uuid() }).strict(),
      (key, a) => {
        const task = agent.requests(key).find((t) => t.id === a.id);
        if (!task) throw Error('当前会话没有该申请');
        return task;
      },
    );
    for (const name of ['memory_append', 'memory_query', 'memory_remove'] as const)
      tools.register(ctx, {
        name,
        category: 'memory',
        hiddenFromModel: true,
        description: '兼容旧成员记忆接口；修改以异步申请交给独立记忆Agent。',
        parameters: { type: 'object', properties: {}, additionalProperties: true },
        parse: (a) => z.record(z.string(), z.unknown()).parse(a),
        execute: async (c, args) =>
          name === 'memory_query'
            ? {
                records: agent
                  .list(c.chatKey)
                  .filter((r) => !(args as any).userId || r.personId === String((args as any).userId)),
              }
            : agent.request({
                chatKey: c.chatKey,
                instruction:
                  (name === 'memory_remove' ? '遗忘成员印象：' : '记录成员印象：') + JSON.stringify(args),
                tier: 'short',
                sourceIds: storage
                  .messages(c.chatKey)
                  .filter((m) => m.senderId === String((args as any).userId))
                  .slice(-3)
                  .map((m) => m.localId),
                origin: 'compatibility',
              }),
      });
    const api = memoryRoutes(memory, config, agent, repo);
    ctx.effect(ctx.use(httpService).register('/api/memory', (request) => api.fetch(request)));
  },
});
