import { liveScope } from './live-scope.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createApplication } from '../apps/server/src/app.js';
import { configSchema, messageSegments } from '@qq-harness/contracts';
import {
  adapterService,
  configService,
  outboundService,
  storageService,
  toolService,
  type ToolContext,
} from '@qq-harness/domain';
import { modelMock } from '../plugins/model-mock/src/index.js';
import { writeJsonAtomic } from '@qq-harness/files';

// Manual live verification, explicitly authorized by the user. Never part of automated tests.
if (!process.argv.includes('--live')) throw Error('人工真实 QQ 联调必须显式传入 --live');
const root = fileURLToPath(new URL('../', import.meta.url));
const { privateId, groupId, allowedChats } = liveScope();
const dataDir = path.join(root, 'var', 'live-management-' + Date.now());
fs.mkdirSync(dataDir, { recursive: true });
// Copy protocol connection settings only. No production histories, memories or model credentials.
const production = JSON.parse(fs.readFileSync(path.join(root, 'var/production/config.json'), 'utf8'));
const initialConfig = configSchema.parse({
  onebot: production.onebot,
  acceptAllSessions: false,
  admissions: [...allowedChats],
  paused: true,
  defaults: { online: false, maxReplyMessages: 5, memory: { enabled: false }, tools: { enabled: true } },
  plugins: {
    'model-openai': false,
    'model-opencode': false,
    'agent-memory': false,
    reminders: false,
    'command-direct': false,
  },
  send: { minIntervalMs: 1500, dedupeMs: 15000, perMinute: 12 },
});
const evidence = {
  at: new Date().toISOString(),
  scope: allowedChats,
  productionChanged: false,
  checks: [] as Record<string, unknown>[],
};
const record = (name: string, passed: boolean, details: Record<string, unknown> = {}) => {
  const item = { name, passed, ...details };
  evidence.checks.push(item);
  console.log(JSON.stringify(item));
};
let app: Awaited<ReturnType<typeof createApplication>> | undefined;
try {
  app = await createApplication({
    dataDir,
    demo: false,
    initialConfig,
    allowedChats,
    v2Managers: false,
    extensionHotReload: false,
    snowluma: { allowLaunch: false },
    qqPortable: { allowLaunch: false },
    containers: { allowOperations: false },
    plugins: [
      modelMock,
      {
        id: 'manual-management-verification',
        requires: [toolService.id, outboundService.id],
        setup(ctx) {
          ctx.mode({
            id: 'verify.management',
            input: z.object({ chatKey: z.enum(allowedChats) }),
            async execute(run, { chatKey }) {
              const adapter = ctx.use(adapterService),
                tools = ctx.use(toolService),
                outbound = ctx.use(outboundService),
                storage = ctx.use(storageService);
              const budget = outbound.openReplyBudget!(run, 5);
              const c: ToolContext = {
                run,
                chatKey,
                settings: ctx.use(configService).effective(chatKey),
                sent: 0,
                trace: () => {},
              };
              const call = (name: string, args: unknown) =>
                tools.execute(c, name, JSON.stringify(args)) as Promise<any>;
              const requireOk = (result: any) => {
                if (result.isError || result.failed?.length)
                  throw Error(result.error ?? result.failed?.[0]?.error ?? '工具调用失败');
                return result;
              };
              try {
                const group = chatKey.startsWith('group:');
                let target = privateId;
                if (group) {
                  try {
                    await adapter.query(
                      'get_group_member_info',
                      { group_id: Number(groupId), user_id: Number(target) },
                      run.signal,
                    );
                  } catch {
                    target = String(((await adapter.query('get_login_info', {}, run.signal)) as any).user_id);
                  }
                }
                const first = requireOk(
                  await call('send_message', {
                    messages: ['【qq-harness联调 1/5】验证消息、引用、@与五条上限，无需回复。'],
                  }),
                );
                const sourceId = first.messageIds[0] as string;
                const source = (await adapter.query(
                  'get_msg',
                  { message_id: Number(sourceId) },
                  run.signal,
                )) as any;
                const result = requireOk(
                  await call('send_message', {
                    messages: [
                      '【qq-harness联调 2/5】此条普通消息不引用。',
                      `⟦reply:${sourceId}⟧【qq-harness联调 3/5】此条自主引用首条消息。`,
                      group
                        ? `⟦reply:${sourceId}⟧⟦at:${target}⟧【qq-harness联调 4/5】此条同时引用与提及。`
                        : '【qq-harness联调 4/5】准备验证拍一拍与额度拦截。',
                    ],
                  }),
                );
                const poke = requireOk(await call('send_poke', { targetUserId: target }));
                const sixth = await call('send_message', {
                  messages: ['此条超过上限，不应送达。', '此条也不应送达。'],
                });
                record(
                  'shared-budget-and-hard-stop',
                  budget.used() === 5 &&
                    budget.exceeded() &&
                    sixth.limitReached === true &&
                    sixth.messageIds.length === 0,
                  {
                    chatKey,
                    used: budget.used(),
                    blocked: sixth.limitReached === true,
                    poke: poke.poked === true,
                  },
                );
                for (const [index, id] of result.messageIds.entries()) {
                  const remote = (await adapter.query(
                    'get_msg',
                    { message_id: Number(id) },
                    run.signal,
                  )) as any;
                  const segments = messageSegments(remote.message ?? remote.raw_message);
                  const quote = segments.find((s) => s.type === 'reply');
                  const at = segments.find((s) => s.type === 'at');
                  const noMarker = !segments.some(
                    (s) => s.type === 'text' && /⟦|⟧/.test(String(s.data.text)),
                  );
                  // Some OneBot implementations report a private reply using message_seq.
                  const valid =
                    index === 0 || (!group && index === 2)
                      ? !quote
                      : [sourceId, String(source?.message_seq)].includes(String(quote?.data.id));
                  record(
                    index === 0
                      ? 'plain-second-message'
                      : index === 1
                        ? 'quote-third-message'
                        : group
                          ? 'combined-quote-and-at'
                          : 'plain-fourth-message',
                    Boolean(valid && noMarker && (!group || index !== 2 || String(at?.data.qq) === target)),
                    { chatKey, segmentTypes: segments.map((s) => s.type), markerHidden: noMarker },
                  );
                }
                record(
                  'only-five-outbound-effects',
                  (storage.state('outbound-attempts', run.id) as any[]).filter((a) => a.status !== 'failed')
                    .length === 5,
                  { chatKey },
                );
              } finally {
                budget.release();
              }
            },
          });
        },
      },
    ],
  });
  const until = Date.now() + 20000;
  while (!app.runtime.use(adapterService).connected() && Date.now() < until)
    await new Promise((r) => setTimeout(r, 100));
  if (!app.runtime.use(adapterService).connected()) throw Error('OneBot 连接未就绪');
  for (const chatKey of allowedChats) {
    const run = app.runtime.submit({
      mode: 'verify.management',
      partitionKey: chatKey,
      input: { chatKey },
      timeoutMs: 120000,
    });
    const result = await app.runtime.wait(run.id);
    if (result.status !== 'completed')
      record('live-run', false, {
        chatKey,
        error: String(result.error)
          .replace(/https?:\/\/\S+/g, '[URL]')
          .slice(0, 400),
      });
  }
} finally {
  await app?.stop();
  writeJsonAtomic(path.join(dataDir, 'evidence.json'), evidence);
  console.log(
    JSON.stringify({
      evidence: path.join(dataDir, 'evidence.json'),
      passed: evidence.checks.filter((c) => c.passed).length,
      total: evidence.checks.length,
    }),
  );
}
if (!evidence.checks.length || evidence.checks.some((c) => !c.passed)) process.exitCode = 1;
