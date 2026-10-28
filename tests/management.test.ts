import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { Runtime } from '@qq-harness/kernel';
import { configFile } from '@qq-harness/config-file';
import { modelOpenai } from '@qq-harness/model-openai';
import {
  configService,
  storageService,
  modelService,
  adapterService,
  memoryService,
} from '@qq-harness/domain';
import { createApplication } from '../apps/server/src/app.js';
import { replyDecision } from '../plugins/conversation/src/policy.js';
import { chatSettingsSchema, incomingSchema } from '@qq-harness/contracts';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanups.splice(0).reverse()) await stop();
  vi.unstubAllGlobals();
});
async function boot() {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-management-')),
    v2Managers: false,
    extensionHotReload: false,
    allowedChats: ['group:1'],
    initialConfig: {
      acceptAllSessions: false,
      admissions: ['group:1'],
      send: { minIntervalMs: 0, dedupeMs: 0 },
    },
  });
  cleanups.push(() => app.stop());
  return app;
}
test('会话目录包含无消息配置与准入，元数据独立保存，移除保留数据', async () => {
  const app = await boot(),
    cfg = app.runtime.use(configService),
    storage = app.runtime.use(storageService);
  cfg.saveProfile('group:3', { persona: '独立' });
  const request = (url: string, method = 'GET', body?: unknown) =>
    app.app.request(`http://127.0.0.1/api${url}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  expect(((await (await request('/chats')).json()) as { chatKey: string }[]).map((r) => r.chatKey)).toEqual([
    'group:1',
    'group:3',
  ]);
  await request('/chats/group%3A1', 'PATCH', { alias: '测试会话', pinned: true });
  expect(await (await request('/chats')).json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ chatKey: 'group:1', alias: '测试会话', pinnedAt: expect.any(Number) }),
    ]),
  );
  storage.append({
    id: 'm1',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '保留消息',
    atMe: false,
    timestamp: Date.now(),
  });
  await request('/chats/group%3A1', 'PATCH', { online: false });
  expect(storage.unread('group:1')).toEqual([]);
  cfg.saveMemorySchedule('group:1', { shortIntervalMs: 60000 });
  await request('/profiles/group%3A1/restore', 'POST', { section: 'memory' });
  expect(cfg.get().memoryOverrides['group:1']).toBeUndefined();
  await request('/chats/group%3A1', 'DELETE');
  expect(storage.messages('group:1')).toHaveLength(1);
  expect(cfg.get().admissions).not.toContain('group:1');
  expect(cfg.get().profiles['group:1']).toBeUndefined();
});
test('会话消息与运行记录分页筛选，默认汇总排除独立配置，统计缺失项不伪造', async () => {
  const app = await boot(),
    cfg = app.runtime.use(configService),
    storage = app.runtime.use(storageService);
  cfg.saveProfile('group:3', {});
  for (let i = 0; i < 65; i++)
    storage.append({
      id: String(i),
      chatKey: 'group:1',
      senderId: i % 2 ? '2' : '3',
      senderName: '甲',
      text: `项目消息${i}`,
      atMe: false,
      timestamp: Date.now(),
    });
  storage.append({
    id: 'excluded',
    chatKey: 'group:3',
    senderId: '2',
    senderName: '甲',
    text: '排除',
    atMe: false,
    timestamp: Date.now(),
  });
  const request = (url: string) => app.app.request(`http://127.0.0.1/api${url}`);
  const data = (await (await request('/chats/group%3A1/messages?page=2&pageSize=20&senderId=2')).json()) as {
    total: number;
    items: { text: string; senderId: string }[];
  };
  expect(data.total).toBe(32);
  expect(data.items).toHaveLength(12);
  expect(data.items.every((m) => m.senderId === '2')).toBe(true);
  const aggregate = (await (await request('/chats/default/messages?page=1&pageSize=100')).json()) as {
    total: number;
  };
  expect(aggregate.total).toBe(65);
  const stats = await (await request('/chats/group%3A1/stats')).json();
  expect(stats).toMatchObject({
    messages: { received: 65, triggered: null },
    cost: null,
    triggerProbability: null,
  });
  const exported = (await (await request('/chats/group%3A1/export')).json()) as { messages: unknown[] };
  expect(exported.messages).toHaveLength(65);
});
test('群发每个目标绑定独立出站运行，管理准入不能扩大启动边界', async () => {
  const app = await boot();
  await app.app.request('http://127.0.0.1/api/chats', {
    method: 'POST',
    body: JSON.stringify({ chatKey: 'group:2' }),
  });
  const response = await app.app.request('http://127.0.0.1/api/chats/send', {
    method: 'POST',
    body: JSON.stringify({ targets: ['group:1', 'group:2', 'group:1'], text: '人工测试消息' }),
  });
  const result = (await response.json()) as { results: { chatKey: string; id?: string; error?: string }[] };
  expect(result.results).toHaveLength(2);
  expect(result.results.find((r) => r.chatKey === 'group:2')?.error).toBeDefined();
  expect((await app.runtime.wait(result.results.find((r) => r.chatKey === 'group:1')!.id!)).status).toBe(
    'completed',
  );
  expect(app.runtime.use(adapterService).sent).toEqual([{ chatKey: 'group:1', text: '人工测试消息' }]);
});
test('目录接口脱敏、更新保留密钥，使用中的目录项不能删除', async () => {
  const app = await boot(),
    cfg = app.runtime.use(configService);
  cfg.patch({
    providers: [{ id: 'p', name: '提供商', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-secret' }],
    personas: [{ id: 'role', name: '人设', text: '角色正文' }],
  });
  cfg.saveProfile('group:1', {
    modelSelection: { providerId: 'p', model: 'm' },
    personaSelection: { personaId: 'role' },
  });
  const response = await app.app.request('http://127.0.0.1/api/catalogs');
  expect(await response.text()).not.toContain('fixture-secret');
  const put = (kind: string, items: unknown[]) =>
    app.app.request(`http://127.0.0.1/api/catalogs/${kind}`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
  expect(
    (
      await put('providers', [
        { id: 'p', name: '新名', baseUrl: 'https://fixture.invalid/v1', models: ['m'] },
      ])
    ).status,
  ).toBe(200);
  expect(cfg.get().providers[0]?.apiKey).toBe('fixture-secret');
  expect((await put('providers', [])).status).toBe(409);
  expect((await put('personas', [])).status).toBe(409);
});
test('峰谷跨午夜按开始日判定，活跃期、私聊概率及下线优先级可验证', () => {
  const s = chatSettingsSchema.parse({
    replyPolicy: {
      enabled: true,
      privateProbability: 0,
      group: { mention: 0, keyword: 0, normal: 0 },
      activeProbability: 1,
      peak: {
        enabled: true,
        days: [1],
        startMinute: 1380,
        endMinute: 60,
        group: { mention: 1, keyword: 1, normal: 1 },
      },
    },
  });
  const m = incomingSchema.parse({ id: 'm', chatKey: 'group:1', senderId: '2', text: '消息' }),
    at = new Date(2026, 9, 27, 0, 30);
  expect(replyDecision(s, m, 0, at, () => 0.5)).toMatchObject({ trigger: true, reason: 'peak-other' });
  expect(replyDecision(s, m, 0, new Date(2026, 9, 27, 2), () => 0.5).trigger).toBe(false);
  expect(replyDecision(s, m, at.getTime() + 1000, new Date(2026, 9, 27, 2), () => 0.5).trigger).toBe(false);
  expect(replyDecision(s, m, at.getTime() + 1000, at, () => 0.5).trigger).toBe(true);
  expect(replyDecision(s, { ...m, chatKey: 'private:2' }, 0, at, () => 0).trigger).toBe(false);
  expect(replyDecision({ ...s, online: false }, m, 0, at, () => 0).reason).toBe('offline');
});
test('实际模型请求使用会话渠道、超时与备选顺序，失败后回退且不输出凭据', async () => {
  const runtime = new Runtime();
  runtime.install(
    configFile(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-selection-')), {
      providers: [
        { id: 'a', name: '甲', baseUrl: 'https://a.invalid/v1', apiKey: 'key-a' },
        { id: 'b', name: '乙', baseUrl: 'https://b.invalid/v1', apiKey: 'key-b' },
      ],
      profiles: {
        'group:1': {
          modelSelection: {
            providerId: 'a',
            model: 'first',
            fallbacks: [{ providerId: 'b', model: 'second' }],
            temperature: 0.3,
            thinkingMode: 'off',
          },
        },
      },
      model: { retries: 0 },
    }),
  );
  runtime.install(modelOpenai);
  await runtime.start();
  cleanups.push(() => runtime.stop());
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return String(url).includes('a.invalid')
      ? new Response('{}', { status: 503 })
      : Response.json({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        });
  });
  expect(
    (
      await runtime
        .use(modelService)
        .complete([{ role: 'user', content: 'mock' }], [], new AbortController().signal, {
          chatKey: 'group:1',
        })
    ).message.content,
  ).toBe('ok');
  expect(calls.map((c) => c.body.model)).toEqual(['first', 'second']);
  expect(calls[1]?.body).toMatchObject({ temperature: 0.3, enable_thinking: false });
});
