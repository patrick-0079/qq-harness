import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin, service } from '@qq-harness/plugin-sdk';
import { adapterService, configService, httpService, storageService } from '@qq-harness/domain';
import { SnowlumaRuntime, type SnowlumaPluginOptions } from './runtime.js';
export type { SnowlumaPluginOptions } from './runtime.js';
export const snowlumaService = service<SnowlumaRuntime>('harness.snowluma');
export function snowlumaRuntime(options: SnowlumaPluginOptions = {}) {
  return definePlugin({
    id: 'snowluma-runtime',
    name: 'SnowLuma 外部运行时',
    requires: [storageService.id, configService.id, httpService.id],
    client: { entry: 'builtin:snowluma-runtime' },
    setup(ctx) {
      const runtime = new SnowlumaRuntime(
        ctx,
        ctx.use(storageService),
        ctx.use(configService),
        options,
        () => {
          try {
            const adapter = ctx.use(adapterService);
            return adapter.kind === 'onebot' && adapter.connected();
          } catch {
            return false;
          }
        },
      );
      ctx.effect(() => runtime.dispose());
      ctx.provide(snowlumaService, runtime);
      const api = new Hono();
      api.get('/api/snowluma/status', async (c) => c.json(await runtime.status()));
      api.get('/api/snowluma/settings', (c) => c.json(runtime.getSettings()));
      api.patch('/api/snowluma/settings', async (c) => c.json(runtime.configure(await c.req.json())));
      api.get('/api/snowluma/logs', (c) => c.json({ logs: runtime.logs() }));
      api.post('/api/snowluma/launch', async (c) => c.json({ ok: true, status: await runtime.start() }));
      api.post('/api/snowluma/stop', async (c) => {
        await runtime.stop();
        return c.json({ ok: true, status: await runtime.status() });
      });
      api.onError((error, c) =>
        c.json(
          {
            error: {
              code:
                error instanceof z.ZodError || error instanceof SyntaxError
                  ? 'INVALID_INPUT'
                  : 'SNOWLUMA_FAILED',
              message:
                error instanceof z.ZodError || error instanceof SyntaxError
                  ? 'SnowLuma 设置格式无效'
                  : error.message,
            },
          },
          error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409,
        ),
      );
      ctx.effect(ctx.use(httpService).register('/api/snowluma', (request) => api.fetch(request)));
      if (options.allowLaunch && runtime.getSettings().autoStart && runtime.getSettings().mode === 'managed')
        void runtime.start().catch((error) => ctx.log(error.message));
    },
  });
}
