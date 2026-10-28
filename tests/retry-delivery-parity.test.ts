import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  adapterService,
  configService,
  conversationService,
  hasOutboundEffect,
  modelService,
  outboundService,
  storageService,
  toolService,
  type ToolContext,
} from '@qq-harness/domain';
import type { Archive } from '@qq-harness/contracts';
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-retry-'));
  cleanups.push(() => {
    const real = fs.realpathSync(root);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-retry-')
    )
      throw new Error('清理越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  const app = await createApplication({
    dataDir: root,
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      acceptAllSessions: true,
      defaults: { wakeDelayMs: 0, behavior: { enabled: true, run: { retryAttempts: 1 } } },
      send: { minIntervalMs: 0, dedupeMs: 0 },
      model: { apiKey: 'fixture-private-secret' },
    },
  });
  cleanups.push(app.stop);
  const storage = app.runtime.use(storageService),
    config = app.runtime.use(configService),
    adapter = app.runtime.use(adapterService),
    context: ToolContext = {
      chatKey: 'group:1',
      settings: config.effective('group:1'),
      sent: 0,
      trace() {},
      run: {
        id: 'delivery-test',
        signal: new AbortController().signal,
        deadline: Infinity,
        revision: 0,
        assertActive() {},
      },
    };
  return {
    ...app,
    storage,
    config,
    adapter,
    context,
    call: (messages: string[]) =>
      app.runtime.use(toolService).execute(context, 'send_message', JSON.stringify({ messages })),
    retry: (id: string) =>
      app.app.request('http://127.0.0.1/api/archives/' + id + '/retry', { method: 'POST' }),
  };
}
test('部分发送状态未知时不建议重发；同一运行重复发送被阻止，审计脱敏且确认的下一条正常发送', async () => {
  const f = await fixture(),
    original = f.adapter.send.bind(f.adapter),
    send = vi
      .spyOn(f.adapter, 'send')
      .mockRejectedValueOnce(new Error('socket closed fixture-private-secret'))
      .mockImplementation(original);
  const result = (await f.call(['状态未知', '下一条'])) as any;
  expect(result).toMatchObject({ sent: 1, uncertain: true });
  expect(result.note).toContain('均不要直接重发');
  expect(f.context.sent).toBe(1);
  expect(send).toHaveBeenCalledTimes(2);
  const again = (await f.call(['状态未知'])) as any;
  expect(again.isError).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  const attempts = f.storage.state('outbound-attempts', f.context.run.id) as any[];
  expect(attempts.map((a) => a.status)).toEqual(['unknown', 'delivered']);
  expect(JSON.stringify(attempts)).not.toContain('fixture-private-secret');
  expect(hasOutboundEffect(f.storage, f.context.run.id, 'group:1')).toBe(true);
});
test('协议明确拒绝可安全重试；成功发出后的本地落盘错误不能变成发送失败', async () => {
  const f = await fixture(),
    original = f.adapter.send.bind(f.adapter),
    send = vi
      .spyOn(f.adapter, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('协议明确拒绝'), { definiteFailure: true }))
      .mockImplementation(original);
  expect((await f.call(['第一次'])) as any).toMatchObject({ isError: true });
  expect(hasOutboundEffect(f.storage, f.context.run.id, 'group:1')).toBe(false);
  expect((await f.call(['第一次'])) as any).toMatchObject({ sent: 1 });
  expect(send).toHaveBeenCalledTimes(2);
  const set = f.storage.setState.bind(f.storage);
  let writes = 0;
  vi.spyOn(f.storage, 'setState').mockImplementation((namespace, key, value) => {
    if (namespace === 'outbound-attempts' && ++writes === 2) throw new Error('模拟落盘失败');
    set(namespace, key, value);
  });
  vi.spyOn(f.storage, 'append').mockImplementation(() => {
    throw new Error('模拟记录失败');
  });
  const result = (await f.call(['已发出的第三条'])) as any;
  expect(result.sent).toBe(1);
  expect(result.results[0].warning).toContain('记录保存失败');
  expect(f.context.sent).toBe(2);
  expect(f.adapter.sent).toHaveLength(2);
});
test('取消恰好发生在协议成功回包前，仍记录真实发送及其运行归属', async () => {
  const f = await fixture(),
    abort = new AbortController();
  let complete!: (value: { id: string }) => void;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  vi.spyOn(f.adapter, 'send').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
        ready();
      }),
  );
  const run = {
    ...f.context.run,
    signal: abort.signal,
    assertActive() {
      abort.signal.throwIfAborted();
    },
  };
  const promise = f.runtime.use(outboundService).send(run, 'group:1', '回包与取消竞态');
  await started;
  abort.abort(new Error('用户取消'));
  complete({ id: 'acknowledged' });
  expect(await promise).toMatchObject({ id: 'acknowledged' });
  expect(f.storage.messages('group:1')[0]).toMatchObject({
    id: 'acknowledged',
    self: true,
    metadata: { outboundRunId: run.id },
  });
  expect((f.storage.state('outbound-attempts', run.id) as any[])[0].status).toBe('delivered');
});
test('按失败档案恢复原触发消息并关联新运行；完成、已发送、未知发送和不可见来源都拒绝', async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    message = f.storage.append({
      id: 'original-trigger',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '甲',
      text: '失败前的原触发内容',
      atMe: true,
      timestamp: Date.now(),
    });
  f.storage.markRead('group:1', [message.localId]);
  const archive: Archive = {
    id: 'failed-record',
    chatKey: 'group:1',
    mode: 'agent.basic',
    startedAt: Date.now() - 100,
    endedAt: Date.now(),
    status: 'failed',
    sent: 0,
    trace: [],
    triggerIds: [message.localId],
    usage: { input: 0, output: 0 },
  };
  f.storage.archive(archive);
  const response = await f.retry(archive.id);
  expect(response.status).toBe(200);
  const result = await response.json();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.adapter.sent).toHaveLength(1);
  expect(f.storage.archives().find((a) => a.id === result.runId)).toMatchObject({
    retryOf: archive.id,
    triggerIds: [message.localId],
  });
  for (const [index, patch] of [
    { status: 'completed' },
    { sent: 1 },
    { triggerIds: [999999] },
    { mode: 'memory.consolidate' },
  ].entries()) {
    const old = { ...archive, ...patch, id: 'unsafe-' + index };
    f.storage.archive(old);
    expect((await f.retry(old.id)).status).toBe(409);
  }
  const unsafe = { ...archive, id: 'unknown-delivery' };
  f.storage.archive(unsafe);
  f.storage.setState('outbound-attempts', unsafe.id, [{ status: 'unknown', chatKey: 'group:1' }]);
  const blocked = await f.retry(unsafe.id);
  expect(blocked.status).toBe(409);
  expect(JSON.stringify(await blocked.json())).toContain('发送结果未知');
  f.storage.setState('outbound-children', 'parent-failed', [
    { runId: 'unknown-delivery', chatKey: 'group:1' },
  ]);
  expect(hasOutboundEffect(f.storage, 'parent-failed', 'group:1')).toBe(true);
});
test('结果未知的失败运行不自动重试，也不把原触发消息翻回未读', async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    model = vi
      .spyOn(f.runtime.use(modelService), 'complete')
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'send',
              type: 'function',
              function: { name: 'send_message', arguments: '{"messages":["网络结果未知"]}' },
            },
          ],
        },
        usage: { input: 1, output: 1 },
      })
      .mockRejectedValue(new Error('后续模型失败'));
  vi.spyOn(f.adapter, 'send').mockRejectedValue(new Error('socket closed'));
  await f.runtime
    .use(conversationService)
    .ingest({
      id: 'unknown-trigger',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '甲',
      text: '原请求',
      atMe: true,
      timestamp: Date.now(),
    });
  await vi.advanceTimersByTimeAsync(5000);
  expect(model).toHaveBeenCalledTimes(2);
  expect(f.storage.archives()[0]).toMatchObject({ status: 'failed', sent: 0 });
  expect(f.storage.unread('group:1')).toHaveLength(0);
});
