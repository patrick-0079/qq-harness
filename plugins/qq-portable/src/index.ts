import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin, service } from '@qq-harness/plugin-sdk';
import { storageService, httpService } from '@qq-harness/domain';
import { QqPortableRuntime, type QqPortableOptions } from './runtime.js';
export type { QqPortableOptions } from './runtime.js';
export const qqPortableService = service<QqPortableRuntime>('harness.qq-portable');
export function qqPortable(options: QqPortableOptions = {}) {
  return definePlugin({
    id: 'qq-portable',
    name: '便携 QQ',
    requires: [storageService.id, httpService.id],
    client: { entry: 'builtin:qq-portable' },
    setup(ctx) {
      const runtime = new QqPortableRuntime(ctx, ctx.use(storageService), options);
      ctx.effect(() => runtime.dispose());
      ctx.provide(qqPortableService, runtime);
      const api = new Hono();
      api.get('/api/qq-portable/status', async (c) => c.json(await runtime.status()));
      api.get('/api/qq-portable/settings', (c) => c.json(runtime.getSettings()));
      api.patch('/api/qq-portable/settings', async (c) => c.json(runtime.configure(await c.req.json())));
      api.post('/api/qq-portable/launch', async (c) => c.json(await runtime.start()));
      api.post('/api/qq-portable/stop', async (c) => {
        await runtime.stop();
        return c.json(await runtime.status());
      });
      api.onError((error, c) => {
        const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
        return c.json(
          {
            error: {
              code: invalid ? 'INVALID_INPUT' : 'QQ_PORTABLE_FAILED',
              message: invalid ? '便携 QQ 设置格式无效' : error.message,
            },
          },
          invalid ? 400 : 409,
        );
      });
      ctx.effect(ctx.use(httpService).register('/api/qq-portable', (request) => api.fetch(request)));
    },
  });
}
