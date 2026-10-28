import { definePlugin } from '@qq-harness/plugin-sdk';
import { conversationService, httpService, configService } from '@qq-harness/domain';
import { chatKeySchema } from '@qq-harness/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
export const conversationManual = definePlugin({
  id: 'conversation-manual',
  name: '手动触发',
  client: { entry: 'builtin:conversation-manual' },
  requires: [conversationService.id, httpService.id, configService.id],
  setup(ctx) {
    const api = new Hono();
    api.post('/api/conversation/manual', async (c) => {
      const input = z
        .object({
          chatKey: chatKeySchema,
          text: z.string().max(20000).optional(),
        })
        .strict()
        .parse(await c.req.json());
      if (ctx.use(configService).effective(input.chatKey).plugins[ctx.id] === false)
        throw Error('当前会话已停用手动触发插件');
      return c.json(
        { id: ctx.use(conversationService).force(input.chatKey, input.text, ctx.signal) },
        202,
      );
    });
    ctx.effect(
      ctx.use(httpService).register('/api/conversation/manual', (request) => api.fetch(request)),
    );
    api.onError((e, c) =>
      c.json(
        {
          error: {
            code: 'MANUAL_TRIGGER_FAILED',
            message: e instanceof z.ZodError ? '请选择具体会话，并检查说明长度' : e.message,
          },
        },
        409,
      ),
    );
  },
});
