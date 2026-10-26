import { randomUUID } from 'node:crypto';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { modelService } from '@qq-harness/domain';
import type { ModelHttpHeaders } from '@qq-harness/contracts';

export const modelOpencode = definePlugin({
  id: 'model-opencode',
  name: 'OpenCode 会话路由协议',
  requires: [modelService.id],
  setup(ctx) {
    // 每个插件实例复用一个路由会话；多轮工具请求与重试必须保持一致。
    const session = `qqharness-${randomUUID()}`;
    ctx.on<ModelHttpHeaders>('model.http.headers', (request) => {
      const hostname = new URL(request.url).hostname.toLowerCase();
      if (
        hostname !== 'opencode.ai' &&
        !hostname.endsWith('.opencode.ai') &&
        !/^opencode-go\//i.test(request.model)
      )
        return request;
      return {
        ...request,
        headers: {
          ...request.headers,
          'x-opencode-session': session,
          'user-agent': 'qq-harness/0.1',
        },
      };
    });
  },
});
