import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  accessService,
  configService,
  memoryIndex,
  memoryRepository,
  memoryService,
  modelService,
  storageService,
  toolService,
} from '@qq-harness/domain';
import { createApplication } from '../apps/server/src/app.js';
import { createMemoryService, indexable } from '../plugins/agent-memory/src/service.js';
import { fileMemoryRepository } from '../plugins/storage-file/src/memory.js';
import { openSqliteStorage } from '@qq-harness/storage-sqlite';
import type { MemoryRecord } from '@qq-harness/contracts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-memory-'));
async function boot(extra: Partial<Parameters<typeof createApplication>[0]> = {}) {
  const app = await createApplication({ dataDir: root(), ...extra });
  cleanup.push(() => app.stop());
  return app;
}
async function until<T>(read: () => T, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error('等待记忆后台任务超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const sample = (
  chatKey = 'group:1',
): Omit<MemoryRecord, 'id' | 'revision' | 'createdAt' | 'updatedAt' | 'lastConfirmedAt' | 'status'> => ({
  scope: 'chat',
  tier: 'long',
  chatKey,
  personId: null,
  key: 'topic',
  text: '喜欢猫',
  visibility: 'chat_only',
  sensitive: false,
  confidence: 0.8,
  importance: 0.5,
  pinned: false,
  sources: [],
  origin: 'admin',
  expiresAt: null,
});

test('SQLite 与文件仓储保留修订、待索引事件、游标及记事本到期', () => {
  for (const kind of ['sqlite', 'file'] as const) {
    const dir = root();
    const sqlite = kind === 'sqlite' ? openSqliteStorage(path.join(dir, 'data.sqlite')) : undefined;
    const repo = sqlite?.memory ?? fileMemoryRepository(dir);
    const now = Date.now();
    const initial: MemoryRecord = {
      ...sample(),
      id: crypto.randomUUID(),
      status: 'active',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      lastConfirmedAt: now,
    };
    repo.saveRecord(initial, 0);
    repo.saveRecord({ ...initial, text: '改为喜欢狗', revision: 2, updatedAt: now + 1 }, 1);
    expect(repo.history(initial.id).map((entry) => entry.record.revision)).toEqual([2, 1]);
    expect(repo.indexEvents(0, 10).map((event) => event.revision)).toEqual([1, 2]);
    expect(() => repo.saveRecord({ ...initial, revision: 2 }, 1)).toThrow('版本冲突');
    repo.setCursor('group:1', 10);
    repo.setCursor('group:1', 9);
    expect(repo.cursor('group:1')).toBe(10);
    const note = {
      id: crypto.randomUUID(),
      chatKey: 'group:1',
      text: '暂存',
      important: false,
      promotion: 'none' as const,
      sourceIds: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 1000,
      revision: 1,
    };
    repo.saveNote(note, 0);
    expect(repo.expireNotes(now + 999)).toBe(0);
    expect(repo.expireNotes(now + 1000)).toBe(1);
    expect(repo.note(note.id)).toBeUndefined();
    sqlite?.close();
    if (kind === 'file') expect(fileMemoryRepository(dir).record(initial.id)?.revision).toBe(2);
  }
});

test('三个维度隔离、旧文本兼容、敏感及私聊来源不跨会话', async () => {
  const app = await boot();
  const memory = app.runtime.use(memoryService),
    storage = app.runtime.use(storageService);
  const groupMessage = storage.append({
    id: 'm1',
    chatKey: 'group:1',
    senderId: '42',
    senderName: '甲',
    text: '我喜欢猫',
    atMe: false,
    timestamp: Date.now(),
  });
  storage.append({
    id: 'm2',
    chatKey: 'group:2',
    senderId: '42',
    senderName: '甲',
    text: '在吗',
    atMe: false,
    timestamp: Date.now(),
  });
  const local = memory.remember({
    ...sample(),
    scope: 'chat_person',
    personId: '42',
    key: 'group-role',
    text: '只在一群当管理员',
    sources: [{ chatKey: 'group:1', localId: groupMessage.localId, senderId: '42' }],
  });
  const global = memory.remember({
    ...sample(),
    scope: 'person',
    chatKey: null,
    personId: '42',
    key: 'likes-cats',
    text: '喜欢猫',
    visibility: 'cross_chat',
    sources: [{ chatKey: 'group:1', localId: groupMessage.localId, senderId: '42' }],
  });
  storage.setMemory('group:1', '旧版约定：周末讨论');
  expect((await memory.search('group:1', '管理员', '42')).map((item) => item.record.id)).toContain(local.id);
  expect((await memory.search('group:2', '管理员', '42')).map((item) => item.record.id)).not.toContain(
    local.id,
  );
  expect((await memory.search('group:2', '猫', '42')).map((item) => item.record.id)).toContain(global.id);
  expect((await memory.search('group:1', '周末')).some((item) => item.record.key === 'legacy-text')).toBe(
    true,
  );
  expect(() =>
    memory.remember({
      ...sample(),
      scope: 'person',
      chatKey: null,
      personId: '42',
      visibility: 'cross_chat',
      sensitive: true,
    }),
  ).toThrow('敏感');
  expect(() =>
    memory.remember({
      ...sample(),
      scope: 'person',
      chatKey: null,
      personId: '42',
      visibility: 'cross_chat',
      origin: 'automatic',
      sources: [{ chatKey: 'private:42', localId: 1, senderId: '42' }],
    }),
  ).toThrow('私聊');
  await expect(memory.search('group:2', '猫', '99')).rejects.toThrow('不属于当前会话');
  expect(() => memory.list('group:2', '99')).toThrow('不属于当前会话');
  expect(() => memory.history(local.id, 'group:2')).toThrow('不属于当前会话');
  app.runtime.use(configService).patch({ deniedChats: ['group:1'] });
  expect((await memory.search('group:2', '猫', '42')).map((item) => item.record.id)).not.toContain(global.id);
  expect(memory.list('group:2', '42').map((record) => record.id)).not.toContain(global.id);
  expect(() => memory.history(global.id, 'group:2')).toThrow('不属于当前会话');
  const allowed = memory.remember({ ...sample('group:2'), key: 'cat-plan', text: '猫主题日程' });
  const baseIndex = app.runtime.use(memoryIndex);
  const ignoringHints = {
    ...baseIndex,
    id: 'ignoring-hints',
    health: () => ({ ready: true }),
    search: async () => [
      { id: global.id, relevance: 1 },
      { id: allowed.id, relevance: 0.7 },
    ],
  };
  const guarded = createMemoryService({
    repo: app.runtime.use(memoryRepository),
    index: ignoringHints,
    storage,
    access: app.runtime.use(accessService),
    config: app.runtime.use(configService),
    onImportant: () => {},
    onChanged: () => {},
  });
  expect((await guarded.search('group:2', '猫', '42')).map((item) => item.record.id)).toEqual([allowed.id]);
  expect(memory.remove(global.id).status).toBe('deleted');
  expect(memory.remove(local.id).status).toBe('deleted');
});

test('暂存修改重置到期，重要项凭来源整理成中期记忆', async () => {
  const app = await boot();
  const memory = app.runtime.use(memoryService),
    repo = app.runtime.use(memoryRepository);
  const message = app.runtime.use(storageService).append({
    id: 'note-source',
    chatKey: 'group:1',
    senderId: '42',
    senderName: '甲',
    text: '下周讨论旅行',
    atMe: false,
    timestamp: Date.now(),
  });
  const note = memory.note('group:1', '下周讨论旅行', [message.localId], 20 * 86_400_000);
  expect(note.expiresAt - note.updatedAt).toBeLessThanOrEqual(7 * 86_400_000);
  const changed = memory.updateNote('group:1', note.id, { text: '下周继续讨论旅行', important: true });
  expect(changed.updatedAt).toBeGreaterThanOrEqual(note.updatedAt);
  await until(
    () => repo.note(note.id)?.promotion,
    (value) => value === 'done',
  );
  expect(
    repo.records().some((record) => record.key === `scratchpad:${note.id}` && record.tier === 'medium'),
  ).toBe(true);
  const edited = memory.updateNote('group:1', note.id, { text: '改为下周讨论路线' });
  await until(
    () => repo.note(note.id)?.promotion,
    (value) => value === 'done',
  );
  expect(
    repo.records().find((record) => record.key === `scratchpad:${note.id}` && record.status === 'active')
      ?.text,
  ).toBe('改为下周讨论路线');
  expect(repo.expireNotes(edited.expiresAt)).toBe(1);
  expect(memory.notes('group:1')).toEqual([]);
});

test('索引仅供候选：删除项、故障索引及旧版本写入不会成为事实', async () => {
  const app = await boot();
  const memory = app.runtime.use(memoryService),
    repo = app.runtime.use(memoryRepository);
  const index = app.runtime.use(memoryIndex);
  const record = memory.remember(sample());
  await until(
    () => memory.indexStatus().pending,
    (value) => value === 0,
  );
  expect(
    (await index.search('猫', { chatKey: 'group:1', personIds: [], allowedIds: [record.id] }, 10))[0]?.id,
  ).toBe(record.id);
  memory.remove(record.id);
  await until(
    () => memory.indexStatus().pending,
    (value) => value === 0,
  );
  await index.upsert(indexable(record));
  expect(
    await index.search('猫', { chatKey: 'group:1', personIds: [], allowedIds: [record.id] }, 10),
  ).toEqual([]);
  const active = memory.remember({ ...sample(), key: 'new', text: '喜欢狗' });
  const failing = {
    ...index,
    id: 'broken',
    health: () => ({ ready: true }),
    search: async () => {
      throw new Error('索引故障');
    },
  };
  const fallback = createMemoryService({
    repo,
    index: failing,
    storage: app.runtime.use(storageService),
    access: app.runtime.use(accessService),
    config: app.runtime.use(configService),
    onImportant: () => {},
    onChanged: () => {},
  });
  expect((await fallback.search('group:1', '狗')).map((item) => item.record.id)).toContain(active.id);
  expect(repo.record(record.id)?.status).toBe('deleted');
});

test('已准入的全部消息后台聚批提炼，重启后按游标续处理', async () => {
  const extractor = definePlugin({
    id: 'test-memory-extractor',
    setup(ctx) {
      ctx.provide(modelService, {
        complete: async (messages) => {
          const body = String(messages.at(-1)?.content ?? '');
          const first = Number(body.split('\n')[0]?.split(' | ')[0]);
          return {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                candidates: [
                  {
                    scope: 'person',
                    tier: 'long',
                    key: 'cats',
                    text: '喜欢猫',
                    personId: '42',
                    sensitive: false,
                    direct: true,
                    confidence: 0.9,
                    importance: 0.7,
                    sourceIds: [first],
                  },
                ],
              }),
            },
            usage: { input: 0, output: 0 },
          };
        },
      });
    },
  });
  const app = await boot({
    initialConfig: { acceptAllSessions: true, plugins: { 'model-mock': false } },
    plugins: [extractor],
  });
  const conversation = app.runtime.use({
    id: 'harness.conversation',
  } as typeof import('@qq-harness/domain').conversationService);
  for (let index = 0; index < 30; index++)
    await conversation.ingest({
      id: `batch-${index}`,
      chatKey: 'group:1',
      senderId: '42',
      senderName: '甲',
      text: index === 0 ? '我喜欢猫' : '普通消息',
      atMe: false,
      timestamp: Date.now(),
    });
  const repo = app.runtime.use(memoryRepository);
  await until(
    () => repo.cursor('group:1'),
    (cursor) => cursor >= 30,
  );
  expect(repo.records().filter((record) => record.key === 'cats')).toHaveLength(1);
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .some((tool) => tool.function.name === 'memory_search'),
  ).toBe(true);
});

test('管理 API 读写结构化记忆、记事本和旧文本，并拒绝陈旧修订', async () => {
  const app = await boot({ token: 'memory-test-token' });
  const request = (url: string, init: RequestInit = {}) =>
    app.app.request(`http://127.0.0.1${url}`, {
      ...init,
      headers: { Authorization: 'Bearer memory-test-token', ...init.headers },
    });
  expect((await app.app.request('http://127.0.0.1/api/memory/status')).status).toBe(401);
  const created = await request('/api/memory/records', { method: 'POST', body: JSON.stringify(sample()) });
  expect(created.status).toBe(201);
  const record = (await created.json()) as MemoryRecord;
  expect(
    ((await (await request('/api/memory/records?chatKey=group%3A1')).json()) as MemoryRecord[]).map(
      (item) => item.id,
    ),
  ).toContain(record.id);
  const conflict = await request(`/api/memory/records/${record.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expectedRevision: 2,
      patch: { text: '错误版本' },
    }),
  });
  expect(conflict.status).toBe(409);
  const edited = await request(`/api/memory/records/${record.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expectedRevision: 1,
      patch: { text: '喜欢狗' },
    }),
  });
  expect(((await edited.json()) as MemoryRecord).revision).toBe(2);
  const note = (await (
    await request('/api/memory/notes', {
      method: 'POST',
      body: JSON.stringify({
        chatKey: 'group:1',
        text: '临时事项',
      }),
    })
  ).json()) as { id: string };
  expect((await request(`/api/memory/notes/${note.id}?chatKey=group%3A1`, { method: 'DELETE' })).status).toBe(
    200,
  );
  expect(await (await request('/api/memory/notes?chatKey=group%3A1')).json()).toEqual([]);
  await request('/api/chats/group%3A1/memory', {
    method: 'PATCH',
    body: JSON.stringify({ text: '旧文本约定' }),
  });
  expect(await (await request('/api/chats/group%3A1/memory')).json()).toEqual({ text: '旧文本约定' });
  expect(
    ((await (await request('/api/memory/records?chatKey=group%3A1')).json()) as MemoryRecord[]).some(
      (item) => item.key === 'legacy-text',
    ),
  ).toBe(true);
});

test('替换索引提供器且重建失败时仍可从权威仓储查询', async () => {
  const broken = definePlugin({
    id: 'memory-index-broken-test',
    setup(ctx) {
      ctx.provide(memoryIndex, {
        id: 'broken-test',
        upsert: async () => {
          throw new Error('离线');
        },
        remove: async () => {
          throw new Error('离线');
        },
        search: async () => {
          throw new Error('离线');
        },
        rebuild: async () => {
          throw new Error('离线');
        },
        health: () => ({ ready: false, error: '离线' }),
      });
    },
  });
  const app = await boot({ memoryIndex: broken });
  const memory = app.runtime.use(memoryService);
  const record = memory.remember(sample());
  expect(memory.indexStatus().provider).toBe('broken-test');
  expect((await memory.search('group:1', '猫')).map((item) => item.record.id)).toContain(record.id);
  expect(app.runtime.listPlugins().find((item) => item.id === 'agent-memory')?.status).toBe('active');
});

test('提炼失败不推进游标，下一条消息触发重试且不复制事实', async () => {
  let attempts = 0;
  const extractor = definePlugin({
    id: 'test-memory-retry-model',
    setup(ctx) {
      ctx.provide(modelService, {
        complete: async () => {
          attempts++;
          if (attempts === 1) throw new Error('模拟短暂失败');
          return {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                candidates: [
                  {
                    scope: 'chat',
                    tier: 'medium',
                    key: 'topic',
                    text: '讨论旅行',
                    personId: null,
                    sensitive: false,
                    direct: false,
                    confidence: 0.7,
                    importance: 0.5,
                    sourceIds: [1, 2],
                  },
                ],
              }),
            },
            usage: { input: 0, output: 0 },
          };
        },
      });
    },
  });
  const app = await boot({
    initialConfig: { acceptAllSessions: true, plugins: { 'model-mock': false } },
    plugins: [extractor],
  });
  const conversation = app.runtime.use({
    id: 'harness.conversation',
  } as typeof import('@qq-harness/domain').conversationService);
  for (let index = 0; index < 30; index++)
    await conversation.ingest({
      id: `retry-${index}`,
      chatKey: 'group:1',
      senderId: '42',
      senderName: '甲',
      text: '旅行',
      atMe: false,
      timestamp: Date.now(),
    });
  await until(
    () => attempts,
    (value) => value >= 1,
  );
  expect(app.runtime.use(memoryRepository).cursor('group:1')).toBe(0);
  await conversation.ingest({
    id: 'retry-next',
    chatKey: 'group:1',
    senderId: '42',
    senderName: '甲',
    text: '继续',
    atMe: false,
    timestamp: Date.now(),
  });
  const repo = app.runtime.use(memoryRepository);
  await until(
    () => repo.cursor('group:1'),
    (value) => value >= 30,
  );
  expect(repo.records().filter((record) => record.key === 'topic')).toHaveLength(1);
  expect(attempts).toBe(2);
});

test('模型每轮只收到按需检索指引，不预注入记忆正文', async () => {
  const prompts: string[] = [];
  const model = definePlugin({
    id: 'test-memory-prompt-model',
    setup(ctx) {
      ctx.provide(modelService, {
        complete: async (messages) => {
          prompts.push(messages.map((message) => message.content ?? '').join('\n'));
          return {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: crypto.randomUUID(),
                  type: 'function',
                  function: {
                    name: 'finish',
                    arguments: JSON.stringify({ mode: 'silent', reason: '测试' }),
                  },
                },
              ],
            },
            usage: { input: 0, output: 0 },
          };
        },
      });
    },
  });
  const app = await boot({
    initialConfig: { acceptAllSessions: true, plugins: { 'model-mock': false } },
    plugins: [model],
  });
  app.runtime.use(memoryService).remember({ ...sample(), text: '私人测试正文不应直接出现' });
  await app.runtime
    .use({ id: 'harness.conversation' } as typeof import('@qq-harness/domain').conversationService)
    .ingest({
      id: 'wake',
      chatKey: 'group:1',
      senderId: '42',
      senderName: '甲',
      text: '帮我回答',
      atMe: true,
      timestamp: Date.now(),
    });
  await until(
    () => app.runtime.use(storageService).archives().length,
    (value) => value > 0,
  );
  expect(prompts[0]).toContain('memory_search');
  expect(prompts[0]).not.toContain('私人测试正文不应直接出现');
});

test('文件存储模式重启后可读取结构化记忆和暂存', async () => {
  const dataDir = root();
  const first = await createApplication({ dataDir, storage: 'files' });
  const memory = first.runtime.use(memoryService);
  const record = memory.remember(sample());
  const note = memory.note('group:1', '重启后还在');
  await first.stop();
  const second = await createApplication({ dataDir, storage: 'files' });
  cleanup.push(() => second.stop());
  expect(
    second.runtime
      .use(memoryService)
      .list('group:1')
      .map((item) => item.id),
  ).toContain(record.id);
  expect(
    second.runtime
      .use(memoryService)
      .notes('group:1')
      .map((item) => item.id),
  ).toContain(note.id);
});
