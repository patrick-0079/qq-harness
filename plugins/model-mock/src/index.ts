import { mockMemory } from './memory.js';
import { textContent } from '@qq-harness/contracts';
import { randomUUID } from 'node:crypto';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { modelService } from '@qq-harness/domain';

export const modelMock = definePlugin({
  id: 'model-mock',
  name: '开发模型（零费用）',
  setup(ctx) {
    ctx.provide(modelService, {
      complete: async (messages, _tools, signal) => {
        ctx.assertActive();
        signal.throwIfAborted();
        if (textContent(messages[0]?.content).includes('【记忆Agent】')) return mockMemory(messages);
        if (messages[0]?.role === 'system' && textContent(messages[0].content).includes('"candidates"'))
          return {
            message: { role: 'assistant', content: '{"candidates":[]}' },
            usage: { input: 0, output: 0 },
          };
        const latest = textContent(messages.findLast((message) => message.role === 'user')?.content);
        const text = `演示回复：${latest.split('\n').at(-1)?.slice(0, 300) ?? ''}`;
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: 'function',
                function: { name: 'send_message', arguments: JSON.stringify({ messages: [text] }) },
              },
              {
                id: randomUUID(),
                type: 'function',
                function: {
                  name: 'finish',
                  arguments: JSON.stringify({ mode: 'spoken' }),
                },
              },
            ],
          },
          usage: { input: 0, output: 0 },
        };
      },
    });
  },
});
