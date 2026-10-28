import { liveScope } from './live-scope.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createApplication } from '../apps/server/src/app.js';
import { modelMock } from '../plugins/model-mock/src/index.js';
import {
  configService,
  storageService,
  systemControlService,
  adapterService,
  outboundService,
  conversationService,
  memoryAgentService,
} from '@qq-harness/domain';
import { writeJsonAtomic } from '@qq-harness/files';

// Explicitly authorized manual QQ verification. Not loaded by automated test runners.
if (!process.argv.includes('--live')) throw Error('真实 QQ 联调需要显式 --live');
const root = fileURLToPath(new URL('../', import.meta.url)),
  base = 'http://127.0.0.1:3310';
const { privateId, allowedChats } = liveScope();
const production = JSON.parse(fs.readFileSync(path.join(root, 'var/production/config.json'), 'utf8'));
const dataDir = path.join(root, 'var', 'live-system-control-' + Date.now());
const checks: { name: string; passed: boolean; details?: unknown }[] = [];
const record = (name: string, passed: boolean, details?: unknown) => {
  checks.push({ name, passed, details });
  if (!passed) throw Error('人工联调失败：' + name);
  console.log(JSON.stringify({ name, passed, details }));
};
const ops = production.operations ?? { privateEnabled: false, allowedIds: [] };
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
try {
  app = await createApplication({
    dataDir,
    demo: false,
    allowedChats,
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      onebot: production.onebot,
      acceptAllSessions: false,
      admissions: allowedChats,
      defaults: { online: false, memory: { enabled: true } },
      operations: { privateEnabled: ops.allowedIds.includes(privateId), allowedIds: ops.allowedIds },
      plugins: {
        'model-openai': false,
        'model-opencode': false,
        'snowluma-runtime': false,
        'qq-portable': false,
        'conversation-proactive': false,
      },
      send: { minIntervalMs: 500, dedupeMs: 0 },
    },
    plugins: [modelMock],
  });
  const runtime = app.runtime,
    control = runtime.use(systemControlService),
    adapter = runtime.use(adapterService),
    storage = runtime.use(storageService);
  const deadline = Date.now() + 15000;
  while (!adapter.connected() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  record('真实 OneBot 已连接；仅两个指定会话', adapter.connected());
  runtime.install({
    id: 'manual-system-check',
    setup(ctx) {
      ctx.mode({
        id: 'manual.system.send',
        input: z.object({ chatKey: z.string() }),
        execute: async (run, input) =>
          ctx
            .use(outboundService)
            .send(run, input.chatKey, '【qq-harness 运维联调】上线后的发送通道验证；离线积压不会补发。'),
      });
    },
  });
  await runtime.settled();
  control.change({ state: 'offline', requestId: randomUUID() }, 'verification', 'manual');
  for (const chatKey of allowedChats) {
    let blocked = false;
    try {
      runtime.submit({ mode: 'manual.system.send', partitionKey: chatKey, input: { chatKey } });
    } catch {
      blocked = true;
    }
    record('离线阻止发送：' + chatKey, blocked);
  }
  record(
    '离线期间没有协议发送',
    allowedChats.every((key) => storage.messages(key).every((m) => !m.self)),
  );
  const memory = runtime.use(memoryAgentService),
    task = memory.request({
      chatKey: allowedChats[0]!,
      tier: 'medium',
      instruction: '本次仅检查维护接口，没有新事实。请不修改任何记忆，使用 memory_finish 完成本次检查。',
    });
  const memoryDeadline = Date.now() + 15000;
  let status: string | undefined;
  while (Date.now() < memoryDeadline) {
    status = memory.requests(allowedChats[0]!).find((t) => t.id === task.id)?.status;
    if (status && !['queued', 'running'].includes(status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  record('离线时记忆 Agent 完成维护任务（mock 模型，无生产记忆）', status === 'completed');
  const privateControl = ops.allowedIds.includes(privateId);
  if (privateControl) {
    await runtime
      .use(conversationService)
      .ingest({
        id: 'manual-ctrl-' + randomUUID(),
        chatKey: allowedChats[0]!,
        senderId: privateId,
        senderName: '人工验收',
        text: '/ctrl 上线',
        atMe: false,
        timestamp: Date.now(),
      });
    record(
      '既有白名单私聊恢复，模拟入站＋真实 QQ 回执',
      control.get().state === 'online' &&
        storage.messages(allowedChats[0]!).some((m) => m.self && m.text.includes('历史积压已跳过')),
    );
  } else control.change({ state: 'online', requestId: randomUUID() }, 'verification', 'manual');
  for (const chatKey of allowedChats) {
    const run = runtime.submit({ mode: 'manual.system.send', partitionKey: chatKey, input: { chatKey } });
    const done = await runtime.wait(run.id);
    record('上线后真实 QQ 出站：' + chatKey, done.status === 'completed');
  }
  record(
    '未扩大白名单',
    JSON.stringify(runtime.use(configService).get().operations.allowedIds) === JSON.stringify(ops.allowedIds),
  );
  const controllerMessageIds = storage
    .messages(allowedChats[0]!)
    .filter((m) => m.self)
    .map((m) => m.id);
  record(
    '人工联调仅产生指定会话的消息',
    storage.chats().every((c) => allowedChats.includes(c.chatKey)),
    {
      privateSent: controllerMessageIds.length,
      groupSent: storage.messages(allowedChats[1]!).filter((m) => m.self).length,
    },
  );
} finally {
  await app?.stop();
  writeJsonAtomic(path.join(root, 'var/system-control-live-evidence.json'), {
    at: new Date().toISOString(),
    dataDir,
    base,
    scope: allowedChats,
    productionConfigurationModified: false,
    checks,
  });
}
