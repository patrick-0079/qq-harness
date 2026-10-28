import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema, containerExecSchema } from '@qq-harness/contracts';
import {
  httpService,
  containerRuntimeService,
  containerSessionService,
  containerJobsService,
} from '@qq-harness/domain';

export const containerConsole = definePlugin({
  id: 'container-console',
  name: '容器管理页面与 API',
  requires: [httpService.id, containerRuntimeService.id, containerSessionService.id, containerJobsService.id],
  client: { entry: 'builtin:container-console' },
  setup(ctx) {
    const runtime = ctx.use(containerRuntimeService),
      session = ctx.use(containerSessionService),
      jobs = ctx.use(containerJobsService);
    const api = new Hono();
    const key = (value: string) => chatKeySchema.parse(value);
    api.get('/api/containers/status', async (c) =>
      c.json({
        settings: runtime.settings(),
        engine: await runtime.status(c.req.raw.signal),
        containers: await runtime.list(c.req.raw.signal),
      }),
    );
    api.patch('/api/containers/settings', async (c) => c.json(runtime.configure(await c.req.json())));
    api.post('/api/containers/inventory', async (c) => {
      const input = z
        .object({
          name: z.string().optional(),
          image: z.string().optional(),
          chatKey: chatKeySchema.optional(),
        })
        .strict()
        .parse(await c.req.json());
      return c.json(
        input.chatKey
          ? await runtime.create(input.chatKey, c.req.raw.signal)
          : await runtime.createResource(input, c.req.raw.signal),
        201,
      );
    });
    api.get('/api/containers/discovery', async (c) => c.json(await runtime.discover(c.req.raw.signal)));
    api.post('/api/containers/inventory/import', async (c) => {
      const input = z
        .object({ reference: z.string().min(1).max(160) })
        .strict()
        .parse(await c.req.json());
      return c.json(await runtime.registerExisting(input.reference, c.req.raw.signal), 201);
    });
    api.put('/api/containers/bindings/:chatKey', async (c) => {
      const input = z
        .object({ containerIds: z.array(z.string()).max(64), primaryContainerId: z.string().optional() })
        .strict()
        .parse(await c.req.json());
      return c.json(
        await runtime.setBindings(key(c.req.param('chatKey')), input.containerIds, input.primaryContainerId),
      );
    });
    api.put('/api/containers/inventory/:id/chats', async (c) => {
      const input = z
        .object({ chatKeys: z.array(chatKeySchema).max(1000) })
        .strict()
        .parse(await c.req.json());
      return c.json(await runtime.assignResource(c.req.param('id'), input.chatKeys));
    });
    api.post('/api/containers/inventory/:id/start', async (c) =>
      c.json(await runtime.startResource(c.req.param('id'), c.req.raw.signal)),
    );
    api.post('/api/containers/inventory/:id/stop', async (c) => {
      await runtime.stopResource(c.req.param('id'));
      return c.json({ stopped: true });
    });
    api.post('/api/containers/bindings', async (c) => {
      const input = z
        .object({
          chatKey: chatKeySchema,
          containerId: z.string().min(1).max(160),
        })
        .strict()
        .parse(await c.req.json());
      return c.json(await runtime.bind(input.chatKey, input.containerId));
    });
    api.delete('/api/containers/bindings/:chatKey', async (c) => {
      await runtime.unbind(key(c.req.param('chatKey')), c.req.query('containerId'));
      return c.json({ unbound: true });
    });
    api.delete('/api/containers/inventory/:id', async (c) => {
      await runtime.removeExisting(c.req.param('id'));
      return c.json({ removed: true });
    });
    api.post('/api/containers/sessions/:chatKey/start', async (c) =>
      c.json(await runtime.start(key(c.req.param('chatKey')), c.req.raw.signal)),
    );
    api.post('/api/containers/sessions/:chatKey/stop', async (c) => {
      await runtime.stop(key(c.req.param('chatKey')));
      return c.json({ stopped: true });
    });
    api.delete('/api/containers/sessions/:chatKey', async (c) => {
      await runtime.remove(key(c.req.param('chatKey')));
      return c.json({ removed: true });
    });
    api.post('/api/containers/sessions/:chatKey/exec', async (c) => {
      const input = containerExecSchema
        .extend({ run_in_background: z.boolean().default(false) })
        .parse(await c.req.json());
      const chatKey = key(c.req.param('chatKey'));
      return c.json(
        input.run_in_background
          ? jobs.start(chatKey, input)
          : await session.execute(chatKey, input, c.req.raw.signal),
      );
    });
    api.get('/api/containers/sessions/:chatKey/jobs', (c) => c.json(jobs.list(key(c.req.param('chatKey')))));
    api.get('/api/containers/sessions/:chatKey/jobs/:id', (c) =>
      c.json(jobs.get(key(c.req.param('chatKey')), c.req.param('id'))),
    );
    api.post('/api/containers/sessions/:chatKey/jobs/:id/cancel', async (c) =>
      c.json(await jobs.cancel(key(c.req.param('chatKey')), c.req.param('id'))),
    );
    api.onError((error, c) =>
      c.json(
        {
          error: {
            code:
              error instanceof z.ZodError || error instanceof SyntaxError
                ? 'INVALID_INPUT'
                : 'CONTAINER_FAILED',
            message:
              error instanceof z.ZodError || error instanceof SyntaxError
                ? '容器请求格式无效'
                : error.message,
          },
        },
        error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409,
      ),
    );
    ctx.effect(ctx.use(httpService).register('/api/containers', (request) => api.fetch(request)));
  },
});
