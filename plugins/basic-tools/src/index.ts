import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { adapterService, outboundService, storageService, toolService } from '@qq-harness/domain';

export const basicTools = definePlugin({
  id: 'basic-tools',
  name: '基础会话工具',
  requires: [toolService.id, outboundService.id, storageService.id, adapterService.id],
  setup(ctx) {
    const tools = ctx.use(toolService),
      outbound = ctx.use(outboundService),
      storage = ctx.use(storageService),
      adapter = ctx.use(adapterService);
    const parameters = (properties: Record<string, unknown>, required: string[] = []) => ({
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    });
    tools.register(ctx, {
      name: 'send_message',
      description: '向当前会话发送消息。目标已由运行绑定。',
      parameters: parameters({ text: { type: 'string', description: '消息正文' } }, ['text']),
      parse: (args) => z.object({ text: z.string().min(1).max(100000) }).parse(args),
      execute: async (context, args) => {
        const { text } = args as { text: string };
        const result = await outbound.send(context.run, context.chatKey, text);
        if (!result.duplicate) context.sent++;
        return result;
      },
    });
    tools.register(ctx, {
      name: 'get_recent_messages',
      description: '读取当前会话最近的消息。',
      parameters: parameters({ limit: { type: 'integer' } }),
      parse: (args) => z.object({ limit: z.number().int().min(1).max(200).default(30) }).parse(args),
      execute: async (context, args) =>
        storage.messages(context.chatKey).slice(-(args as { limit: number }).limit),
    });
    tools.register(ctx, {
      name: 'get_message_detail',
      description: '读取当前会话中已记录的一条消息。',
      parameters: parameters({ id: { type: 'string' } }, ['id']),
      parse: (args) => z.object({ id: z.string() }).parse(args),
      execute: async (context, args) => {
        const message = storage
          .messages(context.chatKey)
          .find((value) => value.id === (args as { id: string }).id);
        if (!message) throw new Error('消息不属于当前会话或尚未记录');
        return message;
      },
    });
    tools.register(ctx, {
      name: 'read_forward',
      description: '读取当前会话中已记录消息包含的合并转发。',
      parameters: parameters({ id: { type: 'string' } }, ['id']),
      parse: (args) => z.object({ id: z.string() }).parse(args),
      execute: async (context, args) => {
        const id = (args as { id: string }).id;
        if (
          !storage
            .messages(context.chatKey)
            .some((value) => value.id === id && /\[forward\]|\[合并转发/.test(value.text))
        )
          throw new Error('转发消息不属于当前会话');
        return adapter.query('get_forward_msg', { message_id: id }, context.run.signal);
      },
    });
    tools.register(ctx, {
      name: 'finish',
      description: '结束本轮；spoken 表示已经实际发送，silent 表示决定不发言并说明理由。',
      parameters: parameters(
        { mode: { type: 'string', enum: ['spoken', 'silent'] }, reason: { type: 'string' } },
        ['mode', 'reason'],
      ),
      parse: (args) =>
        z.object({ mode: z.enum(['spoken', 'silent']), reason: z.string().min(1).max(2000) }).parse(args),
      execute: async (context, args) => {
        const value = args as { mode: 'spoken' | 'silent'; reason: string };
        if (value.mode === 'spoken' && context.sent === 0)
          throw new Error('本轮没有实际发送；请调用发送工具，或以 silent 结束。');
        context.finish = value;
        return { finished: true };
      },
    });
    ctx.provide({ id: 'harness.basic-tools' }, { ready: true });
  },
});
