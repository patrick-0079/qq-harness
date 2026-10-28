import { chatNames } from './names.js';
import { z } from 'zod';
import type { Hono } from 'hono';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import {
  accessService,
  configService,
  storageService,
  outboundService,
  adapterService,
} from '@qq-harness/domain';
import {
  chatKeySchema,
  catalogTextSchema,
  providerSchema,
  compareChatNames,
  type ChatDirectoryEntry,
  type StoredMessage,
  type PageResult,
} from '@qq-harness/contracts';

export function management(ctx: PluginContext, api: Hono) {
  const config = ctx.use(configService),
    storage = ctx.use(storageService);
  const names = chatNames(storage, () => {
    try {
      return ctx.use(adapterService);
    } catch {
      return undefined;
    }
  });
  api.get('/api/chats/contacts', async (c) => {
    await names.refresh();
    return c.json({
      connected: ctx.use(adapterService).connected(),
      items: names.list().sort((a, b) => compareChatNames(a.name, b.name)),
    });
  });
  const scope = (key: string) =>
    key === 'default'
      ? directory()
          .filter((c) => !c.configured)
          .map((c) => c.chatKey)
      : [chatKeySchema.parse(key)];
  const directory = (): ChatDirectoryEntry[] => {
    const cfg = config.get(),
      existing = new Map(storage.chats().map((c) => [c.chatKey, c]));
    return [
      ...new Set([
        ...existing.keys(),
        ...cfg.admissions,
        ...Object.keys(cfg.profiles),
        ...Object.keys(cfg.chatMeta),
        ...cfg.deniedChats,
      ]),
    ]
      .map((chatKey) => {
        const row = existing.get(chatKey),
          meta = cfg.chatMeta[chatKey];
        return {
          chatKey,
          alias: meta?.alias ?? '',
          name:
            names.get(chatKey) ||
            (chatKey.startsWith('private:')
              ? storage.recent(chatKey, 1, 0, chatKey.split(':')[1])[0]?.senderName || ''
              : ''),
          displayName:
            meta?.alias ||
            names.get(chatKey) ||
            (chatKey.startsWith('private:')
              ? storage.recent(chatKey, 1, 0, chatKey.split(':')[1])[0]?.senderName || '未命名私聊'
              : '未命名群聊'),
          pinnedAt: meta?.pinnedAt ?? 0,
          configured: !!cfg.profiles[chatKey],
          admitted: cfg.admissions.includes(chatKey),
          allowed: ctx.use(accessService).allowed(chatKey),
          denied: cfg.deniedChats.includes(chatKey),
          online: config.effective(chatKey).online,
          messages: row?.messages ?? 0,
          unread: row?.unread ?? 0,
          lastText: row?.lastText ?? '',
        };
      })
      .sort(
        (a, b) =>
          Number(b.pinnedAt > 0) - Number(a.pinnedAt > 0) ||
          compareChatNames(a.displayName, b.displayName) ||
          a.chatKey.localeCompare(b.chatKey),
      );
  };
  const pagination = (query: Record<string, string>) =>
    z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
        query: z.string().max(500).optional(),
        senderId: z.string().optional(),
        status: z.string().optional(),
        from: z.coerce.number().nonnegative().optional(),
        to: z.coerce.number().nonnegative().optional(),
        unread: z.enum(['0', '1']).optional(),
      })
      .parse(query);
  const paginate = <T>(items: T[], page: number, pageSize: number): PageResult<T> => ({
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
  });
  const messages = (key: string, query: Record<string, string>) => {
    const keys = scope(key),
      q = pagination(query);
    if (storage.queryMessages && q.unread !== '1') return storage.queryMessages(keys, q);
    const rows = keys
      .flatMap((k) => storage.messages(k))
      .filter(
        (m) =>
          (!q.query || m.text.includes(q.query)) &&
          (!q.senderId || m.senderId === q.senderId) &&
          (q.unread !== '1' || (!m.self && !m.read)) &&
          m.timestamp >= (q.from ?? 0) &&
          m.timestamp <= (q.to ?? Infinity),
      )
      .sort((a, b) => b.timestamp - a.timestamp);
    const result = paginate(rows, q.page, q.pageSize);
    result.items.reverse();
    return result;
  };
  ctx.mode({
    id: 'console.send',
    partitionKey: (input) => input.chatKey,
    input: z.object({
      chatKey: chatKeySchema,
      text: z.string().min(1).max(100000),
    }),
    execute: async (run, input) => {
      const startedAt = Date.now();
      let sent = 0,
        status = 'completed',
        reason: string | undefined;
      try {
        const result = await ctx.use(outboundService).send(run, input.chatKey, input.text);
        sent = result.duplicate ? 0 : 1;
        return result;
      } catch (error) {
        status = run.signal.aborted ? 'cancelled' : 'failed';
        reason = error instanceof Error ? error.message : '发送失败';
        throw error;
      } finally {
        if (!ctx.signal.aborted)
          storage.archive({
            id: run.id,
            chatKey: input.chatKey,
            mode: 'console.send',
            startedAt,
            endedAt: Date.now(),
            status,
            sent,
            reason,
            usage: { input: 0, output: 0 },
            trace: [{ type: 'outbound', text: input.text, timestamp: startedAt }],
          });
      }
    },
  });
  api.post('/api/chats', async (c) => {
    const input = z
      .object({
        chatKey: chatKeySchema,
        alias: z.string().max(160).default(''),
      })
      .parse(await c.req.json());
    const cfg = config.get();
    config.patch({
      admissions: [...new Set([...cfg.admissions, input.chatKey])],
      chatMeta: {
        [input.chatKey]: {
          alias: input.alias,
          pinnedAt: cfg.chatMeta[input.chatKey]?.pinnedAt ?? 0,
          createdAt: cfg.chatMeta[input.chatKey]?.createdAt ?? Date.now(),
        },
      },
    });
    return c.json(
      directory().find((row) => row.chatKey === input.chatKey),
      201,
    );
  });
  api.patch('/api/chats/:chatKey', async (c) => {
    const key = chatKeySchema.parse(c.req.param('chatKey'));
    const patch = z
      .object({
        alias: z.string().max(160).optional(),
        pinned: z.boolean().optional(),
        online: z.boolean().optional(),
        denied: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const cfg = config.get(),
      meta = cfg.chatMeta[key] ?? {
        alias: '',
        pinnedAt: 0,
        createdAt: Date.now(),
      };
    if (patch.alias !== undefined) meta.alias = patch.alias;
    if (patch.pinned !== undefined) meta.pinnedAt = patch.pinned ? Date.now() : 0;
    const denied = new Set(cfg.deniedChats);
    if (patch.denied !== undefined) {
      if (patch.denied) denied.add(key);
      else denied.delete(key);
    }
    config.patch({ chatMeta: { [key]: meta }, deniedChats: [...denied] });
    if (patch.online !== undefined) {
      config.saveProfile(key, { online: patch.online });
      if (!patch.online)
        storage.markRead(
          key,
          storage.unread(key).map((m) => m.localId),
        );
    }
    return c.json(directory().find((row) => row.chatKey === key));
  });
  api.delete('/api/chats/:chatKey', (c) => {
    const key = chatKeySchema.parse(c.req.param('chatKey'));
    config.clearProfile(key);
    config.patch({
      admissions: config.get().admissions.filter((item) => item !== key),
    });
    return c.json({ ok: true, preserved: ['messages', 'memory', 'archives'] });
  });
  api.post('/api/profiles/:chatKey/restore', async (c) => {
    const { section } = z.object({ section: z.string() }).parse(await c.req.json());
    config.restoreProfile(chatKeySchema.parse(c.req.param('chatKey')), section);
    return c.json({ ok: true });
  });
  api.post('/api/chats/:chatKey/unmute', (c) => {
    const key = chatKeySchema.parse(c.req.param('chatKey'));
    storage.setState('conversation-muted', key, 0);
    return c.json({ ok: true });
  });
  api.post('/api/chats/send', async (c) => {
    const input = z
      .object({
        targets: z.array(chatKeySchema).min(1).max(100),
        text: z.string().min(1).max(100000),
      })
      .parse(await c.req.json());
    return c.json(
      {
        results: [...new Set(input.targets)].map((chatKey) => {
          try {
            ctx.use(accessService).assert(chatKey);
            return {
              chatKey,
              id: ctx.host.submit({
                mode: 'console.send',
                partitionKey: chatKey,
                input: { chatKey, text: input.text },
                timeoutMs: 120000,
              }).id,
            };
          } catch {
            return { chatKey, error: '会话未准入或超出启动边界' };
          }
        }),
      },
      202,
    );
  });
  api.get('/api/chats/:chatKey/stats', (c) => {
    const keys = scope(c.req.param('chatKey')),
      records = storage.archives().filter((a) => keys.includes(a.chatKey));
    const raw = storage.messageMetrics?.(keys),
      fallback = raw ? [] : keys.flatMap((key) => storage.messages(key));
    const totals = raw ?? {
      received: fallback.filter((m) => !m.self).length,
      sent: fallback.filter((m) => m.self).length,
      triggered: null,
      daily: [],
    };
    const tools: Record<string, number> = {},
      reasons: Record<string, number> = {};
    for (const a of records) {
      for (const event of a.trace)
        if (event.type === 'tool') {
          const name = event.text.split(':')[0] ?? 'unknown';
          tools[name] = (tools[name] ?? 0) + 1;
        }
      if (a.sent === 0 && a.reason) reasons[a.reason] = (reasons[a.reason] ?? 0) + 1;
    }
    const usage = records.reduce(
      (v, a) => ({
        input: v.input + a.usage.input,
        output: v.output + a.usage.output,
      }),
      { input: 0, output: 0 },
    );
    const measured = records.filter((a) => a.usage.input + a.usage.output > 0);
    const models = records.flatMap((a) => a.usage.models ?? []);
    const currencies = [...new Set(models.map((m) => m.currency))];
    const knownCost =
      measured.length > 0 &&
      measured.every((a) => a.usage.models?.length && a.usage.models.every((m) => m.cost !== null)) &&
      currencies.length === 1;
    const now = Date.now(),
      ranges = {
        today: new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
        week: now - 7 * 86400000,
        month: now - 30 * 86400000,
      };
    return c.json({
      scope: c.req.param('chatKey'),
      chats: keys.length,
      messages: totals,
      runs: records.length,
      durationMs: records.reduce((v, a) => v + Math.max(0, a.endedAt - a.startedAt), 0),
      usage,
      cost: knownCost ? models.reduce((sum, m) => sum + (m.cost ?? 0), 0) : null,
      currency: knownCost ? currencies[0] : null,
      costReason: knownCost ? '' : '部分运行缺少模型计价依据或币种不一致',
      models,
      periods: Object.fromEntries(
        Object.entries(ranges).map(([key, since]) => [
          key,
          records.filter((a) => a.startedAt >= since).length,
        ]),
      ),
      tools,
      reasons,
      triggerProbability:
        totals.triggered === null || !totals.received ? null : totals.triggered / totals.received,
    });
  });
  api.get('/api/chats/:chatKey/export', (c) =>
    c.json({
      version: 1,
      scope: c.req.param('chatKey'),
      messages: scope(c.req.param('chatKey')).flatMap((key) => storage.messages(key)),
      archives: storage.archives().filter((a) => scope(c.req.param('chatKey')).includes(a.chatKey)),
    }),
  );
  api.get('/api/catalogs', (c) => {
    const p = config.public();
    return c.json({
      personas: p.personas.map((item) => ({
        ...item,
        readOnly: item.readOnly || item.id === 'builtin-compatible',
      })),
      prompts: p.prompts.map((item) => ({
        ...item,
        readOnly: item.readOnly || item.id === 'builtin-compatible',
      })),
      providers: p.providers,
      defaultPersona: p.defaults.persona,
    });
  });
  api.put('/api/catalogs/:kind', async (c) => {
    const kind = z.enum(['personas', 'prompts', 'providers']).parse(c.req.param('kind'));
    const body = z
      .object({
        items: z.array(
          kind === 'providers'
            ? providerSchema.omit({ apiKey: true }).extend({ apiKey: z.string().optional() })
            : catalogTextSchema,
        ),
      })
      .parse(await c.req.json());
    if (new Set(body.items.map((v) => v.id)).size !== body.items.length) throw new Error('目录 ID 不能重复');
    const cfg = config.get();
    const ids = new Set(body.items.map((v) => v.id));
    for (const settings of [cfg.defaults, ...Object.values(cfg.profiles)]) {
      const referenced =
        kind === 'providers'
          ? [
              settings.modelSelection.providerId,
              ...settings.modelSelection.fallbacks.map((v) => v.providerId),
            ]
          : [kind === 'personas' ? settings.personaSelection.personaId : settings.personaSelection.promptId];
      if (referenced.some((id) => id && !ids.has(id)))
        throw new Error('仍有会话使用待删除目录项，请先更改会话选择');
    }
    const items =
      kind === 'providers'
        ? body.items.map((v) => ({
            ...v,
            apiKey:
              'apiKey' in v && typeof v.apiKey === 'string'
                ? v.apiKey
                : (cfg.providers.find((p) => p.id === v.id)?.apiKey ?? ''),
          }))
        : body.items.map((item) => {
            const previous = cfg[kind].find((v) => v.id === item.id);
            return { ...item, readOnly: previous?.readOnly };
          });
    config.patch({ [kind]: items });
    return c.json({ ok: true });
  });
  return {
    directory,
    messages,
    pagination,
    scope,
    paginate,
    refreshNames: names.refresh,
  };
}
