import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { snowlumaService } from '@qq-harness/snowluma-runtime';
import { isPortOpen } from '../plugins/snowluma-runtime/src/runtime.js';
import { lockInstallation } from '../plugins/snowluma-runtime/src/process-lock.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function boot(allowLaunch = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-snowluma-'));
  const packageDir = path.join(directory, 'fake-third-party');
  fs.mkdirSync(path.join(packageDir, 'config'), { recursive: true });
  cleanups.push(async () => {
    const real = fs.realpathSync(directory);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-snowluma-')
    )
      throw new Error('清理目录越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  const port = await freePort();
  const content = `import net from 'node:net';if(process.env.SNOWLUMA_ACCEPT_EULA!=='1'||process.env.SNOWLUMA_ACCEPT_PRIVACY!=='1')process.exit(91);process.stdout.write('accessToken=test-fixture-secret\\n');process.stdout.write('token=other-fixture-secret\\n');net.createServer(socket=>socket.end()).listen(${port},'127.0.0.1');`;
  fs.writeFileSync(path.join(packageDir, 'index.mjs'), content, 'utf8');
  fs.writeFileSync(
    path.join(packageDir, 'config/runtime.json'),
    JSON.stringify({ webuiHost: '127.0.0.1', webuiPort: port, hookAutoLoad: true }),
    'utf8',
  );
  const app = await createApplication({
    dataDir: path.join(directory, 'data'),
    extensionHotReload: false,
    snowluma: { allowLaunch, lockRoot: path.join(directory, 'locks') },
    initialConfig: {
      acceptAllSessions: true,
      onebot: {
        wsUrl: `ws://127.0.0.1:${await freePort()}`,
        httpUrl: `http://127.0.0.1:${await freePort()}`,
        accessToken: 'test-fixture-secret',
      },
    },
  });
  cleanups.push(app.stop);
  const runtime = app.runtime.use(snowlumaService);
  const request = (route: string, init?: RequestInit) =>
    app.app.request(`http://127.0.0.1/api/snowluma${route}`, init);
  return { app, runtime, request, packageDir, directory, port, content };
}
async function until(get: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await get()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待超时');
}
test('SnowLuma 插件默认只读，演示配置和未同意协议时禁止启动', async () => {
  const f = await boot(false);
  expect((await f.runtime.status()).phase).toBe('unconfigured');
  expect(f.runtime.getSettings()).toMatchObject({
    mode: 'external',
    autoStart: false,
    acceptEula: false,
    acceptPrivacy: false,
  });
  expect((await f.request('/settings', { method: 'PATCH', body: '{"directory":"relative"}' })).status).toBe(
    409,
  );
  f.runtime.configure({ directory: f.packageDir, mode: 'managed', acceptEula: true, acceptPrivacy: true });
  await expect(f.runtime.start()).rejects.toThrow('演示');
  expect(await isPortOpen('127.0.0.1', f.port)).toBe(false);
  const live = await boot();
  live.runtime.configure({ directory: live.packageDir, mode: 'managed' });
  await expect(live.runtime.start()).rejects.toThrow('EULA');
  expect(await isPortOpen('127.0.0.1', live.port)).toBe(false);
});
test('托管启动互斥、状态区分登录、日志脱敏、设置持久化且不改第三方文件', async () => {
  const f = await boot();
  f.runtime.configure({ directory: f.packageDir, mode: 'managed', acceptEula: true, acceptPrivacy: true });
  const a = f.runtime.start(),
    b = f.runtime.start();
  expect(a).toBe(b);
  await a;
  await until(async () => (await f.runtime.status()).webuiReady);
  expect(await f.runtime.status()).toMatchObject({
    phase: 'running',
    owned: true,
    onebotConnected: false,
    hookAutoLoad: true,
  });
  expect((await f.request('/settings', { method: 'PATCH', body: '{"autoStart":true}' })).status).toBe(409);
  await until(async () => f.runtime.logs().some((line) => line.text.includes('[REDACTED]')));
  const logs = JSON.stringify(await (await f.request('/logs')).json());
  expect(logs).not.toContain('test-fixture-secret');
  expect(logs).not.toContain('other-fixture-secret');
  expect(fs.readFileSync(path.join(f.packageDir, 'index.mjs'), 'utf8')).toBe(f.content);
  await f.runtime.stop();
  expect(await isPortOpen('127.0.0.1', f.port)).toBe(false);
  await f.app.runtime.setEnabled('snowluma-runtime', false);
  expect((await f.request('/status')).status).toBe(404);
  await f.app.runtime.setEnabled('snowluma-runtime', true);
  expect(f.app.runtime.use(snowlumaService).getSettings().directory).toBe(f.packageDir);
});
test('外部服务不重复启动也不接管停止；卸载只回收自有子进程', async () => {
  const f = await boot();
  const external = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => external.listen(f.port, '127.0.0.1', resolve));
  cleanups.push(async () => new Promise<void>((resolve) => external.close(() => resolve())));
  f.runtime.configure({ directory: f.packageDir, mode: 'managed', acceptEula: true, acceptPrivacy: true });
  expect(await f.runtime.status()).toMatchObject({ phase: 'external', owned: false, pid: null });
  await expect(f.runtime.start()).rejects.toThrow('已有服务');
  await f.runtime.stop();
  expect(await isPortOpen('127.0.0.1', f.port)).toBe(true);
  await new Promise<void>((resolve) => external.close(() => resolve()));
  await f.runtime.start();
  await until(async () => (await f.runtime.status()).webuiReady);
  await f.app.runtime.setEnabled('snowluma-runtime', false);
  expect(await isPortOpen('127.0.0.1', f.port)).toBe(false);
});
test('启动被卸载或停止打断时不能留下迟到进程，安装目录锁按实例持有', async () => {
  const f = await boot();
  f.runtime.configure({ directory: f.packageDir, mode: 'managed', acceptEula: true, acceptPrivacy: true });
  const start = f.runtime.start();
  const expected = expect(start).rejects.toThrow('取消');
  await f.runtime.stop();
  await expected;
  expect(await isPortOpen('127.0.0.1', f.port)).toBe(false);
  const release = lockInstallation(f.packageDir, path.join(f.directory, 'locks'));
  expect(() => lockInstallation(f.packageDir, path.join(f.directory, 'locks'))).toThrow('其他 Harness');
  release();
  const next = lockInstallation(f.packageDir, path.join(f.directory, 'locks'));
  next();
});
