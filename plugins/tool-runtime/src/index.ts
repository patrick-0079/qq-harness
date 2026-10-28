import { z } from 'zod';
import { redactKnownSecrets } from '@qq-harness/files';
import { definePlugin, type PluginContext } from '@qq-harness/plugin-sdk';
import {
  accessService,
  configService,
  toolService,
  toolPolicy,
  traceService,
  type TraceService,
  type ToolDefinition,
  type ToolContext,
  type ToolPolicy,
} from '@qq-harness/domain';

export const toolRuntime = definePlugin({
  id: 'tool-runtime',
  name: '工具注册与执行',
  requires: [accessService.id, configService.id],
  setup(ctx) {
    const access = ctx.use(accessService),
      config = ctx.use(configService);
    const tools = new Map<string, { owner: PluginContext; tool: ToolDefinition }>();
    const permitted = (tool: ToolDefinition, chatKey: string) => {
      let policy: ToolPolicy | undefined;
      try {
        policy = ctx.use(toolPolicy);
      } catch {
        /* 可选附加工具策略。 */
      }
      return policy?.allowed(tool, chatKey) !== false;
    };
    const guardSchema = z.object({
      chatKey: z.string(),
      name: z.string(),
      args: z.unknown(),
    });
    ctx.definePoint({
      id: 'tool.input',
      kind: 'transform',
      schema: guardSchema,
    });
    ctx.definePoint({
      id: 'tool.prepare',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: guardSchema,
    });
    ctx.definePoint({
      id: 'tool.before',
      kind: 'guard',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: guardSchema,
      requiredGuard: true,
    });
    ctx.definePoint({
      id: 'tool.after',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: guardSchema.extend({ result: z.unknown() }),
    });
    ctx.on<{ chatKey: string }>(
      'tool.before',
      (value) => {
        access.assert(value.chatKey);
        return true;
      },
      0,
    );
    const available = (owner: PluginContext, chatKey: string, tool?: ToolDefinition) => {
      owner.assertActive();
      ctx.assertActive();
      if (config.get().plugins[owner.id] === false || config.effective(chatKey).plugins[owner.id] === false)
        throw new Error(`当前会话已停用 ${owner.id}`);
      const settings = config.effective(chatKey).tools;
      if (!settings.enabled) throw new Error('工具总开关已关闭');
      if (tool) {
        if (!tool.core && settings.categories[tool.category ?? 'other'] === false)
          throw new Error('工具分类已关闭');
        if (!tool.core && settings.overrides[tool.name] === false) throw new Error('工具已单独关闭');
        if (!tool.core && settings.overrides[tool.name] === undefined && tool.defaultEnabled === false)
          throw Error('工具默认未启用');
        if (tool.name === 'send_to' && !settings.crossChatSend) throw new Error('跨会话发送未开启');
      }
    };
    const reason = (owner: PluginContext, tool: ToolDefinition, chatKey: string) => {
      try {
        available(owner, chatKey, tool);
        if (tool.available?.(chatKey) === false) return '当前运行条件不满足';
        if (!permitted(tool, chatKey)) return '扩展策略否决';
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    ctx.provide(toolService, {
      catalog: (chatKey) =>
        [...tools.values()].map(({ owner, tool }) => {
          const why = reason(owner, tool, chatKey);
          return {
            id: tool.name,
            name: tool.displayName ?? tool.name,
            owner: owner.id,
            category: tool.category ?? 'other',
            core: tool.core === true,
            builtinQQ: tool.builtinQQ === true,
            configuredEnabled:
              tool.core === true ||
              (config.effective(chatKey).tools.overrides[tool.name] ?? tool.defaultEnabled !== false),
            description: tool.description,
            parameters: tool.parameters,
            enabled: !why,
            reason: why,
          };
        }),
      unregister: (name, owner) => {
        if (tools.get(name)?.owner === owner) tools.delete(name);
      },
      register: (owner, tool) => {
        ctx.assertActive();
        owner.assertActive();
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || tools.has(tool.name))
          throw new Error(`非法或重复工具名：${tool.name}`);
        const entry = { owner, tool };
        tools.set(tool.name, entry);
        owner.effect(() => {
          if (tools.get(tool.name) === entry) tools.delete(tool.name);
        });
      },
      list: (chatKey) =>
        [...tools.values()]
          .filter(({ owner, tool }) => {
            if (tool.hiddenFromModel) return false;
            try {
              available(owner, chatKey, tool);
              return tool.available?.(chatKey) !== false && permitted(tool, chatKey);
            } catch {
              return false;
            }
          })
          .map(({ tool }) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
      execute: async (context, name, raw) => {
        const execute = async () => {
          context.run.assertActive();
          ctx.assertActive();
          const entry = tools.get(name);
          if (!entry) return { isError: true, error: '工具不存在或已经卸载' };
          let trace: TraceService | undefined;
          try {
            trace = ctx.use(traceService);
          } catch {
            /* Diagnostics are optional. */
          }
          const startedAt = Date.now(),
            callId = trace?.record(
              context.run.id,
              'tool.call',
              name,
              { arguments: raw },
              { status: 'running' },
            );
          try {
            available(entry.owner, context.chatKey, entry.tool);
            if (entry.tool.available?.(context.chatKey) === false) throw new Error('工具在当前会话不可用');
            if (!permitted(entry.tool, context.chatKey)) throw new Error('扩展策略否决工具执行');
            access.assert(context.chatKey);
            const adapted = await ctx.points.transform(
              'tool.input',
              { chatKey: context.chatKey, name, args: JSON.parse(raw) },
              context.run.signal,
            );
            if (adapted.chatKey !== context.chatKey || adapted.name !== name)
              throw Error('工具输入适配不能改变目标');
            const original = entry.tool.parse(adapted.args);
            const prepared = await ctx.points.transform(
              'tool.prepare',
              { chatKey: context.chatKey, name, args: original },
              context.run.signal,
            );
            if (prepared.chatKey !== context.chatKey || prepared.name !== name)
              throw Error('工具转换不能改变会话或工具名称');
            const args = entry.tool.parse(prepared.args);
            await ctx.points.guard(
              'tool.before',
              { chatKey: context.chatKey, name, args },
              context.run.signal,
            );
            context.run.assertActive();
            available(entry.owner, context.chatKey, entry.tool);
            const result = await entry.tool.execute(context, args);
            context.trace(
              'tool',
              `${name}: ${JSON.stringify(redactKnownSecrets(result, config.get())).slice(0, 10000)}`,
            );
            const transformed = await ctx.points.transform(
              'tool.after',
              { chatKey: context.chatKey, name, args, result },
              context.run.signal,
            );
            trace?.record(
              context.run.id,
              'tool.result',
              name,
              { args, result: transformed.result },
              {
                parentId: callId,
                durationMs: Date.now() - startedAt,
                status:
                  result && typeof result === 'object' && 'isError' in result && result.isError
                    ? 'failed'
                    : 'completed',
              },
            );
            return transformed.result;
          } catch (error) {
            trace?.record(
              context.run.id,
              'tool.result',
              name,
              { error: error instanceof Error ? error.message : String(error) },
              {
                parentId: callId,
                durationMs: Date.now() - startedAt,
                status: context.run.signal.aborted ? 'cancelled' : 'failed',
              },
            );
            context.run.signal.throwIfAborted();
            return {
              isError: true,
              error:
                error instanceof z.ZodError
                  ? error.issues
                      .map((issue) => `${issue.path.join('.') || '参数'}：${issue.message}`)
                      .join('；')
                  : error instanceof Error
                    ? error.message
                    : String(error),
            };
          }
        };
        let scope: { run<T>(tool: ToolContext, fn: () => T): T } | undefined;
        try {
          scope = ctx.use({ id: 'harness.tool-scope' });
        } catch {
          /* 可选的扩展契约适配器。 */
        }
        return scope ? scope.run(context, execute) : execute();
      },
    });
  },
});
