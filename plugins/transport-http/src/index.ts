import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { definePlugin, type HostControl } from '@qq-harness/plugin-sdk';
import { httpService } from '@qq-harness/domain';

export function transportHttp(options: { token?: string; origins?: string[] } = {}) {
  const app = new Hono();
  const routes = new Map<string, (request: Request) => Response | Promise<Response>>();
  let host: HostControl | undefined;
  const session = randomBytes(32).toString('hex');
  const matchToken = (value: string) => {
    const actual = Buffer.from(options.token ?? ''),
      provided = Buffer.from(value);
    return actual.length === provided.length && timingSafeEqual(actual, provided);
  };
  app.use('/api/*', (c, next) =>
    bodyLimit({
      maxSize: (c.req.path === '/api/extensions/import' ? 12 : 2) * 1024 * 1024,
      onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE', message: '请求体超过上限' } }, 413),
    })(c, next),
  );
  app.use('/api/*', async (c, next) => {
    const url = new URL(c.req.url);
    // 默认只接受本机 Host，显式允许的前端也不能通过伪造 Host 绕过鉴权。
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      return c.json({ error: { code: 'HOST_DENIED', message: 'Host 不受信任' } }, 403);
    const origin = c.req.header('Origin');
    if (origin && origin !== url.origin && !options.origins?.includes(origin))
      return c.json({ error: { code: 'ORIGIN_DENIED', message: '请求来源不受信任' } }, 403);
    if (origin && options.origins?.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', 'content-type,authorization');
      c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    if (
      options.token &&
      getCookie(c, 'harness-session') !== session &&
      !matchToken(c.req.header('Authorization')?.replace(/^Bearer /, '') ?? '')
    )
      return c.json({ error: { code: 'UNAUTHORIZED', message: '管理令牌无效' } }, 401);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.post('/api/session', (c) => {
    setCookie(c, 'harness-session', session, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api',
      maxAge: 3600 * 12,
    });
    return c.json({ ok: true });
  });
  app.get('/api/health', (c) => c.json({ ok: Boolean(host), revision: host?.revision ?? 0 }));
  app.get('/api/events', (c) => {
    if (!host) return c.json({ error: { code: 'NOT_READY', message: 'HTTP 插件未就绪' } }, 503);
    const activeHost = host;
    return streamSSE(c, async (stream) => {
      // 网络慢时限制积压；浏览器重连后获取完整状态，不依赖无界事件回放。
      let pending = 0;
      const unsubscribe = activeHost.subscribe((event) => {
        if (++pending > 100) {
          stream.abort();
          return;
        }
        void stream
          .writeSSE({ id: String(event.id), event: event.type, data: JSON.stringify(event) })
          .catch(() => stream.abort())
          .finally(() => pending--);
      });
      const timer = setInterval(() => {
        void stream.writeSSE({ event: 'heartbeat', data: '{}' }).catch(() => stream.abort());
      }, 15000);
      try {
        await stream.writeSSE({ event: 'hello', data: JSON.stringify({ revision: activeHost.revision }) });
        await new Promise<void>((resolve) => stream.onAbort(resolve));
      } finally {
        clearInterval(timer);
        await unsubscribe();
      }
    });
  });
  app.all('/api/*', async (c) => {
    const route = [...routes]
      .sort((a, b) => b[0].length - a[0].length)
      .find(([prefix]) => c.req.path === prefix || c.req.path.startsWith(prefix + '/'));
    if (!route) return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在或所属插件已停用' } }, 404);
    return route[1](c.req.raw);
  });
  app.onError((error, c) => {
    const validation = error.name === 'ZodError' || error instanceof SyntaxError;
    return c.json(
      {
        error: {
          code: validation ? 'INVALID_INPUT' : 'REQUEST_FAILED',
          message: validation ? '请求参数或 JSON 格式无效' : error.message,
        },
      },
      validation ? 400 : 409,
    );
  });
  const plugin = definePlugin({
    id: 'transport-http',
    name: 'Hono HTTP / SSE',
    setup(ctx) {
      host = ctx.host;
      ctx.provide(httpService, {
        register: (prefix, handler) => {
          ctx.assertActive();
          if (!prefix.startsWith('/api/') || routes.has(prefix))
            throw new Error(`非法或重复 API 前缀：${prefix}`);
          routes.set(prefix, handler);
          return () => {
            if (routes.get(prefix) === handler) routes.delete(prefix);
          };
        },
      });
      ctx.effect(() => {
        host = undefined;
        routes.clear();
      });
    },
  });
  return { plugin, app };
}
