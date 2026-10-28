import { waitMemoryRequest } from './fixtures/memory-task.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { Runtime } from '@qq-harness/kernel';
import { modelMock } from '@qq-harness/model-mock';
import { modelOpencode } from '@qq-harness/model-opencode';
import { reminders } from '@qq-harness/reminders';
import {
  accessService,
  adapterService,
  configService,
  outboundService,
  reminderService,
  storageService,
  toolService,
  type ConfigService,
  type StorageService,
  type ToolService,
  conversationService,
  modelService,
} from '@qq-harness/domain';
import { configSchema } from '@qq-harness/contracts';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function boot(
  initialConfig: unknown = {},
  plugins: Parameters<typeof createApplication>[0]['plugins'] = [],
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-'));
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const app = await createApplication({ dataDir, initialConfig, plugins, extensionHotReload: false });
  cleanups.push(app.stop);
  return app;
}

test('聊天扩展点提供者缺席时依赖插件等待，启用和再次卸载均联动', async () => {
  const app = await boot({ plugins: { conversation: false } });
  const states = () =>
    app.runtime.listPlugins().filter((p) => ['agent-memory', 'extension-system'].includes(p.id));
  expect(states().map((p) => p.status)).toEqual(['waiting', 'waiting']);
  await app.runtime.setEnabled('conversation', true);
  expect(states().map((p) => p.status)).toEqual(['active', 'active']);
  await app.runtime.setEnabled('conversation', false);
  expect(states().map((p) => p.status)).toEqual(['waiting', 'waiting']);
  await app.runtime.setEnabled('conversation', true);
  expect(states().map((p) => p.status)).toEqual(['active', 'active']);
});

test.each([
  'adapter-mock',
  'model-mock',
  'tool-runtime',
  'outbound-queue',
  'agent-basic',
  'extension-system',
  'storage-sqlite',
])('基础插件 %s 停用/恢复后所有消费者恢复 active，旧工具不会重复注册', async (id) => {
  const app = await boot();
  const before = app.runtime
    .use(toolService)
    .list('group:1')
    .map((tool) => tool.function.name)
    .sort();
  await app.runtime.setEnabled(id, false);
  expect(app.runtime.listPlugins().filter((plugin) => plugin.status === 'failed')).toEqual([]);
  await app.runtime.setEnabled(id, true);
  expect(app.runtime.listPlugins().filter((plugin) => plugin.status !== 'active')).toEqual([]);
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .map((tool) => tool.function.name)
      .sort(),
  ).toEqual(before);
});

test('OpenCode 请求头插件不能把任意模型提供者误认成 HTTP 扩展点提供者', async () => {
  const runtime = new Runtime();
  cleanups.push(() => runtime.stop());
  runtime.install(modelMock);
  runtime.install(modelOpencode);
  await runtime.start();
  expect(runtime.listPlugins().find((p) => p.id === 'model-opencode')?.status).toBe('waiting');
});

test('工具后置 transform 的结果实际返回调用方，异常监听不破坏原结果', async () => {
  const app = await boot({ acceptAllSessions: true }, [
    {
      id: 'audit-tools',
      requires: [toolService.id],
      setup(ctx) {
        ctx.use(toolService).register(ctx, {
          name: 'audit_echo',
          description: '审计用工具',
          parameters: { type: 'object' },
          parse: (value) => value,
          execute: async () => ({ content: 'raw' }),
        });
        ctx.on<{ result: unknown }>(
          'tool.after',
          (value) => ({ ...value, result: { content: 'filtered' } }),
          10,
        );
        ctx.on(
          'tool.after',
          () => {
            throw new Error('隔离后置插件异常');
          },
          20,
        );
      },
    },
  ]);
  const run = app.runtime.submit({
    mode: 'command.direct',
    partitionKey: 'group:1',
    input: { chatKey: 'group:1', tool: 'audit_echo', args: {} },
  });
  expect((await app.runtime.wait(run.id)).result).toEqual({ content: 'filtered' });
});

test('删除正在排队的提醒会撤销对应运行，不会稍后继续发送', async () => {
  const app = await boot({ acceptAllSessions: true, send: { minIntervalMs: 0 } });
  const service = app.runtime.use(reminderService);
  const reminder = service.add({ chatKey: 'group:1', text: '应被取消', dueAt: Date.now() + 60_000 });
  // 运行输入必须来自现存提醒；使用占住同分区的模式确保提醒仍在排队。
  app.runtime.install({
    id: 'audit-hold',
    setup(ctx) {
      ctx.mode({
        id: 'audit.hold',
        input: { parse: () => ({}) },
        execute: (run) =>
          new Promise<void>((resolve) =>
            run.signal.addEventListener('abort', () => resolve(), { once: true }),
          ),
      });
    },
  });
  await app.runtime.settled();
  const hold = app.runtime.submit({ mode: 'audit.hold', partitionKey: 'group:1', input: {} });
  const delivery = app.runtime.submit({ mode: 'reminder.deliver', partitionKey: 'group:1', input: reminder });
  expect(delivery.status).toBe('queued');
  service.remove(reminder.id);
  app.runtime.cancel(hold.id);
  await app.runtime.wait(delivery.id);
  expect(app.runtime.use(adapterService).sent).toEqual([]);
});

test('提醒队列满时隔离提交失败，下次轮询仍可重试且每条只提交一次', async () => {
  // 只替换 host 调度口，真实运行提醒插件；不用 200 个长任务制造满队列。
  vi.useFakeTimers();
  const runtime = new Runtime();
  cleanups.push(() => runtime.stop());
  const settings = configSchema.parse({ acceptAllSessions: true });
  const state = new Map<string, unknown>();
  runtime.install({
    id: 'fixture-services',
    setup(ctx) {
      ctx.provide(configService, {
        get: () => settings,
        effective: () => settings.defaults,
      } as unknown as ConfigService);
      ctx.provide(accessService, { allowed: () => true, assert() {} });
      ctx.provide(storageService, {
        state: (ns, key) => state.get(`${ns}/${key}`),
        setState: (ns, key, value) => {
          state.set(`${ns}/${key}`, value);
        },
      } as StorageService);
      ctx.provide(outboundService, {
        send: async () => ({ id: '1' }),
        sendPayload: async () => ({ id: '1' }),
      });
      ctx.provide(toolService, { register() {} } as unknown as ToolService);
    },
  });
  runtime.install(reminders(''));
  await runtime.start();
  runtime.use(reminderService).add({ chatKey: 'group:1', text: '重试', dueAt: Date.now() + 1 });
  const original = runtime.submit;
  let attempts = 0;
  runtime.submit = (request) => {
    if (++attempts === 1) throw new Error('运行队列已满');
    return original(request);
  };
  await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(500);
  expect(attempts).toBe(2);
  expect(runtime.use(reminderService).list()).toEqual([]);
});

test('会话关闭记忆插件后不注入记忆提示，也不在后台调用提炼模型', async () => {
  let modelCalls = 0;
  const app = await boot(
    {
      acceptAllSessions: true,
      plugins: { 'model-mock': false, 'extension-system': false },
      defaults: { plugins: { 'agent-memory': false } },
    },
    [
      {
        id: 'audit-memory-model',
        setup(ctx) {
          ctx.provide(modelService, {
            complete: async () => {
              modelCalls++;
              return {
                message: { role: 'assistant', content: '{"candidates":[]}' },
                usage: { input: 0, output: 0 },
              };
            },
          });
        },
      },
    ],
  );
  const prompt = { chatKey: 'group:1', persona: '测试人设', extra: '' };
  const result = await app.runtime.points.transform('prompt.segments', prompt);
  expect(result.persona).toBe(prompt.persona);
  expect(result.extra).not.toMatch(/memory_search|scratchpad_list|短期>中期>长期/);
  for (let i = 0; i < 30; i++)
    await app.runtime.use(conversationService).ingest({
      id: String(i),
      chatKey: 'group:1',
      senderId: '2',
      senderName: 'mock',
      text: '未唤醒的消息',
      atMe: false,
      timestamp: Date.now(),
    });
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(modelCalls).toBe(0);
  app.runtime.use(configService).saveProfile('group:1', { plugins: { 'agent-memory': true } });
  await app.runtime.use(conversationService).ingest({
    id: '30',
    chatKey: 'group:1',
    senderId: '2',
    senderName: 'mock',
    text: '开启记忆后',
    atMe: false,
    timestamp: Date.now(),
  });
  const memory = app.runtime.use({
    id: 'harness.memory',
  } as typeof import('@qq-harness/domain').memoryService);
  await waitMemoryRequest(app, memory.consolidate('group:1', 'short'));
  expect(modelCalls).toBeGreaterThan(0);
});
