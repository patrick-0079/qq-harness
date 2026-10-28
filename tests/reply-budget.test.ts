import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createApplication } from '../apps/server/src/app.js';
import {
  adapterService,
  configService,
  conversationService,
  modelService,
  outboundService,
  storageService,
  type ModelResponse,
} from '@qq-harness/domain';
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.stop();
  vi.restoreAllMocks();
});
const response = (...calls: [string, unknown][]): ModelResponse => ({
  message: {
    role: 'assistant',
    content: null,
    tool_calls: calls.map(([name, args], i) => ({
      id: name + i,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })),
  },
  usage: { input: 0, output: 0 },
});
const finish: [string, unknown] = ['finish', { mode: 'spoken' }];
async function boot(limit = 0) {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reply-budget-')),
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      acceptAllSessions: true,
      send: { minIntervalMs: 0, dedupeMs: 0 },
      defaults: {
        maxReplyMessages: limit,
        memory: { enabled: false },
        tools: { crossChatSend: true },
      },
    },
  });
  apps.push(app);
  const model = vi.spyOn(app.runtime.use(modelService), 'complete');
  return {
    app,
    model,
    adapter: app.runtime.use(adapterService),
    config: app.runtime.use(configService),
    storage: app.runtime.use(storageService),
    outbound: app.runtime.use(outboundService),
    run: async (expected = 'completed') => {
      const id = app.runtime.use(conversationService).force('group:1');
      const result = await app.runtime.wait(id);
      expect(result.status).toBe(expected);
      return app.runtime
        .use(storageService)
        .archives()
        .find((a) => a.id === id)!;
    },
  };
}
test('回复上限跨多次工具调用计数，每轮上下文显示准确剩余额度，扩展重建system后仍生效', async () => {
  const f = await boot(2);
  f.app.runtime.install({
    id: 'rewrite-budget-prompt',
    setup(ctx) {
      ctx.on<any>('messages.before', (value) => ({
        ...value,
        messages: [
          { role: 'system', content: '扩展重新构建提示词' },
          ...value.messages.filter((m: any) => m.role !== 'system'),
        ],
      }));
    },
  });
  await f.app.runtime.start();
  f.model
    .mockResolvedValueOnce(response(['send_message', { messages: ['甲'] }]))
    .mockResolvedValueOnce(response(['send_message', { messages: ['乙'] }]))
    .mockResolvedValueOnce(response(finish));
  const archive = await f.run();
  expect(archive.sent).toBe(2);
  for (const [i, call] of f.model.mock.calls.entries()) {
    const text = String(call[0].find((m) => m.role === 'system')!.content);
    expect(text).toContain('本次回复最多发送 2 条信息');
    expect(text).toContain(`剩余最多 ${2 - i} 条`);
    expect(text.match(/【本轮回复消息上限】/g)).toHaveLength(1);
  }
});
test('模型一次给出超额数组及重复发送调用，也不能突破本轮物理消息上限', async () => {
  const f = await boot(2);
  f.model.mockResolvedValue(
    response(
      ['send_message', { messages: ['甲', '乙', '丙', '丁'] }],
      ['send_message', { messages: ['更多'] }],
      finish,
    ),
  );
  expect((await f.run('failed')).sent).toBe(2);
  expect(f.adapter.sent?.map((m) => m.text)).toEqual(['甲', '乙']);
  const result = f.storage
    .archives()[0]!
    .trace.filter((e) => e.type === 'tool')
    .map((e) => e.text)
    .join('');
  expect(JSON.stringify(f.storage.messages('group:1'))).not.toContain('更多');
  expect(result).toContain('本轮回复消息上限');
  expect(result).toContain('"limitReached":true');
  expect(result).toContain('禁止重试');
});
test('跨会话子运行与源会话共用回复额度，目标会话不能绕过剩余条数', async () => {
  const f = await boot(2);
  f.model.mockResolvedValue(
    response(
      ['send_message', { messages: ['当前会话'] }],
      ['send_to', { targetChatKey: 'group:2', messages: ['其他会话第一条', '其他会话第二条'] }],
      finish,
    ),
  );
  expect((await f.run('failed')).sent).toBe(2);
  expect(f.adapter.sent).toHaveLength(2);
  expect(f.adapter.sent?.map((m) => m.chatKey)).toEqual(['group:1', 'group:2']);
});
test('显式硬拆分后的实际消息计入额度，默认0不限制且不注入限额块', async () => {
  const f = await boot(2);
  f.config.patch({ send: { hardSplitAt: 2 } });
  f.model.mockResolvedValue(response(['send_message', { messages: ['甲乙丙丁戊己'] }], finish));
  expect((await f.run('failed')).sent).toBe(2);
  expect(f.adapter.sent?.map((m) => m.text)).toEqual(['甲乙', '丙丁']);
  f.config.saveProfile('group:1', { maxReplyMessages: 0 });
  f.model.mockResolvedValue(response(['send_message', { messages: ['一二三四五六'] }], finish));
  expect((await f.run()).sent).toBe(3);
  expect(JSON.stringify(f.model.mock.calls.at(-1)![0])).not.toContain('【本轮回复消息上限】');
});
test('明确失败退还额度，去重不扣额度，结果未知保守占用额度', async () => {
  const f = await boot();
  f.config.patch({ send: { dedupeMs: 10000 } });
  const original = f.adapter.send.bind(f.adapter);
  vi.spyOn(f.adapter, 'send').mockImplementation((chat, text, signal) =>
    text === '失败'
      ? Promise.reject(Object.assign(new Error('明确拒绝'), { definiteFailure: true }))
      : text === '未知'
        ? Promise.reject(new Error('断开'))
        : original(chat, text, signal),
  );
  f.app.runtime.install({
    id: 'quota-accounting',
    setup(ctx) {
      ctx.mode({
        id: 'quota.accounting',
        input: z.object({}),
        execute: async (run) => {
          const budget = f.outbound.openReplyBudget!(run, 2);
          try {
            await expect(f.outbound.send(run, 'group:1', '失败')).rejects.toThrow('明确拒绝');
            expect(budget.used()).toBe(0);
            await f.outbound.send(run, 'group:1', '成功');
            expect(budget.used()).toBe(1);
            expect((await f.outbound.send(run, 'group:1', '成功')).duplicate).toBe(true);
            expect(budget.used()).toBe(1);
            await expect(f.outbound.send(run, 'group:1', '未知')).rejects.toThrow('发送结果未知');
            expect(budget.used()).toBe(2);
            await expect(f.outbound.send(run, 'group:1', '超额')).rejects.toThrow('本轮回复消息上限');
          } finally {
            budget.release();
          }
        },
      });
    },
  });
  await f.app.runtime.start();
  const run = f.app.runtime.submit({
    mode: 'quota.accounting',
    partitionKey: 'group:1',
    input: {},
  });
  expect((await f.app.runtime.wait(run.id)).status).toBe('completed');
  expect(f.adapter.sent).toHaveLength(1);
});
test.each(['reply', 'at'])('数组任意元素可独立指定 %s，其他元素正常发送', async (kind) => {
  const f = await boot();
  f.storage.append({
    id: 'source',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试',
    text: '触发消息',
    timestamp: Date.now(),
    atMe: true,
  });
  f.model.mockResolvedValue(
    response(
      [
        'send_message',
        {
          messages: ['首条', (kind === 'reply' ? '⟦reply:source⟧' : '⟦at:2⟧') + '第二条', '第三条'],
        },
      ],
      finish,
    ),
  );
  expect((await f.run()).sent).toBe(3);
  const payload = JSON.parse(f.adapter.sent![1]!.text);
  expect(payload.segments[0].type).toBe(kind === 'reply' ? 'reply' : 'at');
  expect(f.adapter.sent?.[0]?.text).toBe('首条');
  expect(f.adapter.sent?.[2]?.text).toBe('第三条');
});
test('新会话继承默认上限，已有快照独立，聊天分区恢复能恢复上限', async () => {
  const f = await boot(3);
  f.config.saveProfile('group:1', { maxReplyMessages: 2 });
  f.config.patch({ defaults: { maxReplyMessages: 5 } });
  expect(f.config.effective('group:2').maxReplyMessages).toBe(5);
  expect(f.config.effective('group:1').maxReplyMessages).toBe(2);
  f.config.restoreProfile('group:1', 'chat');
  expect(f.config.effective('group:1').maxReplyMessages).toBe(5);
});
test('拍一拍等非文字消息也消耗回复额度', async () => {
  const f = await boot(1);
  f.model.mockResolvedValue(
    response(['send_poke', { targetUserId: '2' }], ['send_message', { messages: ['超额文字'] }], finish),
  );
  expect((await f.run('failed')).sent).toBe(1);
  expect(f.adapter.sent).toHaveLength(1);
  expect(JSON.parse(f.adapter.sent![0]!.text)).toMatchObject({ poke: '2' });
});
test('不同发送队列并发发送时也共享原子额度', async () => {
  const f = await boot(1);
  f.app.runtime.install({
    id: 'concurrent-reply-fixture',
    setup(ctx) {
      ctx.mode({
        id: 'quota.concurrent',
        input: z.object({}),
        execute: async (run) => {
          const budget = f.outbound.openReplyBudget!(run, 1);
          try {
            const results = await Promise.allSettled(
              ['group:1', 'group:2'].map((chat) => f.outbound.send(run, chat, '并发消息')),
            );
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
            expect(budget.used()).toBe(1);
          } finally {
            budget.release();
          }
        },
      });
    },
  });
  await f.app.runtime.start();
  const run = f.app.runtime.submit({
    mode: 'quota.concurrent',
    partitionKey: 'quota-test',
    input: {},
  });
  expect((await f.app.runtime.wait(run.id)).status).toBe('completed');
  expect(f.adapter.sent).toHaveLength(1);
});
test('上限配置拒绝负数、小数和越界值', async () => {
  const { chatSettingsSchema } = await import('@qq-harness/contracts');
  for (const maxReplyMessages of [-1, 1.5, 101, '3'])
    expect(chatSettingsSchema.safeParse({ maxReplyMessages }).success).toBe(false);
  for (const maxReplyMessages of [0, 1, 100])
    expect(chatSettingsSchema.parse({ maxReplyMessages }).maxReplyMessages).toBe(maxReplyMessages);
});

test('超额终止后，即使并发中的明确失败释放额度，也不能再次发送', async () => {
  const f = await boot(1);
  let rejectSend!: (error: Error) => void;
  vi.spyOn(f.adapter, 'send').mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
  );
  f.app.runtime.install({
    id: 'sticky-budget-fixture',
    setup(ctx) {
      ctx.mode({
        id: 'quota.sticky',
        input: z.object({}),
        async execute(run) {
          const budget = f.outbound.openReplyBudget!(run, 1);
          try {
            const pending = f.outbound.send(run, 'group:1', '明确失败前的发送').catch((error) => error);
            await vi.waitFor(() => expect(rejectSend).toBeTypeOf('function'));
            await expect(f.outbound.send(run, 'group:2', '超额')).rejects.toThrow('本轮回复消息上限');
            rejectSend(Object.assign(new Error('明确发送失败'), { definiteFailure: true }));
            await pending;
            expect(budget.used()).toBe(0);
            expect(budget.exceeded()).toBe(true);
            await expect(f.outbound.send(run, 'group:1', '不允许继续')).rejects.toThrow('本轮回复消息上限');
          } finally {
            budget.release();
          }
        },
      });
    },
  });
  await f.app.runtime.start();
  const run = f.app.runtime.submit({ mode: 'quota.sticky', partitionKey: 'quota-test', input: {} });
  expect((await f.app.runtime.wait(run.id)).status).toBe('completed');
  expect(f.adapter.sent).toHaveLength(0);
});
