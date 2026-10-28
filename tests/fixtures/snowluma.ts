import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

interface Reply {
  status?: number;
  body?: unknown;
  raw?: string;
}
interface Call {
  action: string;
  args: Record<string, unknown>;
  authorization?: string;
}

// 协议 mock 只监听随机回环端口，不读取安装目录、不启动 SnowLuma/QQ。
// 使用真实 HTTP/WS 边界，避免直接替换适配器后漏掉鉴权、断线和事件解析问题。
export async function mockSnowluma(
  options: { wsToken?: string; httpToken?: string; holdHandshake?: boolean } = {},
) {
  const calls: Call[] = [];
  const upgrades: (string | undefined)[] = [];
  const actions = new Map<string, (call: Call) => Reply | Promise<Reply>>();
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const call: Call = {
        action: new URL(request.url ?? '/', 'http://localhost').pathname.slice(1),
        args: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
        authorization: request.headers.authorization,
      };
      calls.push(call);
      const authorized = !options.httpToken || call.authorization === `Bearer ${options.httpToken}`;
      const reply: Reply = !authorized
        ? { status: 401, body: { error: 'unauthorized' } }
        : ((await actions.get(call.action)?.(call)) ?? {
            body: {
              status: 'ok',
              retcode: 0,
              data: call.action === 'get_login_info' ? { user_id: '888' } : { message_id: calls.length },
            },
          });
      if (!response.destroyed) {
        response.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
        response.end(reply.raw ?? JSON.stringify(reply.body));
      }
    } catch {
      if (!response.destroyed) {
        response.writeHead(500);
        response.end('{}');
      }
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const ws = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    upgrades.push(request.headers.authorization);
    if (options.holdHandshake) return;
    if (options.wsToken && request.headers.authorization !== `Bearer ${options.wsToken}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    ws.handleUpgrade(request, socket, head, (client) => ws.emit('connection', client, request));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  return {
    calls,
    upgrades,
    actions,
    ws,
    config: {
      wsUrl: `ws://127.0.0.1:${port}`,
      httpUrl: `http://127.0.0.1:${port}`,
      accessToken: options.wsToken ?? '',
      httpAccessToken: options.httpToken ?? '',
    },
    push(event: unknown) {
      for (const client of ws.clients)
        if (client.readyState === WebSocket.OPEN)
          client.send(typeof event === 'string' ? event : JSON.stringify(event));
    },
    async close() {
      for (const client of ws.clients) client.terminate();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => ws.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    },
  };
}
