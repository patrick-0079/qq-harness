import { registerQueries } from './queries.js';
import { registerMessaging } from './messaging.js';
import { registerCrossChat } from './cross-chat.js';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { accessService,adapterService, configService, outboundService, storageService, toolService } from '@qq-harness/domain';

export const basicTools = definePlugin({
  id: 'basic-tools',
  name: '基础会话工具',
  requires: [toolService.id, outboundService.id, storageService.id, adapterService.id,configService.id,accessService.id],
  setup(ctx) {
    registerMessaging(ctx);
    registerQueries(ctx);
    registerCrossChat(ctx);
    ctx.provide({ id: 'harness.basic-tools' }, { ready: true });
  },
});
