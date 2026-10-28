import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { compileLegacyPackage } from '../tools/compile-legacy-package.js';
import { extensionService } from '@qq-harness/extension-compat';
import {
  adapterService,
  modelService,
  storageService,
  conversationService,
  configService,
  toolService,
  hasOutboundEffect,
  type OutboundPayload,
} from '@qq-harness/domain';
const source = fileURLToPath(new URL('../../backup/source/plugins', import.meta.url)),
  cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.skipIf(!fs.existsSync(source))(
  '按需表情回应验证明确请求和本群目标，不能借号码作用于别群，回应成功不冒充已发言',
  async () => {
    const app = await fixture({
        'typing-indicator': { enabled: false },
        'msg-reaction': {
          enabled: true,
          mode: '随机贴一个',
          probabilityPercent: 0,
          requireExplicit: true,
          emojiIds: '128077',
        },
      }),
      storage = app.runtime.use(storageService),
      results: unknown[] = [];
    const rounds = new Map<string, number>();
    storage.append({
      id: '90002',
      chatKey: 'group:2',
      senderId: '54321',
      senderName: '别群',
      text: '别群图片',
      atMe: false,
      timestamp: Date.now(),
    });
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(
      async (messages, _tools, _signal, context) => {
        const round = (rounds.get(context!.runId!) ?? 0) + 1;
        rounds.set(context!.runId!, round);
        const trigger =
          String(messages.find((m) => m.role === 'user')?.content ?? '')
            .split('【未读信息】')
            .at(-1) ?? '';
        if (round === 1)
          return {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'react',
                  type: 'function',
                  function: {
                    name: 'msg-reaction__react',
                    arguments: JSON.stringify({
                      emoji: '👍',
                      ...(trigger.includes('越界') ? { messageId: '90002' } : {}),
                    }),
                  },
                },
              ],
            },
            usage: { input: 0, output: 0 },
          };
        results.push(messages.filter((m) => m.role === 'tool').at(-1)?.content);
        return finish;
      },
    );
    const ingest = async (id: string, text: string, count: number) => {
      await app.runtime
        .use(conversationService)
        .ingest({
          id,
          chatKey: 'group:1',
          senderId: '12345',
          senderName: '测试',
          text,
          atMe: true,
          timestamp: Date.now(),
        });
      await settle(() => storage.archives().filter((a) => !a.mode).length === count);
    };
    await ingest('10001', '你好', 1);
    expect(app.events).toHaveLength(0);
    expect(String(results[0])).toContain('没有人要求');
    await ingest('10002', '给我贴个赞，但越界目标', 2);
    expect(app.events).toHaveLength(0);
    await ingest('10003', '给我贴个赞', 3);
    expect(app.events.filter((e) => 'reaction' in e.payload)).toHaveLength(1);
    expect(app.events[0]).toMatchObject({
      chatKey: 'group:1',
      payload: { reaction: { messageId: '10003', emojiId: '128077' } },
    });
    expect(storage.messages('group:1').filter((m) => m.self)).toHaveLength(0);
    expect(
      storage
        .archives()
        .filter((a) => !a.mode)
        .every((a) => a.sent === 0),
    ).toBe(true);
  },
);
async function fixture(settings: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-protocol-'));
  cleanups.push(() => {
    const actual = fs.realpathSync(root);
    if (
      path.dirname(actual) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(actual).startsWith('harness-protocol-')
    )
      throw new Error('清理越界');
    fs.rmSync(actual, { recursive: true, force: true });
  });
  for (const id of ['typing-indicator', 'msg-reaction']) {
    const folder = path.join(source, id),
      target = path.join(root, 'extensions/plugins', id),
      manifest = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'));
    await compileLegacyPackage(folder, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
  }
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T06:40:00Z'));
  const options = {
    dataDir: path.join(root, 'data'),
    v2ExtensionDir: path.join(root, 'extensions'),
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      acceptAllSessions: true,
      defaults: { wakeDelayMs: 0 },
      send: { minIntervalMs: 0, dedupeMs: 0 },
      legacyGlobal: { skills: settings },
    },
  };
  const app = await createApplication(options);
  cleanups.push(app.stop);
  const adapter = app.runtime.use(adapterService),
    events: { chatKey: string; payload: OutboundPayload }[] = [];
  let id = 70000;
  vi.spyOn(adapter, 'sendPayload').mockImplementation(async (chatKey, payload, signal) => {
    signal.throwIfAborted();
    events.push({ chatKey, payload });
    if ('segments' in payload) adapter.sent!.push({ chatKey, text: JSON.stringify(payload) });
    return { id: String(++id) };
  });
  vi.spyOn(adapter, 'send').mockImplementation(async (chatKey, text, signal) => {
    signal.throwIfAborted();
    adapter.sent!.push({ chatKey, text });
    return { id: String(++id) };
  });
  return { ...app, root, options, events };
}
async function settle(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await vi.advanceTimersByTimeAsync(5);
  expect(predicate()).toBe(true);
}
const finish = {
  message: {
    role: 'assistant' as const,
    content: null,
    tool_calls: [
      {
        id: 'finish',
        type: 'function' as const,
        function: { name: 'finish', arguments: '{"mode":"silent","silentReason":"仅验证协议"}' },
      },
    ],
  },
  usage: { input: 0, output: 0 },
};

test.skipIf(!fs.existsSync(source))(
  '旧正在输入跟随私聊模型等待、真实出站及收尾，状态不计发言，停用不留下刷新任务',
  async () => {
    const app = await fixture({
        'typing-indicator': { enabled: true, firstDelayMs: 0 },
        'msg-reaction': { enabled: false },
      }),
      storage = app.runtime.use(storageService);
    let complete!: (result: typeof finish) => void;
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await app.runtime.use(conversationService).ingest({
      id: '10001',
      chatKey: 'private:12345',
      senderId: '12345',
      senderName: '测试',
      text: '请稍等',
      atMe: true,
      timestamp: Date.now(),
    });
    await settle(() => Boolean(complete));
    await vi.advanceTimersByTimeAsync(1500);
    await settle(() => app.events.some((e) => 'typing' in e.payload));
    const agent = app.runtime.listRuns().find((r) => r.mode === 'agent.basic')!;
    expect(app.events[0]).toMatchObject({ chatKey: 'private:12345', payload: { typing: { eventType: 1 } } });
    expect(hasOutboundEffect(storage, agent.id, 'private:12345')).toBe(false);
    expect(storage.messages('private:12345').filter((m) => m.self)).toHaveLength(0);
    complete(finish);
    await settle(() => storage.archives().some((a) => a.id === agent.id));
    const count = app.events.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(app.events).toHaveLength(count);
    expect(storage.archives().find((a) => a.id === agent.id)?.sent).toBe(0);
    await app.runtime.use(extensionService).configure('typing-indicator', { enabled: false });
    await vi.advanceTimersByTimeAsync(20000);
    expect(app.events).toHaveLength(count);
    expect(app.runtime.use(adapterService).sent).toHaveLength(0);
  },
);

test.skipIf(!fs.existsSync(source))(
  '旧表情回应观察已成功消息、遵守概率和每日上限，重载不重复观察且不伪造聊天消息',
  async () => {
    const app = await fixture({
        'typing-indicator': { enabled: false },
        'msg-reaction': {
          enabled: true,
          mode: '随机贴一个',
          probabilityPercent: 100,
          minGapSec: 0,
          maxPerHour: 1,
          maxPerDay: 1,
          delayMinSec: 0.5,
          delayMaxSec: 0.5,
          emojiIds: '128077',
        },
      }),
      storage = app.runtime.use(storageService);
    const rounds = new Map<string, number>();
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(
      async (_messages, _tools, _signal, context) => {
        const round = (rounds.get(context!.runId!) ?? 0) + 1;
        rounds.set(context!.runId!, round);
        return round === 1
          ? {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'send',
                    type: 'function',
                    function: { name: 'send_message', arguments: '{"messages":["原始消息"]}' },
                  },
                ],
              },
              usage: { input: 0, output: 0 },
            }
          : {
              ...finish,
              message: {
                ...finish.message,
                tool_calls: [
                  {
                    id: 'finish',
                    type: 'function',
                    function: { name: 'finish', arguments: '{"mode":"spoken"}' },
                  },
                ],
              },
            };
      },
    );
    const ingest = async (id: string, count: number) => {
      await app.runtime.use(conversationService).ingest({
        id,
        chatKey: 'group:1',
        senderId: '12345',
        senderName: '测试',
        text: '回复一下',
        atMe: true,
        timestamp: Date.now(),
      });
      await settle(() => storage.archives().filter((a) => !a.mode).length === count);
    };
    await ingest('10001', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await settle(() => app.events.filter((e) => 'reaction' in e.payload).length === 1);
    expect(app.events.find((e) => 'reaction' in e.payload)).toMatchObject({
      chatKey: 'group:1',
      payload: { reaction: { messageId: '70001', emojiId: '128077', set: true } },
    });
    expect(storage.messages('group:1').filter((m) => m.self)).toHaveLength(1);
    await app.runtime.use(extensionService).reload();
    await ingest('10002', 2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(app.events.filter((e) => 'reaction' in e.payload)).toHaveLength(1);
    expect(storage.messages('group:1').filter((m) => m.self)).toHaveLength(2);
  },
);
