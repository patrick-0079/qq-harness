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
        if (messages[0]?.role === 'system' && messages[0].content?.includes('从聊天消息提取值得记住的事实'))
          return {
            message: { role: 'assistant', content: '{"candidates":[]}' },
            usage: { input: 0, output: 0 },
          };
        const latest = messages.findLast((message) => message.role === 'user')?.content ?? '';
        const text = `演示回复：${latest.split('\n').at(-1)?.slice(0, 300) ?? ''}`;
        return {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: 'function',
                function: { name: 'send_message', arguments: JSON.stringify({ text }) },
              },
              {
                id: randomUUID(),
                type: 'function',
                function: {
                  name: 'finish',
                  arguments: JSON.stringify({ mode: 'spoken', reason: '已通过发送工具回复' }),
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
