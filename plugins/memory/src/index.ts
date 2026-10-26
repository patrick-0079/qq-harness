import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { configService, storageService, toolService } from '@qq-harness/domain';

export const memory = definePlugin({
  id: 'memory',
  name: '会话长期记忆',
  requires: [configService.id, storageService.id, toolService.id, 'harness.agent'],
  setup(ctx) {
    const storage = ctx.use(storageService),
      tools = ctx.use(toolService);
    ctx.on<{ chatKey: string; text: string }>('context.build', (value) =>
      ctx.use(configService).effective(value.chatKey).plugins[ctx.id] === false
        ? value
        : {
            ...value,
            text: `${storage.memory(value.chatKey) ? `【长期记忆】\n${storage.memory(value.chatKey)}\n` : ''}${value.text}`,
          },
    );
    tools.register(ctx, {
      name: 'memory_query',
      description: '读取当前会话长期记忆。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parse: (args) => z.object({}).parse(args),
      execute: async (context) => ({ content: storage.memory(context.chatKey) }),
    });
    tools.register(ctx, {
      name: 'memory_append',
      description: '为当前会话追加长期记忆。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      parse: (args) => z.object({ text: z.string().min(1).max(10000) }).parse(args),
      execute: async (context, args) => {
        const text = (storage.memory(context.chatKey) + '\n' + (args as { text: string }).text).trim();
        if (text.length > 100000) throw new Error('记忆超过 10 万字，请先整理');
        storage.setMemory(context.chatKey, text);
        return { ok: true };
      },
    });
  },
});
