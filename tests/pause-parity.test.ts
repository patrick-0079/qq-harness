import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  adapterService,
  configService,
  conversationService,
  modelService,
  storageService,
} from '@qq-harness/domain';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.useRealTimers();
});
async function fixture() {
  vi.useFakeTimers();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pause-'));
  cleanups.push(() => {
    const real = fs.realpathSync(root);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-pause-')
    )
      throw new Error('清理越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  const options = {
    dataDir: root,
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      acceptAllSessions: true,
      defaults: { wakeDelayMs: 50, drainDelayMs: 1 },
      send: { minIntervalMs: 0, dedupeMs: 0 },
    },
  };
  const app = await createApplication(options);
  cleanups.push(app.stop);
  return {
    ...app,
    options,
    config: app.runtime.use(configService),
    storage: app.runtime.use(storageService),
    adapter: app.runtime.use(adapterService),
    ingest: (id: string, chatKey = 'group:1', senderId = '2') =>
      app.runtime.use(conversationService).ingest({
        id,
        chatKey,
        senderId,
        senderName: '测试成员',
        text: id,
        atMe: true,
        timestamp: Date.now(),
      }),
    pause: (body: unknown) =>
      app.app.request('http://127.0.0.1/api/pause', { method: 'POST', body: JSON.stringify(body) }),
  };
}
test('全局下线覆盖独立会话快照并保留存档，上线始终跳过积压', async () => {
  const f = await fixture();
  f.config.saveProfile('group:1', { online: true });
  f.config.saveProfile('group:2', { online: true });
  expect((await f.pause({ paused: true })).ok).toBe(true);
  await f.ingest('paused-one');
  await f.ingest('paused-two', 'group:2');
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(0);
  expect(f.storage.unread('group:1')).toHaveLength(0);
  const skipped = await (await f.pause({ paused: false, skipBacklog: true })).json();
  expect(skipped.marked).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(0);
  expect(f.storage.messages('group:1')).toHaveLength(1);
  await f.ingest('fresh');
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(1);
  await f.pause({ paused: true });
  await f.ingest('backlog');
  const rejected = await f.pause({ paused: false, skipBacklog: false });
  expect(rejected.status).toBe(400);
  await f.pause({ paused: false });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(1);
  await f.ingest('after-online');
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(2);
  expect(f.adapter.sent![1]!.text).toContain('after-online');
});
test('暂停会取消待触发定时器，重启保留状态，恢复不读取被新屏蔽用户的积压', async () => {
  const f = await fixture();
  await f.ingest('timer-pending');
  await f.pause({ paused: true });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(0);
  await f.stop();
  const app = await createApplication(f.options);
  cleanups.push(app.stop);
  expect(app.runtime.use(configService).get().paused).toBe(true);
  const config = app.runtime.use(configService),
    storage = app.runtime.use(storageService),
    model = app.runtime.use(modelService);
  config.patch({ deniedUsers: ['2'] });
  const complete = vi.spyOn(model, 'complete');
  await app.app.request('http://127.0.0.1/api/pause', { method: 'POST', body: '{"paused":false}' });
  await vi.advanceTimersByTimeAsync(100);
  expect(complete).not.toHaveBeenCalled();
  await app.runtime.use(conversationService).ingest({
    id: 'allowed-new',
    chatKey: 'group:1',
    senderId: '3',
    senderName: '允许成员',
    text: '允许的新消息',
    atMe: true,
    timestamp: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(complete).toHaveBeenCalled();
  expect(JSON.stringify(complete.mock.calls)).not.toContain('timer-pending');
  expect(storage.unread('group:1')).toHaveLength(0);
});
test('下线取消当前运行，保留后续消息存档；DELETE 上线不重放', async () => {
  const f = await fixture();
  let finish!: (value: any) => void;
  vi.spyOn(f.runtime.use(modelService), 'complete').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await f.ingest('active');
  await vi.advanceTimersByTimeAsync(60);
  expect(finish).toBeTypeOf('function');
  await f.pause({ paused: true });
  await f.ingest('later');
  finish({
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'finish',
          type: 'function',
          function: { name: 'finish', arguments: '{"mode":"silent","silentReason":"暂停测试"}' },
        },
      ],
    },
    usage: { input: 1, output: 1 },
  });
  await vi.advanceTimersByTimeAsync(20);
  expect(f.storage.archives()[0]?.status).toBe('cancelled');
  expect(f.storage.unread('group:1')).toHaveLength(0);
  expect(f.storage.messages('group:1').some((m) => m.id === 'later')).toBe(true);
  const restored = await (await f.app.request('http://127.0.0.1/api/pause', { method: 'DELETE' })).json();
  expect(restored).toMatchObject({ paused: false, marked: {} });
  expect(f.storage.unread('group:1')).toHaveLength(0);
});
