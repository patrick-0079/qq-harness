import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { ServiceManager, sanitize, tailFile } from '../scripts/service-manager.mjs';
import { loadLaunch, liveEnvironment,releaseDirectory } from '../scripts/live-config.mjs';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-manage-'));
  cleanups.push(() => {
    const real = fs.realpathSync(root);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-manage-')
    )
      throw new Error('清理越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'var/production'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'var/production/launch.json'),
    JSON.stringify({
      port: 3310,
      concurrency: 2,
      token: 'fixture-console-token-'.repeat(3),
      allowedChats: ['group:123'],
    }),
  );
  fs.writeFileSync(
    path.join(root, 'var/production/config.json'),
    JSON.stringify({
      model: { apiKey: 'fixture-model-key' },
      onebot: { accessToken: 'fixture-ws-key', httpAccessToken: 'fixture-http-key' },
    }),
  );
  const app = {
    name: 'qq-harness',
    cwd: root,
    script: path.join(root, 'scripts/start-live.mjs'),
    env: { HARNESS_PM2: '1' },
    wait_ready: true,
    shutdown_with_message: true,
  };
  fs.writeFileSync(
    path.join(root, 'ecosystem.config.cjs'),
    `module.exports = ${JSON.stringify({ apps: [app] })};`,
  );
  const entries: any[] = [];
  const record = (config: typeof app, status: string) => ({
    name: config.name,
    pm_id: 7,
    pid: status === 'online' ? 1234 : 0,
    pm2_env: {
      status,
      pm_exec_path: config.script,
      pm_cwd: config.cwd,
      pm_uptime: Date.now(),
      restart_time: 0,
      autostart: (config as typeof app & { autostart?: boolean }).autostart ?? true,
    },
    monit: { memory: 1024 },
  });
  const pm2 = {
    connect: vi.fn((cb) => cb(null)),
    disconnect: vi.fn(),
    list: vi.fn((cb) => cb(null, entries)),
    start: vi.fn((config, cb) => {
      entries.push(record(config, config.autostart === false ? 'stopped' : 'online'));
      cb(null);
    }),
    restart: vi.fn((config, _options, cb) => {
      const index = entries.findIndex((entry) => entry.name === 'qq-harness');
      entries[index] = record(config.apps[0], 'online');
      cb(null);
    }),
    stop: vi.fn((id, cb) => {
      const entry = entries.find((entry) => entry.pm_id === id);
      entry.pm2_env.status = 'stopped';
      entry.pid = 0;
      cb(null);
    }),
    delete: vi.fn((id, cb) => {
      const index = entries.findIndex((entry) => entry.pm_id === id);
      entries.splice(index, 1);
      cb(null);
    }),
    dump: vi.fn((_force, cb) => cb(null)),
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/health')) return Response.json({ ok: true });
    if (url.endsWith('/api/status'))
      return Response.json({
        demo: false,
        adapter: { kind: 'onebot', connected: true },
        plugins: [],
        runs: [],
      });
    return Response.json({ phase: 'running', pid: 999, owned: false, message: 'should-not-be-returned' });
  });
  const portOpen = vi.fn(async () => false);
  const manager = new ServiceManager(root, pm2, { fetch, portOpen, waitMs: 25 });
  return { root, app, entries, pm2, manager, fetch, portOpen, record };
}
test('PM2 注册与保存幂等，默认不启动后端，不把密钥装入 PM2 配置', async () => {
  const f = fixture();
  await f.manager.setup();
  await f.manager.setup();
  await f.manager.save();
  expect(f.pm2.start).toHaveBeenCalledTimes(1);
  expect(f.pm2.start.mock.calls[0]?.[0]).toMatchObject({ autostart: false });
  expect(f.pm2.dump).toHaveBeenCalledWith(true, expect.any(Function));
  expect(await f.manager.status()).toMatchObject({ status: 'stopped', pid: null, ready: false });
  expect((await f.manager.status()).startHint).toContain('autostart=false');
  expect(f.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(f.pm2.start.mock.calls)).not.toContain('fixture-console-token');
});
test('Windows 组件启动超过4秒仍等待实际结果，不把成功启动误报为失败', async () => {
  const f = fixture(); f.entries.push(f.record(f.app, 'online'));
  f.fetch.mockImplementationOnce(async (_input, init) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(Response.json({ status: { phase: 'running', owned: true, pid: 42 } })); }, 4200);
    signal.addEventListener('abort', abort, { once: true });
  }));
  expect(await f.manager.component('qq','start')).toMatchObject({ phase: 'running', pid: 42 });
});
test('启动和重启读取新配置并等待 HTTP 就绪，重复 start 不重复启动', async () => {
  const f = fixture();
  await f.manager.setup();
  const status = await f.manager.start();
  expect(status).toMatchObject({
    status: 'online',
    ready: true,
    adapter: { connected: true },
    'qq-portable': { phase: 'running', owned: false },
  });
  expect(status.startHint).toBeUndefined();
  expect(JSON.stringify(status)).not.toContain('should-not-be-returned');
  expect(f.pm2.restart).toHaveBeenCalledWith(
    { apps: [expect.objectContaining({ autostart: true, shutdown_with_message: true })] },
    { updateEnv: true },
    expect.any(Function),
  );
  expect(f.fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
    authorization: `Bearer ${loadLaunch(f.root).token}`,
  });
  await f.manager.start();
  expect(f.pm2.restart).toHaveBeenCalledTimes(1);
  await f.manager.start(true);
  expect(f.pm2.restart).toHaveBeenCalledTimes(2);
});
test('同名外部实例或重复条目不能被停止、重启或删除', async () => {
  const f = fixture();
  f.entries.push(f.record({ ...f.app, cwd: path.join(f.root, 'other') }, 'online'));
  await expect(f.manager.stop()).rejects.toThrow('不属于');
  await expect(f.manager.remove()).rejects.toThrow('不属于');
  await expect(f.manager.start(true)).rejects.toThrow('不属于');
  expect(f.pm2.stop).not.toHaveBeenCalled();
  expect(f.pm2.delete).not.toHaveBeenCalled();
  f.entries.splice(0);
  f.entries.push(f.record(f.app, 'online'), f.record(f.app, 'online'));
  await expect(f.manager.stop()).rejects.toThrow('重名');
});
test('启动前拒绝旧 PM2 消费者或外部端口冲突；停止不依赖 launch.json', async () => {
  const f = fixture();
  f.entries.push({ name: 'qq-agent', pm2_env: { status: 'online' } });
  await expect(f.manager.start()).rejects.toThrow('上线交接');
  f.entries.splice(0);
  f.portOpen.mockResolvedValueOnce(true);
  await expect(f.manager.start()).rejects.toThrow('端口');
  expect(f.pm2.start).not.toHaveBeenCalled();
  f.entries.push(f.record(f.app, 'online'));
  fs.unlinkSync(path.join(f.root, 'var/production/launch.json'));
  await f.manager.stop();
  await f.manager.stop();
  expect(f.pm2.stop).toHaveBeenCalledExactlyOnceWith(7, expect.any(Function));
  await f.manager.remove();
  expect(f.pm2.delete).toHaveBeenCalledExactlyOnceWith(7, expect.any(Function));
});
test('组件操作经认证 API，错误正文与私密状态不会泄漏，接口故障可查询', async () => {
  const f = fixture();
  f.entries.push(f.record(f.app, 'online'));
  expect(await f.manager.component('qq', 'start')).toMatchObject({
    component: 'qq',
    action: 'start',
    phase: 'running',
  });
  expect(f.fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3310/api/qq-portable/launch');
  expect(f.fetch.mock.calls[0]?.[1]?.method).toBe('POST');
  f.fetch.mockImplementation(async () => new Response('fixture-model-key private details', { status: 500 }));
  await expect(f.manager.component('snowluma', 'start')).rejects.toThrow('HTTP 500');
  const status = await f.manager.status();
  expect(status).toMatchObject({ ready: false, apiError: expect.any(String) });
  expect(JSON.stringify(status)).not.toContain('fixture-model-key');
});
test('日志尾部有界读取并隐藏控制台/模型/双 OneBot 令牌', () => {
  const f = fixture();
  const file = path.join(f.root, 'events.log');
  fs.writeFileSync(file, 'first\nsecond\nthird\n');
  expect(tailFile(file, 2)).toBe('second\nthird');
  const text = [
    loadLaunch(f.root).token,
    'fixture-model-key',
    'fixture-ws-key',
    'fixture-http-key',
    'Bearer another-secret',
  ].join('\n');
  expect(sanitize(text, f.root)).not.toMatch(/fixture-|another-secret/);
  expect(
    liveEnvironment(f.root, { HARNESS_DATA_DIR: 'incorrect', HARNESS_ALLOWED_CHATS: 'group:999' }),
  ).toMatchObject({
    HARNESS_DATA_DIR: path.join(f.root, 'var/production'),
    HARNESS_ALLOWED_CHATS: 'group:123',
  });
});

test('关闭控制台令牌后可启动且不发送认证头，覆盖 PM2 继承的旧令牌', async () => {
  const f = fixture();
  const file = path.join(f.root, 'var/production/launch.json');
  const launch = JSON.parse(fs.readFileSync(file, 'utf8'));
  launch.token = '';
  fs.writeFileSync(file, JSON.stringify(launch));
  expect(liveEnvironment(f.root, { HARNESS_TOKEN: 'stale-pm2-secret' }).HARNESS_TOKEN).toBe('');
  expect(await f.manager.start()).toMatchObject({ ready: true });
  expect(f.fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
  delete launch.token;
  fs.writeFileSync(file, JSON.stringify(launch));
  expect(loadLaunch(f.root).token).toBe('');
  launch.token = 'short';
  fs.writeFileSync(file, JSON.stringify(launch));
  expect(() => loadLaunch(f.root)).toThrow('令牌');
});

test('整套启动按后端、SnowLuma、QQ 顺序，已有外部运行时不重复启动', async () => {
  const f = fixture();
  const base = f.fetch.getMockImplementation()!;
  let started = false;
  f.fetch.mockImplementation(async (input, init) => {
    if (String(input).endsWith('/api/snowluma/status'))
      return Response.json({ phase: started ? 'running' : 'stopped', webuiReady: started });
    if (String(input).endsWith('/api/snowluma/launch')) {
      started = true;
      return Response.json({ status: { phase: 'starting', owned: true } });
    }
    if (String(input).endsWith('/api/qq-portable/status'))
      return Response.json({ phase: 'external', owned: false, pid: 88 });
    return base(input, init);
  });
  expect(await f.manager.startAll()).toMatchObject({ status: 'online', ready: true });
  expect(f.fetch.mock.calls.filter(([input]) => String(input).endsWith('/api/snowluma/launch'))).toHaveLength(
    1,
  );
  expect(
    f.fetch.mock.calls.filter(([input]) => String(input).endsWith('/api/qq-portable/launch')),
  ).toHaveLength(0);
  await f.manager.startAll();
  expect(f.fetch.mock.calls.filter(([input]) => String(input).endsWith('/api/snowluma/launch'))).toHaveLength(
    1,
  );
});
test('上线入口与后端同 PID，IPC shutdown 正常退出，不创建孤儿后端', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.root, 'dist/server'), { recursive: true });
  fs.writeFileSync(
    path.join(f.root, 'dist/server/main.mjs'),
    `
process.send({type:'fixture-ready',pid:process.pid,allowed:process.env.HARNESS_ALLOWED_CHATS,data:process.env.HARNESS_DATA_DIR,live:process.argv.includes('--live')});
const timer=setInterval(()=>{},1000);
process.on('message', message=>{if(message==='shutdown'){clearInterval(timer);process.disconnect();}});`,
  );
  const runner = path.join(f.root, 'runner.mjs');
  const moduleUrl = pathToFileURL(fileURLToPath(new URL('../scripts/start-live.mjs', import.meta.url))).href;
  fs.writeFileSync(
    runner,
    `import { startLive } from ${JSON.stringify(moduleUrl)};await startLive(${JSON.stringify(f.root)});`,
  );
  const child: ChildProcess = fork(runner, [], {
    cwd: os.tmpdir(),
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  });
  const ready = await new Promise<any>((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('入口提前退出')));
  });
  expect(ready).toMatchObject({
    pid: child.pid,
    allowed: 'group:123',
    data: path.join(f.root, 'var/production'),
    live: true,
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.send('shutdown');
  expect(await exited).toBe(0);
});

test('真实 demo 后端向 PM2 发 ready 字符串并响应 IPC 正常停机', async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const project = fileURLToPath(new URL('../', import.meta.url));
  const child = fork(
    path.join(project, 'apps/server/src/main.ts'),
    ['--demo', '--ephemeral', `--port=${port}`],
    {
      cwd: project,
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        HARNESS_PM2: '1',
        HARNESS_TOKEN: 'fixture-pm2-http-token',
        HARNESS_SNOWLUMA_DIR: '',
      },
    },
  );
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  });
  const message = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('demo 提前退出')));
  });
  expect(message).toBe('ready');
  const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { authorization: 'Bearer fixture-pm2-http-token' },
  });
  expect(await health.json()).toMatchObject({ ok: true });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.send('shutdown');
  expect(await exited).toBe(0);
});

test('生产未配置启动会话边界时清除 PM2 遗留白名单环境', () => {
  const { root } = fixture();
  const file = path.join(root, 'var/production/launch.json');
  const launch = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete launch.allowedChats;
  fs.writeFileSync(file, JSON.stringify(launch));
  expect(loadLaunch(root).allowedChats).toBeUndefined();
  expect(liveEnvironment(root, { HARNESS_ALLOWED_CHATS: 'group:old' }).HARNESS_ALLOWED_CHATS).toBe('');
});
test('正式启动选定独立版本目录，覆盖遗留环境并拒绝工程外版本',()=>{
 const {root}=fixture(),file=path.join(root,'var/production/launch.json'),raw=JSON.parse(fs.readFileSync(file,'utf8'));
 expect(loadLaunch(root).releaseDirectory).toBe(path.join(root,'dist'));
 const release=path.join(root,'var/releases/accepted-build');fs.mkdirSync(release,{recursive:true});fs.writeFileSync(file,JSON.stringify({...raw,releaseDirectory:release}));
 expect(loadLaunch(root).releaseDirectory).toBe(release);expect(liveEnvironment(root,{HARNESS_RELEASE_DIR:'old'}).HARNESS_RELEASE_DIR).toBe(release);
 for(const bad of [root,path.join(root,'var/builds/test'),path.join(root,'var/releases'),path.join(root,'../outside'),'var/releases/relative'])expect(()=>releaseDirectory(root,bad)).toThrow('版本');
});
test('启动明确选择扩展版本并覆盖遗留根，拒绝工程外与相对路径',()=>{
 const {root}=fixture(),file=path.join(root,'var/production/launch.json'),raw=JSON.parse(fs.readFileSync(file,'utf8'));
 expect(liveEnvironment(root,{HARNESS_V2_EXTENSION_ROOT:'old'}).HARNESS_V2_EXTENSION_ROOT).toBe(path.join(root,'extensions-v2'));
 const selected=path.join(root,'var/extension-releases/accepted');fs.mkdirSync(selected,{recursive:true});fs.writeFileSync(file,JSON.stringify({...raw,extensionDirectory:selected}));expect(liveEnvironment(root).HARNESS_V2_EXTENSION_ROOT).toBe(selected);
 fs.writeFileSync(file,JSON.stringify({...raw,extensionDirectory:path.join(root,'outside')}));expect(()=>loadLaunch(root)).toThrow('扩展版本');
});
