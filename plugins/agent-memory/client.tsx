import { defineClientPlugin } from '@qq-harness/client-sdk';
import { MemoryWorkspace } from './workspace.js';
export default defineClientPlugin({
  id: 'agent-memory',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.slot('conversation.detail.tabs', {
      id: 'memory',
      title: '记忆',
      order: 40,
      component: MemoryWorkspace,
    });
  },
});
