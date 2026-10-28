import { waitMemoryRequest } from './fixtures/memory-task.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { compileLegacyPackage } from '../tools/compile-legacy-package.js';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import {
  adapterService,
  configService,
  conversationService,
  storageService,
  stickerService,
  modelService,
  webService,
  memoryService,
} from '@qq-harness/domain';
const legacy = fileURLToPath(new URL('../../backup/source/', import.meta.url));
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function boot(
  id: string,
  kind = 'plugins',
  prepare?: (dataDir: string) => void,
  extensionFetch?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sender-migration-'));
  cleanup.push(() => {
    const real = fs.realpathSync(root);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-sender-migration-')
    )
      throw Error('清理越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  const source = path.join(legacy, kind, id),
    target = path.join(root, 'extensions', kind, id);
  const manifestName = fs.existsSync(path.join(source, 'plugin.json')) ? 'plugin.json' : 'skill.json';
  const manifest = JSON.parse(fs.readFileSync(path.join(source, manifestName), 'utf8'));
  await compileLegacyPackage(source, target);
  fs.writeFileSync(
    path.join(target, manifestName),
    JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
  );
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  prepare?.(dataDir);
  const app = await createApplication({
    dataDir,
    v2ExtensionDir: path.join(root, 'extensions'),
    extensionHotReload: false,
    extensionFetch,
  });
  cleanup.push(app.stop);
  app.runtime.use(configService).patch({ send: { minIntervalMs: 0, maxIntervalMs: 0, byLengthMs: 0 } });
  return {
    ...app,
    dataDir,
    host: app.runtime.use(extensionService),
    adapter: app.runtime.use(adapterService),
  };
}
async function until(fn: () => boolean) {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw Error('等待旧包结果超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}
test.skipIf(!fs.existsSync(legacy))(
  '旧发送包装参与真实数组批次，关闭后恢复；不提前发出捕获消息',
  async () => {
    const f = await boot('hell-joke');
    await f.host.configure('hell-joke', { enabled: true, settings: { alwaysOn: true } });
    await f.host.runHook('before-context', { chatKey: 'group:1', triggerEntries: [] }, 'group:1');
    expect(f.adapter.sent).toHaveLength(0);
    const send = async () => {
      const run = f.runtime.submit({
        mode: 'command.direct',
        partitionKey: 'group:1',
        input: {
          chatKey: 'group:1',
          tool: 'send_message',
          args: { messages: ['第一条测试内容。\n\n第二条测试内容。'] },
        },
      });
      return f.runtime.wait(run.id);
    };
    expect((await send()).status).toBe('completed');
    expect(f.adapter.sent!.map((s) => s.text)).toEqual(['第一条测试内容。', '第二条测试内容。']);
    await f.host.configure('hell-joke', { enabled: false });
    await send();
    expect(f.adapter.sent!.at(-1)?.text).toBe('第一条测试内容。\n\n第二条测试内容。');
  },
);
test.skipIf(!fs.existsSync(legacy))('旧体力查询使用公开发送运行，只发送一次真实回执并归档', async () => {
  const f = await boot('stamina', 'skills');
  await f.host.configure('stamina', { enabled: true });
  await f.runtime.use(conversationService).ingest({
    id: 'stamina-query',
    chatKey: 'group:1',
    senderId: '2',
    senderName: 'test',
    atMe: true,
    text: '查询体力',
    timestamp: Date.now(),
  });
  await until(() => f.runtime.use(storageService).archives().length > 0);
  expect(f.adapter.sent).toHaveLength(1);
  expect(f.adapter.sent![0]?.text).toContain('体力');
});
test.skipIf(!fs.existsSync(legacy))('旧好感度群查询经过入站拦截，名称与档位回执只发一次', async () => {
  const f = await boot('qianyeyue-affinity');
  await f.host.configure('qianyeyue-affinity', { enabled: true });
  await f.runtime.use(conversationService).ingest({
    id: 'affinity-query',
    chatKey: 'group:1',
    senderId: '2',
    senderName: 'test',
    atMe: true,
    text: '查询好感度',
    timestamp: Date.now(),
  });
  expect(f.adapter.sent).toHaveLength(1);
  expect(f.adapter.sent![0]?.text).toContain('在我这儿');
  expect(f.runtime.listRuns().filter((r) => r.mode === 'agent.basic')).toEqual([]);
});
test.skipIf(!fs.existsSync(legacy))('旧表情上限同步后剔除名单持久化，停用后原收藏可重新同步', async () => {
  const entries = [
    { id: 'keep', url: 'https://example.com/keep.png' },
    { id: 'drop', url: 'https://example.com/drop.png' },
  ];
  const f = await boot('sticker-cap', 'plugins', (data) =>
    fs.writeFileSync(path.join(data, 'stickers.json'), JSON.stringify(entries)),
  );
  f.adapter.query = async (action) => (action === 'fetch_custom_face_detail' ? entries : {});
  await f.host.configure('sticker-cap', { enabled: true, settings: { blockedIds: 'drop' } });
  const stickers = f.runtime.use(stickerService);
  await stickers.refresh();
  expect(stickers.entries().map((s) => s.id)).toEqual(['keep']);
  expect(
    JSON.parse(fs.readFileSync(path.join(f.dataDir, 'stickers.json'), 'utf8')).map((s: any) => s.id),
  ).toEqual(['keep']);
  await f.host.configure('sticker-cap', { enabled: false });
  await stickers.refresh();
  expect(
    stickers
      .entries()
      .map((s) => s.id)
      .sort(),
  ).toEqual(['drop', 'keep']);
});
test.skipIf(!fs.existsSync(legacy))(
  '旧自己上网读取绑定会话、使用公共搜索及模型、发送走outbound；演练不发送',
  async () => {
    const fetched: string[] = [];
    const f = await boot('self-surf', 'skills', undefined, async (url) => {
      fetched.push(url);
      return new Response('<article>' + '公开资料正文。'.repeat(100) + '</article>', {
        headers: { 'content-type': 'text/html' },
      });
    });
    const config = f.runtime.use(configService);
    config.saveProfile('group:1', {});
    config.saveProfile('group:2', {});
    await f.host.configure('self-surf', {
      enabled: true,
      settings: { targetChat: 'group:1', quietHours: '', maxPages: 1 },
    });
    f.runtime.use(storageService).append({
      id: 'surf-context',
      chatKey: 'group:1',
      senderId: '2',
      senderName: 'fixture',
      text: '聊聊新的科学发现',
      atMe: false,
      timestamp: Date.now(),
    });
    f.runtime.use(storageService).append({
      id: 'private-other',
      chatKey: 'group:2',
      senderId: '3',
      senderName: 'other',
      text: 'OTHER_SESSION_SECRET',
      atMe: false,
      timestamp: Date.now(),
    });
    let calls = 0;
    f.runtime.use(modelService).complete = async (messages) => {
      expect(JSON.stringify(messages)).not.toContain('OTHER_SESSION_SECRET');
      return {
        usage: { input: 1, output: 1 },
        message: {
          role: 'assistant',
          content:
            calls++ % 2 === 0
              ? '{"topic":"fixture topic","query":"fixture search","why":"test"}'
              : '从公开资料得到的测试结论。',
        },
      };
    };
    f.runtime.use(webService).search = async () => ({
      results: [{ title: 'fixture title', url: 'https://93.184.216.34/fixture', snippet: 'fixture' }],
    });
    const invoke = async (dry: boolean) => {
      const run = f.runtime.submit({
        mode: 'command.direct',
        partitionKey: 'group:1',
        input: { chatKey: 'group:1', tool: 'self-surf__surf_now', args: { dry } },
      });
      return (await f.runtime.wait(run.id)).result as any;
    };
    expect(await invoke(false)).not.toHaveProperty('isError', true);
    expect(f.adapter.sent).toHaveLength(1);
    expect(f.adapter.sent![0]!.text).toContain('公开资料得到');
    expect(await invoke(true)).not.toHaveProperty('isError', true);
    expect(f.adapter.sent).toHaveLength(1);
    expect(calls).toBe(4);
    expect(fetched).toEqual(['https://93.184.216.34/fixture', 'https://93.184.216.34/fixture']);
  },
);
test.skipIf(!fs.existsSync(legacy))('旧长期记忆工具提交异步维护申请，保留版本冲突与会话隔离', async () => {
  const f = await boot('long-memory', 'skills');
  await f.host.configure('long-memory', { enabled: true });
  const invoke = async (name: string, args: unknown, chatKey = 'group:1') => {
    const run = f.runtime.submit({
      mode: 'command.direct',
      partitionKey: chatKey,
      input: { chatKey, tool: 'long-memory__' + name, args },
    });
    return (await f.runtime.wait(run.id)).result as any;
  };
  const saved = await invoke('save', {
    items: [{ category: 'profile', key: '饮品', content: '喜欢牛奶', evidence: '用户明确说喜欢牛奶' }],
  });
  expect(saved.isError).not.toBe(true);
  const accepted = JSON.parse(saved.content);
  expect(accepted.accepted).toBe(true);
  expect((await waitMemoryRequest(f as any, accepted.requestId)).status).toBe('completed');
  const memory = f.runtime.use(memoryService);
  const record = memory.list('group:1').find((r) => r.key === 'legacy:profile:饮品')!;
  expect(record.tier).toBe('short');
  expect(fs.existsSync(path.join(f.dataDir, 'long-memory/memory.sqlite'))).toBe(false);
  const changed = await invoke('update', {
    id: record.id,
    revision: record.revision,
    content: '改为喜欢豆浆',
    evidence: '用户更正',
  });
  expect(changed.isError).not.toBe(true);
  expect((await waitMemoryRequest(f as any, JSON.parse(changed.content).requestId)).status).toBe('completed');
  expect(memory.list('group:1').find((r) => r.id === record.id)?.text).toBe('改为喜欢豆浆');
  const notes = memory.notes('group:1').length;
  expect(
    (await invoke('update', { id: record.id, revision: 99, content: '错误修改', evidence: '错误' })).isError,
  ).toBe(true);
  expect(memory.notes('group:1')).toHaveLength(notes);
  expect((await invoke('forget', { ids: [record.id] }, 'group:2')).isError).toBe(true);
  memory.publishDrafts('group:1');
  expect(memory.list('group:1').find((r) => r.key === 'legacy:profile:饮品')?.text).toBe('改为喜欢豆浆');
  const current = memory.list('group:1').find((r) => r.key === 'legacy:profile:饮品')!;
  const forgotten = await invoke('forget', { ids: [current.id] });
  expect(forgotten.isError).not.toBe(true);
  expect((await waitMemoryRequest(f as any, JSON.parse(forgotten.content).requestId)).status).toBe(
    'completed',
  );
  expect(memory.list('group:1').some((r) => r.key === 'legacy:profile:饮品')).toBe(false);
});
