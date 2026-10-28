import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  mediaService,
  storageService,
  conversationService,
  traceService,
  configService,
} from '@qq-harness/domain';
import { privateAddress } from '@qq-harness/files';
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.stop();
});
async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-media-trace-'));
  const app = await createApplication({ dataDir, v2Managers: false, extensionHotReload: false });
  apps.push(app);
  return { ...app, dataDir };
}
test('媒体只读取所属消息中的图片，跨消息／路径和伪图片拒绝，同源返回正确内容', async () => {
  const app = await boot(),
    storage = app.runtime.use(storageService),
    media = app.runtime.use(mediaService);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV9sAAAAASUVORK5CYII=';
  const m = storage.append({
    id: 'image',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '图片测试',
    text: '[image]',
    atMe: false,
    timestamp: Date.now(),
    metadata: { segments: [{ type: 'image', data: { file: 'base64://' + png } }] },
  });
  expect(media.references('group:1', m.localId)).toMatchObject([{ kind: 'image', index: 0 }]);
  const result = await media.image('group:1', m.localId, 0);
  expect(result.mime).toBe('image/png');
  expect(Buffer.from(result.bytes).toString('base64')).toBe(png);
  await expect(media.image('group:2', m.localId, 0)).rejects.toThrow('不属于');
  await expect(media.fetchImage('C:\\Windows\\win.ini')).rejects.toThrow('宿主');
  await expect(media.fetchImage('base64://' + Buffer.from('<svg/>').toString('base64'))).rejects.toThrow(
    '格式',
  );
  const response = await app.app.request(`http://127.0.0.1/api/message-media/group%3A1/${m.localId}/0`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(privateAddress('127.0.0.1')).toBe(true);
  expect(privateAddress('::ffff:7f00:1')).toBe(true);
  expect(privateAddress('8.8.8.8')).toBe(false);
});
test('真实 mock agent 记录提示词、工具参数结果，压缩持久化并脱敏', async () => {
  const app = await boot();
  app.runtime
    .use(configService)
    .patch({ model: { apiKey: 'trace-fixture-key' }, defaults: { persona: '不要泄露 trace-fixture-key' } });
  await app.runtime
    .use(conversationService)
    .ingest({
      id: 'trace',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '测试',
      text: '轨迹测试',
      atMe: true,
      timestamp: Date.now(),
    });
  let archives = app.runtime.use(storageService).archives();
  const deadline = Date.now() + 5000;
  while (!archives.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
    archives = app.runtime.use(storageService).archives();
  }
  expect(archives[0]?.status).toBe('completed');
  const id = archives[0]!.id,
    trace = app.runtime.use(traceService).get(id)!;
  expect(trace.events.map((e) => e.kind)).toEqual(
    expect.arrayContaining(['trigger', 'context', 'model.response', 'tool.call', 'tool.result', 'finish']),
  );
  expect(JSON.stringify(trace)).toContain('messages');
  expect(JSON.stringify(trace)).not.toContain('trace-fixture-key');
  expect(JSON.stringify(trace)).toContain('[REDACTED]');
  expect((await app.app.request(`http://127.0.0.1/api/run-details/${id}`)).status).toBe(200);
  expect(fs.readdirSync(path.join(app.dataDir, 'run-details')).some((f) => f.endsWith('.json.gz'))).toBe(
    true,
  );
  await app.stop();
  const next = await createApplication({
    dataDir: app.dataDir,
    v2Managers: false,
    extensionHotReload: false,
  });
  apps.push(next);
  expect(next.runtime.use(traceService).get(id)?.events.length).toBe(trace.events.length);
});
