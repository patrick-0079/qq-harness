import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createApplication } from '../apps/server/src/app.js';
import {
  configService,
  mediaService,
  storageService,
  toolService,
  adapterService,
  type ToolContext,
} from '@qq-harness/domain';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanups.splice(0).reverse()) await stop();
  vi.restoreAllMocks();
});
async function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-images-'));
  const requests: { url: string; body?: unknown }[] = [];
  const app = await createApplication({
    dataDir,
    v2Managers: false,
    extensionHotReload: false,
    imageStudio: {
      fetch: async (url, options) => {
        requests.push({ url, body: options?.body });
        if (url.includes('baidu.com'))
          return new Response(
            JSON.stringify({
              data: [{ middleURL: 'https://images.example.test/a.png', fromPageTitleEnc: '猫' }],
            }),
          );
        if (url.includes('bing.com'))
          return new Response('<div>{"murl":"https://images.example.test/b.png"}</div>');
        return new Response(
          JSON.stringify({
            data: [{ pid: 1234, title: '插画', author: '甲', tags: ['全年龄'], r18: false }],
          }),
        );
      },
    },
    initialConfig: {
      acceptAllSessions: true,
      send: { minIntervalMs: 0, dedupeMs: 0 },
      defaults: { legacySession: { skills: { 'image-studio': { maxSendsPerRun: 1 } } } },
    },
  });
  cleanups.push(async () => {
    await app.stop();
    const real = fs.realpathSync(dataDir);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-images-')
    )
      throw new Error('目录越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 3, background: { r: 60, g: 150, b: 220 } },
  })
    .png()
    .toBuffer();
  vi.spyOn(app.runtime.use(mediaService), 'fetchImage').mockResolvedValue({ bytes, mime: 'image/png' });
  vi.spyOn(app.runtime.use(mediaService), 'image').mockResolvedValue({ bytes, mime: 'image/png' });
  let id = 0;
  const execute = async (
    fn: (c: ToolContext, call: (name: string, args: unknown) => Promise<any>) => Promise<void>,
  ) => {
    const mode = 'images-test-' + id++;
    app.runtime.install({
      id: mode,
      setup(ctx) {
        ctx.mode({
          id: mode,
          input: z.object({}),
          execute: async (run) => {
            const c: ToolContext = {
              run,
              chatKey: 'group:1',
              settings: app.runtime.use(configService).effective('group:1'),
              sent: 0,
              trace() {},
            };
            await fn(c, (name, args) =>
              app.runtime.use(toolService).execute(c, 'image-studio__' + name, JSON.stringify(args)),
            );
            return { sent: c.sent };
          },
        });
      },
    });
    await app.runtime.start();
    const run = app.runtime.submit({ mode, partitionKey: 'group:1', input: {} });
    const result = await app.runtime.wait(run.id);
    if (result.status !== 'completed') throw new Error(result.error);
    return result;
  };
  return { ...app, dataDir, requests, bytes, execute };
}
test('图片工坊预览与发送绑定同一运行，原图不重编码，限额、失败重试与缓存清理有效', async () => {
  const app = await fixture(),
    adapter = app.runtime.use(adapterService);
  let usedToken = '';
  await app.execute(async (c, call) => {
    expect(await call('edit_image', { url: 'https://images.example.test/a.png', send: true })).toHaveProperty(
      'isError',
      true,
    );
    const preview = await call('edit_image', { url: 'https://images.example.test/a.png' });
    expect(preview).toMatchObject({ width: 3, height: 2, edited: false });
    expect(preview.content[1].type).toBe('image_url');
    expect(c.sent).toBe(0);
    usedToken = preview.token;
    const original = adapter.sendPayload!.bind(adapter);
    vi.spyOn(adapter, 'sendPayload')
      .mockRejectedValueOnce(new Error('模拟发送失败'))
      .mockImplementation(original);
    expect(await call('edit_image', { token: usedToken, send: true })).toHaveProperty('isError', true);
    expect(await call('edit_image', { token: usedToken, send: true, note: '原图' })).toMatchObject({
      sent: true,
      edited: false,
    });
    expect(c.sent).toBe(1);
    expect(await call('edit_image', { token: usedToken, send: true })).toHaveProperty('isError', true);
    const second = await call('edit_image', {
      url: 'https://images.example.test/b.png',
      rotate: 90,
      flip: 'horizontal',
      grayscale: true,
    });
    expect(second).toMatchObject({ width: 2, height: 3, edited: true });
    expect(await call('edit_image', { token: second.token, send: true })).toHaveProperty('isError', true);
  });
  const payload = JSON.parse(adapter.sent![0]!.text);
  expect(Buffer.from(payload.segments[0].data.file.slice(9), 'base64')).toEqual(app.bytes);
  expect(fs.readdirSync(path.join(app.dataDir, 'image-studio/previews'))).toEqual([]);
  await app.execute(async (_c, call) =>
    expect(await call('edit_image', { token: usedToken, send: true })).toHaveProperty('isError', true),
  );
  const history = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'image-studio/history.json'), 'utf8'));
  expect(history.items).toHaveLength(1);
});
test('双源搜图、Pixiv 标签学习与去重保留，改自己头像受预览和开关约束，消息来源隔离', async () => {
  const app = await fixture(),
    cfg = app.runtime.use(configService),
    storage = app.runtime.use(storageService);
  storage.append({
    id: 'image-message',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '图',
    atMe: false,
    timestamp: Date.now(),
    metadata: { segments: [{ type: 'image', data: { url: 'https://images.example.test/a.png' } }] },
  });
  await app.execute(async (c, call) => {
    const search = await call('find_images', { query: '猫', limit: 2 });
    expect(search.results).toHaveLength(2);
    const pixiv = await call('find_images', { query: '角色甲', tag: 'キャラ甲', source: 'pixiv', limit: 1 });
    expect(pixiv.results[0].url).toBe('https://pixiv.re/1234.png');
    expect(await call('set_qq_avatar', { url: 'https://images.example.test/a.png' })).toHaveProperty(
      'isError',
      true,
    );
    expect(await call('edit_image', { messageId: 'foreign' })).toHaveProperty('isError', true);
    const preview = await call('edit_image', { messageId: 'image-message' });
    expect(preview.token).toBeDefined();
    cfg.patch({ defaults: { legacySession: { skills: { 'image-studio': { allowAvatar: false } } } } });
    expect(await call('set_qq_avatar', { token: preview.token })).toHaveProperty('isError', true);
    cfg.patch({ defaults: { legacySession: { skills: { 'image-studio': { allowAvatar: true } } } } });
    expect(await call('set_qq_avatar', { token: preview.token })).toMatchObject({ updated: true });
    expect(c.sent).toBe(0);
    expect(await app.runtime.use(toolService).execute(c, 'finish', '{"mode":"spoken"}')).toMatchObject({
      isError: true,
    });
    expect(storage.messages('group:1').filter((m) => m.self)).toHaveLength(0);
  });
  expect(JSON.parse(app.runtime.use(adapterService).sent![0]!.text)).toHaveProperty('profileImage');
  expect(
    app.requests.some((r) => r.url.includes('r18=0') || JSON.stringify(r.body ?? '').includes('"r18":0')),
  ).toBe(true);
  expect(
    JSON.parse(fs.readFileSync(path.join(app.dataDir, 'image-studio/tag-dict.json'), 'utf8')),
  ).toHaveProperty('角色甲', 'キャラ甲');
});
