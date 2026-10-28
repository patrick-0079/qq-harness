import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import { chatKeySchema } from '@qq-harness/contracts';
import {
  accessService,
  configService,
  outboundService,
  toolService,
  traceService,
  storageService,
  type TraceService,
} from '@qq-harness/domain';
const input = z
  .object({
    targetChatKey: chatKeySchema,
    messages: z.array(z.string().trim().min(1).max(100000)).min(1).max(100),
  })
  .strict();
export function registerCrossChat(ctx: PluginContext) {
  const config = ctx.use(configService),
    access = ctx.use(accessService),
    outbound = ctx.use(outboundService);
  const mode = input.extend({
    sourceChatKey: chatKeySchema,
    sourceRunId: z.string(),
  });
  ctx.mode({
    id: 'outbound.cross-chat',
    operation: true,
    input: mode,
    partitionKey: (v) => `outbound:${v.targetChatKey}`,
    execute: async (run, v) => {
      if (!config.effective(v.sourceChatKey).tools.crossChatSend)
        throw new Error('跨会话发送已关闭');
      access.assert(v.sourceChatKey);
      access.assert(v.targetChatKey);
      const storage = ctx.use(storageService),
        children = storage.state('outbound-children', v.sourceRunId) ?? [];
      if (!Array.isArray(children)) throw new Error('发送运行关联记录损坏');
      storage.setState('outbound-children', v.sourceRunId, [
        ...children,
        { runId: run.id, chatKey: v.targetChatKey },
      ]);
      const results: {
        index: number;
        id?: string;
        duplicate?: boolean;
        error?: string;
      }[] = [];
      let trace: TraceService | undefined;
      try {
        trace = ctx.use(traceService);
      } catch {
        /* 详情插件可停用 */
      }
      trace?.start(run.id, v.targetChatKey);
      try {
        trace?.record(run.id, 'trigger', '跨会话发送', {
          sourceChatKey: v.sourceChatKey,
          targetChatKey: v.targetChatKey,
        });
        for (const [index, text] of v.messages.entries()) {
          run.assertActive();
          if (!config.effective(v.sourceChatKey).tools.crossChatSend)
            throw new Error('跨会话发送已关闭');
          access.assert(v.sourceChatKey);
          try {
            const r = await outbound.send(run, v.targetChatKey, text);
            results.push({ index, ...r });
            trace?.record(run.id, 'outbound', '发送到目标会话', {
              index,
              text,
              ...r,
            });
          } catch (e) {
            run.signal.throwIfAborted();
            results.push({
              index,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        trace?.end(run.id, 'completed');
        return {
          results,
          sent: results.filter((r) => r.id && !r.duplicate).length,
          failed: results.filter((r) => r.error),
          messageIds: results.flatMap((r) => (r.id ? [r.id] : [])),
        };
      } catch (error) {
        trace?.end(run.id, run.signal.aborted ? 'cancelled' : 'failed');
        throw error;
      }
    },
  });
  ctx.use(toolService).register(ctx, {
    name: 'send_to',
    displayName: '发送到指定会话',
    category: 'messaging',
    description:
      '向另一个已准入群或私聊发送字符串数组。必须开启跨会话发送，先 get_chats 查询目标；成功项不重发。使用绑定目标会话、随当前运行取消的发送运行。',
    parameters: z.toJSONSchema(input),
    parse: (a) => input.parse(a),
    execute: async (c, a) => {
      const v = a as z.infer<typeof input>;
      if (v.targetChatKey === c.chatKey) throw new Error('目标是当前会话，请使用 send_message');
      if (!c.settings.tools.crossChatSend) throw new Error('当前会话未开启跨会话发送');
      access.assert(v.targetChatKey);
      const result = await ctx.host.operation(c.run, {
        mode: 'outbound.cross-chat',
        partitionKey: `outbound:${v.targetChatKey}`,
        input: { ...v, sourceChatKey: c.chatKey, sourceRunId: c.run.id },
      });
      if (result.status !== 'completed') throw new Error(result.error ?? '跨会话发送失败');
      const value = result.result as { sent: number };
      c.sent += value.sent;
      return { ...value, runId: result.id, targetChatKey: v.targetChatKey };
    },
  });
}
