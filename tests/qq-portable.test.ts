import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { qqPortableService } from '@qq-harness/qq-portable';
import type { QqProcess, QqProcessDriver } from '../plugins/qq-portable/src/process.js';
import { inside } from '../plugins/qq-portable/src/process.js';
import { preparePortable, verifyPortable } from '../scripts/portable-qq.mjs';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
function temporary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-portable-'));
  cleanups.push(async () => {
    const real = fs.realpathSync(dir);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-portable-')
    )
      throw new Error('清理目录越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  return dir;
}
function program(dir: string) {
  const files: Record<string, string> = {
    'QQ.exe': 'fixture',
    'versions/config.json': '{"curVersion":"9.9.36-53644"}',
    'versions/9.9.36-53644/QQNT.dll': 'fixture',
    'versions/9.9.36-53644/resources/app/package.json': '{}',
  };
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
}
async function boot(allowLaunch = true, startupGraceMs = 40) {
  const root = temporary(),
    directory = path.join(root, '中文 space QQ'),
    dataDirectory = path.join(root, 'QQ data');
  program(directory);
  const processes: QqProcess[] = [];
  const driver: QqProcessDriver = {
    supported: true,
    list: vi.fn(async () => processes),
    launch: vi.fn(() =>
      spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' }),
    ),
    stop: vi.fn(async (child) => {
      child.kill();
    }),
  };
  const app = await createApplication({
    dataDir: path.join(root, 'data'),
    extensionHotReload: false,
    qqPortable: {
      allowLaunch,
      directory,
      dataDirectory,
      driver,
      startupGraceMs,
      lockRoot: path.join(root, 'locks'),
    },
  });
  cleanups.push(app.stop);
  const runtime = app.runtime.use(qqPortableService);
  return { root, directory, dataDirectory, driver, processes, app, runtime };
}
test('便携 QQ 默认禁止 demo 启动，设置校验与 API 持久化', async () => {
  const f = await boot(false);
  expect(await f.runtime.status()).toMatchObject({
    phase: 'ready',
    version: '9.9.36-53644',
    owned: false,
    allowLaunch: false,
  });
  await expect(f.runtime.start()).rejects.toThrow('演示');
  expect(f.driver.launch).not.toHaveBeenCalled();
  const request = (body: string) =>
    f.app.app.request('http://127.0.0.1/api/qq-portable/settings', { method: 'PATCH', body });
  expect((await request('{"directory":"relative"}')).status).toBe(409);
  expect((await request('{"command":"arbitrary"}')).status).toBe(400);
  const dataDirectory = path.join(f.root, 'another-data');
  expect((await request(JSON.stringify({ dataDirectory }))).status).toBe(200);
  await f.app.runtime.setEnabled('qq-portable', false);
  expect((await f.app.app.request('http://127.0.0.1/api/qq-portable/status')).status).toBe(404);
  await f.app.runtime.setEnabled('qq-portable', true);
  expect(f.app.runtime.use(qqPortableService).getSettings().dataDirectory).toBe(dataDirectory);
});
test('便携 QQ 启动互斥、独立参数、卸载只停止自有假进程', async () => {
  const f = await boot();
  const first = f.runtime.start();
  expect(f.runtime.start()).toBe(first);
  expect(await first).toMatchObject({ phase: 'running', owned: true });
  expect(f.driver.launch).toHaveBeenCalledExactlyOnceWith(
    fs.realpathSync(path.join(f.directory, 'QQ.exe')),
    fs.realpathSync(f.dataDirectory),
  );
  expect(() => f.runtime.configure({ directory: '' })).toThrow('先停止');
  await f.app.runtime.setEnabled('qq-portable', false);
  expect(f.driver.stop).toHaveBeenCalledTimes(1);
  expect((await f.runtime.status()).owned).toBe(false);
});
test('外部 QQ 与相似路径不混淆，探测失败禁止启动，外部进程不会被停止', async () => {
  const f = await boot();
  expect(inside(f.directory, path.join(f.directory + '-other', 'QQ.exe'))).toBe(false);
  f.processes.push({ pid: 123, executable: path.join(f.directory, 'QQ.exe') });
  expect(await f.runtime.status()).toMatchObject({ phase: 'external', owned: false, pid: 123 });
  await expect(f.runtime.start()).rejects.toThrow('外部');
  await f.runtime.stop();
  expect(f.driver.stop).not.toHaveBeenCalled();
  expect(f.driver.launch).not.toHaveBeenCalled();
  vi.mocked(f.driver.list).mockRejectedValueOnce(new Error('无法读取进程'));
  await expect(f.runtime.start()).rejects.toThrow('无法读取');
  expect(f.driver.launch).not.toHaveBeenCalled();
});
test('停用打断进程探测时不会迟到启动或遗留锁', async () => {
  const f = await boot();
  let resolve!: (processes: QqProcess[]) => void;
  vi.mocked(f.driver.list).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const starting = f.runtime.start();
  const expected = expect(starting).rejects.toThrow('取消');
  const stop = f.runtime.stop();
  resolve([]);
  await expected;
  await stop;
  expect(f.driver.launch).not.toHaveBeenCalled();
  await f.runtime.start();
  await f.runtime.stop();
});
test('缺失程序与重叠数据目录被拒绝；启动失败释放锁后可以重试', async () => {
  const f = await boot();
  f.runtime.configure({ dataDirectory: f.directory });
  await expect(f.runtime.start()).rejects.toThrow('独立');
  f.runtime.configure({ dataDirectory: f.dataDirectory });
  vi.mocked(f.driver.launch).mockImplementationOnce(() =>
    spawn(path.join(f.root, 'missing.exe'), [], { windowsHide: true }),
  );
  await expect(f.runtime.start()).rejects.toThrow('启动失败');
  await f.runtime.start();
  await f.runtime.stop();
  fs.unlinkSync(path.join(f.directory, 'versions/9.9.36-53644/QQNT.dll'));
  await expect(f.runtime.start()).rejects.toThrow('缺少有效');
});
test('程序目录和 profile 双锁阻止两个宿主共用，进程退出后恢复', async () => {
  const a = await boot(),
    b = await boot();
  // 两宿主使用同一锁根，模拟同机多实例。
  const other = await createApplication({
    dataDir: path.join(b.root, 'other-data'),
    extensionHotReload: false,
    qqPortable: {
      allowLaunch: true,
      directory: b.directory,
      dataDirectory: a.dataDirectory,
      driver: b.driver,
      lockRoot: path.join(a.root, 'locks'),
    },
  });
  cleanups.push(other.stop);
  await a.runtime.start();
  await expect(other.runtime.use(qqPortableService).start()).rejects.toThrow('其他 Harness');
  await a.runtime.stop();
  await other.runtime.use(qqPortableService).start();
});
test('准备仅复制程序并验证哈希，跳过账号数据/旧版本，拒绝覆盖或篡改', () => {
  const root = temporary(),
    source = path.join(root, 'source'),
    target = path.join(root, 'prepared');
  program(source);
  fs.writeFileSync(path.join(source, 'versions/setting.json'), '{"launcherCounts":1}');
  fs.writeFileSync(path.join(source, 'Uninstall.xml'), '<Files/>');
  fs.writeFileSync(path.join(source, 'Uninstall.exe'), 'fixture-installer');
  fs.mkdirSync(path.join(source, 'Tencent Files'));
  fs.writeFileSync(path.join(source, 'Tencent Files/account.json'), 'secret');
  fs.writeFileSync(path.join(source, 'beacon.log'), 'secret');
  fs.mkdirSync(path.join(source, 'versions/old'));
  fs.writeFileSync(path.join(source, 'versions/old/old.dll'), 'old');
  const result = preparePortable(source, target);
  expect(result).toMatchObject({ version: '9.9.36-53644', verified: true, files: 7 });
  expect(fs.readFileSync(path.join(target, 'versions/setting.json'), 'utf8')).toContain('launcherCounts');
  expect(fs.existsSync(path.join(target, 'Uninstall.xml'))).toBe(true);
  expect(fs.existsSync(path.join(target, 'Tencent Files'))).toBe(false);
  expect(fs.existsSync(path.join(target, 'versions/old'))).toBe(false);
  expect(() => preparePortable(source, target)).toThrow('拒绝覆盖');
  expect(() => preparePortable(source, path.join(source, 'nested'))).toThrow('重叠');
  fs.writeFileSync(path.join(target, 'QQ.exe'), 'tampered');
  expect(() => verifyPortable(target)).toThrow('校验失败');
});

test('假启动器立即退出时启动 API 报错，不误报已运行且释放目录锁', async () => {
  const f = await boot(true, 800);
  vi.mocked(f.driver.launch).mockImplementationOnce(() =>
    spawn(process.execPath, ['-e', 'process.exit(23)'], { windowsHide: true, stdio: 'ignore' }),
  );
  const response = await f.app.app.request('http://127.0.0.1/api/qq-portable/launch', { method: 'POST' });
  expect(response.status).toBe(409);
  expect((await f.runtime.status()).phase).toBe('failed');
  expect((await f.runtime.status()).message).toContain('23');
  await f.runtime.start();
  expect((await f.runtime.status()).owned).toBe(true);
});
