import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { fakeContainerCli } from './fixtures/container-cli.js';
import {
  containerRuntimeService,
  containerJobsService,
  toolService,
  configService,
  modelService,
  conversationService,
  storageService,
  adapterService,
} from '@qq-harness/domain';
import { runContainerCli } from '@qq-harness/container-runtime';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function boot(allowOperations = true) {
  const fake = fakeContainerCli();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-containers-'));
  const app = await createApplication({
    dataDir,
    extensionHotReload: false,
    containers: { allowOperations, cli: fake.cli },
  });
  cleanups.push(async () => {
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const containers = app.runtime.use(containerRuntimeService);
  const request = (url: string, init?: RequestInit) =>
    app.app.request(`http://127.0.0.1/api/containers${url}`, init);
  const tool = async (name: string, args: unknown, chatKey = 'group:1') => {
    const run = app.runtime.submit({
      mode: 'command.direct',
      partitionKey: chatKey,
      input: { chatKey, tool: name, args },
    });
    return (await app.runtime.wait(run.id)).result as Record<string, unknown>;
  };
  return { app, fake, containers, request, tool, dataDir };
}
async function until(get: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (get()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('等待容器任务超时');
}

test('默认关闭、宿主开关不能由设置绕过；页面 API 不触碰真实 CLI', async () => {
  const f = await boot(false);
  f.containers.configure({ enabled: true });
  expect((await f.request('/status')).status).toBe(200);
  expect(f.fake.calls).toEqual([]);
  expect((await f.request('/bindings', { method: 'POST', body: '{"chatKey":"group:1"}' })).status).toBe(409);
  expect(
    f.app.runtime
      .use(toolService)
      .list('group:1')
      .some((t) => t.function.name.startsWith('container_')),
  ).toBe(false);
  expect(
    (await f.request('/settings', { method: 'PATCH', body: '{"binaryPath":"relative.exe"}' })).status,
  ).toBe(409);
  expect((await f.request('/settings', { method: 'PATCH', body: '{"memoryMb":1}' })).status).toBe(400);
});

test.each(['podman', 'docker'] as const)(
  '%s：创建、绑定、Agent 工具与文件操作都通过 argv，输出与非零退出可观察',
  async (engine) => {
    const f = await boot();
    f.containers.configure({ enabled: true, engine });
    expect(
      f.app.runtime
        .use(toolService)
        .list('group:1')
        .some((t) => t.function.name === 'container_bash'),
    ).toBe(false);
    expect((await f.request('/bindings', { method: 'POST', body: '{"chatKey":"group:1"}' })).status).toBe(
      201,
    );
    const create = f.fake.calls.find((c) => c.args[1] === 'create')!;
    expect(create.binary).toBe(engine);
    expect(create.args).toContain('--pull=never');
    expect(create.args).toContain('--cap-drop');
    expect(create.args).not.toContain('--privileged');
    expect(create.args).not.toContain('--volume');
    const text = '中文\n$(touch /host) `echo unsafe`';
    expect(await f.tool('container_write', { path: 'nested/test.txt', content: text })).toMatchObject({
      exitCode: 0,
    });
    expect(await f.tool('container_read', { path: 'nested/test.txt' })).toMatchObject({ stdout: text });
    const write = f.fake.calls.find((c) => c.stdin === text)!;
    expect(write.args).not.toContain(text);
    expect(write.args.at(-1)).toBe('/tmp/qq-harness-workspace/nested/test.txt');
    expect(await f.tool('container_bash', { command: 'fail' })).toMatchObject({ exitCode: 7, isError: true });
    expect(await f.tool('container_bash', { command: 'echo ok' }, 'group:2')).toMatchObject({
      isError: true,
    });
    const status = await (await f.request('/status')).json();
    expect(status.containers).toHaveLength(1);
    const record = [...f.fake.containers.values()][0]!;
    record.Config.Labels['io.qq-harness.owner'] = 'foreign';
    expect(await f.tool('container_bash', { command: 'echo denied' })).toMatchObject({ isError: true });
    await expect(f.containers.remove('group:1')).rejects.toThrow('不属于');
    expect(f.fake.calls.some((c) => c.args[1] === 'rm')).toBe(false);
  },
);

test('后台任务输出、跨会话隔离、取消与超时会结束远端计算，卸载撤销能力', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  await f.containers.create('group:1');
  const jobs = f.app.runtime.use(containerJobsService);
  const job = jobs.start('group:1', {
    command: 'wait',
    workdir: '/tmp/qq-harness-workspace',
    timeoutMs: 10000,
  });
  await until(() => f.fake.remote.size === 1);
  expect(jobs.get('group:1', job.id).stdout).toBe('started\n');
  expect(() => jobs.get('group:2', job.id)).toThrow('不属于');
  expect((await jobs.cancel('group:1', job.id)).status).toBe('cancelled');
  expect(f.fake.remote.size).toBe(0);
  const controller = new AbortController();
  const execution = f.containers.execute(
    'group:1',
    { command: 'wait', workdir: '/tmp/qq-harness-workspace' },
    controller.signal,
  );
  await until(() => f.fake.remote.size === 1);
  controller.abort(new Error('test cancel'));
  await expect(execution).rejects.toThrow('test cancel');
  expect(f.fake.remote.size).toBe(0);
  const timeout = f.containers.execute('group:1', {
    command: 'wait',
    workdir: '/tmp/qq-harness-workspace',
    timeoutMs: 1000,
  });
  await expect(timeout).rejects.toThrow();
  expect(f.fake.remote.size).toBe(0);
  await f.app.runtime.setEnabled('container-runtime', false);
  expect(
    f.app.runtime
      .use(toolService)
      .list('group:1')
      .some((t) => t.function.name.startsWith('container_')),
  ).toBe(false);
  expect((await f.request('/status')).status).toBe(404);
  await f.app.runtime.setEnabled('container-runtime', true);
  expect(f.app.runtime.use(containerRuntimeService).has('group:1')).toBe(true);
  expect((await f.request('/status')).status).toBe(200);
  const done = f.app.runtime
    .use(containerJobsService)
    .start('group:1', { command: 'echo ok', workdir: '/tmp/qq-harness-workspace' });
  await until(() => f.app.runtime.use(containerJobsService).get('group:1', done.id).status !== 'running');
  expect(f.app.runtime.use(containerJobsService).get('group:1', done.id)).toMatchObject({
    status: 'completed',
    stdout: 'fixture-output\n',
  });
  expect((await f.request(`/sessions/group:1/jobs/${done.id}`)).status).toBe(200);
  expect((await f.request(`/sessions/group:1/jobs/${done.id}/cancel`, { method: 'POST' })).status).toBe(200);
  expect((await f.request('/sessions/group:1/jobs')).status).toBe(200);
  expect((await f.request('/sessions/group:1/stop', { method: 'POST' })).status).toBe(200);
  expect((await f.request('/sessions/group:1/start', { method: 'POST' })).status).toBe(200);
  expect(
    (await f.request('/sessions/group:1/exec', { method: 'POST', body: '{"command":"echo ok"}' })).status,
  ).toBe(200);
  expect((await f.request('/sessions/group:1', { method: 'DELETE' })).status).toBe(200);
});

test('Agent 实际工具循环能写文件、读文件与执行命令，关闭会话插件后不可见', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  await f.containers.create('group:1');
  await f.app.runtime.setEnabled('model-mock', false);
  let count = 0;
  f.app.runtime.install({
    id: 'container-model-test',
    setup(ctx) {
      ctx.provide(modelService, {
        complete: async () => ({
          usage: { input: 1, output: 1 },
          message: {
            role: 'assistant',
            content: null,
            tool_calls: (count++ === 0
              ? [
                  ['container_write', { path: 'result.txt', content: '42' }],
                  ['container_read', { path: 'result.txt' }],
                  ['container_bash', { command: 'echo ok' }],
                ]
              : [['finish', { mode: 'silent', reason: '容器测试完成' }]]
            ).map(([name, args], i) => ({
              id: `${count}-${i}`,
              type: 'function',
              function: { name: String(name), arguments: JSON.stringify(args) },
            })),
          },
        }),
      });
    },
  });
  await f.app.runtime.start();
  await f.app.runtime.use(conversationService).ingest({
    id: 'container-test',
    chatKey: 'group:1',
    senderId: '2',
    senderName: 'test',
    text: '测试容器',
    atMe: true,
    timestamp: Date.now(),
  });
  await until(() => f.app.runtime.use(storageService).archives().length > 0);
  const archive = f.app.runtime.use(storageService).archives()[0]!;
  expect(archive.status).toBe('silent');
  expect(archive.trace.filter((t) => t.type === 'tool')).toHaveLength(4);
  expect([...f.fake.files.values()]).toContain('42');
  expect(f.app.runtime.use(adapterService).sent).toEqual([]);
  f.app.runtime.use(configService).saveProfile('group:1', { plugins: { 'container-session': false } });
  expect(
    f.app.runtime
      .use(toolService)
      .list('group:1')
      .some((t) => t.function.name.startsWith('container_')),
  ).toBe(false);
});

test('真实子进程包装限制输出且能取消自己启动的 CLI', async () => {
  const result = await runContainerCli(process.execPath, ['-e', 'process.stdout.write("中".repeat(10000))'], {
    signal: AbortSignal.timeout(3000),
    maxOutputChars: 1000,
  });
  expect(result.stdout).toHaveLength(1000);
  expect(result.truncated).toBe(true);
  const controller = new AbortController();
  const running = runContainerCli(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    signal: controller.signal,
    maxOutputChars: 1000,
  });
  controller.abort(new Error('cancel fixture'));
  await expect(running).rejects.toThrow('cancel fixture');
});

test('创建失败不残留绑定，显式停止清理排队任务，停用运行时结束活跃任务', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  f.fake.flags.failCreate = true;
  await expect(f.containers.create('group:1')).rejects.toThrow('image missing');
  expect(f.containers.bindings()).toEqual([]);
  f.fake.flags.failCreate = false;
  await f.containers.create('group:1');
  const jobs = f.app.runtime.use(containerJobsService);
  const first = jobs.start('group:1', { command: 'wait', workdir: '/tmp/qq-harness-workspace' });
  await until(() => f.fake.remote.size === 1);
  const second = jobs.start('group:1', { command: 'wait', workdir: '/tmp/qq-harness-workspace' });
  await f.containers.stop('group:1');
  await until(
    () =>
      jobs.get('group:1', first.id).status !== 'running' &&
      jobs.get('group:1', second.id).status !== 'running',
  );
  expect(f.fake.remote.size).toBe(0);
  jobs.start('group:1', { command: 'wait', workdir: '/tmp/qq-harness-workspace' });
  await until(() => f.fake.remote.size === 1);
  await f.app.runtime.setEnabled('container-runtime', false);
  expect(f.fake.remote.size).toBe(0);
  expect([...f.fake.containers.values()][0]!.State.Running).toBe(false);
});
