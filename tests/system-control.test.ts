import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createApplication } from '../apps/server/src/app.js';
import {
  configService,
  storageService,
  conversationService,
  systemControlService,
  adapterService,
  modelService,
  memoryAgentService,
  reminderService,
  outboundService,
} from '@qq-harness/domain';
import { operationsSettingsSchema } from '@qq-harness/contracts';
import { createBalanceQuery } from '../plugins/ops-control/src/balance.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const stop of cleanups.splice(0).reverse()) await stop();
});
async function fixture(initial: Record<string, unknown> = {}, allowedChats?: string[]) {
  const options = {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-control-')),
    v2Managers: false,
    extensionHotReload: false,
    allowedChats,
    initialConfig: {
      acceptAllSessions: true,
      defaults: { wakeDelayMs: 0 },
      send: { minIntervalMs: 0, dedupeMs: 0 },
      ...initial,
    },
  };
  const app = await createApplication(options);
  cleanups.push(app.stop);
  const control = app.runtime.use(systemControlService),
    config = app.runtime.use(configService),
    storage = app.runtime.use(storageService);
  const change = (state: 'online' | 'offline') =>
    control.change({ state, requestId: randomUUID() }, 'test', 'tester');
  const ingest = (text: string, chatKey = 'group:22222', senderId = '11111', id: string = randomUUID()) =>
    app.runtime
      .use(conversationService)
      .ingest({ id, chatKey, senderId, senderName: '测试', text, atMe: true, timestamp: Date.now() });
  return {
    ...app,
    options,
    control,
    config,
    storage,
    change,
    ingest,
    sent: app.runtime.use(adapterService).sent!,
  };
}
test('统一状态持久化、幂等、并发版本与普通配置保护', async () => {
  const f = await fixture(),
    input = { state: 'offline', requestId: 'once', expectedRevision: 0 };
  const first = f.control.change(input, 'test', 'tester');
  expect(first.state).toBe('offline');
  expect(f.control.change(input, 'test', 'tester')).toEqual(first);
  expect(() => f.control.change({ ...input, state: 'online' }, 'test', 'tester')).toThrow('幂等');
  expect(() =>
    f.control.change({ state: 'online', requestId: 'stale', expectedRevision: 0 }, 'test', 'tester'),
  ).toThrow('刷新');
  expect(
    (await f.app.request('/api/config', { method: 'PATCH', body: JSON.stringify({ paused: false }) })).status,
  ).toBe(400);
  await f.stop();
  const next = await createApplication(f.options);
  cleanups.push(next.stop);
  expect(next.runtime.use(systemControlService).get()).toEqual(first);
});
test('下线立即取消普通执行及排队，控制通道不受满队列影响，记忆维护仍可执行', async () => {
  const f = await fixture({
    execution: { concurrency: 1, queueLimit: 1 },
    operations: { privateEnabled: true, allowedIds: ['11111'] },
  });
  f.runtime.install({
    id: 'test-load',
    setup(ctx) {
      ctx.mode({
        id: 'test.block',
        input: z.object({}),
        execute: async (run) =>
          new Promise((_, reject) =>
            run.signal.addEventListener('abort', () => reject(run.signal.reason), { once: true }),
          ),
      });
    },
  });
  await f.runtime.settled();
  const a = f.runtime.submit({ mode: 'test.block', partitionKey: 'a', input: {} }),
    b = f.runtime.submit({ mode: 'test.block', partitionKey: 'b', input: {} });
  await f.ingest('/ctrl 状态', 'private:11111');
  expect(f.sent[0]?.text).toContain('系统：在线');
  f.change('offline');
  expect((await f.runtime.wait(a.id)).status).toBe('cancelled');
  expect((await f.runtime.wait(b.id)).status).toBe('cancelled');
  expect(() => f.runtime.submit({ mode: 'test.block', partitionKey: 'c', input: {} })).toThrow('下线');
  const task = f.runtime
    .use(memoryAgentService)
    .request({ chatKey: 'group:22222', instruction: '没有新事实，无需修改记忆' });
  await vi.waitFor(() =>
    expect(
      f.runtime
        .use(memoryAgentService)
        .requests('group:22222')
        .find((t) => t.id === task.id)?.status,
    ).toBe('completed'),
  );
});
test('授权私聊在系统及会话下线、无普通准入时可恢复，不经过模型', async () => {
  const f = await fixture({
    acceptAllSessions: false,
    operations: { privateEnabled: true, allowedIds: ['11111'] },
  });
  f.config.saveProfile('private:11111', { online: false });
  f.change('offline');
  const model = vi.spyOn(f.runtime.use(modelService), 'complete');
  await f.ingest('/ctrl 上线', 'private:11111');
  expect(f.control.get().state).toBe('online');
  expect(f.sent.at(-1)?.text).toContain('历史积压已跳过');
  expect(model).not.toHaveBeenCalled();
  expect(f.config.effective('private:11111').online).toBe(false);
  f.config.clearProfile('private:11111');
  f.config.patch({ admissions: [] });
  f.change('offline');
  await f.ingest('/ctrl 状态', 'private:11111');
  expect(f.sent.at(-1)?.text).toContain('系统：下线');
  expect(f.config.get().admissions).toEqual([]);
});
test('非授权私聊、群聊、启动边界与黑名单不能使用运维特权', async () => {
  const f = await fixture({ operations: { privateEnabled: true, allowedIds: ['11111'] } }, [
    'group:22222',
    'private:11111',
  ]);
  f.change('offline');
  await f.ingest('/ctrl 上线', 'private:33333', '33333');
  await f.ingest('/ctrl 上线');
  expect(f.control.get().state).toBe('offline');
  expect(f.sent).toHaveLength(0);
  f.config.patch({ deniedUsers: ['11111'] });
  await f.ingest('/ctrl 上线', 'private:11111');
  expect(f.sent).toHaveLength(0);
  f.config.patch({ deniedUsers: [], operations: { allowedIds: ['44444'] } });
  await f.ingest('/ctrl 上线', 'private:44444', '44444');
  expect(f.sent).toHaveLength(0);
});
test('同一私聊事件只执行和回复一次；停用运维插件不改变系统下线', async () => {
  const f = await fixture({ operations: { privateEnabled: true, allowedIds: ['11111'] } });
  await f.ingest('/ctrl 下线 测试', 'private:11111', '11111', 'same');
  await f.ingest('/ctrl 下线 测试', 'private:11111', '11111', 'same');
  expect(f.sent).toHaveLength(1);
  expect(f.control.get().revision).toBe(1);
  await f.runtime.setEnabled('ops-control', false);
  expect(f.control.get().state).toBe('offline');
  expect((await f.app.request('/api/system/presence')).status).toBe(200);
});
test('离线消息只存档，上线不重放，禁止兼容接口请求补处理', async () => {
  const f = await fixture();
  f.change('offline');
  await f.ingest('离线消息');
  expect(f.storage.unread('group:22222')).toHaveLength(0);
  expect(
    (
      await f.app.request('/api/pause', {
        method: 'POST',
        body: JSON.stringify({ paused: false, skipBacklog: false }),
      })
    ).status,
  ).toBe(400);
  f.change('online');
  expect(f.sent).toHaveLength(0);
  await f.ingest('新消息');
  await vi.waitFor(() => expect(f.sent.length).toBe(1));
  expect(f.sent[0]?.text).toContain('新消息');
});
test('延迟发送与媒体、账户动作不能在下线后发出或伪造运维授权', async () => {
  const f = await fixture();
  f.config.patch({ send: { minIntervalMs: 2000 } });
  f.runtime.install({
    id: 'test-send',
    setup(ctx) {
      ctx.mode({
        id: 'test.send',
        input: z.object({}),
        execute: async (run) => {
          await ctx.use(outboundService).send(run, 'group:22222', '第一条');
          return ctx.use(outboundService).sendPayload(run, 'group:22222', '第二条', {
            segments: [{ type: 'text', data: { text: '第二条' } }],
          });
        },
      });
    },
  });
  await f.runtime.settled();
  const run = f.runtime.submit({ mode: 'test.send', partitionKey: 'group:22222', input: {} });
  await vi.waitFor(() => expect(f.sent.length).toBe(1));
  f.change('offline');
  expect((await f.runtime.wait(run.id)).status).toBe('cancelled');
  expect(f.sent).toHaveLength(1);
  const forged = {
    id: 'fake',
    signal: new AbortController().signal,
    deadline: Infinity,
    revision: 0,
    assertActive() {},
  };
  expect(() => f.control.grantReply(forged, 'fake', '任意消息')).toThrow('授权');
  await expect(
    f.runtime.use(outboundService).sendPayload(forged, 'group:22222', 'x', { profileImage: 'x' }),
  ).rejects.toThrow('下线');
});
test('下线期间的过期提醒跳过，未来提醒保留', async () => {
  const f = await fixture(),
    reminders = f.runtime.use(reminderService);
  reminders.add({ chatKey: 'group:22222', text: '应跳过', dueAt: Date.now() + 60 });
  reminders.add({ chatKey: 'group:22222', text: '未来', dueAt: Date.now() + 60000 });
  f.change('offline');
  await vi.waitFor(() => expect(reminders.list()).toHaveLength(1));
  f.change('online');
  expect(f.sent).toHaveLength(0);
  expect(f.control.logs().some((r) => r.status === 'skipped')).toBe(true);
});
test('迁移旧下线、白名单与凭据，只执行一次且保留原配置', async () => {
  const f = await fixture({
    legacyGlobal: {
      skills: {
        'ops-ctrl': { offline: true, enabled: true, allowedIds: '11111,22222', deepseekKey: 'secret-old' },
      },
    },
  });
  expect(f.control.get().state).toBe('offline');
  expect(f.config.get().operations.allowedIds).toEqual(['11111', '22222']);
  expect(f.config.public().operations.deepseekKey).toBe('******');
  expect(JSON.stringify(await (await f.app.request('/api/operations/settings')).json())).not.toContain(
    'secret-old',
  );
  f.config.patch({ operations: { deepseekKey: 'new' } });
  await f.stop();
  const next = await createApplication(f.options);
  cleanups.push(next.stop);
  expect(next.runtime.use(configService).get().operations.deepseekKey).toBe('new');
});
test('余额独立渠道失败、脱敏、未配置与缓存，不调用模型', async () => {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input).includes('deepseek')
            ? { balance_infos: [{ total_balance: '12.50', currency: 'CNY' }] }
            : {},
        ),
        { status: String(input).includes('opencode') ? 401 : 200 },
      ),
  );
  const query = createBalanceQuery(fetcher as typeof fetch),
    settings = operationsSettingsSchema.parse({ deepseekKey: 'secret1', opencodeGoKey: 'secret2' }),
    signal = new AbortController().signal;
  const result = await query(settings, 'all', signal);
  expect(result.find((r) => r.channel === 'deepseek')?.lines[0]).toContain('12.50');
  expect(result.find((r) => r.channel === 'opencode-go')?.status).toBe('unauthorized');
  expect(result.find((r) => r.channel === 'mimo')?.status).toBe('unconfigured');
  await query(settings, 'all', signal);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain('secret');
});

test('已有新运维配置优先于旧白名单、凭据及开关', async () => {
  const f = await fixture({
    operations: { privateEnabled: false, allowedIds: [], deepseekKey: '' },
    legacyGlobal: { skills: { 'ops-ctrl': { enabled: true, allowedIds: '11111', deepseekKey: 'old' } } },
  });
  expect(f.config.get().operations.privateEnabled).toBe(false);
  expect(f.config.get().operations.allowedIds).toEqual([]);
  expect(f.config.get().operations.deepseekKey).toBe('');
});

test('运维设置 PATCH 仅修改显式字段，保留白名单、凭据和自定义配置', async () => {
  const f = await fixture({
    operations: {
      privateEnabled: false,
      allowedIds: ['11111'],
      opencodeGoKey: 'mock-go',
      deepseekKey: 'mock-deepseek',
      glmKey: 'mock-glm',
      glmRegion: 'global',
      mimoCookie: 'mock-cookie',
      timeoutMs: 42000,
    },
  });
  const patch = (body: unknown) =>
    f.app.request('/api/operations/settings', { method: 'PATCH', body: JSON.stringify(body) });
  const before = f.config.get();
  expect((await patch({ privateEnabled: true })).status).toBe(200);
  const expected = structuredClone(before);
  expected.operations.privateEnabled = true;
  expect(f.config.get()).toEqual(expected);
  expect((await patch({})).status).toBe(200);
  expect(f.config.get()).toEqual(expected);
  expect((await patch({ deepseekKey: '******' })).status).toBe(200);
  expect(f.config.get()).toEqual(expected);
  expect((await patch({ privateEnabled: 'true' })).status).toBe(400);
  expect((await patch({ unexpected: true })).status).toBe(400);
  expect(f.config.get()).toEqual(expected);
  expect((await patch({ deepseekKey: '' })).status).toBe(200);
  expected.operations.deepseekKey = '';
  expect(f.config.get()).toEqual(expected);
});

test('OpenCode、GLM 鉴权回退及 MiMo Cookie 渠道解析', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input),
      auth = new Headers(init?.headers).get('authorization');
    if (url.includes('opencode.ai'))
      return Response.json({ usage: { rolling: { percent: 25 }, weekly: { used: 2, limit: 10 } } });
    if (url.includes('bigmodel.cn'))
      return auth?.startsWith('Bearer ')
        ? new Response('', { status: 401 })
        : Response.json({ data: { availableBalance: 15 } });
    return Response.json({ code: 0, data: { balance: 3, currency: 'CNY' } });
  });
  const query = createBalanceQuery(fetcher as typeof fetch),
    results = await query(
      operationsSettingsSchema.parse({
        opencodeGoKey: 'go-key',
        glmKey: 'glm-key',
        mimoCookie: 'api-platform_serviceToken=abc; userId=123',
      }),
      'all',
      new AbortController().signal,
    );
  expect(results.find((r) => r.channel === 'opencode-go')?.lines.join(' ')).toContain('25.0%');
  expect(results.find((r) => r.channel === 'glm')?.lines).toEqual(['可用余额 15 CNY']);
  expect(results.find((r) => r.channel === 'mimo')?.lines).toEqual(['可用余额 3 CNY']);
});
test('余额查询超时与认证失败分别返回，不伪造为零余额', async () => {
  const query = createBalanceQuery(
    (async (_input, init) =>
      new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }),
      )) as typeof fetch,
  );
  const results = await query(
    operationsSettingsSchema.parse({ deepseekKey: 'mock-only', timeoutMs: 5000 }),
    'deepseek',
    new AbortController().signal,
  );
  expect(results[0]?.status).toBe('timeout');
  expect(results[0]?.lines).toEqual(['渠道查询超时']);
}, 10000);
