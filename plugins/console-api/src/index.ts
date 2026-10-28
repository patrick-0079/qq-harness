import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { management } from './management.js';
import { redactConfigTree } from '@qq-harness/files';
import {
  chatKeySchema,
  incomingSchema,
  managementScopeSchema,
  toolSettingsSchema,
} from '@qq-harness/contracts';
import {
  httpService,
  configService,
  systemControlService,
  storageService,
  adapterService,
  conversationService,
  memoryService,
  memoryAgentService,
  toolService,
  traceService,
  accessService,
  hasOutboundEffect,
} from '@qq-harness/domain';

export function consoleApi(demo: boolean) {
  return definePlugin({
    id: 'console-api',
    name: '控制台管理 API',
    requires: [httpService.id, configService.id, storageService.id, systemControlService.id],
    setup(ctx) {
      const http = ctx.use(httpService),
        config = ctx.use(configService),
        storage = ctx.use(storageService);
      const api = new Hono();
      api.get('/api/conversation/queue', (c) =>
        c.json({
          items: ctx
            .use(conversationService)
            .queue()
            .filter((e) => ctx.use(accessService).allowed(e.chatKey)),
        }),
      );
      api.onError((error, c) => {
        const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
        return c.json(
          {
            error: {
              code: invalid ? 'INVALID_INPUT' : 'REQUEST_FAILED',
              message: invalid ? '请求参数或 JSON 格式无效' : error.message,
            },
          },
          invalid ? 400 : 409,
        );
      });
      api.get('/api/status', (c) => {
        let adapter = { kind: 'unavailable', connected: false };
        try {
          const value = ctx.use(adapterService);
          adapter = { kind: value.kind, connected: value.connected() };
        } catch {
          /* 插件诊断必须在适配器停用后仍可访问。 */
        }
        return c.json({
          revision: ctx.host.revision,
          plugins: ctx.host.listPlugins(),
          runs: ctx.host.listRuns(),
          adapter,
          paused: config.get().paused,
          presence: ctx.use(systemControlService).get(),
          memoryMaintenance: {
            active: ctx.host.listPlugins().some((p) => p.id === 'agent-memory' && p.status === 'active'),
            runs: ctx.host.listRuns().filter((r) => r.mode === 'memory.agent' && r.status === 'running')
              .length,
          },
          demo,
        });
      });
      api.post('/api/pause', async (c) => {
        const { paused, skipBacklog } = z
          .object({
            paused: z.boolean(),
            skipBacklog: z.boolean().default(true),
          })
          .strict()
          .parse(await c.req.json());
        if (!paused && !skipBacklog)
          return c.json(
            { error: { code: 'BACKLOG_REPLAY_UNSUPPORTED', message: '上线只处理新消息，不支持补处理积压' } },
            400,
          );
        ctx
          .use(systemControlService)
          .change({ state: paused ? 'offline' : 'online', requestId: randomUUID() }, 'web', 'console');
        return c.json({ ok: true, paused, marked: 0, resumed: 0 });
      });
      api.delete('/api/pause', (c) => {
        ctx.use(systemControlService).change({ state: 'online', requestId: randomUUID() }, 'web', 'console');
        return c.json({ ok: true, paused: false, marked: {} });
      });
      api.get('/api/plugins', (c) =>
        c.json({
          revision: ctx.host.revision,
          plugins: ctx.host.listPlugins(),
        }),
      );
      api.get('/api/system/presence', (c) => c.json(ctx.use(systemControlService).get()));
      api.put('/api/system/presence', async (c) =>
        c.json(ctx.use(systemControlService).change(await c.req.json(), 'web', 'console')),
      );
      api.post('/api/plugins/:id/enabled', async (c) => {
        const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
        const id = c.req.param('id');
        // 关闭当前 HTTP 或配置宿主会切断保存路径；由启动 profile 管理这些基础服务。
        if (
          [
            'transport-http',
            'system-control',
            'console-api',
            'config-file',
            'storage-file',
            'storage-sqlite',
            'external-plugins',
          ].includes(id)
        )
          return c.json(
            {
              error: { code: 'HOST_REQUIRED', message: '该插件由启动配置管理' },
            },
            409,
          );
        await ctx.host.setEnabled(id, enabled);
        config.patch({ plugins: { [id]: enabled } });
        return c.json({ ok: true, revision: ctx.host.revision });
      });
      api.get('/api/config', (c) => c.json(config.public()));
      api.patch('/api/config', async (c) => {
        const patch = z.record(z.string(), z.unknown()).parse(await c.req.json());
        if ('paused' in patch || 'systemPresence' in patch || 'operations' in patch)
          return c.json(
            { error: { code: 'CONTROL_ENDPOINT_REQUIRED', message: '系统上下线和运维设置请使用专用接口' } },
            400,
          );
        if (
          patch.defaults &&
          typeof patch.defaults === 'object' &&
          'persona' in patch.defaults &&
          (patch.defaults as { persona?: unknown }).persona !== config.get().defaults.persona
        )
          throw Error('默认人设为只读；请在提示词管理中新建人设后选择');
        if ('plugins' in patch)
          return c.json(
            {
              error: {
                code: 'PLUGIN_ENDPOINT_REQUIRED',
                message: '插件启停请使用插件管理接口',
              },
            },
            400,
          );
        config.patch(patch);
        return c.json(config.public());
      });
      api.patch('/api/profiles/:chatKey', async (c) => {
        const key = chatKeySchema.parse(c.req.param('chatKey'));
        config.saveProfile(key, await c.req.json());
        if (!config.effective(key).online)
          storage.markRead(
            key,
            storage.unread(key).map((m) => m.localId),
          );
        return c.json(redactConfigTree(config.effective(key)));
      });
      api.delete('/api/profiles/:chatKey', (c) => {
        config.clearProfile(chatKeySchema.parse(c.req.param('chatKey')));
        return c.json({ ok: true });
      });
      const manage = management(ctx, api);
      api.get('/api/tools', (c) => {
        const scope = managementScopeSchema.parse(c.req.query('scope') || c.req.query('chat') || 'default');
        const settings = scope === 'default' ? config.get().defaults : config.effective(scope);
        return c.json({
          scope,
          settings: settings.tools,
          tools: ctx.use(toolService).catalog?.(scope) ?? [],
        });
      });
      api.patch('/api/tools/settings', async (c) => {
        const raw = await c.req.json();
        const body = z
          .object({
            scope: managementScopeSchema,
            patch: toolSettingsSchema.partial(),
          })
          .parse(raw);
        const patch = Object.fromEntries(
          Object.entries(body.patch).filter(([key]) => Object.hasOwn(raw.patch, key)),
        );
        if (body.scope === 'default') config.patch({ defaults: { tools: patch } });
        else config.saveProfile(body.scope, { tools: patch });
        return c.json({ ok: true });
      });
      api.get('/api/chats', async (c) => {
        await manage.refreshNames();
        return c.json(manage.directory());
      });
      api.get('/api/chats/:chatKey/messages', (c) =>
        c.json(
          c.req.query('page')
            ? manage.messages(c.req.param('chatKey'), c.req.query())
            : manage.messages(c.req.param('chatKey'), {
                page: '1',
                pageSize: '200',
              }).items,
        ),
      );
      api.get('/api/chats/:chatKey/settings', (c) =>
        c.json(
          redactConfigTree(
            c.req.param('chatKey') === 'default'
              ? config.get().defaults
              : config.effective(chatKeySchema.parse(c.req.param('chatKey'))),
          ),
        ),
      );
      api.get('/api/archives', (c) => {
        const chat = c.req.query('chat'),
          keys = chat ? manage.scope(chat) : undefined;
        if (c.req.query('page')) {
          const q = manage.pagination(c.req.query());
          return c.json(
            storage.queryArchives
              ? storage.queryArchives(keys, q)
              : manage.paginate(
                  storage
                    .archives()
                    .filter(
                      (a) =>
                        (!keys || keys.includes(a.chatKey)) &&
                        (!q.status || a.status === q.status) &&
                        (!q.query || JSON.stringify(a).includes(q.query)) &&
                        a.startedAt >= (q.from ?? 0) &&
                        a.startedAt <= (q.to ?? Infinity),
                    ),
                  q.page,
                  q.pageSize,
                ),
          );
        }
        return c.json(storage.archives().filter((a) => !keys || keys.includes(a.chatKey)));
      });
      api.get('/api/runs', (c) => c.json(ctx.host.listRuns()));
      api.post('/api/archives/:id/retry', (c) => {
        const archive = storage.archives().find((a) => a.id === c.req.param('id'));
        if (!archive) throw new Error('运行档案不存在');
        if (
          archive.status !== 'failed' ||
          archive.sent !== 0 ||
          (archive.mode && archive.mode !== 'agent.basic')
        )
          throw new Error('只允许重试尚未发言的失败对话运行');
        ctx.use(accessService).assert(archive.chatKey);
        if (config.get().paused || !config.effective(archive.chatKey).online)
          throw new Error('系统已暂停或该会话已下线');
        if (
          ctx.host
            .listRuns()
            .some((r) => r.partitionKey === archive.chatKey && ['running', 'queued'].includes(r.status))
        )
          throw new Error('该会话已有执行或排队中的运行');
        if (hasOutboundEffect(storage, archive.id, archive.chatKey))
          throw new Error('该运行已有发送或发送结果未知，不能直接重试，请先核对聊天记录');
        let ids = archive.triggerIds;
        if (!ids)
          try {
            const event = ctx
                .use(traceService)
                .get(archive.id)
                ?.events.find((e) => e.kind === 'trigger'),
              data = event?.data as { messages?: { localId?: number }[] } | undefined;
            ids = data?.messages?.flatMap((m) => (Number.isInteger(m.localId) ? [m.localId!] : []));
          } catch {
            /* 历史记录缺少详情时不能猜测触发消息 */
          }
        const messages = storage.messages(archive.chatKey),
          selected = messages.filter(
            (m) =>
              ids?.includes(m.localId) &&
              !m.self &&
              ctx.use(accessService).allowed(archive.chatKey, m.senderId),
          );
        if (!selected.length) throw new Error('原触发消息未保存、已删除或不可见，无法安全重试');
        const conversation = ctx.use(conversationService),
          restore = selected.filter((m) => m.read).map((m) => m.localId);
        storage.markRead(
          archive.chatKey,
          selected.map((m) => m.localId),
          false,
        );
        try {
          return c.json({
            ok: true,
            runId: conversation.retry(archive.chatKey, archive.id),
            restored: restore.length,
          });
        } catch (error) {
          storage.markRead(archive.chatKey, restore);
          throw error;
        }
      });
      api.post('/api/runs', async (c) => {
        const input = z
          .object({
            mode: z.string().min(1),
            partitionKey: z.string().min(1),
            input: z.unknown(),
            timeoutMs: z.number().int().min(0).max(3600000).optional(),
            maxWaitMs: z.number().int().min(0).max(3600000).optional(),
          })
          .parse(await c.req.json());
        return c.json(ctx.host.submit(input), 201);
      });
      api.post('/api/runs/:id/cancel', (c) => c.json({ ok: ctx.host.cancel(c.req.param('id')) }));
      api.post('/api/chats/:chatKey/retry', (c) =>
        c.json({
          id: ctx.use(conversationService).retry(chatKeySchema.parse(c.req.param('chatKey'))),
        }),
      );
      api.get('/api/chats/:chatKey/memory', (c) => {
        const key = chatKeySchema.parse(c.req.param('chatKey')),
          memory = ctx.use(memoryService);
        const migrated = memory.listHistory(key).some((r) => r.key.startsWith('legacy-text'));
        const text = memory
          .list(key)
          .filter((r) => r.key.startsWith('legacy-text'))
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((r) => r.text)
          .join('');
        return c.json({ text: migrated ? text : storage.memory(key) });
      });
      api.patch('/api/chats/:chatKey/memory', async (c) => {
        const key = chatKeySchema.parse(c.req.param('chatKey'));
        const { text } = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
        const agent = ctx.use(memoryAgentService);
        const targets = agent
          .list(key)
          .filter((r) => r.key.startsWith('legacy-text'))
          .map((r) => r.id);
        return c.json(
          agent.request({
            chatKey: key,
            tier: 'short',
            instruction: text
              ? '更正兼容文本记忆：' + JSON.stringify({ key: 'legacy-text', text })
              : '遗忘兼容文本记忆：',
            targetIds: targets,
          }),
          202,
        );
      });
      api.post('/api/demo/messages', async (c) => {
        if (!demo)
          return c.json(
            {
              error: {
                code: 'DEMO_DISABLED',
                message: '真实连接模式不开放模拟消息入口',
              },
            },
            403,
          );
        const message = incomingSchema.parse({
          id: randomUUID(),
          senderId: '10002',
          senderName: '测试用户',
          atMe: true,
          timestamp: Date.now(),
          ...(await c.req.json<Record<string, unknown>>()),
        });
        await ctx.use(conversationService).ingest(message);
        return c.json({ ok: true });
      });
      for (const prefix of [
        '/api/status',
        '/api/system',
        '/api/conversation',
        '/api/pause',
        '/api/plugins',
        '/api/config',
        '/api/profiles',
        '/api/chats',
        '/api/archives',
        '/api/runs',
        '/api/demo',
        '/api/catalogs',
        '/api/tools',
      ]) {
        ctx.effect(http.register(prefix, (request) => api.fetch(request)));
      }
    },
  });
}
