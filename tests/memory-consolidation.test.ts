import { waitMemoryRequest } from './fixtures/memory-task.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  configService,
  memoryService,
  memoryAgentService,
  memoryRepository,
  modelService,
  storageService,
  conversationService,
} from '@qq-harness/domain';
import { createApplication } from '../apps/server/src/app.js';
import type { MemoryRecord } from '@qq-harness/contracts';
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop();
  vi.useRealTimers();
});
const sample = (): Parameters<import('@qq-harness/domain').MemoryService['remember']>[0] => ({
  scope: 'chat',
  tier: 'long',
  chatKey: 'group:1',
  personId: null,
  key: 'drink',
  text: '喜欢茶',
  visibility: 'chat_only',
  sensitive: false,
  confidence: 0.8,
  importance: 0.8,
  pinned: false,
  sources: [],
  origin: 'admin',
  expiresAt: null,
});
async function boot(options: Partial<Parameters<typeof createApplication>[0]> = {}) {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-three-tier-')),
    extensionHotReload: false,
    v2Managers: false,
    initialConfig: {
      acceptAllSessions: true,
      admissions: ['group:1'],
      defaults: {
        memory: {
          shortIntervalMs: 1000,
          mediumIntervalMs: 2000,
          longIntervalMs: 4000,
          shortRetentionMs: 60000,
          mediumRetentionMs: 120000,
        },
      },
    },
    ...options,
  });
  apps.push(app);
  return app;
}
test('默认间隔、独立会话快照及记忆间隔继承互不混淆', async () => {
  const app = await boot({ initialConfig: { acceptAllSessions: true } }),
    cfg = app.runtime.use(configService);
  expect(cfg.effective('group:1').memory).toMatchObject({
    shortIntervalMs: 1800000,
    mediumIntervalMs: 7200000,
    longIntervalMs: 21600000,
    shortRetentionMs: 86400000,
    mediumRetentionMs: 2592000000,
  });
  cfg.saveProfile('group:1', { persona: '独立人设' });
  cfg.patch({ defaults: { persona: '新的默认', memory: { shortIntervalMs: 60000 } } });
  expect(cfg.effective('group:1').persona).toBe('独立人设');
  expect(cfg.effective('group:1').memory.shortIntervalMs).toBe(60000);
  cfg.saveMemorySchedule('group:1', { shortIntervalMs: 120000 });
  cfg.patch({ defaults: { memory: { mediumIntervalMs: 3600000 } } });
  expect(cfg.effective('group:1').memory).toMatchObject({
    shortIntervalMs: 120000,
    mediumIntervalMs: 3600000,
  });
  cfg.saveMemorySchedule('group:1', null);
  expect(cfg.effective('group:1').memory.shortIntervalMs).toBe(60000);
});
test('草稿整理前不生效，短期更正按阶段传播且旧中长期不能重新命中', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  const app = await boot(),
    memory = app.runtime.use(memoryService),
    repo = app.runtime.use(memoryRepository);
  const original = memory.remember(sample());
  const draft = memory.update(original.id, { text: '喜欢咖啡' }, 1);
  expect(draft.status).toBe('pending');
  expect((await memory.search('group:1', '茶'))[0]?.record.id).toBe(original.id);
  expect(await memory.search('group:1', '咖啡')).toEqual([]);
  expect(() => memory.update(original.id, { text: '冲突' }, 1)).toThrow('待整理草稿');
  await vi.advanceTimersByTimeAsync(1000);
  expect(memory.drafts('group:1')[0]?.status).toBe('published');
  expect((await memory.search('group:1', '咖啡'))[0]?.record.tier).toBe('short');
  expect(await memory.search('group:1', '茶')).toEqual([]);
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .map((r) => r.tier),
  ).toEqual(['short']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .map((r) => r.tier),
  ).toEqual(['short', 'medium']);
  await vi.advanceTimersByTimeAsync(2000);
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .map((r) => r.tier),
  ).toEqual(['short', 'medium', 'long']);
  const latest = memory.list('group:1').filter((r) => r.document?.role !== 'persona');
  expect(latest.every((r) => r.factVersion! >= 1)).toBe(true);
  expect(latest.filter((r) => r.tier !== 'short').every((r) => !!r.document)).toBe(true);
  expect(latest.find((r) => r.tier === 'long')?.derivedFrom).toEqual([
    { id: latest.find((r) => r.tier === 'medium')!.id, revision: 1 },
  ]);
  await vi.advanceTimersByTimeAsync(121000);
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .map((r) => r.tier),
  ).toEqual(['long']);
  expect((await memory.search('group:1', '咖啡'))[0]?.record.tier).toBe('long');
  const record = memory.list('group:1').filter((r) => r.document?.role !== 'persona')[0]!;
  memory.remove(record.id, record.revision);
  expect(memory.list('group:1').filter((r) => r.document?.role !== 'persona')).toEqual([]);
  await vi.advanceTimersByTimeAsync(4000);
  expect(repo.records().some((r) => r.tier === 'long' && r.status === 'deleted')).toBe(true);
});
test('手工笔记无需消息来源，编辑与删除经短期整理传播且修订保留', async () => {
  const app = await boot(),
    memory = app.runtime.use(memoryService),
    repo = app.runtime.use(memoryRepository);
  const note = memory.note('group:1', '周五讨论预算');
  expect(note.sourceIds).toEqual([]);
  expect(memory.list('group:1').filter((r) => r.document?.role !== 'persona')).toEqual([]);
  expect((await waitMemoryRequest(app, memory.consolidate('group:1'))).status).toBe('completed');
  const records = memory.list('group:1').filter((r) => r.document?.role !== 'persona');
  expect(records.map((r) => r.tier)).toEqual(['short']);
  await waitMemoryRequest(app, memory.consolidate('group:1', 'medium'));
  await waitMemoryRequest(app, memory.consolidate('group:1', 'long'));
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .filter((r) => r.tier !== 'short')
      .every((r) => !!r.document),
  ).toBe(true);
  expect(records[0]?.sources[0]).toMatchObject({ noteId: note.id, noteRevision: 1 });
  memory.updateNote('group:1', note.id, { text: '周六讨论预算' });
  expect(memory.list('group:1').filter((r) => r.document?.role !== 'persona')[0]?.text).toBe('周五讨论预算');
  await waitMemoryRequest(app, memory.consolidate('group:1', 'short'));
  expect(
    memory
      .list('group:1')
      .filter((r) => r.tier === 'short')
      .map((r) => r.text),
  ).toEqual(['周六讨论预算']);
  await waitMemoryRequest(app, memory.consolidate('group:1'));
  memory.deleteNote('group:1', note.id);
  await waitMemoryRequest(app, memory.consolidate('group:1'));
  expect(memory.list('group:1').filter((r) => r.document?.role !== 'persona').length).toBeGreaterThan(0);
  expect(repo.note(note.id)?.status).toBe('deleted');
  expect(memory.notes('group:1', true).find((n) => n.id === note.id)?.status).toBe('deleted');
  expect(memory.noteHistory('group:1', note.id).length).toBeGreaterThanOrEqual(4);
});

test('旧文本按段无损导入，修改也先进入草稿，取消自动整理仍允许手动整理', async () => {
  const app = await boot(),
    storage = app.runtime.use(storageService),
    memory = app.runtime.use(memoryService),
    repo = app.runtime.use(memoryRepository);
  const original = '甲'.repeat(8100);
  storage.setMemory('group:1', original);
  await waitMemoryRequest(app, memory.consolidate('group:1', 'short'));
  const records = memory.list('group:1').filter((r) => r.document?.role !== 'persona');
  expect(records).toHaveLength(3);
  expect(records.map((r) => r.text).join('')).toBe(original);
  memory.list('group:1').filter((r) => r.document?.role !== 'persona');
  expect(repo.records().filter((r) => r.key.startsWith('legacy-text'))).toHaveLength(3);
  const first = records.find((r) => r.key === 'legacy-text:0001')!;
  memory.update(first.id, { text: '更正' }, first.revision);
  expect(storage.memory('group:1')).toBe(original);
  app.runtime.use(configService).saveMemorySchedule('group:1', { enabled: false });
  expect((await waitMemoryRequest(app, memory.consolidate('group:1', 'short'))).status).toBe('completed');
  const view = (await (await app.app.request('http://127.0.0.1/api/chats/group%3A1/memory')).json()) as {
    text: string;
  };
  expect(view.text).toBe('更正' + '甲'.repeat(4100));
  expect(memory.history(first.id, 'group:1').some((h) => h.record.text === '更正')).toBe(true);
});

test('对话模型通过申请新增和更正，受理与实际生效可区分', async () => {
  const app = await boot(),
    memory = app.runtime.use(memoryService),
    agent = app.runtime.use(memoryAgentService);
  const first = agent.request({
    chatKey: 'group:1',
    tier: 'short',
    instruction: '记录：' + JSON.stringify({ key: 'drink', text: '喜欢茶' }),
  });
  expect(first.status).toBe('queued');
  expect(memory.list('group:1').some((r) => r.key === 'drink')).toBe(false);
  expect((await waitMemoryRequest(app, first.id)).status).toBe('completed');
  const prior = memory.list('group:1').find((r) => r.key === 'drink')!;
  const second = agent.request({
    chatKey: 'group:1',
    tier: 'short',
    targetIds: [prior.id],
    instruction: '更正：' + JSON.stringify({ text: '喜欢咖啡' }),
  });
  expect(memory.list('group:1').find((r) => r.id === prior.id)?.text).toBe('喜欢茶');
  expect((await waitMemoryRequest(app, second.id)).status).toBe('completed');
  expect(memory.list('group:1').find((r) => r.id === prior.id)?.text).toBe('喜欢咖啡');
});

test('整理失败不推进游标，定时重试只提交一次事实并记录用量', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  let calls = 0;
  const extractor = definePlugin({
    id: 'test-tier-extractor',
    setup(ctx) {
      ctx.provide(modelService, {
        complete: async () => {
          calls++;
          if (calls === 1) throw new Error('mock failure');
          return {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                candidates: [{ scope: 'chat', key: 'topic', text: '讨论旅行', sourceIds: [1] }],
              }),
            },
            usage: { input: 12, output: 5 },
          };
        },
      });
    },
  });
  const app = await boot({
    plugins: [extractor],
    initialConfig: {
      acceptAllSessions: true,
      admissions: ['group:1'],
      plugins: { 'model-mock': false },
      defaults: { memory: { shortIntervalMs: 1000, mediumIntervalMs: 600000, longIntervalMs: 600000 } },
    },
  });
  app.runtime.use(storageService).append({
    id: 'source',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '讨论旅行',
    atMe: false,
    timestamp: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(1);
  expect(app.runtime.use(memoryRepository).cursor('group:1')).toBe(0);
  expect(app.runtime.use(memoryService).consolidation('group:1').stages.short.lastFailureAt).toBeDefined();
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(2);
  expect(app.runtime.use(memoryRepository).cursor('group:1')).toBe(1);
  expect(
    app.runtime
      .use(memoryService)
      .list('group:1')
      .filter((r) => r.tier === 'short'),
  ).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toBe(2);
  expect(
    app.runtime
      .use(storageService)
      .archives()
      .some((a) => a.mode === 'memory.agent' && a.usage.input === 12),
  ).toBe(true);
});
test('重启补做过期计划一次，草稿、笔记与游标不丢失', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tier-restart-'));
  const first = await boot({ dataDir: dir });
  const memory = first.runtime.use(memoryService),
    r = memory.remember(sample());
  memory.update(r.id, { text: '喜欢水' }, 1);
  memory.note('group:1', '重启整理事项');
  await first.stop();
  apps.splice(apps.indexOf(first), 1);
  vi.setSystemTime(new Date('2026-10-27T00:00:10Z'));
  const second = await boot({ dataDir: dir });
  await vi.advanceTimersByTimeAsync(0);
  expect(second.runtime.use(memoryService).drafts('group:1')[0]?.status).toBe('published');
  expect(
    second.runtime
      .use(memoryService)
      .list('group:1')
      .some((r) => r.text === '喜欢水' && r.tier === 'short'),
  ).toBe(true);
  await vi.advanceTimersByTimeAsync(4000);
  const count = second.runtime.use(memoryRepository).records().length;
  await vi.advanceTimersByTimeAsync(4000);
  expect(second.runtime.use(memoryRepository).records()).toHaveLength(count);
});
test('整理期间停用会话会取消运行，迟到模型结果不得落库', async () => {
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  const extractor = definePlugin({
    id: 'test-late-extractor',
    setup(ctx) {
      ctx.provide(modelService, {
        complete: async () => {
          started();
          await new Promise<void>((r) => {
            finish = r;
          });
          return {
            message: { role: 'assistant', content: '{"candidates":[]}' },
            usage: { input: 0, output: 0 },
          };
        },
      });
    },
  });
  const app = await boot({
    plugins: [extractor],
    initialConfig: { acceptAllSessions: true, plugins: { 'model-mock': false } },
  });
  const memory = app.runtime.use(memoryService);
  app.runtime.use(storageService).append({
    id: 'late',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '消息',
    atMe: false,
    timestamp: Date.now(),
  });
  const id = memory.consolidate('group:1');
  await entered;
  const runId = app.runtime
    .use(memoryAgentService)
    .requests('group:1')
    .find((task) => task.id === id)!.runId!;
  app.runtime.use(configService).saveProfile('group:1', { plugins: { 'agent-memory': false } });
  finish();
  expect((await app.runtime.wait(runId)).status).toBe('failed');
  expect(app.runtime.use(memoryRepository).cursor('group:1')).toBe(0);
});

test('过期但未整理的短期与笔记仍保留，成功传递后才归档', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  const app = await boot(),
    memory = app.runtime.use(memoryService),
    repo = app.runtime.use(memoryRepository);
  app.runtime.use(configService).saveMemorySchedule('group:1', { enabled: false });
  const record = memory.remember({ ...sample(), tier: 'short', expiresAt: Date.now() + 60000 });
  const note = memory.note('group:1', '未整理笔记');
  vi.setSystemTime(Date.now() + 8 * 86400000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .some((r) => r.id === record.id),
  ).toBe(true);
  expect((await memory.search('group:1', '茶'))[0]?.record.id).toBe(record.id);
  expect(memory.notes('group:1').some((n) => n.id === note.id)).toBe(true);
  expect(repo.expireNotes(Date.now())).toBe(0);
  await waitMemoryRequest(app, memory.consolidate('group:1', 'short'));
  expect(repo.note(note.id)?.consolidatedAt).toBeDefined();
  await waitMemoryRequest(app, memory.consolidate('group:1', 'medium'));
  expect(repo.record(record.id)?.consolidatedAt).toBeDefined();
  await vi.advanceTimersByTimeAsync(1000);
  expect(repo.record(record.id)?.status).toBe('superseded');
  expect(repo.note(note.id)?.status).toBe('expired');
  expect(
    memory
      .list('group:1')
      .filter((r) => r.document?.role !== 'persona')
      .some((r) => r.tier === 'medium' && r.text === record.text),
  ).toBe(true);
});
