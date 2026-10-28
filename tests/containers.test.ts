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
import { DatabaseSync } from 'node:sqlite';
import { upgradeContainerPool } from '../tools/upgrade-container-pool.js';

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

test('局部容器配置保留其他字段，缺失镜像有独立状态且不创建绑定', async () => {
  const f = await boot();
  f.containers.configure({
    enabled: true,
    engine: 'podman',
    image: 'fixture:test',
    memoryMb: 1024,
  });
  f.containers.configure({ timeoutMs: 60000 });
  expect(f.containers.settings()).toMatchObject({
    enabled: true,
    engine: 'podman',
    image: 'fixture:test',
    memoryMb: 1024,
    timeoutMs: 60000,
  });
  f.fake.flags.missingImage = true;
  expect(await f.containers.status()).toMatchObject({
    available: true,
    imageAvailable: false,
  });
  await expect(f.containers.create('group:1')).rejects.toThrow('镜像不存在');
  expect(f.containers.bindings()).toEqual([]);
});

test('默认关闭、宿主开关不能由设置绕过；页面 API 不触碰真实 CLI', async () => {
  const f = await boot(false);
  f.containers.configure({ enabled: true });
  expect((await f.request('/status')).status).toBe(200);
  expect(f.fake.calls).toEqual([]);
  expect(
    (
      await f.request('/inventory', {
        method: 'POST',
        body: '{"chatKey":"group:1"}',
      })
    ).status,
  ).toBe(409);
  expect(
    f.app.runtime
      .use(toolService)
      .list('group:1')
      .some((t) => t.function.name.startsWith('container_')),
  ).toBe(false);
  expect(
    (
      await f.request('/settings', {
        method: 'PATCH',
        body: '{"binaryPath":"relative.exe"}',
      })
    ).status,
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
    expect(
      (
        await f.request('/inventory', {
          method: 'POST',
          body: '{"chatKey":"group:1"}',
        })
      ).status,
    ).toBe(201);
    const create = f.fake.calls.find((c) => c.args[1] === 'create')!;
    expect(create.binary).toBe(engine);
    expect(create.args).toContain('--pull=never');
    expect(create.args).toContain('--cap-drop');
    expect(create.args).not.toContain('--privileged');
    expect(create.args).not.toContain('--volume');
    const text = '中文\n$(touch /host) `echo unsafe`';
    expect(
      await f.tool('container_write', {
        path: 'nested/test.txt',
        content: text,
      }),
    ).toMatchObject({
      exitCode: 0,
    });
    expect(await f.tool('container_read', { path: 'nested/test.txt' })).toMatchObject({
      stdout: text,
    });
    const write = f.fake.calls.find((c) => c.stdin && JSON.parse(c.stdin).stdin === text)!;
    expect(write.args).not.toContain(text);
    expect(JSON.parse(write.stdin!).argv.at(-1)).toBe('/home/g1/workspace/nested/test.txt');
    expect(await f.tool('container_bash', { command: 'fail' })).toMatchObject({
      exitCode: 7,
      isError: true,
    });
    expect(await f.tool('container_bash', { command: 'echo ok' }, 'group:2')).toMatchObject({
      isError: true,
    });
    const status = await (await f.request('/status')).json();
    expect(status.containers).toHaveLength(1);
    const record = [...f.fake.containers.values()][0]!;
    record.Config.Labels['io.qq-harness.owner'] = 'foreign';
    expect(await f.tool('container_bash', { command: 'echo denied' })).toMatchObject({
      isError: true,
    });
    await f.containers.remove('group:1');
    await expect(f.containers.removeExisting(record.Id)).rejects.toThrow('归属');
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
  const done = f.app.runtime.use(containerJobsService).start('group:1', {
    command: 'echo ok',
    workdir: '/tmp/qq-harness-workspace',
  });
  await until(() => f.app.runtime.use(containerJobsService).get('group:1', done.id).status !== 'running');
  expect(f.app.runtime.use(containerJobsService).get('group:1', done.id)).toMatchObject({
    status: 'completed',
    stdout: 'fixture-output\n',
  });
  expect((await f.request(`/sessions/group:1/jobs/${done.id}`)).status).toBe(200);
  expect(
    (
      await f.request(`/sessions/group:1/jobs/${done.id}/cancel`, {
        method: 'POST',
      })
    ).status,
  ).toBe(200);
  expect((await f.request('/sessions/group:1/jobs')).status).toBe(200);
  expect((await f.request('/sessions/group:1/stop', { method: 'POST' })).status).toBe(200);
  expect((await f.request('/sessions/group:1/start', { method: 'POST' })).status).toBe(200);
  expect(
    (
      await f.request('/sessions/group:1/exec', {
        method: 'POST',
        body: '{"command":"echo ok"}',
      })
    ).status,
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
              : [['finish', { mode: 'silent', silentReason: '容器测试完成' }]]
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
  const first = jobs.start('group:1', {
    command: 'wait',
    workdir: '/tmp/qq-harness-workspace',
  });
  await until(() => f.fake.remote.size === 1);
  const second = jobs.start('group:1', {
    command: 'wait',
    workdir: '/tmp/qq-harness-workspace',
  });
  await f.containers.stop('group:1');
  await until(
    () =>
      jobs.get('group:1', first.id).status !== 'running' &&
      jobs.get('group:1', second.id).status !== 'running',
  );
  expect(f.fake.remote.size).toBe(0);
  jobs.start('group:1', {
    command: 'wait',
    workdir: '/tmp/qq-harness-workspace',
  });
  await until(() => f.fake.remote.size === 1);
  await f.app.runtime.setEnabled('container-runtime', false);
  expect(f.fake.remote.size).toBe(0);
  expect([...f.fake.containers.values()][0]!.State.Running).toBe(true);
});

test('资源池支持多对多和默认容器，解绑保留用户文件，删除必须先解绑全部会话', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true, image: 'fixture:test' });
  const before = f.fake.calls.length;
  await expect(f.containers.bind('group:2', 'missing')).rejects.toThrow('未登记');
  expect(f.fake.calls.length).toBe(before);
  const first = await f.containers.create('group:1');
  await f.containers.bind('group:2', first.id);
  await expect(f.containers.removeExisting(first.id)).rejects.toThrow('所有会话绑定');
  await f.containers.unbind('group:1');
  expect(f.containers.has('group:1')).toBe(false);
  expect((await f.containers.list()).find((c) => c.id === first.id)?.chatKeys).toEqual(['group:2']);
  await f.containers.bind('group:2', first.id);
  expect(f.containers.has('group:2')).toBe(true);
  expect(await f.containers.inspect('group:2')).toMatchObject({
    id: first.id,
    chatKeys: ['group:2'],
  });
  expect(f.fake.calls.filter((c) => c.args?.includes('create'))).toHaveLength(1);
  expect(
    (
      await f.request('/bindings', {
        method: 'POST',
        body: JSON.stringify({ chatKey: 'group:3' }),
      })
    ).status,
  ).toBe(400);
  await f.containers.unbind('group:2');
  await f.containers.removeExisting(first.id);
  expect(await f.containers.list()).toEqual([]);
});

test('同一容器中的用户与后台任务隔离，取消一个会话不停止另一个会话', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  const resource = await f.containers.createResource({ name: 'shared-pool' });
  expect(f.containers.bindings()).toEqual([]);
  await f.containers.assignResource(resource.id, ['group:1', 'private:2']);
  expect((await f.containers.list())[0]?.chatKeys).toEqual(['group:1', 'private:2']);
  await f.tool('container_write', { path: 'secret.txt', content: 'private-data' });
  expect(
    await f.tool('container_read', { path: '/home/g1/workspace/secret.txt' }, 'private:2'),
  ).toMatchObject({ isError: true });
  expect([...f.fake.users.values()].map((u) => u.username)).toEqual(['g1', 'p2']);
  const jobs = f.app.runtime.use(containerJobsService);
  const a = jobs.start('group:1', { command: 'wait', workdir: '.' }),
    b = jobs.start('private:2', { command: 'wait', workdir: '.' });
  await until(() => f.fake.remote.size === 2);
  await expect(f.containers.unbind('group:1', resource.id)).rejects.toThrow('运行或排队');
  expect((await jobs.cancel('group:1', a.id)).status).toBe('cancelled');
  expect(f.fake.remote.size).toBe(1);
  expect(jobs.get('private:2', b.id).status).toBe('running');
  expect((await f.containers.inspect('private:2')).running).toBe(true);
  expect((await f.containers.inspect('private:2')).chatKeys).toEqual(['private:2']);
  await jobs.cancel('private:2', b.id);
  expect(f.fake.calls.some((c) => c.args[1] === 'stop')).toBe(false);
});

test('默认与显式选择、排队任务固定资源、管理员停用不可被工具绕过', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  const a = await f.containers.createResource(),
    b = await f.containers.createResource();
  await f.containers.setBindings('group:1', [a.id, b.id], a.id);
  expect(await f.tool('container_list', {})).toHaveLength(2);
  expect(
    await f.tool('container_write', { path: 'a.txt', content: 'in-b', containerId: b.id }),
  ).toMatchObject({ exitCode: 0 });
  expect([...f.fake.files]).toContainEqual([b.id + '//home/g1/workspace/a.txt', 'in-b']);
  expect(await f.tool('container_read', { path: 'a.txt', containerId: 'foreign' })).toMatchObject({
    isError: true,
  });
  const jobs = f.app.runtime.use(containerJobsService);
  const first = jobs.start('group:1', { command: 'wait', workdir: '.' });
  await until(() => f.fake.remote.size === 1);
  const second = jobs.start('group:1', { command: 'echo queued', workdir: '.' });
  await f.containers.setBindings('group:1', [a.id, b.id], b.id);
  await jobs.cancel('group:1', first.id);
  await until(() => jobs.get('group:1', second.id).status !== 'running');
  expect(jobs.get('group:1', second.id)).toMatchObject({ containerId: a.id, status: 'completed' });
  await f.containers.stopResource(b.id);
  expect(await f.tool('container_start', {})).toMatchObject({ isError: true });
  expect(await f.tool('container_bash', { command: 'echo denied' })).toMatchObject({ isError: true });
  await f.containers.startResource(b.id);
  expect(await f.tool('container_bash', { command: 'echo enabled' })).toMatchObject({ exitCode: 0 });
  await expect(f.containers.setBindings('group:1', [a.id], b.id)).rejects.toThrow('默认容器');
});

test.each(['podman', 'docker'] as const)('%s：发现外部容器、只登记引用，不自动接管或删除', async (engine) => {
  const f = await boot();
  f.containers.configure({ enabled: true, engine });
  const id = 'b'.repeat(64);
  f.fake.containers.set(id, {
    Id: id,
    Name: 'QQ-agent-script-runtime',
    Config: { Labels: {}, Image: 'external:test' },
    State: { Running: true, Status: 'running' },
  });
  const discovered = await (await f.request('/discovery')).json();
  expect(discovered).toMatchObject([{ id, registered: false }]);
  const registered = await f.request('/inventory/import', {
    method: 'POST',
    body: JSON.stringify({ reference: 'QQ-agent-script-runtime' }),
  });
  expect(registered.status).toBe(201);
  expect(await registered.json()).toMatchObject({ id, managed: false, chatKeys: [] });
  expect(f.fake.calls.some((c) => ['exec', 'create', 'start', 'stop', 'rm'].includes(c.args[1]!))).toBe(
    false,
  );
  expect(
    (
      await f.request('/bindings/group%3A1', {
        method: 'PUT',
        body: JSON.stringify({ containerIds: [id], primaryContainerId: id }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request('/inventory/' + id + '/chats', {
        method: 'PUT',
        body: JSON.stringify({ chatKeys: ['group:1', 'private:2'] }),
      })
    ).status,
  ).toBe(200);
  expect((await f.request('/inventory/' + id, { method: 'DELETE' })).status).toBe(409);
  await f.containers.assignResource(id, []);
  await f.containers.removeExisting(id);
  expect(f.fake.containers.get(id)?.State.Running).toBe(true);
  expect(f.fake.calls.some((c) => ['exec', 'stop', 'rm'].includes(c.args[1]!))).toBe(false);
  expect((await f.request('/bindings/default', { method: 'PUT', body: '{"containerIds":[]}' })).status).toBe(
    400,
  );
});

test('旧绑定幂等转换到资源池，原始键保留且旧工作目录只归原会话', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  const created = await f.containers.create('group:1');
  await f.app.runtime.setEnabled('container-runtime', false);
  const storage = f.app.runtime.use(storageService),
    old = {
      id: created.id,
      name: created.name,
      engine: created.engine,
      binary: created.binary,
      image: created.image,
      chatKey: 'group:1',
    };
  f.fake.containers.get(created.id)!.Config.Labels['io.qq-harness.chat'] = 'group:1';
  storage.setState('container-runtime', 'pool-v2', null);
  storage.setState('container-runtime', 'bindings', [old]);
  storage.setState('container-runtime', 'unbound', []);
  await f.app.runtime.setEnabled('container-runtime', true);
  let runtime = f.app.runtime.use(containerRuntimeService);
  expect(runtime.bindings()).toMatchObject([
    { chatKey: 'group:1', username: 'g1', legacyWorkspace: true, ownerChatKey: 'group:1' },
  ]);
  await runtime.bind('private:2', created.id);
  expect(storage.state('container-runtime', 'bindings')).toEqual([old]);
  expect(runtime.bindings().find((b) => b.chatKey === 'private:2')?.legacyWorkspace).toBeUndefined();
  await f.app.runtime.setEnabled('container-runtime', false);
  await f.app.runtime.setEnabled('container-runtime', true);
  runtime = f.app.runtime.use(containerRuntimeService);
  expect(runtime.bindings()).toHaveLength(2);
  expect((await runtime.list())[0]?.bindings).toHaveLength(2);
});

test.each(['sqlite', 'files'] as const)(
  '%s：迁移先预览再备份，幂等应用和回滚只修改资源池键',
  async (backend) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-migration-'));
    cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
    const old = [
      {
        id: 'a'.repeat(64),
        name: 'old',
        chatKey: 'group:1',
        engine: 'podman',
        binary: 'podman',
        image: 'fixture:test',
      },
    ];
    const stateFolder = path.join(dir, 'plugin-state/container-runtime');
    if (backend === 'sqlite') {
      const db = new DatabaseSync(path.join(dir, 'harness.sqlite'));
      db.exec('CREATE TABLE plugin_state(namespace TEXT,key TEXT,payload TEXT,PRIMARY KEY(namespace,key))');
      for (const [key, value] of Object.entries({
        bindings: old,
        unbound: [],
        owner: 'fixed-owner',
        settings: { timeoutMs: 5000 },
      }))
        db.prepare('INSERT INTO plugin_state VALUES(?,?,?)').run(
          'container-runtime',
          key,
          JSON.stringify(value),
        );
      db.close();
    } else {
      fs.mkdirSync(stateFolder, { recursive: true });
      for (const [key, value] of Object.entries({
        bindings: old,
        unbound: [],
        owner: 'fixed-owner',
        settings: { timeoutMs: 5000 },
      }))
        fs.writeFileSync(path.join(stateFolder, key + '.json'), JSON.stringify(value));
    }
    expect(upgradeContainerPool(dir)).toMatchObject({
      changed: true,
      applied: false,
      resources: 1,
      bindings: 1,
      accounts: [{ username: 'g1', copyLegacyWorkspace: true }],
    });
    const applied = upgradeContainerPool(dir, true) as { backup: string };
    expect(applied.backup).toBeTruthy();
    expect(upgradeContainerPool(dir, true)).toMatchObject({ changed: false, applied: false });
    expect(upgradeContainerPool(dir, false, applied.backup)).toMatchObject({ restored: false });
    expect(upgradeContainerPool(dir, true, applied.backup)).toMatchObject({ restored: true });
    expect(upgradeContainerPool(dir)).toMatchObject({ changed: true, resources: 1, bindings: 1 });
    if (backend === 'sqlite') {
      const db = new DatabaseSync(path.join(dir, 'harness.sqlite'), { readOnly: true });
      expect(
        JSON.parse(
          String(db.prepare("SELECT payload FROM plugin_state WHERE key='bindings'").get()!.payload),
        ),
      ).toEqual(old);
      db.close();
    } else expect(JSON.parse(fs.readFileSync(path.join(stateFolder, 'bindings.json'), 'utf8'))).toEqual(old);
  },
);

test('并发增加绑定不覆盖；取消清理失败的资源跨重启隔离，确认清理后才可启用', async () => {
  const f = await boot();
  f.containers.configure({ enabled: true });
  const a = await f.containers.createResource(),
    b = await f.containers.createResource();
  await Promise.all([f.containers.bind('group:1', a.id), f.containers.bind('group:1', b.id)]);
  expect(f.containers.bindings()).toHaveLength(2);
  const controller = new AbortController(),
    running = f.containers.execute('group:1', { command: 'wait', workdir: '.' }, controller.signal);
  await until(() => f.fake.remote.size === 1);
  f.fake.flags.failCleanup = true;
  controller.abort(Error('cancel-test'));
  await expect(running).rejects.toThrow('cancel-test');
  expect((await f.containers.list()).find((r) => r.id === a.id)).toMatchObject({
    enabled: false,
    cleanupPending: [{ username: 'g1' }],
  });
  await f.app.runtime.setEnabled('container-runtime', false);
  await f.app.runtime.setEnabled('container-runtime', true);
  const runtime = f.app.runtime.use(containerRuntimeService);
  await expect(runtime.startResource(a.id)).rejects.toThrow('cleanup unavailable');
  await expect(runtime.command('group:1', ['id'])).rejects.toThrow('停用');
  f.fake.flags.failCleanup = false;
  await runtime.startResource(a.id);
  expect(f.fake.remote.size).toBe(0);
  expect((await runtime.command('group:1', ['id'])).exitCode).toBe(0);
  expect((await runtime.list()).find((r) => r.id === a.id)?.cleanupPending).toBeUndefined();
});
