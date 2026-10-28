import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { systemControl } from '../plugins/system-control/src/index.js';
import { storageFile } from '@qq-harness/storage-file';
import { Runtime } from '@qq-harness/kernel';
import { configFile } from '@qq-harness/config-file';
import { accessPolicy } from '@qq-harness/access-policy';
import { adapterOnebot } from '@qq-harness/adapter-onebot';
import { adapterService, configService } from '@qq-harness/domain';
import type { IncomingMessage } from '@qq-harness/contracts';
import { mockSnowluma } from './fixtures/snowluma.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function snow(options: Parameters<typeof mockSnowluma>[0] = {}) {
  const mock = await mockSnowluma(options);
  cleanups.push(mock.close);
  return mock;
}
async function boot(mock: Awaited<ReturnType<typeof snow>>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-onebot-audit-'));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = new Runtime();
  cleanups.push(() => runtime.stop());
  runtime.install(configFile(directory, { onebot: mock.config, admissions: ['group:123', 'private:456'] }));
  runtime.install(accessPolicy);
  runtime.install(storageFile(directory));
  runtime.install(systemControl);
  runtime.install(adapterOnebot);
  await runtime.start();
  return runtime;
}
const event = (patch: Record<string, unknown> = {}) => ({
  post_type: 'message',
  message_type: 'group',
  group_id: 123,
  user_id: 456,
  self_id: 888,
  message_id: -10,
  time: Date.now() / 1000,
  sender: { nickname: 'mock' },
  message: [
    { type: 'at', data: { qq: '888' } },
    { type: 'text', data: { text: 'hello' } },
  ],
  ...patch,
});

test('SnowLuma HTTP/WS 分别校验令牌，非法事件和未获准会话不会进入订阅者', async () => {
  const mock = await snow({ wsToken: 'ws-test', httpToken: 'http-test' });
  const runtime = await boot(mock);
  const adapter = runtime.use(adapterService);
  await vi.waitFor(() => expect(adapter.connected()).toBe(true));
  const received: IncomingMessage[] = [];
  adapter.subscribe((value) => received.push(value));
  mock.push('{');
  mock.push(null);
  mock.push(event({ message_id: undefined }));
  mock.push(event({ group_id: 999 }));
  mock.push(event({ user_id: 888 }));
  mock.push(event());
  await vi.waitFor(() => expect(received.some((value) => value.id === '-10')).toBe(true));
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ id: '-10', chatKey: 'group:123', atMe: true });
  await adapter.send('group:123', '[CQ:at,qq=all] literal', new AbortController().signal);
  expect(mock.upgrades).toEqual(['Bearer ws-test']);
  expect(mock.calls.every((call) => call.authorization === 'Bearer http-test')).toBe(true);
  expect(mock.calls.find((call) => call.action === 'send_group_msg')?.args.message).toEqual([
    { type: 'text', data: { text: '[CQ:at,qq=all] literal' } },
  ]);
  await expect(adapter.query('send_group_msg', { group_id: '999' })).rejects.toThrow('outbound');
  await expect(adapter.query('get_group_info', { group_id: '999' })).rejects.toThrow('准入');
  await expect(adapter.query('get_avatar', { user_id: '777' })).resolves.toBeDefined();
});

test('保存新的 OneBot 地址或令牌立即换连接，旧连接停止投递', async () => {
  const first = await snow({ wsToken: 'first' });
  const second = await snow({ wsToken: 'second', httpToken: 'http-second' });
  const runtime = await boot(first);
  const adapter = runtime.use(adapterService);
  await vi.waitFor(() => expect(adapter.connected()).toBe(true));
  const received: IncomingMessage[] = [];
  adapter.subscribe((value) => received.push(value));
  runtime.use(configService).patch({ onebot: second.config });
  await vi.waitFor(() => expect(second.ws.clients.size).toBe(1));
  await vi.waitFor(() => expect(first.ws.clients.size).toBe(0));
  first.push(event({ message_id: 1 }));
  second.push(event({ message_id: 2 }));
  await vi.waitFor(() => expect(received.map((value) => value.id)).toEqual(['2']));
  runtime.use(configService).patch({ defaults: { persona: '无关配置修改' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(second.upgrades).toHaveLength(1);
});

test('带调用方 signal 的 HTTP 请求仍受超时约束，异常响应不能当作成功', async () => {
  const mock = await snow();
  const runtime = await boot(mock);
  const adapter = runtime.use(adapterService);
  await vi.waitFor(() => expect(adapter.connected()).toBe(true));
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  await adapter.query('get_group_info', { group_id: '123' }, new AbortController().signal);
  expect(timeout).toHaveBeenCalledWith(30000);
  for (const reply of [
    { body: { status: 'failed', retcode: 0 } },
    { body: { status: 'ok', retcode: 1 } },
    { raw: 'not-json' },
    { status: 401, body: {} },
  ]) {
    mock.actions.set('get_group_info', () => reply);
    await expect(adapter.query('get_group_info', { group_id: '123' })).rejects.toThrow();
  }
});

test('握手尚未完成时卸载适配器不会产生未处理 error，也不会重新连接', async () => {
  const mock = await snow({ holdHandshake: true });
  const runtime = await boot(mock);
  await vi.waitFor(() => expect(mock.upgrades).toHaveLength(1));
  await runtime.setEnabled('adapter-onebot', false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mock.upgrades).toHaveLength(1);
});

test('SnowLuma 断线后只建立一个替代连接，恢复后消息只投递一次', async () => {
  const mock = await snow();
  const runtime = await boot(mock);
  const adapter = runtime.use(adapterService);
  await vi.waitFor(() => expect(adapter.connected()).toBe(true));
  for (const client of mock.ws.clients) client.terminate();
  await vi.waitFor(() => expect(adapter.connected()).toBe(false));
  await vi.waitFor(() => expect(mock.upgrades).toHaveLength(2), { timeout: 5000 });
  const received: IncomingMessage[] = [];
  adapter.subscribe(() => {
    throw new Error('故障观察者');
  });
  adapter.subscribe((message) => received.push(message));
  mock.push(event());
  await vi.waitFor(() => expect(received).toHaveLength(1));
  expect(mock.ws.clients.size).toBe(1);
});

test('旧连接迟到的账号查询不能覆盖新账号身份，调用方取消会中止 HTTP 等待', async () => {
  const first = await snow();
  const second = await snow();
  let release!: (reply: { body: unknown }) => void;
  first.actions.set(
    'get_login_info',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  second.actions.set('get_login_info', () => ({
    body: { status: 'ok', retcode: 0, data: { user_id: '999' } },
  }));
  const runtime = await boot(first);
  await vi.waitFor(() => expect(first.calls).toHaveLength(1));
  runtime.use(configService).patch({ onebot: second.config });
  await vi.waitFor(() => expect(second.calls).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  release({ body: { status: 'ok', retcode: 0, data: { user_id: '888' } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const adapter = runtime.use(adapterService);
  const received: IncomingMessage[] = [];
  adapter.subscribe((message) => received.push(message));
  second.push(event({ self_id: undefined, user_id: 999, message_id: 1 }));
  second.push(event({ self_id: undefined, message_id: 2 }));
  await vi.waitFor(() => expect(received.map((message) => message.id)).toEqual(['2']));
  let finish!: (reply: { body: unknown }) => void;
  second.actions.set(
    'get_group_info',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const query = adapter.query('get_group_info', { group_id: '123' }, controller.signal);
  const expected = expect(query).rejects.toThrow('test cancel');
  await vi.waitFor(() => expect(second.calls.some((call) => call.action === 'get_group_info')).toBe(true));
  controller.abort(new Error('test cancel'));
  await expected;
  finish({ body: { status: 'ok', retcode: 0, data: {} } });
});
