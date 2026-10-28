import { z } from 'zod';
import { messageMarkers } from './message-markers.js';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import { outboundService, storageService, toolService } from '@qq-harness/domain';

export const sendMessageInput = z
  .object({
    messages: z.array(z.string().trim().min(1).max(100000)).min(1).max(100),
    stop: z.boolean().optional(),
  })
  .strict();
export const finishInput = z
  .object({
    mode: z.enum(['spoken', 'silent']),
    silentReason: z.string().trim().max(2000).optional(),
    activeTopic: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.mode !== 'silent' || !!v.silentReason, 'mode="silent" 必须填写 silentReason');

export function registerMessaging(ctx: PluginContext) {
  const tools = ctx.use(toolService),
    outbound = ctx.use(outboundService),
    storage = ctx.use(storageService);
  tools.register(ctx, {
    builtinQQ: true,
    name: 'send_poke',
    displayName: '拍一拍',
    category: 'messaging',
    description: '拍一拍当前会话成员。群聊必须传数字 targetUserId，私聊默认拍对方。成功后计入本轮发言。',
    parameters: {
      type: 'object',
      properties: { targetUserId: { type: 'string' } },
      additionalProperties: false,
    },
    parse: (a) =>
      z
        .object({
          targetUserId: z
            .string()
            .regex(/^[1-9]\d{0,19}$/)
            .optional(),
        })
        .strict()
        .parse(a),
    execute: async (c, a) => {
      const group = c.chatKey.startsWith('group:'),
        target =
          (a as { targetUserId?: string }).targetUserId || (!group ? c.chatKey.split(':')[1] : undefined);
      if (!target) throw new Error('群聊拍一拍必须填写 targetUserId，请先查询活跃成员');
      if (!group && target !== c.chatKey.split(':')[1]) throw new Error('私聊只能拍当前会话对方');
      const r = await ctx
        .use(outboundService)
        .sendPayload(c.run, c.chatKey, `[拍一拍] ${target}`, { poke: target });
      if (!r.duplicate) c.sent++;
      return { poked: true, messageId: r.id, duplicate: r.duplicate };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'send_message',
    displayName: '发送消息',
    category: 'messaging',
    core: true,
    description:
      '向当前会话发送消息。messages 必须为字符串数组，单条也传数组，如 ["在的"]；每个元素是一条消息。普通分句拆为数组元素，代码或表格保留必要换行。每条可含 ⟦reply:消息ID⟧ 引用和多个 ⟦at:QQ号⟧ 提及；每条仅首个引用生效，可同时引用和@，控制标记不显示。遵守本轮回复消息条数上限。',
    parameters: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        stop: {
          type: 'boolean',
          description: 'true：发送处理完成后直接结束本轮，不再调用 finish 或其他工具。',
        },
      },
      required: ['messages'],
      additionalProperties: false,
    },
    parse: (args) => sendMessageInput.parse(args),
    execute: async (context, value) => {
      const args = value as z.infer<typeof sendMessageInput>;
      const results: {
        index: number;
        id?: string;
        ids?: string[];
        failedParts?: { index: number; text: string; error: string }[];
        duplicate?: boolean;
        sentCount?: number;
        error?: string;
      }[] = [];
      for (const [index, text] of args.messages.entries()) {
        context.run.assertActive();
        try {
          const parsed = messageMarkers(text, context.chatKey, storage);
          const result = parsed.targeted
            ? await outbound.sendPayload(context.run, context.chatKey, parsed.text, {
                segments: parsed.segments,
              })
            : await outbound.send(context.run, context.chatKey, parsed.text);
          if (!result.duplicate) context.sent += result.sentCount ?? 1;
          results.push({ index, ...result });
          if (result.failedParts?.some((p) => p.error.includes('本轮回复消息上限'))) break;
        } catch (error) {
          context.run.signal.throwIfAborted();
          results.push({
            index,
            error: error instanceof Error ? error.message : String(error),
          });
          if (error instanceof Error && error.message.includes('本轮回复消息上限')) break;
        }
      }
      const failed = results.flatMap((r) =>
        r.error ? [r] : (r.failedParts?.map((p) => ({ ...p, messageIndex: r.index })) ?? []),
      );
      const uncertain = failed.some((r) => /发送.*(?:未知|不能.*重发)/.test(r.error ?? ''));
      const limitReached = failed.some((r) => r.error?.includes('本轮回复消息上限'));
      if (args.stop) {
        context.stopRequested = true;
        context.finish =
          context.sent > 0
            ? { mode: 'spoken', reason: 'send_message stop=true' }
            : {
                mode: 'silent',
                reason: 'send_message stop=true；本轮未产生新的发送副作用（去重或发送失败）',
              };
      }
      return {
        stopped: args.stop === true,
        sent: results.reduce((sum, r) => sum + (r.id && !r.duplicate ? (r.sentCount ?? 1) : 0), 0),
        messageIds: results.flatMap((r) => r.ids ?? (r.id ? [r.id] : [])),
        results,
        failed,
        ...(limitReached ? { limitReached: true } : {}),
        ...(!results.some((r) => r.id) ? { isError: true } : {}),
        ...(uncertain ? { uncertain: true } : {}),
        note: limitReached
          ? '已达到本轮回复消息上限，本轮立即终止；剩余消息不会发送，禁止重试。'
          : uncertain
            ? '部分发送结果未知，请先核对聊天记录，成功项和结果未知项均不要直接重发。'
            : failed.length
              ? '成功项不要重发，仅明确失败项可重试。'
              : '已发送，不要额外汇报“已发送”。',
      };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'finish',
    displayName: '结束处理',
    category: 'system',
    core: true,
    description:
      '结束本轮。spoken=本轮已经实际发出文字、图片、表情、拍一拍等；silent=不发言，必须填写 silentReason。finish 不会发送正文。activeTopic=true 开启或保持活跃期（不会续期），false 结束，不填保持。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['spoken', 'silent'] },
        silentReason: { type: 'string' },
        activeTopic: { type: 'boolean' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    parse: (args) => finishInput.parse(args),
    execute: async (context, args) => {
      const value = args as z.infer<typeof finishInput>;
      if (value.mode === 'spoken' && context.sent === 0) {
        context.finishCorrections = (context.finishCorrections ?? 0) + 1;
        if (context.finishCorrections <= 2)
          throw new Error(
            '本轮没有成功发出内容；请调用发送工具，或以 finish({mode:"silent",silentReason:"原因"}) 结束。finish 不会发送正文。',
          );
        context.finish = {
          mode: 'spoken',
          reason: '模型声称已发言，但本轮没有成功发送（已追问两次）',
          unverified: true,
        };
        return { finished: true, unverified: true };
      }
      context.finish = {
        mode: value.mode,
        reason: value.silentReason?.slice(0, 300) ?? '',
        ...(value.activeTopic === undefined ? {} : { activeTopic: value.activeTopic }),
      };
      return { finished: true, mode: value.mode };
    },
  });
}
