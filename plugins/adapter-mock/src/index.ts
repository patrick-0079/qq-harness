import { randomUUID } from 'node:crypto';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { adapterService } from '@qq-harness/domain';
import { incomingSchema, type IncomingMessage } from '@qq-harness/contracts';

export const adapterMock = definePlugin({
  id: 'adapter-mock',
  name: '开发消息适配器',
  setup(ctx) {
    const listeners = new Set<(message: IncomingMessage) => void>();
    const sent: { chatKey: string; text: string }[] = [];
    ctx.effect(() => {
      listeners.clear();
    });
    ctx.provide(adapterService, {
      kind: 'mock',
      connected: () => !ctx.signal.aborted,
      sent,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      inject: (value) => {
        ctx.assertActive();
        const message = incomingSchema.parse(value);
        for (const listener of listeners) listener(message);
      },
      send: async (chatKey, text, signal) => {
        ctx.assertActive();
        signal.throwIfAborted();
        sent.push({ chatKey, text });
        return { id: randomUUID() };
      },
      sendPayload: async (chatKey, payload, signal) => {
        ctx.assertActive();
        signal.throwIfAborted();
        sent.push({ chatKey, text: JSON.stringify(payload) });
        return { id: randomUUID() };
      },
      query: async () => {
        ctx.assertActive();
        return {};
      },
    });
  },
});
