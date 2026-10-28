import { AsyncLocalStorage } from 'node:async_hooks';
import type { LegacyObject } from './types.js';

/** Legacy prototype wrappers belong to one capsule. Capture runs only the
 * wrapper's transformation; its base cannot transmit while preparing a batch. */
export function senderBridge(
  send: (chatKey: string, messages: string[], options: LegacyObject) => Promise<unknown>,
) {
  const capture = new AsyncLocalStorage<{ messages?: string[] }>();
  class SendQueue {
    constructor(_options: LegacyObject = {}) {}
    async sendTextBatch(chatKey: string, messages: string[], options: LegacyObject = {}) {
      if (
        !Array.isArray(messages) ||
        !messages.length ||
        messages.some((m) => typeof m !== 'string' || !m.trim())
      )
        throw Error('发送批次必须为非空字符串数组');
      const captured = capture.getStore();
      if (captured) {
        captured.messages = messages;
        return [];
      }
      return send(chatKey, messages, options);
    }
  }
  const base = SendQueue.prototype.sendTextBatch;
  return {
    SendQueue,
    active: () => SendQueue.prototype.sendTextBatch !== base,
    async prepare(chatKey: string, messages: string[], options: LegacyObject = {}) {
      const state: { messages?: string[] } = {};
      await capture.run(state, () => new SendQueue().sendTextBatch(chatKey, messages, options));
      if (!state.messages) throw Error('发送转换没有提交有效消息批次');
      return state.messages;
    },
  };
}
