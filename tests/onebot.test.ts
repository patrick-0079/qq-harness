import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { adapterService, storageService } from '@qq-harness/domain';

test('真实 OneBot 适配器与 OpenAI 协议连接本地 mock，完成端到端工具发送', async () => {
  const sends: unknown[] = [];
  const modelRequests: { messages: unknown[] }[] = [];
  const authorizations: (string | undefined)[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
    if (request.url === '/get_login_info' || request.url === '/send_group_msg')
      authorizations.push(request.headers.authorization);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/get_login_info')
      response.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: '888' } }));
    else if (request.url === '/send_group_msg') {
      sends.push(body);
      response.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 987 } }));
    } else if (request.url === '/v1/chat/completions') {
      modelRequests.push(body as { messages: unknown[] });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: '测试思考',
                tool_calls: [
                  {
                    id: 's1',
                    type: 'function',
                    function: {
                      name: 'send_message',
                      arguments: JSON.stringify({ text: '来自协议 mock 的回复' }),
                    },
                  },
                  {
                    id: 's2',
                    type: 'function',
                    function: {
                      name: 'finish',
                      arguments: JSON.stringify({ mode: 'spoken', reason: '已回复' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const wss = new WebSocketServer({ server });
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-onebot-')),
    demo: false,
    initialConfig: {
      admissions: ['group:123'],
      defaults: { wakeDelayMs: 0 },
      send: { minIntervalMs: 0 },
      onebot: {
        wsUrl: `ws://127.0.0.1:${port}`,
        httpUrl: `http://127.0.0.1:${port}`,
        accessToken: 'mock-ws-token',
        httpAccessToken: 'mock-http-token',
      },
      model: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock', apiKey: 'test' },
    },
  });
  try {
    for (let i = 0; !app.runtime.use(adapterService).connected() && i < 100; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    for (const socket of wss.clients)
      socket.send(
        JSON.stringify({
          post_type: 'message',
          message_type: 'group',
          group_id: 123,
          user_id: 456,
          self_id: 888,
          message_id: 1,
          time: Date.now() / 1000,
          sender: { nickname: '本地用户' },
          message: [
            { type: 'at', data: { qq: '888' } },
            { type: 'text', data: { text: '你好' } },
          ],
        }),
      );
    for (let i = 0; !app.runtime.use(storageService).archives().length && i < 200; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sends).toEqual([
      { group_id: '123', message: [{ type: 'text', data: { text: '来自协议 mock 的回复' } }] },
    ]);
    expect(modelRequests[0]?.messages).toHaveLength(2);
    expect(authorizations.length).toBeGreaterThan(0);
    expect(authorizations.every((token) => token === 'Bearer mock-http-token')).toBe(true);
    expect(app.runtime.use(storageService).archives()[0]?.usage).toEqual({ input: 10, output: 5 });
  } finally {
    await app.stop();
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
