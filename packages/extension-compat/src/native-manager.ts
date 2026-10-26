import { definePlugin } from '@qq-harness/plugin-sdk';
import { extensionService } from './service.js';

// 管理器以普通 Cordis 插件装配，宿主本身不会选择或启动任何一种扩展能力。
export function legacyManager(id: string, name: string, client = id) {
  return definePlugin({
    id,
    name,
    requires: [extensionService.id],
    client: { entry: `builtin:${client}` },
    async setup(ctx) {
      await ctx.use(extensionService).attachManager(ctx, id);
    },
  });
}
