import { AsyncLocalStorage } from 'node:async_hooks';
import type { LegacyObject } from './types.js';
export function stickerPolicyBridge() {
  const capture = new AsyncLocalStorage<{ entries: LegacyObject[] }>();
  class StickerManager {
    entries: LegacyObject[] = [];
    async sync() {
      return { entries: this.entries };
    }
  }
  const base = StickerManager.prototype.sync;
  return {
    StickerManager,
    active: () => StickerManager.prototype.sync !== base,
    saveStickerStore(entries: LegacyObject[]) {
      const state = capture.getStore();
      if (!state) throw Error('旧表情写入仅允许在受控同步转换中调用');
      state.entries = entries;
    },
    async prepare(entries: LegacyObject[]) {
      const receiver = new StickerManager();
      receiver.entries = entries;
      const state = { entries };
      await capture.run(state, () => receiver.sync());
      return receiver.entries;
    },
  };
}
