import { z } from 'zod';
import { definePlugin, type PluginContext } from '@qq-harness/plugin-sdk';
import {
  accessService,
  configService,
  toolService,
  toolPolicy,
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
    const guardSchema = z.object({ chatKey: z.string(), name: z.string(), args: z.unknown() });
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
      schema: z.unknown(),
    });
    ctx.on<{ chatKey: string }>(
      'tool.before',
      (value) => {
        access.assert(value.chatKey);
        return true;
      },
      0,
    );
    const available = (owner: PluginContext, chatKey: string) => {
      owner.assertActive();
      ctx.assertActive();
      if (config.get().plugins[owner.id] === false || config.effective(chatKey).plugins[owner.id] === false)
        throw new Error(`当前会话已停用 ${owner.id}`);
    };
    ctx.provide(toolService, {
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
            try {
              available(owner, chatKey);
              return tool.available?.(chatKey) !== false && permitted(tool, chatKey);
            } catch {
              return false;
            }
          })
          .map(({ tool }) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
      execute: async (context, name, raw) => {
        const execute = async () => {
          context.run.assertActive();
          ctx.assertActive();
          const entry = tools.get(name);
          if (!entry) return { isError: true, error: '工具不存在或已经卸载' };
          try {
            available(entry.owner, context.chatKey);
            if (entry.tool.available?.(context.chatKey) === false) throw new Error('工具在当前会话不可用');
            if (!permitted(entry.tool, context.chatKey)) throw new Error('扩展策略否决工具执行');
            access.assert(context.chatKey);
            const args = entry.tool.parse(JSON.parse(raw));
            await ctx.points.guard(
              'tool.before',
              { chatKey: context.chatKey, name, args },
              context.run.signal,
            );
            context.run.assertActive();
            available(entry.owner, context.chatKey);
            const result = await entry.tool.execute(context, args);
            context.trace('tool', `${name}: ${JSON.stringify(result).slice(0, 10000)}`);
            await ctx.points.transform(
              'tool.after',
              { chatKey: context.chatKey, name, args, result },
              context.run.signal,
            );
            return result;
          } catch (error) {
            context.run.signal.throwIfAborted();
            return { isError: true, error: error instanceof Error ? error.message : String(error) };
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
