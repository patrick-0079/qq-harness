import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { operationsSettingsSchema, type IncomingMessage } from '@qq-harness/contracts';
import {
  configService,
  storageService,
  accessService,
  adapterService,
  outboundService,
  httpService,
  systemControlService,
  operationsIngressService,
  networkProxyService,
} from '@qq-harness/domain';
import { redactConfigTree, restoreMaskedSecrets, redactKnownSecrets, publicFetch } from '@qq-harness/files';
import { createBalanceQuery, normalizeChannel, type BalanceResult } from './balance.js';

export const opsControl = definePlugin({
  id: 'ops-control',
  name: '运维控制台',
  client: { entry: 'builtin:ops-control' },
  requires: [
    configService.id,
    storageService.id,
    accessService.id,
    adapterService.id,
    outboundService.id,
    httpService.id,
    systemControlService.id,
  ],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      control = ctx.use(systemControlService),
      outbound = ctx.use(outboundService);
    const api = new Hono(),
      balance = createBalanceQuery(((input, init) => {
        const url = String(input),
          origin = new URL(url).origin;
        let proxy;
        try {
          proxy = ctx.use(networkProxyService).get();
        } catch {}
        return publicFetch(url, {
          headers: Object.fromEntries(new Headers(init?.headers)),
          signal: init?.signal ?? undefined,
          maxBytes: 2 * 1024 * 1024,
          proxy: proxy?.webFetch === false ? undefined : proxy,
          allowUrl: (target) => {
            if (target.origin !== origin) throw Error('渠道接口跨站重定向已拒绝');
          },
        });
      }) as typeof fetch),
      responses = new Map<string, { ticket: string; chatKey: string; text: string }>();
    const publicSettings = () => {
      const s = config.get().operations;
      return redactConfigTree({
        ...s,
        opencodeGoKey: s.opencodeGoKey ? '******' : '',
        deepseekKey: s.deepseekKey ? '******' : '',
        glmKey: s.glmKey ? '******' : '',
      });
    };
    const summary = () => {
      const plugins = ctx.host.listPlugins(),
        runs = ctx.host.listRuns();
      const processState = async (id: string, token: string) => {
        try {
          return await ctx.use<any>({ id: token }).status();
        } catch {
          return { phase: plugins.find((p) => p.id === id)?.status ?? 'unavailable' };
        }
      };
      return Promise.all([
        processState('qq-portable', 'harness.qq-portable'),
        processState('snowluma-runtime', 'harness.snowluma'),
      ]).then(([qq, snowluma]) => ({
        presence: control.get(),
        adapter: { kind: ctx.use(adapterService).kind, connected: ctx.use(adapterService).connected() },
        qq: { state: qq.phase ?? 'unknown', pid: qq.pid },
        snowluma: { state: snowluma.phase ?? 'unknown', pid: snowluma.pid },
        plugins: {
          active: plugins.filter((p) => p.status === 'active').length,
          failed: plugins.filter((p) => p.status === 'failed').map((p) => ({ id: p.id, status: p.status })),
        },
        tasks: {
          running: runs.filter((r) => r.status === 'running').length,
          queued: runs.filter((r) => r.status === 'queued').length,
        },
        memory: {
          active: plugins.some((p) => p.id === 'agent-memory' && p.status === 'active'),
          running: runs.filter((r) => r.mode === 'memory.agent' && r.status === 'running').length,
        },
        recentFailures: storage
          .archives()
          .filter((a) => a.status === 'failed')
          .sort((a, b) => b.endedAt - a.endedAt)
          .slice(0, 10)
          .map((a) => ({ id: a.id, mode: a.mode, at: a.endedAt, status: a.status })),
      }));
    };
    const resources = async () => {
      const snapshot = () =>
        os.cpus().reduce(
          (v, c) => ({
            idle: v.idle + c.times.idle,
            total: v.total + Object.values(c.times).reduce((a, b) => a + b, 0),
          }),
          { idle: 0, total: 0 },
        );
      const a = snapshot();
      await delay(250, undefined, { signal: ctx.signal });
      const b = snapshot();
      return {
        at: Date.now(),
        cpuPercent: b.total > a.total ? 100 * (1 - (b.idle - a.idle) / (b.total - a.total)) : 0,
        cores: os.cpus().length,
        memoryTotal: os.totalmem(),
        memoryUsed: os.totalmem() - os.freemem(),
        processMemory: process.memoryUsage().rss,
        uptimeSeconds: process.uptime(),
      };
    };
    const usage = () => {
      const all = storage.archives(),
        now = Date.now();
      return {
        at: now,
        source: '本地运行归档；费用缺少计价或币种不一致时不估算',
        periods: Object.fromEntries(
          [
            ['today', new Date().setHours(0, 0, 0, 0)],
            ['week', now - 7 * 86400000],
            ['month', now - 30 * 86400000],
          ].map(([key, since]) => {
            const records = all.filter((a) => a.startedAt >= Number(since)),
              measured = records.filter((a) => a.usage.input + a.usage.output > 0),
              models = measured.flatMap((a) => a.usage.models ?? []),
              currencies = [...new Set(models.map((m) => m.currency))];
            const known =
              measured.length > 0 &&
              measured.every((a) => a.usage.models?.length && a.usage.models.every((m) => m.cost !== null)) &&
              currencies.length === 1;
            return [
              key,
              {
                runs: records.length,
                input: records.reduce((s, a) => s + a.usage.input, 0),
                output: records.reduce((s, a) => s + a.usage.output, 0),
                cost: known ? models.reduce((s, m) => s + (m.cost ?? 0), 0) : null,
                currency: known ? currencies[0] : null,
              },
            ];
          }),
        ) as Record<
          string,
          {
            runs: number;
            input: number;
            output: number;
            cost: number | null;
            currency: string | null | undefined;
          }
        >,
      };
    };
    const balances = async (channel: string) => {
      const result = await balance(config.get().operations, channel, ctx.signal);
      for (const item of result.filter((i) => !['ok', 'unconfigured'].includes(i.status)))
        control.log({
          source: 'operations',
          actor: 'system',
          action: 'balance',
          status: 'failed',
          message: `${item.channel}：${item.lines.join('；')}`,
        });
      return redactKnownSecrets(result, config.get()) as BalanceResult[];
    };
    api.onError((e, c) =>
      c.json(
        {
          error: {
            code: e instanceof z.ZodError ? 'INVALID_INPUT' : 'OPERATIONS_FAILED',
            message: e instanceof z.ZodError ? '运维设置或请求格式无效' : e.message,
          },
        },
        e instanceof z.ZodError ? 400 : 409,
      ),
    );
    api.get('/api/operations/status', async (c) => c.json(await summary()));
    api.get('/api/operations/resources', async (c) => c.json(await resources()));
    api.get('/api/operations/usage', (c) => c.json(usage()));
    api.post('/api/operations/balances', async (c) => {
      const value = z
        .object({ channel: z.string().default('all') })
        .strict()
        .parse(await c.req.json());
      return c.json({ items: await balances(value.channel) });
    });
    api.get('/api/operations/logs', (c) => c.json({ items: control.logs().slice().reverse() }));
    api.get('/api/operations/settings', (c) => c.json(publicSettings()));
    api.patch('/api/operations/settings', async (c) => {
      const input = z.record(z.string(), z.unknown()).parse(await c.req.json());
      const parsed = operationsSettingsSchema.partial().strict().parse(input);
      // Zod applies field defaults even under partial(). PATCH must retain all
      // omitted fields, particularly credentials and the authorization list.
      const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(input, key)));
      config.patch({ operations: restoreMaskedSecrets(patch, config.get().operations) });
      control.log({
        source: 'web',
        actor: 'console',
        action: 'settings',
        status: 'ok',
        message: '运维设置已更新',
      });
      return c.json(publicSettings());
    });
    ctx.effect(ctx.use(httpService).register('/api/operations', (r) => api.fetch(r)));
    ctx.mode({
      id: 'ops.reply',
      lane: 'control',
      partitionKey: () => 'ops-replies',
      input: z.object({ id: z.string().uuid() }),
      execute: async (run, input) => {
        const response = responses.get(input.id);
        responses.delete(input.id);
        if (!response) throw Error('运维回执已失效');
        const revoke = control.grantReply(run, response.ticket, response.text);
        try {
          return await outbound.send(run, response.chatKey, response.text);
        } finally {
          revoke();
        }
      },
    });
    const reply = async (message: IncomingMessage, text: string, ticket: string) => {
      const id = randomUUID();
      responses.set(id, { ticket, chatKey: message.chatKey, text });
      try {
        const run = ctx.host.submit({
          mode: 'ops.reply',
          partitionKey: 'ops-replies',
          input: { id },
          timeoutMs: 15000,
          maxWaitMs: 30000,
        });
        const result = await ctx.host.wait(run.id);
        if (result.status !== 'completed') throw Error('运维回执发送失败');
      } finally {
        responses.delete(id);
      }
    };
    const help =
      '运维指令：/ctrl 状态｜下线 [原因]｜上线｜系统｜诊断｜用量｜余额 [opencode-go/deepseek/glm/mimo]｜帮助。下线时记忆维护继续，上线跳过历史积压。';
    const handle = async (message: IncomingMessage) => {
      if (!control.authorized(message)) throw Error('运维指令未获授权');
      const key = `${message.chatKey}:${message.id}`;
      if (storage.state('operations-commands', key)) return;
      storage.setState('operations-commands', key, { at: Date.now() });
      const ticket = control.issue(message),
        body = message.text.trim().replace(/^[/／]ctrl\b\s*/i, ''),
        [word = '', ...args] = body.split(/\s+/);
      const command = word.toLowerCase();
      const logAction = [
        '下线',
        'offline',
        '关闭',
        '上线',
        'online',
        '恢复',
        '状态',
        'status',
        '诊断',
        '系统',
        'system',
        '用量',
        'usage',
        '余额',
        'balance',
      ].includes(command)
        ? command
        : 'help';
      let text: string;
      let failed = false;
      try {
        if (['下线', 'offline', '关闭'].includes(command)) {
          control.change(
            { state: 'offline', reason: args.join(' '), requestId: key },
            'private',
            message.senderId,
          );
          text = '系统已下线。对话和推送已停止；记忆维护继续。';
        } else if (['上线', 'online', '恢复'].includes(command) && !args.length) {
          control.change({ state: 'online', requestId: key }, 'private', message.senderId);
          text = '系统已上线，历史积压已跳过。';
        } else if (['状态', 'status', '诊断'].includes(command) && !args.length) {
          const s = await summary();
          text = `系统：${s.presence.state === 'online' ? '在线' : '下线'}\nOneBot：${s.adapter.connected ? '已连接' : '未连接'}\n插件：${s.plugins.active} 正常，${s.plugins.failed.length} 失败\n任务：${s.tasks.running} 执行，${s.tasks.queued} 排队\n记忆 Agent：${s.memory.active ? '可用' : '不可用'}\n近期失败：${s.recentFailures.length} 项${word === '诊断' ? `\n失败插件：${s.plugins.failed.map((p) => p.id).join('、') || '无'}` : ''}`;
        } else if (['系统', 'system'].includes(command) && !args.length) {
          const s = await resources();
          text = `CPU：${s.cpuPercent.toFixed(1)}%（${s.cores} 核）\n主机内存：${(s.memoryUsed / 2 ** 30).toFixed(2)}/${(s.memoryTotal / 2 ** 30).toFixed(2)} GB\n后端内存：${(s.processMemory / 2 ** 20).toFixed(0)} MB\n后端运行：${Math.floor(s.uptimeSeconds / 60)} 分钟`;
        } else if (['用量', 'usage'].includes(command) && !args.length) {
          const u = usage();
          text =
            '本地归档用量\n' +
            Object.entries(u.periods)
              .map(
                ([k, v]) =>
                  `${k === 'today' ? '今日' : k === 'week' ? '近七天' : '近三十天'}：${v.runs} 次，输入 ${v.input}，输出 ${v.output} token，费用 ${v.cost === null ? '未知' : `${v.cost} ${v.currency}`}`,
              )
              .join('\n');
        } else if (['余额', 'balance'].includes(command) && args.length <= 1) {
          const results = await balances(normalizeChannel(args[0] ?? 'all'));
          failed = results.some((r) => !['ok', 'unconfigured'].includes(r.status));
          text = results.map((r) => `${r.channel}（${r.status}）\n${r.lines.join('\n')}`).join('\n\n');
        } else text = help;
        control.log({
          source: 'private',
          actor: message.senderId,
          action: logAction,
          status: failed ? 'failed' : 'ok',
          message: failed ? '渠道查询失败，详情见渠道查询记录' : '运维指令已处理',
        });
      } catch (e) {
        text = e instanceof Error ? e.message : '运维指令处理失败';
        control.log({
          source: 'private',
          actor: message.senderId,
          action: logAction,
          status: 'failed',
          message: '运维指令处理失败',
        });
      }
      try {
        await reply(message, text, ticket);
      } catch (error) {
        control.log({
          source: 'private',
          actor: message.senderId,
          action: 'reply',
          status: 'failed',
          message: '运维回执发送失败，请核对连接和发送记录',
        });
        throw error;
      }
    };
    ctx.provide(operationsIngressService, { handle });
    ctx.effect(() => responses.clear());
  },
});
