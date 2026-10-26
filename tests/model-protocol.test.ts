import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Runtime } from '@qq-harness/kernel';
import { configFile } from '@qq-harness/config-file';
import { modelOpenai } from '@qq-harness/model-openai';
import { modelOpencode } from '@qq-harness/model-opencode';
import { configService, modelService } from '@qq-harness/domain';

test('OpenCode 协议插件补充稳定路由头、限定端点且卸载后撤销', async () => {
  const requests: http.IncomingHttpHeaders[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(req.headers);
    res.setHeader('content-type', 'application/json');
    if (body.model.startsWith('opencode-go/') && !req.headers['x-opencode-session']) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'Request is missing x-opencode-session' } }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-model-protocol-'));
  const runtime = new Runtime();
  runtime.install(
    configFile(dir, {
      model: {
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        model: 'opencode-go/mock',
        apiKey: 'test',
        retries: 0,
      },
    }),
  );
  runtime.install(modelOpenai);
  runtime.install(modelOpencode);
  try {
    await runtime.start();
    const complete = () =>
      runtime
        .use(modelService)
        .complete([{ role: 'user', content: 'protocol test' }], [], new AbortController().signal);
    await complete();
    await complete();
    const session = requests[0]!['x-opencode-session'];
    expect(session).toMatch(/^qqharness-/);
    expect(requests[1]!['x-opencode-session']).toBe(session);
    expect(requests[0]!.authorization).toBe('Bearer test');
    expect(requests[0]!['user-agent']).toBe('qq-harness/0.1');
    const headersFor = async (url: string) =>
      (
        await runtime.points.transform('model.http.headers', {
          url,
          model: 'ordinary-model',
          headers: { authorization: 'Bearer test' },
        })
      ).headers as Record<string, string>;
    expect((await headersFor('https://opencode.ai/zen/go/v1/chat/completions'))['x-opencode-session']).toBe(
      session,
    );
    expect(
      (await headersFor('https://opencode.ai.example.com/v1/chat/completions'))['x-opencode-session'],
    ).toBeUndefined();
    runtime.use(configService).patch({ model: { model: 'ordinary-model' } });
    await complete();
    expect(requests.at(-1)!['x-opencode-session']).toBeUndefined();
    runtime.use(configService).patch({ model: { model: 'opencode-go/mock' } });
    await runtime.setEnabled('model-opencode', false);
    await expect(complete()).rejects.toThrow('HTTP 400');
    await runtime.setEnabled('model-opencode', true);
    await complete();
    expect(requests.at(-1)!['x-opencode-session']).toMatch(/^qqharness-/);
    expect(requests.at(-1)!['x-opencode-session']).not.toBe(session);
  } finally {
    await runtime.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
