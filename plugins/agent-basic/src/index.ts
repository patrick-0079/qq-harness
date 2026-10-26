import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  configService,
  storageService,
  accessService,
  modelService,
  toolService,
  type ModelMessage,
  type ToolContext,
} from '@qq-harness/domain';
import { chatKeySchema, modelMessageSchema, type Archive } from '@qq-harness/contracts';

export const agentBasic = definePlugin({
  id: 'agent-basic',
  name: '无状态 Agent 运行模式',
  requires: [
    configService.id,
    storageService.id,
    accessService.id,
    modelService.id,
    toolService.id,
    'harness.basic-tools',
  ],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      access = ctx.use(accessService),
      model = ctx.use(modelService),
      tools = ctx.use(toolService);
    ctx.definePoint({
      id: 'context.build',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({
        chatKey: chatKeySchema,
        text: z.string(),
        triggerEntries: z.array(z.unknown()).optional(),
      }),
    });
    ctx.definePoint({
      id: 'prompt.segments',
      kind: 'transform',
      schema: z.object({ chatKey: chatKeySchema, persona: z.string(), extra: z.string() }),
    });
    // 兼容层内部逐扩展执行旧版 5s 超时；外层仍受运行截止时间与取消约束。
    ctx.definePoint({
      id: 'messages.before',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({ chatKey: chatKeySchema, messages: z.array(modelMessageSchema) }),
    });
    ctx.definePoint({
      id: 'model.after',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({ chatKey: chatKeySchema, response: modelMessageSchema }),
    });
    ctx.definePoint({ id: 'run.ended', kind: 'observe', schema: z.unknown() });
    ctx.mode({
      id: 'agent.basic',
      partitionKey: (input) => input.chatKey,
      input: z.object({ chatKey: chatKeySchema, ids: z.array(z.number().int()) }),
      execute: async (run, input) => {
        const settings = config.effective(input.chatKey);
        access.assert(input.chatKey);
        const selected = new Set(input.ids);
        const triggers = storage.unread(input.chatKey).filter((message) => selected.has(message.localId));
        if (!settings.online || !triggers.length) return { skipped: true };
        const archive: Archive = {
          id: run.id,
          chatKey: input.chatKey,
          startedAt: Date.now(),
          endedAt: 0,
          status: 'running',
          sent: 0,
          trace: [],
          usage: { input: 0, output: 0 },
        };
        const context: ToolContext = {
          run,
          chatKey: input.chatKey,
          settings,
          sent: 0,
          trace: (type, text) => {
            archive.trace.push({ type, text, timestamp: Date.now() });
            ctx.host.publish('run.trace', { id: run.id, type, text });
          },
        };
        storage.markRead(
          input.chatKey,
          triggers.map((message) => message.localId),
        );
        const execute = async () => {
          try {
            const built = await ctx.points.transform(
              'context.build',
              {
                chatKey: input.chatKey,
                triggerEntries: triggers.map((message) => ({
                  ...message,
                  ...(message.metadata ?? {}),
                  id: message.localId,
                  mid: message.id,
                  ts: message.timestamp,
                })),
                text: triggers
                  .map((message) => `${message.senderName || message.senderId}: ${message.text}`)
                  .join('\n'),
              },
              run.signal,
            );
            const prompt = await ctx.points.transform(
              'prompt.segments',
              { chatKey: input.chatKey, persona: settings.persona, extra: '' },
              run.signal,
            );
            // 业务安全与工具协议最后追加，增强插件只通过受控阶段贡献文本。
            let messages: ModelMessage[] = [
              {
                role: 'system',
                content: `${prompt.persona}\n${prompt.extra}\n只操作当前会话。需要发言时调用 send_message，结束时调用 finish。未发送时不能声称已发送。`,
              },
              { role: 'user', content: built.text },
            ];
            for (let round = 0; round < settings.maxRounds; round++) {
              run.assertActive();
              ctx.assertActive();
              messages = (
                await ctx.points.transform(
                  'messages.before',
                  { chatKey: input.chatKey, messages },
                  run.signal,
                )
              ).messages;
              const result = await model.complete(messages, tools.list(input.chatKey), run.signal);
              archive.usage.input += result.usage.input;
              archive.usage.output += result.usage.output;
              if (result.extraUsage) {
                archive.usage.extra ??= {};
                for (const [key, value] of Object.entries(result.extraUsage))
                  archive.usage.extra[key] = (archive.usage.extra[key] ?? 0) + value;
              }
              const response = (
                await ctx.points.transform(
                  'model.after',
                  { chatKey: input.chatKey, response: result.message },
                  run.signal,
                )
              ).response;
              messages.push(response);
              if (response.content) context.trace('assistant', response.content);
              if (!response.tool_calls?.length) {
                messages.push({
                  role: 'user',
                  content: '请用工具发送你的回复；若决定不发言，请调用 finish(mode="silent") 并说明理由。',
                });
                continue;
              }
              for (const call of response.tool_calls) {
                run.assertActive();
                const output = await tools.execute(context, call.function.name, call.function.arguments);
                messages.push({ role: 'tool', content: JSON.stringify(output), tool_call_id: call.id });
                if (context.finish) break;
              }
              if (context.finish) break;
            }
            archive.status = context.finish
              ? context.finish.mode === 'silent'
                ? 'silent'
                : 'completed'
              : 'exhausted';
            archive.reason = context.finish?.reason ?? '达到最大工具轮数';
            return { sent: context.sent, finish: context.finish ?? null };
          } catch (error) {
            archive.status = run.signal.aborted || ctx.signal.aborted ? 'cancelled' : 'failed';
            archive.reason = error instanceof Error ? error.message : String(error);
            if (context.sent === 0)
              storage.markRead(
                input.chatKey,
                triggers.map((message) => message.localId),
                false,
              );
            throw error;
          } finally {
            archive.sent = context.sent;
            archive.endedAt = Date.now();
            storage.archive(archive);
            ctx.points.observe('run.ended', archive);
          }
        };
        let scope: { run<T>(tool: ToolContext, fn: () => T): T } | undefined;
        try {
          scope = ctx.use({ id: 'harness.tool-scope' });
        } catch {
          /* 扩展作用域由可选插件提供。 */
        }
        return scope ? scope.run(context, execute) : execute();
      },
    });
    ctx.provide({ id: 'harness.agent' }, { mode: 'agent.basic' });
  },
});
