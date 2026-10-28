import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  modelService,
  conversationService,
  storageService,
  configService,
  toolService,
  adapterService,
  type ModelResponse,
} from '@qq-harness/domain';
import { behaviorDecision } from '../plugins/conversation/src/behavior.js';
import { behaviorSchema, incomingSchema } from '@qq-harness/contracts';
import { nextTopicCheck } from '../plugins/conversation-proactive/src/index.js';
import { z } from 'zod';
import { declaredManifest } from '../plugins/extension-system/src/import-manifest.js';
import { memoryDiffs } from '../plugins/agent-memory/diffs.js';
import { memoryRecordSchema } from '@qq-harness/contracts';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const silent: ModelResponse = {
  message: {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'end',
        type: 'function',
        function: {
          name: 'finish',
          arguments: '{"mode":"silent","silentReason":"测试无需发言"}',
        },
      },
    ],
  },
  usage: { input: 0, output: 0 },
};
async function boot(defaults: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-upgrade-'));
  const app = await createApplication({
    dataDir: folder,
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      acceptAllSessions: true,
      send: { minIntervalMs: 0, dedupeMs: 0 },
      defaults: {
        wakeDelayMs: 0,
        drainDelayMs: 0,
        memory: { enabled: false },
        ...defaults,
      },
      ...extra,
    },
  });
  cleanups.push(async () => {
    await app.stop();
    if (path.dirname(fs.realpathSync(folder)) !== fs.realpathSync(os.tmpdir())) throw Error('清理越界');
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const model = vi.spyOn(app.runtime.use(modelService), 'complete').mockResolvedValue(silent);
  const request = (route: string, body?: unknown) =>
    app.app.request(
      'http://127.0.0.1' + route,
      body
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
  return { app, model, request };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error('等待测试运行超时');
}
test.each(['mention', 'poke', 'keyword'])(
  '%s 明确标注真实触发消息，未读上下文不冒充触发消息',
  async (kind) => {
    const { app, model } = await boot({
      behavior: {
        enabled: true,
        reply: { other: { enabled: false } },
        keywordRules: [{ id: 'key', pattern: '关键词' }],
      },
    });
    const conversation = app.runtime.use(conversationService);
    await conversation.ingest({
      id: 'history',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '测试用户',
      text: '普通上下文',
      timestamp: Date.now(),
      atMe: false,
    });
    await conversation.ingest({
      id: 'focus-' + kind,
      chatKey: 'group:1',
      senderId: '2',
      senderName: '测试用户',
      text: kind === 'keyword' ? '关键词' : '请回应这条',
      timestamp: Date.now(),
      atMe: kind === 'mention',
      metadata: kind === 'poke' ? { poke: true } : undefined,
    });
    await until(() => app.runtime.use(storageService).archives().length > 0);
    expect(model).toHaveBeenCalledTimes(1);
    const context = JSON.stringify(model.mock.calls[0]![0]);
    expect(context).toContain('本轮触发消息 #focus-' + kind);
    expect(context).toContain('着重理解并回应');
  },
);
test('上下文插件重建消息后仍保留权威触发定位', async () => {
  const { app, model } = await boot({ trigger: 'mention' });
  app.runtime.install({
    id: 'context-rebuild-test',
    setup(ctx) {
      ctx.on<any>('messages.before', (value) => ({
        ...value,
        messages: [{ role: 'system', content: '插件重建后的上下文' }],
      }));
    },
  });
  await app.runtime.start();
  await app.runtime.use(conversationService).ingest({
    id: 'focus-rebuilt',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试',
    text: '需要着重处理的内容',
    atMe: true,
    timestamp: Date.now(),
  });
  await until(() => app.runtime.use(storageService).archives().length > 0);
  const messages = model.mock.calls[0]![0];
  expect(JSON.stringify(messages)).toContain('实际启动本轮的是消息 #focus-rebuilt');
  expect(JSON.stringify(messages)).toContain('需要着重处理的内容');
});
test('手动触发忽略概率和触发规则，仍遵守会话下线与插件停用', async () => {
  const { app, model, request } = await boot({
    behavior: {
      enabled: true,
      reply: {
        mention: { probability: 0 },
        other: { enabled: true, probability: 0 },
      },
    },
  });
  await app.runtime.use(conversationService).ingest({
    id: 'unread',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试用户',
    text: '概率未命中的未读',
    timestamp: Date.now(),
    atMe: false,
  });
  expect(model).not.toHaveBeenCalled();
  const response = await request('/api/conversation/manual', {
    chatKey: 'group:1',
    text: '本轮手动任务',
  });
  expect(response.status).toBe(202);
  const result = await response.json();
  await app.runtime.wait(result.id);
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0]![0])).toContain('本轮手动任务');
  expect(app.runtime.use(storageService).unread('group:1')).toHaveLength(0);
  app.runtime.use(configService).saveProfile('group:1', { online: false });
  expect((await request('/api/conversation/manual', { chatKey: 'group:1' })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(model).toHaveBeenCalledTimes(1);
  await app.runtime.setEnabled('conversation-manual', false);
  expect((await request('/api/conversation/manual', { chatKey: 'group:1' })).status).toBe(404);
});
test('send_message stop=true 发送数组后短路后续工具与finish，不伪造成功', async () => {
  const { app, model } = await boot({ trigger: 'all' });
  model.mockResolvedValue({
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'send',
          type: 'function',
          function: {
            name: 'send_message',
            arguments: '{"messages":["甲","乙"],"stop":true}',
          },
        },
        {
          id: 'never',
          type: 'function',
          function: {
            name: 'send_message',
            arguments: '{"messages":["不能发送"]}',
          },
        },
      ],
    },
    usage: { input: 0, output: 0 },
  });
  const id = app.runtime.use(conversationService).force('group:1');
  await app.runtime.wait(id);
  expect(model).toHaveBeenCalledTimes(1);
  expect(app.runtime.use(adapterService).sent?.map((m) => m.text)).toEqual(['甲', '乙']);
  expect(
    app.runtime
      .use(storageService)
      .archives()
      .find((a) => a.id === id),
  ).toMatchObject({
    status: 'completed',
    sent: 2,
    reason: 'send_message stop=true',
  });
  const service = app.runtime.use(toolService);
  expect(service.catalog?.('group:1').find((t) => t.id === 'send_message')?.parameters).toHaveProperty(
    'properties.stop',
  );
});
test('活跃期始终触发，优先于@和拍一拍概率', () => {
  const policy = behaviorSchema.parse({
    enabled: true,
    chatActive: { enabled: true, maxMinutes: 1, probability: 0 },
    reply: {
      mention: { enabled: true, probability: 100 },
      other: { enabled: true, probability: 100 },
    },
  });
  const message = incomingSchema.parse({
    id: '1',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试用户',
    text: '普通',
    timestamp: 100,
    atMe: false,
  });
  expect(behaviorDecision(policy, message, 200, new Date(100), () => 0)).toMatchObject({
    trigger: true,
    reason: 'active',
  });
  expect(behaviorDecision(policy, { ...message, atMe: true }, 200, new Date(100), () => 0)).toMatchObject({
    trigger: true,
    reason: 'active',
  });
  policy.chatActive.probability = 100;
  expect(behaviorDecision(policy, message, 200, new Date(100), () => 0.99).trigger).toBe(true);
});
test('主动话题在x秒进入判定，失败后固定y秒，新消息重置，不在重启后补做多次', () => {
  const last = { localId: 1, timestamp: 0 };
  let result = nextTopicCheck(undefined, last, 10, 3, 9999);
  expect(result.due).toBe(false);
  result = nextTopicCheck(result.state, last, 10, 3, 10000);
  expect(result.due).toBe(true);
  expect(result.state.nextAt).toBe(13000);
  expect(nextTopicCheck(result.state, last, 10, 3, 12999).due).toBe(false);
  const restarted = nextTopicCheck(result.state, last, 10, 3, 90000);
  expect(restarted.state.nextAt).toBe(93000);
  const fresh = nextTopicCheck(restarted.state, { localId: 2, timestamp: 91000 }, 10, 3, 92000);
  expect(fresh).toMatchObject({ due: false, state: { nextAt: 101000 } });
});
test('未读筛选返回最新入站未读，内置目录用QQ来源标记区分弱相关插件工具', async () => {
  const { app, request } = await boot();
  const storage = app.runtime.use(storageService);
  for (let i = 1; i <= 3; i++)
    storage.append({
      id: String(i),
      chatKey: 'group:1',
      senderId: '2',
      senderName: '测试用户',
      text: '独立测试 ' + i,
      timestamp: i,
      atMe: false,
    });
  storage.markRead('group:1', [storage.unread('group:1')[0]!.localId]);
  const response = await request('/api/chats/group%3A1/messages?page=1&unread=1');
  expect((await response.json()).items.map((m: any) => m.id)).toEqual(['2', '3']);
  const catalog = app.runtime.use(toolService).catalog!('group:1');
  expect(catalog.find((t) => t.id === 'send_message')?.builtinQQ).toBe(true);
  expect(catalog.find((t) => t.id === 'container_bash')?.builtinQQ).toBe(false);
  expect(catalog.find((t) => t.id === 'web_fetch')?.builtinQQ).toBe(false);
});
test('缺失/未知的扩展类型在预览阶段拒绝，不写入安装目录', async () => {
  const { app, request } = await boot();
  for (const manifest of [{ id: 'bad' }, { id: 'bad', type: 'unknown' }]) {
    const response = await request('/api/extensions/import?dry=1', {
      files: [
        {
          rel: 'bad/tool.json',
          data: Buffer.from(JSON.stringify(manifest)).toString('base64'),
        },
        {
          rel: 'bad/index.js',
          data: Buffer.from('export function setup(){}').toString('base64'),
        },
      ],
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toMatch(/声明|不一致/);
  }
});
test('全局并发和队列容量热更新实际调度，不取消已经开始的运行', async () => {
  const { app } = await boot({}, { execution: { concurrency: 1, queueLimit: 1 } }),
    started: string[] = [],
    release = new Map<string, () => void>();
  app.runtime.install({
    id: 'pool-test',
    setup(ctx) {
      ctx.mode({
        id: 'pool-test',
        input: z.object({ key: z.string() }),
        execute: async (_run, input) => {
          started.push(input.key);
          await new Promise<void>((resolve) => release.set(input.key, resolve));
          return input.key;
        },
      });
    },
  });
  await app.runtime.start();
  const submit = (key: string) =>
      app.runtime.submit({
        mode: 'pool-test',
        partitionKey: key,
        input: { key },
      }),
    a = submit('a'),
    b = submit('b');
  await until(() => started.includes('a'));
  expect(started).toEqual(['a']);
  expect(() => submit('overflow')).toThrow('队列已满');
  app.runtime.use(configService).patch({ execution: { concurrency: 2 } });
  await until(() => started.includes('b'));
  expect(started).toEqual(['a', 'b']);
  app.runtime.use(configService).patch({ execution: { concurrency: 1 } });
  const c = submit('c');
  release.get('a')!();
  await app.runtime.wait(a.id);
  expect(started).toEqual(['a', 'b']);
  release.get('b')!();
  await app.runtime.wait(b.id);
  await until(() => started.includes('c'));
  release.get('c')!();
  expect((await app.runtime.wait(c.id)).status).toBe('completed');
});
test('主动话题概率失败继续等y秒，新消息重新等待x秒，卸载取消检查', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  const { app, model } = await boot({
    behavior: {
      enabled: true,
      reply: { other: { enabled: false } },
      proactive: {
        enabled: true,
        idleSeconds: 2,
        checkEverySeconds: 3,
        probability: 0,
      },
    },
  });
  const storage = app.runtime.use(storageService);
  storage.append({
    id: 'one',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试',
    text: '冷场前最后一条未读',
    atMe: false,
    timestamp: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(model).not.toHaveBeenCalled();
  app.runtime.use(configService).patch({ defaults: { behavior: { proactive: { probability: 1 } } } });
  await vi.advanceTimersByTimeAsync(2999);
  expect(model).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0]![0])).toContain('冷场前最后一条未读');
  expect(storage.unread('group:1')).toHaveLength(1);
  storage.append({
    id: 'two',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试',
    text: '新消息',
    atMe: false,
    timestamp: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(1999);
  expect(model).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(model).toHaveBeenCalledTimes(2);
  await app.runtime.setEnabled('conversation-proactive', false);
  await vi.advanceTimersByTimeAsync(10000);
  expect(model).toHaveBeenCalledTimes(2);
});
test.each(['manual', 'proactive'])('%s 插件停用会取消自身正在等待模型的对话', async (kind) => {
  vi.useFakeTimers();
  const { app, model, request } = await boot({
    behavior: {
      proactive: { enabled: true, idleSeconds: 1, checkEverySeconds: 3, probability: 1 },
    },
  });
  model.mockImplementation(
    (_messages, _tools, signal) =>
      new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  let id: string;
  if (kind === 'manual') {
    const response = await request('/api/conversation/manual', { chatKey: 'group:1' });
    expect(response.status).toBe(202);
    id = (await response.json()).id;
    await vi.advanceTimersByTimeAsync(0);
  } else {
    app.runtime.use(storageService).append({
      id: 'idle',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '测试',
      text: '等待主动话题',
      timestamp: Date.now(),
      atMe: false,
    });
    await vi.advanceTimersByTimeAsync(1000);
    id = app.runtime.listRuns().find((run) => run.mode === 'agent.basic')!.id;
  }
  expect(model).toHaveBeenCalledTimes(1);
  const signal = model.mock.calls[0]![2];
  await app.runtime.setEnabled('conversation-' + kind, false);
  expect(signal.aborted).toBe(true);
  expect((await app.runtime.wait(id)).status).toBe('cancelled');
  expect(app.runtime.use(adapterService).sent).toEqual([]);
});
test('默认人设管理API只读，自定义人设在集中目录增改且不覆盖默认', async () => {
  const { app, request } = await boot(),
    config = app.runtime.use(configService),
    original = config.get().defaults.persona;
  const denied = await app.app.request('http://127.0.0.1/api/config', {
    method: 'PATCH',
    body: JSON.stringify({ defaults: { persona: '不允许覆盖' } }),
  });
  expect(denied.status).toBe(409);
  expect(config.get().defaults.persona).toBe(original);
  const saved = await app.app.request('http://127.0.0.1/api/catalogs/personas', {
    method: 'PUT',
    body: JSON.stringify({
      items: [{ id: 'custom', name: '自定义', text: '# 人设\n\n**测试**' }],
    }),
  });
  expect(saved.status).toBe(200);
  const catalog = await (await request('/api/catalogs')).json();
  expect(catalog.defaultPersona).toBe(original);
  expect(catalog.personas).toHaveLength(1);
});
test.each(['plugin', 'chat-plugin', 'skill', 'tool', 'mcp', 'knowledge', 'promptinject'])(
  '显式 %s 类型独立于上传文件名，生成兼容的规范入口',
  (type) => {
    const entries = [
      {
        name: 'package/extension.json',
        data: Buffer.from(JSON.stringify({ id: 'typed', type })),
      },
    ];
    const declaration = declaredManifest(entries);
    expect(declaration.type).toBe(type === 'chat-plugin' ? 'plugin' : type);
    expect(entries[0]!.name).toBe('package/' + declaration.type + '.json');
    if (type === 'chat-plugin') expect(declaration.scope).toBe('session');
  },
);
test('记忆更正的新记录r1按派生关系对比旧版本，而非跨记录按修订号排序', () => {
  const old = memoryRecordSchema.parse({
    id: crypto.randomUUID(),
    scope: 'chat',
    tier: 'short',
    chatKey: 'group:1',
    personId: null,
    key: 'fact',
    text: '旧值',
    visibility: 'chat_only',
    sensitive: false,
    confidence: 1,
    importance: 0.5,
    pinned: false,
    sources: [],
    origin: 'admin',
    expiresAt: null,
    status: 'active',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    lastConfirmedAt: 1,
    factVersion: 1,
  });
  const current = {
    ...old,
    id: crypto.randomUUID(),
    text: '更正值',
    revision: 1,
    factVersion: 2,
    createdAt: 2,
    updatedAt: 2,
    derivedFrom: [{ id: old.id, revision: 1 }],
  };
  const rows = memoryDiffs([
    { record: current, changedAt: 2 },
    { record: { ...old, revision: 2, status: 'superseded' }, changedAt: 3 },
    { record: old, changedAt: 1 },
  ]);
  const corrected = rows.find((row) => row.item.record.id === current.id)!;
  expect(corrected.previous?.record.text).toBe('旧值');
  expect(corrected.item.record.text).toBe('更正值');
});
