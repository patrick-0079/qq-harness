import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { adapterService, configService, storageService, conversationService } from '@qq-harness/domain';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
async function boot(options: Partial<Parameters<typeof createApplication>[0]> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  const app = await createApplication({ dataDir, ...options });
  cleanup.push(() => app.stop());
  return { ...app, dataDir };
}
async function until<T>(get: () => T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = get();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
test('消息 → 模式 → 模型 → 工具 → 发送 → 归档，且重启可读取', async () => {
  const app = await boot();
  expect(app.runtime.listPlugins().filter((plugin) => plugin.status !== 'active')).toEqual([]);
  await app.runtime.use(conversationService).ingest({
    id: 'm1',
    chatKey: 'group:10001',
    senderId: '2',
    senderName: '用户',
    text: '你好',
    atMe: true,
    timestamp: Date.now(),
  });
  const storage = app.runtime.use(storageService);
  const archive = (
    await until(
      () => storage.archives(),
      (value) => value.length > 0,
    )
  )[0]!;
  expect(archive.status).toBe('completed');
  expect(archive.sent).toBe(1);
  expect(app.runtime.use(adapterService).sent).toEqual([
    { chatKey: 'group:10001', text: '演示回复：#m1 [localId=1] 用户 (2): 你好' },
  ]);
  expect(storage.unread('group:10001')).toEqual([]);
  await app.stop();
  const next = await createApplication({ dataDir: app.dataDir });
  cleanup.push(() => next.stop());
  expect(next.runtime.use(storageService).archives()).toHaveLength(1);
  expect(next.runtime.use(storageService).messages('group:10001')).toHaveLength(2);
});
test('准入、离线与会话完整配置快照保持隔离', async () => {
  const app = await boot();
  const config = app.runtime.use(configService);
  const conversation = app.runtime.use(conversationService);
  const storage = app.runtime.use(storageService);
  config.patch({ acceptAllSessions: false, admissions: ['group:1', 'group:2'] });
  config.saveProfile('group:1', { online: false, persona: '群一' });
  config.patch({ defaults: { persona: '新默认' } });
  expect(config.effective('group:1').persona).toBe('群一');
  expect(config.effective('group:2').persona).toBe('新默认');
  const message = {
    id: '1',
    senderId: '3',
    senderName: '用户',
    text: '消息',
    atMe: true,
    timestamp: Date.now(),
  };
  await conversation.ingest({ ...message, chatKey: 'group:9' });
  await conversation.ingest({ ...message, chatKey: 'group:1' });
  expect(storage.messages('group:9')).toEqual([]);
  expect(storage.unread('group:1')).toEqual([]);
  expect(app.runtime.listRuns()).toEqual([]);
});
test('HTTP 来源、鉴权、脱敏、输入校验与插件停用', async () => {
  const app = await boot({ token: 'test-token' });
  const request = (url: string, init: RequestInit = {}) =>
    app.app.request(`http://127.0.0.1${url}`, {
      ...init,
      headers: { Authorization: 'Bearer test-token', ...init.headers },
    });
  expect((await app.app.request('http://127.0.0.1/api/status')).status).toBe(401);
  const session = await request('/api/session', { method: 'POST' });
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
  expect((await app.app.request('http://127.0.0.1/api/status', { headers: { Cookie: cookie } })).status).toBe(
    200,
  );
  expect(
    (
      await request('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
  ).toBe(400);
  expect((await request('/api/status', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  app.runtime.use(configService).patch({ model: { apiKey: 'secret-value' } });
  const config = await (await request('/api/config')).json();
  expect(JSON.stringify(config)).not.toContain('secret-value');
  expect(config.model.hasApiKey).toBe(true);
  app.runtime.use(configService).patch({ onebot: { httpAccessToken: 'http-secret-value' } });
  expect(JSON.stringify(await (await request('/api/config')).json())).not.toContain('http-secret-value');
  await request('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaults: { persona: '测试' } }),
  });
  expect(app.runtime.use(configService).get().model.apiKey).toBe('secret-value');
  await app.runtime.setEnabled('conversation', false);
  expect(app.runtime.listPlugins().find((plugin) => plugin.id === 'conversation')?.status).toBe('disabled');
  expect((await request('/api/status')).status).toBe(200);
});

test('关闭管理令牌后无需认证访问控制台 API，旧令牌不干扰且来源限制保留', async () => {
  const app = await boot({ token: '' });
  expect((await app.app.request('http://127.0.0.1/api/status')).status).toBe(200);
  expect((await app.app.request('http://127.0.0.1/api/config')).status).toBe(200);
  expect(
    (
      await app.app.request('http://127.0.0.1/api/status', {
        headers: { Authorization: 'Bearer stale-browser-token' },
      })
    ).status,
  ).toBe(200);
  expect(
    (await app.app.request('http://127.0.0.1/api/status', { headers: { Origin: 'https://evil.example' } }))
      .status,
  ).toBe(403);
  expect((await app.app.request('http://evil.example/api/status')).status).toBe(403);
});
