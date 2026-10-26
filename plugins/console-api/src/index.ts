import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema, incomingSchema } from '@qq-harness/contracts';
import {
  httpService,
  configService,
  storageService,
  adapterService,
  conversationService,
} from '@qq-harness/domain';

export function consoleApi(demo: boolean) {
  return definePlugin({
    id: 'console-api',
    name: '控制台管理 API',
    requires: [httpService.id, configService.id, storageService.id],
    setup(ctx) {
      const http = ctx.use(httpService),
        config = ctx.use(configService),
        storage = ctx.use(storageService);
      const api = new Hono();
      api.onError((error, c) => {
        const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
        return c.json(
          {
            error: {
              code: invalid ? 'INVALID_INPUT' : 'REQUEST_FAILED',
              message: invalid ? '请求参数或 JSON 格式无效' : error.message,
            },
          },
          invalid ? 400 : 409,
        );
      });
      api.get('/api/status', (c) => {
        let adapter = { kind: 'unavailable', connected: false };
        try {
          const value = ctx.use(adapterService);
          adapter = { kind: value.kind, connected: value.connected() };
        } catch {
          /* 插件诊断必须在适配器停用后仍可访问。 */
        }
        return c.json({
          revision: ctx.host.revision,
          plugins: ctx.host.listPlugins(),
          runs: ctx.host.listRuns(),
          adapter,
          demo,
        });
      });
      api.get('/api/plugins', (c) =>
        c.json({ revision: ctx.host.revision, plugins: ctx.host.listPlugins() }),
      );
      api.post('/api/plugins/:id/enabled', async (c) => {
        const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
        const id = c.req.param('id');
        // 关闭当前 HTTP 或配置宿主会切断保存路径；由启动 profile 管理这些基础服务。
        if (
          [
            'transport-http',
            'console-api',
            'config-file',
            'storage-file',
            'storage-sqlite',
            'external-plugins',
          ].includes(id)
        )
          return c.json({ error: { code: 'HOST_REQUIRED', message: '该插件由启动配置管理' } }, 409);
        await ctx.host.setEnabled(id, enabled);
        config.patch({ plugins: { [id]: enabled } });
        return c.json({ ok: true, revision: ctx.host.revision });
      });
      api.get('/api/config', (c) => c.json(config.public()));
      api.patch('/api/config', async (c) => {
        const patch = z.record(z.string(), z.unknown()).parse(await c.req.json());
        if ('plugins' in patch)
          return c.json(
            { error: { code: 'PLUGIN_ENDPOINT_REQUIRED', message: '插件启停请使用插件管理接口' } },
            400,
          );
        config.patch(patch);
        return c.json(config.public());
      });
      api.patch('/api/profiles/:chatKey', async (c) => {
        const key = chatKeySchema.parse(c.req.param('chatKey'));
        config.saveProfile(key, await c.req.json());
        return c.json(config.effective(key));
      });
      api.delete('/api/profiles/:chatKey', (c) => {
        config.clearProfile(chatKeySchema.parse(c.req.param('chatKey')));
        return c.json({ ok: true });
      });
      api.get('/api/chats', (c) => c.json(storage.chats()));
      api.get('/api/chats/:chatKey/messages', (c) =>
        c.json(storage.messages(chatKeySchema.parse(c.req.param('chatKey'))).slice(-500)),
      );
      api.get('/api/chats/:chatKey/settings', (c) =>
        c.json(config.effective(chatKeySchema.parse(c.req.param('chatKey')))),
      );
      api.get('/api/archives', (c) => c.json(storage.archives(c.req.query('chat'))));
      api.get('/api/runs', (c) => c.json(ctx.host.listRuns()));
      api.post('/api/runs', async (c) => {
        const input = z
          .object({
            mode: z.string().min(1),
            partitionKey: z.string().min(1),
            input: z.unknown(),
            timeoutMs: z.number().int().min(100).max(3600000).optional(),
            maxWaitMs: z.number().int().min(0).max(3600000).optional(),
          })
          .parse(await c.req.json());
        return c.json(ctx.host.submit(input), 201);
      });
      api.post('/api/runs/:id/cancel', (c) => c.json({ ok: ctx.host.cancel(c.req.param('id')) }));
      api.post('/api/chats/:chatKey/retry', (c) =>
        c.json({ id: ctx.use(conversationService).retry(chatKeySchema.parse(c.req.param('chatKey'))) }),
      );
      api.get('/api/chats/:chatKey/memory', (c) =>
        c.json({ text: storage.memory(chatKeySchema.parse(c.req.param('chatKey'))) }),
      );
      api.patch('/api/chats/:chatKey/memory', async (c) => {
        const key = chatKeySchema.parse(c.req.param('chatKey'));
        const { text } = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
        storage.setMemory(key, text);
        return c.json({ ok: true });
      });
      api.post('/api/demo/messages', async (c) => {
        if (!demo)
          return c.json({ error: { code: 'DEMO_DISABLED', message: '真实连接模式不开放模拟消息入口' } }, 403);
        const message = incomingSchema.parse({
          id: randomUUID(),
          senderId: '10002',
          senderName: '测试用户',
          atMe: true,
          timestamp: Date.now(),
          ...(await c.req.json<Record<string, unknown>>()),
        });
        await ctx.use(conversationService).ingest(message);
        return c.json({ ok: true });
      });
      for (const prefix of [
        '/api/status',
        '/api/plugins',
        '/api/config',
        '/api/profiles',
        '/api/chats',
        '/api/archives',
        '/api/runs',
        '/api/demo',
      ]) {
        ctx.effect(http.register(prefix, (request) => api.fetch(request)));
      }
    },
  });
}
