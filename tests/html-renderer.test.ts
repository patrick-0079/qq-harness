import { afterEach, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { Runtime } from '@qq-harness/kernel';
import { htmlRenderer, closeOwnedBrowser, closeRenderContext } from '../plugins/html-renderer/src/index.js';
import { htmlRendererService } from '@qq-harness/domain';
import { EventEmitter } from 'node:events';
const hosts: Runtime[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
});
test('渲染进程优雅关闭超时后只终止其拥有的浏览器服务', async () => {
  vi.useFakeTimers();
  const server = { close: vi.fn(() => new Promise<void>(() => {})), kill: vi.fn(async () => {}) };
  try {
    const task = closeOwnedBrowser(server, 5000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(server.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await task;
    expect(server.kill).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('面板上下文关闭卡住时升级清理，多个卸载请求只关闭同一自有浏览器一次', async () => {
  vi.useFakeTimers();
  const server = { close: vi.fn(() => new Promise<void>(() => {})), kill: vi.fn(async () => {}) },
    context = { close: vi.fn(() => new Promise<void>(() => {})) };
  try {
    const first = closeRenderContext(context, () => closeOwnedBrowser(server, 1000), 500),
      second = closeRenderContext(context, () => closeOwnedBrowser(server, 1000), 500);
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all([first, second]);
    expect(context.close).toHaveBeenCalledTimes(2);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.kill).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('浏览器公开 kill 本身无响应时仅终止持有的子进程，并以真实退出结束清理', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null as string | null,
    kill: vi.fn((_signal: string) => {
      child.signalCode = 'SIGKILL';
      child.emit('exit', null, 'SIGKILL');
      return true;
    }),
  });
  const server = {
    close: vi.fn(() => new Promise<void>(() => {})),
    kill: vi.fn(() => new Promise<void>(() => {})),
    process: () => child as any,
  };
  try {
    const task = closeOwnedBrowser(server, 100);
    await vi.advanceTimersByTimeAsync(1600);
    await task;
    expect(server.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.listenerCount('exit')).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
test('状态卡真实渲染中文和图片，阻止脚本及页面导航，调整尺寸并回收浏览器', async () => {
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#00aaff' } })
    .png()
    .toBuffer();
  const fetch = vi.fn(async () => new Response(image, { headers: { 'content-type': 'image/png' } }));
  const host = new Runtime();
  hosts.push(host);
  host.install(htmlRenderer({ fetch }));
  await host.start();
  const renderer = host.use(htmlRendererService),
    page = await renderer.create({ width: 320, height: 180 });
  await page.load(
    '<html><head><style>body{background:#15202b;color:white;font:20px sans-serif}</style></head><body>中文状态卡<img src="https://image.fixture.invalid/a.png"><script>window.ran=true</script><script src="https://script.fixture.invalid/x.js"></script><iframe src="https://page.fixture.invalid"></iframe></body></html>',
  );
  expect(await page.evaluate('typeof window.ran')).toBe('undefined');
  expect(fetch).toHaveBeenCalledTimes(1);
  const png = await page.screenshot();
  expect((await sharp(png).metadata()).width).toBe(320);
  expect((await sharp(png).metadata()).height).toBe(180);
  await page.resize(400, 220);
  expect((await sharp(await page.screenshot()).metadata()).height).toBe(220);
  await page.close();
  expect(renderer.status().pages).toBe(0);
  await host.setEnabled('html-renderer', false);
  expect(renderer.status().browser).toBe(false);
}, 15000);
test('渲染限制两个并行页面，等待请求和执行中的页面都能取消', async () => {
  const host = new Runtime();
  hosts.push(host);
  host.install(htmlRenderer());
  await host.start();
  const renderer = host.use(htmlRendererService);
  const first = await renderer.create({ width: 100, height: 100 }),
    active = new AbortController(),
    second = await renderer.create({ width: 100, height: 100 }, active.signal);
  const waiting = new AbortController(),
    queued = renderer.create({ width: 100, height: 100 }, waiting.signal);
  waiting.abort(new Error('排队取消'));
  await expect(queued).rejects.toThrow('排队取消');
  expect(renderer.status().pages).toBe(2);
  await second.load('<p>等待取消</p>');
  const task = second.evaluate('new Promise(()=>{})');
  active.abort(new Error('执行取消'));
  await expect(task).rejects.toThrow();
  expect(renderer.status().pages).toBe(1);
  await first.close();
  expect(renderer.status().pages).toBe(0);
  await expect(renderer.create({ width: 100000, height: 100 })).rejects.toThrow('尺寸');
  expect(renderer.status().pages).toBe(0);
}, 15000);

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileLegacyPackage } from '../tools/compile-legacy-package.js';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import {
  storageService,
  configService,
  toolService,
  adapterService,
  type ToolContext,
} from '@qq-harness/domain';
const commandSource = fileURLToPath(new URL('../../backup/source/plugins/ccb-command/', import.meta.url));
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-render-source-'));
  cleanups.push(() => {
    const actual = fs.realpathSync(root);
    if (
      path.dirname(actual) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(actual).startsWith('harness-render-source-')
    )
      throw new Error('清理越界');
    fs.rmSync(actual, { recursive: true, force: true });
  });
  return root;
}

test.skipIf(!fs.existsSync(commandSource))(
  '旧状态插件经原工具生成中文面板并经过 outbound 发送，文字回退严格使用数组',
  async () => {
    const root = fixture(),
      source = path.resolve(commandSource, '../ai-status'),
      target = path.join(root, 'extensions/plugins/ai-status'),
      manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
    await compileLegacyPackage(source, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: { acceptAllSessions: true, send: { minIntervalMs: 0, dedupeMs: 0 } },
    });
    cleanups.push(app.stop);
    const host = app.runtime.use(extensionService);
    await host.configure('ai-status', { enabled: true });
    app.runtime.use(storageService).append({
      id: 'status-request',
      chatKey: 'private:1',
      senderId: '1',
      senderName: '测试',
      text: '\\状态',
      atMe: false,
      timestamp: Date.now(),
    });
    const c: ToolContext = {
      chatKey: 'private:1',
      settings: app.runtime.use(configService).effective('private:1'),
      sent: 0,
      trace() {},
      run: {
        id: 'status-test',
        revision: 0,
        deadline: Infinity,
        signal: new AbortController().signal,
        assertActive() {},
      },
    };
    const result = await app.runtime.use(toolService).execute(c, 'ai-status__get_ai_status', '{}');
    expect(result).toMatchObject({ _cardSent: true });
    expect(c.sent).toBe(1);
    const sent = app.runtime.use(adapterService).sent!;
    expect(sent).toHaveLength(1);
    const segment = JSON.parse(sent[0]!.text).segments[0];
    expect(segment.type).toBe('image');
    const image = Buffer.from(segment.data.file.slice('base64://'.length), 'base64'),
      size = await sharp(image).metadata();
    expect(size.width).toBeGreaterThan(400);
    expect(size.height).toBeGreaterThan(200);
    expect(app.runtime.use(htmlRendererService).status().pages).toBe(0);
    const fallback = await app.runtime
      .use(toolService)
      .execute(c, 'ai-status__get_ai_status', '{"format":"text"}');
    expect(String((fallback as any).content)).toContain('messages 传仅含一个字符串的数组');
    expect(String((fallback as any).content)).not.toContain('严禁传数组');
  },
  20000,
);
