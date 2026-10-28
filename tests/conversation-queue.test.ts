import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { conversationService, configService, storageService, adapterService } from '@qq-harness/domain';
import { conversationQueue } from '../plugins/conversation/src/queue.js';
import { z } from 'zod';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function boot(dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-queue-'))) {
  const app = await createApplication({ dataDir, concurrency: 1, extensionHotReload: false });
  cleanup.push(app.stop);
  return {
    ...app,
    dataDir,
    storage: app.runtime.use(storageService),
    config: app.runtime.use(configService),
    conversation: app.runtime.use(conversationService),
  };
}
async function until(fn: () => boolean) {
  const end = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > end) throw Error('等待队列超时');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const message = (chatKey = 'group:1') => ({
  chatKey,
  id: 'queued',
  text: 'queued test',
  senderId: '2',
  senderName: 'test',
  timestamp: Date.now(),
  atMe: true,
});

test('排队超时独立于执行超时、取消记录可查且没有发送', async () => {
  const f = await boot();
  f.config.patch({ defaults: { queueTimeoutMs: 50, runTimeoutMs: 10000 } });
  f.runtime.install({
    id: 'block-slot',
    setup(ctx) {
      ctx.mode({
        id: 'block-slot',
        input: z.object({}),
        execute: (run) =>
          new Promise((_, reject) =>
            run.signal.addEventListener('abort', () => reject(run.signal.reason), { once: true }),
          ),
      });
    },
  });
  await f.runtime.start();
  const block = f.runtime.submit({ mode: 'block-slot', partitionKey: 'other', input: {} });
  f.storage.append(message());
  const id = f.conversation.retry('group:1');
  expect(f.conversation.queue().find((e) => e.id === id)?.status).toBe('queued');
  expect((await f.runtime.wait(id)).error).toBe('排队超时');
  expect(f.conversation.queue().find((e) => e.id === id)).toMatchObject({
    status: 'cancelled',
    reason: '排队超时',
  });
  expect(f.runtime.use(adapterService).sent).toEqual([]);
  f.runtime.cancel(block.id);
});

test('重启恢复未执行任务，不重放运行中任务，不突破下线和超时', async () => {
  const f = await boot();
  const stored = f.storage.append(message());
  f.config.saveProfile('group:2', { online: false });
  f.storage.append(message('group:2'));
  f.storage.setState('conversation-queue', 'jobs', [
    {
      id: 'restore',
      chatKey: 'group:1',
      ids: [stored.localId],
      createdAt: Date.now(),
      timeoutMs: 0,
      status: 'queued',
    },
    {
      id: 'unsafe-replay',
      chatKey: 'group:3',
      ids: [],
      createdAt: Date.now(),
      timeoutMs: 0,
      status: 'running',
    },
    { id: 'offline', chatKey: 'group:2', ids: [], createdAt: Date.now(), timeoutMs: 0, status: 'queued' },
    { id: 'expired', chatKey: 'group:4', ids: [], createdAt: 1, timeoutMs: 1, status: 'queued' },
  ]);
  await f.stop();
  const next = await boot(f.dataDir);
  await until(() => next.storage.archives().length > 0);
  expect(next.runtime.use(adapterService).sent).toHaveLength(1);
  expect(next.conversation.queue().find((e) => e.id === 'unsafe-replay')).toMatchObject({
    status: 'interrupted',
  });
  expect(next.conversation.queue().find((e) => e.id === 'offline')).toMatchObject({
    status: 'cancelled',
    reason: expect.stringContaining('下线'),
  });
  expect(next.conversation.queue().find((e) => e.id === 'expired')).toMatchObject({
    status: 'cancelled',
    reason: expect.stringContaining('超时'),
  });
  expect(next.conversation.queue().find((e) => e.id === 'restore')?.reason).toContain('已恢复');
  expect(next.storage.unread('group:2')).toHaveLength(1);
  const response = await next.app.request('http://127.0.0.1/api/conversation/queue');
  expect(response.status).toBe(200);
});

test('排队设置支持会话快照及分区恢复，完成记录只保留100条', async () => {
  const f = await boot();
  f.config.saveProfile('group:1', { queueTimeoutMs: 250 });
  f.config.patch({ defaults: { queueTimeoutMs: 500 } });
  expect(f.config.effective('group:1').queueTimeoutMs).toBe(250);
  f.config.restoreProfile('group:1', 'chat');
  expect(f.config.effective('group:1').queueTimeoutMs).toBe(500);
  const journal = conversationQueue(f.storage);
  for (let i = 0; i < 120; i++)
    journal.put({
      id: String(i),
      chatKey: 'group:1',
      ids: [],
      createdAt: 0,
      timeoutMs: 0,
      status: 'completed',
    });
  expect(journal.list()).toHaveLength(100);
});
