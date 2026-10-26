import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  accessService,
  adapterService,
  configService,
  conversationService,
  modelService,
  outboundService,
  storageService,
} from '@qq-harness/domain';
import { acquireDataLock } from '../apps/server/src/lock.js';
test('启动级会话边界不会被宽松配置或后续管理 API 扩大', async () => {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-boundary-')),
    allowedChats: ['group:10001', 'private:10002'],
    initialConfig: { acceptAllSessions: true },
  });
  try {
    const access = app.runtime.use(accessService);
    expect(access.allowed('group:10001')).toBe(true);
    expect(access.allowed('private:10002')).toBe(true);
    expect(access.allowed('group:1')).toBe(false);
    expect(access.allowed('private:1')).toBe(false);
    app.runtime.use(configService).patch({ acceptAllSessions: true, admissions: ['group:1'] });
    await expect(
      app.runtime.use(outboundService).send(
        {
          id: 'boundary',
          signal: new AbortController().signal,
          deadline: Date.now() + 1000,
          revision: 0,
          assertActive() {},
        },
        'group:1',
        '不应发送',
      ),
    ).rejects.toThrow();
    expect(app.runtime.use(adapterService).sent).toEqual([]);
  } finally {
    await app.stop();
  }
});

test('运行取消后迟到的模型响应不能发送消息', async () => {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cancel-')),
    initialConfig: {
      acceptAllSessions: true,
      defaults: { wakeDelayMs: 0 },
      plugins: { 'model-mock': false },
    },
    plugins: [
      {
        id: 'slow-model',
        setup(ctx) {
          ctx.provide(modelService, {
            complete: async () => {
              await delay(100);
              return {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'late',
                      type: 'function',
                      function: { name: 'send_message', arguments: '{"text":"不应发送"}' },
                    },
                  ],
                },
                usage: { input: 0, output: 0 },
              };
            },
          });
        },
      },
    ],
  });
  try {
    await app.runtime.use(conversationService).ingest({
      id: '1',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '',
      text: '测试',
      atMe: true,
      timestamp: Date.now(),
    });
    for (let i = 0; !app.runtime.listRuns().length && i < 100; i++) await delay(5);
    const run = app.runtime.listRuns()[0]!;
    app.runtime.cancel(run.id);
    await app.runtime.wait(run.id);
    await delay(150);
    expect(app.runtime.use(adapterService).sent).toHaveLength(0);
    expect(app.runtime.use(storageService).unread('group:1')).toHaveLength(1);
  } finally {
    await app.stop();
  }
});
test('发送队列出队时再次检查准入，撤销后不发送', async () => {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outbound-')),
    initialConfig: { acceptAllSessions: true, send: { minIntervalMs: 100 } },
  });
  try {
    const outbound = app.runtime.use(outboundService);
    const config = app.runtime.use(configService);
    const run = {
      id: 'test',
      signal: new AbortController().signal,
      deadline: Date.now() + 10000,
      revision: 0,
      assertActive() {},
    };
    await outbound.send(run, 'group:1', '第一条');
    const second = outbound.send(run, 'group:1', '第二条');
    config.patch({ deniedChats: ['group:1'] });
    await expect(second).rejects.toThrow();
    expect(app.runtime.use(adapterService).sent).toHaveLength(1);
  } finally {
    await app.stop();
  }
});
test('数据目录实例锁拒绝双写，释放后可重新启动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lock-'));
  const release = acquireDataLock(dir);
  expect(() => acquireDataLock(dir)).toThrow('已有');
  release();
  const next = acquireDataLock(dir);
  next();
  expect(fs.existsSync(path.join(dir, 'harness.lock'))).toBe(false);
});
