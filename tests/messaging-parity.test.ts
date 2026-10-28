import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  adapterService,
  configService,
  storageService,
  toolService,
  type ToolContext,
} from '@qq-harness/domain';
import { sendMessageInput, finishInput } from '../plugins/basic-tools/src/messaging.js';
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.stop();
});
async function boot() {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-array-send-')),
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: { acceptAllSessions: true, send: { minIntervalMs: 0, dedupeMs: 10000 } },
  });
  apps.push(app);
  return app;
}
test('发送契约仅允许非空字符串数组，不接受旧 text、字符串化数组或对象', () => {
  for (const value of [
    { text: 'x' },
    { messages: 'x' },
    { messages: '["x"]' },
    { messages: [] },
    { messages: [{}] },
    { messages: [''] },
    'x',
    ['x'],
  ])
    expect(sendMessageInput.safeParse(value).success).toBe(false);
  expect(sendMessageInput.parse({ messages: ['第一条', '代码\n  print(1)'] })).toEqual({
    messages: ['第一条', '代码\n  print(1)'],
  });
  expect(finishInput.safeParse({ mode: 'silent' }).success).toBe(false);
  expect(finishInput.parse({ mode: 'spoken' })).toEqual({ mode: 'spoken' });
});
test('数组逐条发送，部分失败和去重结果可区分，成功项不重复发送', async () => {
  const app = await boot(),
    adapter = app.runtime.use(adapterService),
    tools = app.runtime.use(toolService);
  const original = adapter.send.bind(adapter);
  const send = vi
    .spyOn(adapter, 'send')
    .mockImplementation((chat, text, signal) =>
      text === '失败'
        ? Promise.reject(Object.assign(new Error('模拟拒绝'), { definiteFailure: true }))
        : original(chat, text, signal),
    );
  let result: unknown;
  const { definePlugin } = await import('@qq-harness/plugin-sdk');
  const { z } = await import('zod');
  app.runtime.install(
    definePlugin({
      id: 'test-send-batch',
      setup(ctx) {
        ctx.mode({
          id: 'test.send-batch',
          input: z.object({}),
          execute: async (run) => {
            const context: ToolContext = {
              run,
              chatKey: 'group:1',
              settings: app.runtime.use(configService).effective('group:1'),
              sent: 0,
              trace() {},
            };
            result = await tools.execute(
              context,
              'send_message',
              JSON.stringify({ messages: ['甲', '失败', '乙'] }),
            );
            expect(context.sent).toBe(2);
            const duplicate = await tools.execute(
              context,
              'send_message',
              JSON.stringify({ messages: ['甲'] }),
            );
            expect(duplicate).toMatchObject({ results: [{ duplicate: true }] });
            expect(context.sent).toBe(2);
            return result;
          },
        });
      },
    }),
  );
  await app.runtime.start();
  const run = app.runtime.submit({ mode: 'test.send-batch', partitionKey: 'group:1', input: {} });
  expect((await app.runtime.wait(run.id)).status).toBe('completed');
  expect(result).toMatchObject({ sent: 2, failed: [{ index: 1, error: '模拟拒绝' }] });
  expect(send).toHaveBeenCalledTimes(3);
  expect(adapter.sent?.map((m) => m.text)).toEqual(['甲', '乙']);
});

test('send_message 的相似括号引用实际发送原生分段，正文与留档不含控制标记', async () => {
  const app = await boot(),
    adapter = app.runtime.use(adapterService),
    storage = app.runtime.use(storageService),
    tools = app.runtime.use(toolService);
  storage.append({
    id: '-123456',
    chatKey: 'group:1',
    senderId: '22',
    senderName: '测试成员',
    text: '合成引用来源',
    atMe: false,
    timestamp: Date.now(),
  });
  const payload = vi.spyOn(adapter, 'sendPayload');
  const { z } = await import('zod');
  app.runtime.install({
    id: 'test-alias-marker',
    setup(ctx) {
      ctx.mode({
        id: 'test.alias-marker',
        input: z.object({}),
        execute: async (run) => {
          const context: ToolContext = {
            run,
            chatKey: 'group:1',
            settings: app.runtime.use(configService).effective('group:1'),
            sent: 0,
            trace() {},
          };
          return tools.execute(
            context,
            'send_message',
            JSON.stringify({
              messages: ['第一条', '〖reply:-123456〗〖at:22〗兼容引用测试', '〖说明〗保留'],
            }),
          );
        },
      });
    },
  });
  await app.runtime.settled();
  const run = app.runtime.submit({ mode: 'test.alias-marker', partitionKey: 'group:1', input: {} });
  expect(await app.runtime.wait(run.id)).toMatchObject({
    status: 'completed',
    result: { sent: 3, failed: [] },
  });
  expect(payload).toHaveBeenCalledTimes(1);
  expect(payload.mock.calls[0]?.[1]).toEqual({
    segments: [
      { type: 'reply', data: { id: '-123456' } },
      { type: 'at', data: { qq: '22' } },
      { type: 'text', data: { text: '兼容引用测试' } },
    ],
  });
  const outgoing = storage.messages('group:1').filter((m) => m.self);
  expect(outgoing.map((m) => m.text)).toEqual(['第一条', '兼容引用测试', '〖说明〗保留']);
  expect(JSON.stringify(adapter.sent)).not.toContain('〖reply:');
});
test('finish 两次纠正后标未验证，目录与执行共用工具开关，默认扩展 scope 可用', async () => {
  const app = await boot();
  const cfg = app.runtime.use(configService),
    tools = app.runtime.use(toolService);
  cfg.saveProfile('group:1', {
    tools: { categories: { messaging: false }, overrides: { send_message: false } },
  });
  expect(tools.catalog?.('group:1').find((t) => t.id === 'send_message')).toMatchObject({
    core: true,
    enabled: true,
  });
  cfg.saveProfile('group:1', { tools: { enabled: false } });
  expect(tools.list('group:1')).toEqual([]);
  cfg.saveProfile('group:1', { tools: { enabled: true } });
  const { definePlugin } = await import('@qq-harness/plugin-sdk');
  const { z } = await import('zod');
  app.runtime.install(
    definePlugin({
      id: 'test-finish',
      setup(ctx) {
        ctx.mode({
          id: 'test.finish',
          input: z.object({}),
          execute: async (run) => {
            const context: ToolContext = {
              run,
              chatKey: 'group:1',
              settings: cfg.effective('group:1'),
              sent: 0,
              trace() {},
            };
            for (let i = 0; i < 2; i++)
              expect(await tools.execute(context, 'finish', '{"mode":"spoken"}')).toMatchObject({
                isError: true,
              });
            expect(context.finish).toBeUndefined();
            expect(await tools.execute(context, 'finish', '{"mode":"spoken"}')).toMatchObject({
              unverified: true,
            });
            expect(context.finish?.unverified).toBe(true);
            return context.finish;
          },
        });
      },
    }),
  );
  await app.runtime.start();
  const run = app.runtime.submit({ mode: 'test.finish', partitionKey: 'group:1', input: {} });
  expect((await app.runtime.wait(run.id)).status).toBe('completed');
  expect((await app.app.request('http://127.0.0.1/api/extensions?chat=default')).status).toBe(200);
  const bad = await app.app.request('http://127.0.0.1/api/extensions?chat=invalid');
  expect(bad.status).toBe(400);
  expect(JSON.stringify(await bad.json())).not.toContain('invalid_format');
  expect(app.runtime.use(storageService).messages('group:1')).toEqual([]);
});
