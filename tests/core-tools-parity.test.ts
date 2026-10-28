import { waitMemoryRequest } from './fixtures/memory-task.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { createApplication } from '../apps/server/src/app.js';
import {
  adapterService,
  configService,
  mediaService,
  storageService,
  toolService,
  webService,
  type ToolContext,
} from '@qq-harness/domain';
import { reminderTime } from '../plugins/reminders/src/time.js';
import { convertLegacySession } from '../tools/legacy-session.js';
import { createCoreUtilities } from '../packages/legacy-core/generated/runtime.mjs';
import { videoParts } from '../plugins/media-runtime/src/video.js';
import sharp from 'sharp';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanups.splice(0).reverse()) await stop();
  vi.restoreAllMocks();
});
async function boot(concurrency = 1) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-core-parity-'));
  const app = await createApplication({
    dataDir,
    v2Managers: false,
    extensionHotReload: false,
    concurrency,
    initialConfig: {
      acceptAllSessions: true,
      defaults: {
        tools: { crossChatSend: true },
        legacySession: {
          sticker: { enabled: true, collectEnabled: true },
          api: { vision: true, video: true, videoMode: 'native' },
        },
      },
      send: { minIntervalMs: 0, dedupeMs: 0 },
    },
  });
  cleanups.push(async () => {
    await app.stop();
    const resolved = fs.realpathSync(dataDir);
    if (
      path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(resolved).startsWith('harness-core-parity-')
    )
      throw new Error('临时目录越界');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  let sequence = 0;
  const execute = async (
    fn: (c: ToolContext, call: (name: string, a: unknown) => Promise<any>) => Promise<void>,
  ) => {
    const id = 'parity-' + sequence++;
    app.runtime.install(
      definePlugin({
        id,
        setup(ctx) {
          ctx.mode({
            id,
            input: z.object({}),
            execute: async (run) => {
              const c: ToolContext = {
                run,
                chatKey: 'group:1',
                settings: app.runtime.use(configService).effective('group:1'),
                sent: 0,
                trace() {},
              };
              await fn(c, (name, a) => app.runtime.use(toolService).execute(c, name, JSON.stringify(a)));
              return { sent: c.sent };
            },
          });
        },
      }),
    );
    await app.runtime.start();
    const run = app.runtime.submit({ mode: id, partitionKey: 'group:1', input: {} });
    const result = await app.runtime.wait(run.id);
    if (result.status !== 'completed') throw new Error(result.error);
    return result;
  };
  return { ...app, dataDir, execute };
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
  'base64',
);
test('旧版全部29个核心工具都有统一目录、参数说明与执行入口', async () => {
  const app = await boot();
  const inventory = JSON.parse(
    fs.readFileSync(new URL('../doc/parity-inventory.json', import.meta.url), 'utf8'),
  ) as { builtins: { id: string; metadata: { category?: string; core?: boolean } }[] };
  const catalog = app.runtime.use(toolService).catalog!('group:1');
  expect(inventory.builtins).toHaveLength(29);
  for (const tool of inventory.builtins) {
    const item = catalog.find((t) => t.id === tool.id);
    expect(item, tool.id).toBeDefined();
    expect(item?.parameters.type, tool.id).toBe('object');
    expect(item?.category, tool.id).toBe(tool.metadata.category);
    expect(item?.core, tool.id).toBe(tool.metadata.core === true);
    expect(item?.description.length, tool.id).toBeGreaterThan(5);
  }
});
test('媒体、表情、拍一拍产生真实 mock 出站副作用，预览不计发言；备注与收藏持久化', async () => {
  const app = await boot(),
    adapter = app.runtime.use(adapterService),
    media = app.runtime.use(mediaService),
    storage = app.runtime.use(storageService);
  let seed = 101;
  const avatar = await sharp(
    Buffer.from(
      Array.from({ length: 100 * 100 * 3 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed >>> 24;
      }),
    ),
    { raw: { width: 100, height: 100, channels: 3 } },
  )
    .png()
    .toBuffer();
  const original = media.fetchImage.bind(media);
  vi.spyOn(media, 'fetchImage').mockImplementation((ref, signal) =>
    ref.startsWith('https://q.qlogo.cn/') || ref.startsWith('https://q1.qlogo.cn/')
      ? Promise.resolve({ bytes: avatar, mime: 'image/png' })
      : ref === 'https://images.example.test/a.png'
        ? Promise.resolve({ bytes: png, mime: 'image/png' })
        : original(ref, signal),
  );
  const actions: string[] = [];
  vi.spyOn(adapter, 'query').mockImplementation(async (action) => {
    actions.push(action);
    if (action === 'fetch_custom_face_detail')
      return [{ emoji_id: 'face-1', url: 'https://images.example.test/a.png', desc: '笑' }];
    if (action === 'add_custom_face') return { emoji_id: 'collected-1' };
    return {};
  });
  storage.append({
    id: 'image-message',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '[图片]',
    atMe: false,
    timestamp: Date.now(),
    metadata: { segments: [{ type: 'image', data: { file: 'base64://' + png.toString('base64') } }] },
  });
  const delivered = await app.execute(async (c, call) => {
    expect(
      await call('send_image', { url: 'https://images.example.test/a.png', preview: true }),
    ).toHaveProperty('content.1.type', 'image_url');
    expect(c.sent).toBe(0);
    expect(await call('get_message_images', { messageId: 'image-message' })).toHaveProperty(
      'content.1.type',
      'image_url',
    );
    expect(await call('get_message_images', { messageId: 'not-in-chat' })).toHaveProperty('isError', true);
    expect(await call('fetch_avatar', { userId: '12345' })).toHaveProperty('content.1.type', 'image_url');
    expect(await call('fetch_avatar', { userId: '未知' })).toHaveProperty('isError', true);
    expect(await call('list_stickers', {})).toBeDefined();
    expect(
      await call('sticker_note', {
        stickerId: 'face-1',
        note: '开心的时候',
        tags: ['开心'],
        usage: '回应笑话',
      }),
    ).toMatchObject({ updated: true, localNote: '开心的时候' });
    expect(await call('get_sticker_image', { stickerId: 'face-1' })).toHaveProperty(
      'content.1.type',
      'image_url',
    );
    expect(await call('collect_sticker', { messageId: 'image-message', note: '收藏测试' })).toMatchObject({
      collected: true,
      qqSaved: true,
      localSaved: true,
    });
    expect(
      await call('send_sticker', { stickerId: 'face-1', replyToMessageId: 'image-message' }),
    ).toMatchObject({ sent: true });
    expect(await call('send_poke', {})).toHaveProperty('isError', true);
    expect(await call('send_poke', { targetUserId: '2' })).toMatchObject({ poked: true });
    expect(
      await call('send_image', { url: 'https://images.example.test/a.png', note: '图片说明', atUserId: '2' }),
    ).toMatchObject({ sent: true });
    expect(c.sent).toBe(3);
    expect(await call('finish', { mode: 'spoken' })).toMatchObject({ finished: true });
  });
  expect(delivered.result).toMatchObject({ sent: 3 });
  expect(adapter.sent).toHaveLength(3);
  expect(actions).toEqual(
    expect.arrayContaining(['fetch_custom_face_detail', 'add_custom_face', 'modify_custom_face']),
  );
  const saved = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'stickers.json'), 'utf8'));
  expect(saved.some((s: any) => s.localNote === '开心的时候')).toBe(true);
  expect(storage.messages('group:1').filter((m) => m.self)).toHaveLength(3);
});
test('视频原生输入与抽帧保持多模态内容，抽帧参数有上限并清理临时文件', async () => {
  const app = await boot(),
    media = app.runtime.use(mediaService),
    storage = app.runtime.use(storageService);
  const root = path.join(app.dataDir, 'video-test'),
    bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(20)]);
  const download = vi.fn(async () => new Response(bytes));
  const native = await videoParts(root, 'https://example.test/video.mp4', {
    mode: 'native',
    frames: 3,
    signal: new AbortController().signal,
    fetch: download,
  });
  expect(native[1]?.type).toBe('video_url');
  const commands: string[][] = [];
  const parts = await videoParts(root, 'https://example.test/video.mp4', {
    mode: 'frames',
    frames: 3,
    signal: new AbortController().signal,
    fetch: download,
    command: async (file, args) => {
      commands.push(args);
      if (file === 'ffprobe') return '{"format":{"duration":12}}';
      if (args.includes('-version')) return 'ffmpeg mock';
      for (let i = 1; i <= 3; i++)
        fs.writeFileSync(args.at(-1)!.replace('%02d', String(i).padStart(2, '0')), png);
      return '';
    },
  });
  expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
  expect(commands.find((args) => args.includes('-vf'))).toContain('fps=0.25,scale=640:-2');
  expect(fs.readdirSync(root)).toEqual([]);
  vi.spyOn(media, 'video').mockResolvedValue(parts);
  storage.append({
    id: 'video',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '[视频]',
    atMe: false,
    timestamp: Date.now(),
    metadata: { segments: [{ type: 'video', data: { url: 'https://example.test/video.mp4' } }] },
  });
  await app.execute(async (_c, call) => {
    expect(await call('read_video', { messageId: 'video', frames: '3' })).toMatchObject({ content: parts });
    expect(await call('read_video', { messageId: 'video', frames: '13' })).toHaveProperty('isError', true);
    expect(await call('read_video', { messageId: 'foreign', frames: '3' })).toHaveProperty('isError', true);
  });
});
test('跨会话发送借用父执行槽，不在并发数1时死锁；目标独立记录且取消继承', async () => {
  const app = await boot(1);
  let targetRun = '';
  await app.execute(async (c, call) => {
    const result = await call('send_to', { targetChatKey: 'private:9', messages: ['转告甲', '转告乙'] });
    expect(result).toMatchObject({ sent: 2, targetChatKey: 'private:9' });
    targetRun = result.runId;
    expect(c.sent).toBe(2);
  });
  const child = app.runtime.listRuns().find((r) => r.id === targetRun)!;
  expect(child).toMatchObject({
    status: 'completed',
    partitionKey: 'outbound:private:9',
    parentId: expect.any(String),
  });
  expect(app.runtime.use(adapterService).sent?.map((m) => m.chatKey)).toEqual(['private:9', 'private:9']);
  app.runtime.use(configService).patch({ deniedChats: ['private:9'] });
  await app.execute(async (_c, call) =>
    expect(await call('send_to', { targetChatKey: 'private:9', messages: ['拒绝'] })).toHaveProperty(
      'isError',
      true,
    ),
  );
});
test('消息查询分页、成员、详情、转发嵌套和图片关联；未知引用及循环被拒绝', async () => {
  const app = await boot(),
    storage = app.runtime.use(storageService),
    adapter = app.runtime.use(adapterService);
  for (let i = 0; i < 4; i++)
    storage.append({
      id: String(100 + i),
      chatKey: 'group:1',
      senderId: String((i % 2) + 2),
      senderName: '成员' + i,
      text: '消息' + i,
      atMe: false,
      timestamp: Date.now(),
    });
  storage.append({
    id: 'forward',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '[转发]',
    atMe: false,
    timestamp: Date.now(),
    metadata: { segments: [{ type: 'forward', data: { id: 'r0' } }] },
  });
  vi.spyOn(adapter, 'query').mockImplementation(async (action, args) =>
    action === 'get_forward_msg'
      ? {
          messages: [
            {
              sender: { nickname: '转发者', user_id: '8' },
              content: [
                { type: 'text', data: { text: '转发正文' } },
                { type: 'image', data: { file: 'base64://' + png.toString('base64') } },
                { type: 'forward', data: { id: 'r' + (Number(String(args.id).slice(1)) + 1) } },
              ],
            },
          ],
        }
      : {},
  );
  await app.execute(async (_c, call) => {
    const recent = await call('get_recent_messages', { limit: 2, offset: 1 });
    expect(recent.count).toBe(2);
    expect(recent.messages.map((m: any) => m.messageId)).toEqual(['102', '103']);
    expect(JSON.stringify(await call('get_message_detail', { messageId: '100' }))).toContain('消息0');
    expect(JSON.stringify(await call('get_active_members', {}))).toContain('成员');
    expect(JSON.stringify(await call('get_chats', {}))).toContain('group:1');
    expect(await call('read_forward', { recordId: 'unknown' })).toHaveProperty('isError', true);
    expect(await call('read_forward', { messageId: 'forward' })).toMatchObject({
      images: 1,
      depth: 0,
      imageMessageId: 'forward',
    });
    for (let i = 1; i <= 8; i++)
      expect(await call('read_forward', { recordId: 'r' + i })).toMatchObject({ depth: i });
    expect(await call('read_forward', { recordId: 'r9' })).toHaveProperty('isError', true);
    expect(await call('read_forward', { recordId: 'r1' })).toHaveProperty('isError', true);
    expect(await call('get_message_images', { messageId: 'forward' })).toHaveProperty(
      'content.1.type',
      'image_url',
    );
    expect(await call('read_forward', { messageId: 'forward', refresh: true })).toMatchObject({
      images: 1,
      depth: 0,
    });
    expect(
      storage.state(
        'forward-media',
        'group:1/' + storage.messages('group:1').find((m) => m.id === 'forward')!.localId,
      ),
    ).toHaveLength(1);
  });
});
test('旧成员记忆与提醒参数接入新服务；删除和取消受会话隔离', async () => {
  const app = await boot(),
    storage = app.runtime.use(storageService);
  storage.append({
    id: '1',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '喜欢茶',
    atMe: false,
    timestamp: Date.now(),
  });
  let requestId = '';
  await app.execute(async (_c, call) => {
    const task = await call('memory_append', {
      category: 'memberImpression',
      userId: '2',
      target: '甲',
      content: '喜欢茶',
    });
    expect(task.status).toBe('queued');
    requestId = task.id;
  });
  expect((await waitMemoryRequest(app, requestId)).status).toBe('completed');
  await app.execute(async (_c, call) => {
    expect(JSON.stringify(await call('memory_query', { userId: '2' }))).toContain('喜欢茶');
    const task = await call('memory_remove', {
      category: 'memberImpression',
      target: '甲',
      content: '喜欢茶',
    });
    requestId = task.id;
  });
  expect((await waitMemoryRequest(app, requestId)).status).toBe('completed');
  await app.execute(async (_c, call) => {
    expect(JSON.stringify(await call('memory_query', { userId: '2' }))).not.toContain('喜欢茶');
    const reminder = await call('set_reminder', { text: '测试提醒', delayMinutes: 60 });
    expect(reminder).toHaveProperty('id');
    expect(await call('list_reminders', {})).toMatchObject({ reminders: [{ id: reminder.id }] });
    expect(await call('cancel_reminder', { id: 'foreign' })).toHaveProperty('isError', true);
    expect(await call('cancel_reminder', { id: reminder.id })).toMatchObject({ cancelled: true });
    expect(await call('list_reminders', {})).toMatchObject({ reminders: [] });
    expect(await call('report_feedback', { message: '测试反馈', level: 'warning' })).toMatchObject({
      recorded: true,
    });
    expect(await call('check_holiday', { days: 0 })).toBeDefined();
  });
  expect(storage.state('feedback', 'items')).toEqual([
    expect.objectContaining({ message: '测试反馈', chatKey: 'group:1' }),
  ]);
});
test('提醒使用北京时间，日期合法性、跨午夜及互斥参数正确', () => {
  const now = Date.parse('2026-10-27T15:30:00Z');
  expect(reminderTime({ atTime: '00:10' }, now)).toBe(Date.parse('2026-10-27T16:10:00Z'));
  expect(reminderTime({ atTime: '2026-10-29 08:00' }, now)).toBe(Date.parse('2026-10-29T00:00:00Z'));
  for (const args of [
    { atTime: '2026-02-30 12:00' },
    { atTime: '24:00' },
    { delayMinutes: 0 },
    { delayMinutes: 2, atTime: '12:00' },
    {},
  ])
    expect(() => reminderTime(args, now)).toThrow();
});
test('旧配置规范化保持概率、关键词、峰谷及全部分区快照，迁移幂等且剥离会话凭据', () => {
  const input = {
    api: {
      model: 'chat',
      provider: 'p',
      fallbackModels: [{ model: 'backup', provider: 'q' }],
      thinkingBudget: 5000,
      vision: true,
      video: true,
      apiKey: 'secret',
    },
    run: { timeoutMs: 0, disposition: 'record', maxNudges: 2 },
    store: {
      contextTier: 3,
      randomPercent: 24.1,
      keywords: ['茶', '咖啡'],
      peakSchedule: {
        enabled: true,
        weekdays: [1, 7],
        peak: { start: '22:00', end: '06:00', sliderPos: 10 },
      },
    },
    tools: { crossChatSend: true, categories: { web: false } },
    proactive: { enabled: true },
    sticker: { collectEnabled: true },
    skills: { disabled: { enabled: false } },
    sessionRetryAttempts: 4,
    blocklist: { '1': ['9'] },
  };
  const first = convertLegacySession(input, input, 'group:1');
  expect(first).toEqual(convertLegacySession(input, input, 'group:1'));
  expect(first).toMatchObject({
    runTimeoutMs: 0,
    behavior: {
      enabled: true,
      reply: { other: { enabled: true, probability: 24.1 } },
      blockedUsers: ['9'],
      run: { retryAttempts: 4 },
    },
    modelSelection: {
      providerId: 'p',
      model: 'chat',
      fallbacks: [{ providerId: 'q', model: 'backup' }],
      thinkingBudget: 5000,
    },
    tools: { crossChatSend: true, categories: { web: false } },
  });
  expect(JSON.stringify(first)).not.toContain('secret');
  expect(first.legacySession).toHaveProperty('skills.disabled.enabled', false);
});
test('联网搜索使用固定旧提供方算法和 mock 网络，保留结果解析与清洗', async () => {
  const requests: unknown[] = [];
  const utility = createCoreUtilities({
    config: () => ({
      webSearch: {
        provider: 'custom:test',
        providers: [{ id: 'test', baseUrl: 'https://search.example.test', apiKey: 'test-key' }],
      },
    }),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({ results: [{ title: '结果', url: 'https://example.test/page', content: '摘要' }] }),
      );
    },
    safeFetch: async (url) => ({
      url,
      statusCode: 200,
      truncated: false,
      body: '<title>示例</title><p>正文内容</p>',
    }),
  });
  const result = await utility.web.webSearch('  QQ 搜索  ');
  expect(JSON.stringify(result)).toContain('摘要');
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(await utility.web.webFetch('https://example.test/page'))).toContain('正文内容');
  const app = await boot();
  vi.spyOn(app.runtime.use(webService), 'search').mockResolvedValue(result);
  vi.spyOn(app.runtime.use(webService), 'fetch').mockResolvedValue({ text: '网页正文' });
  vi.spyOn(app.runtime.use(webService), 'images').mockResolvedValue([
    { url: 'https://images.example.test/a.png' },
  ]);
  await app.execute(async (_c, call) => {
    expect(await call('web_search', { query: 'QQ' })).toEqual(result);
    expect(await call('web_fetch', { url: 'https://example.test' })).toMatchObject({ text: '网页正文' });
    expect(await call('search_images', { query: '图片', limit: 2 })).toHaveProperty('images.length', 1);
  });
});
