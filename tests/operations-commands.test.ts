import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { adapterService, conversationService, modelService, systemControlService } from '@qq-harness/domain';
import { createApplication } from '../apps/server/src/app.js';

const network = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('@qq-harness/files', async (original) => ({ ...(await original<object>()), publicFetch: network }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  network.mockReset();
  for (const stop of cleanup.splice(0).reverse()) await stop();
});
async function fixture(credentials = {}) {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ops-commands-')),
    v2Managers: false,
    extensionHotReload: false,
    allowedChats: ['private:11111'],
    initialConfig: {
      acceptAllSessions: false,
      send: { minIntervalMs: 0, dedupeMs: 0, perMinute: 100, perHour: 1000 },
      operations: { privateEnabled: true, allowedIds: ['11111'], ...credentials },
    },
  });
  cleanup.push(app.stop);
  const sent = app.runtime.use(adapterService).sent!,
    control = app.runtime.use(systemControlService);
  const model = vi.spyOn(app.runtime.use(modelService), 'complete');
  const command = async (text: string) => {
    const before = sent.length;
    await app.runtime
      .use(conversationService)
      .ingest({
        id: randomUUID(),
        chatKey: 'private:11111',
        senderId: '11111',
        senderName: '测试',
        text,
        atMe: false,
        timestamp: Date.now(),
      });
    expect(sent).toHaveLength(before + 1);
    expect(model).not.toHaveBeenCalled();
    return sent.at(-1)!.text;
  };
  return { ...app, sent, control, command };
}

test('全部只读运维命令、大小写、帮助和错误参数均走运维回执，不调用模型', async () => {
  const f = await fixture();
  for (const [input, expected] of [
    ['/ctrl 状态', '系统：在线'],
    ['/CTRL STATUS', 'OneBot：'],
    ['/ctrl 诊断', '失败插件：无'],
    ['/ctrl 系统', 'CPU：'],
    ['/ctrl SYSTEM', '后端内存：'],
    ['/ctrl 用量', '今日：'],
    ['/ctrl USAGE', '近七天：'],
    ['/ctrl 余额', 'opencode-go（unconfigured）'],
    ['/ctrl BALANCE GO', '未配置凭据'],
    ['/ctrl 余额 全部', 'mimo（unconfigured）'],
    ['/ctrl 余额 智谱', 'glm（unconfigured）'],
    ['/ctrl 余额 小米', 'mimo（unconfigured）'],
    ['/ctrl 余额 deepseek', 'deepseek（unconfigured）'],
    ['/ctrl 余额 invalid', '未知渠道'],
    ['/ctrl', '运维指令：'],
    ['／ctrl 帮助', '运维指令：'],
    ['/ctrl help', '运维指令：'],
    ['/ctrl 未知命令', '运维指令：'],
    ['/ctrl 上线 多余参数', '运维指令：'],
    ['/ctrl 余额 go extra', '运维指令：'],
  ])
    expect(await f.command(input!)).toContain(expected);
  expect(network).not.toHaveBeenCalled();
  expect(f.control.get().state).toBe('online');
});

test('所有上下线别名可以往返，离线期间各只读命令仍有回执', async () => {
  const f = await fixture();
  for (const [offline, online] of [
    ['下线 测试', '上线'],
    ['OFFLINE testing', 'ONLINE'],
    ['关闭', '恢复'],
  ]) {
    expect(await f.command('/ctrl ' + offline)).toContain('系统已下线');
    expect(f.control.get().state).toBe('offline');
    for (const [input, expected] of [
      ['状态', '系统：下线'],
      ['系统', 'CPU：'],
      ['诊断', '失败插件：无'],
      ['用量', '本地归档用量'],
      ['余额', '未配置凭据'],
      ['帮助', '运维指令：'],
    ])
      expect(await f.command('/ctrl ' + input)).toContain(expected);
    expect(await f.command('/ctrl ' + online)).toContain('历史积压已跳过');
    expect(f.control.get().state).toBe('online');
  }
});

test('渠道失败不阻止其他渠道，并在私聊指令日志中记为失败', async () => {
  network.mockImplementation(async (input) =>
    String(input).includes('opencode')
      ? new Response('', { status: 401 })
      : Response.json({ balance_infos: [{ total_balance: '12.5', currency: 'CNY' }] }),
  );
  const f = await fixture({ opencodeGoKey: 'fixture-go', deepseekKey: 'fixture-deepseek' });
  const text = await f.command('/ctrl 余额');
  expect(text).toContain('opencode-go（unauthorized）');
  expect(text).toContain('deepseek（ok）');
  expect(text).toContain('12.5');
  expect(text).not.toContain('fixture-');
  expect(f.control.logs().findLast((log) => log.source === 'private')).toMatchObject({
    action: '余额',
    status: 'failed',
  });
  expect(await f.command('/ctrl 状态')).toContain('系统：在线');
});
