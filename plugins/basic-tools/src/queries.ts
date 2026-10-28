import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import {
  storageService,
  adapterService,
  toolService,
  configService,
  accessService,
  mediaService,
  type ToolContext,
  type MessageSegment,
} from '@qq-harness/domain';
import { messageSegments, type StoredMessage } from '@qq-harness/contracts';
import { fetchForwardRoot, forwardId, forwardNodes, recordedSegments } from './forwards.js';
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const parameters = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export function registerQueries(ctx: PluginContext) {
  const tools = ctx.use(toolService),
    storage = ctx.use(storageService),
    adapter = ctx.use(adapterService),
    config = ctx.use(configService),
    access = ctx.use(accessService);
  const find = (chatKey: string, id: string) => {
    const m = storage.messages(chatKey).find((m) => m.id === id || String(m.localId) === id);
    if (!m) throw new Error('当前会话找不到该消息，请使用聊天记录中的消息 ID');
    if (!m.self) access.assert(chatKey, m.senderId);
    return m;
  };
  const summary = (m: StoredMessage) => ({
    id: m.id,
    messageId: m.id,
    localId: m.localId,
    sender: m.senderName || m.senderId,
    userId: m.senderId,
    senderId: m.self ? undefined : m.senderId,
    time: new Date(m.timestamp).toLocaleString('zh-CN', { hour12: false }),
    text: m.text,
    timestamp: m.timestamp,
    media: (() => {
      try {
        return ctx.use(mediaService).references(m.chatKey, m.localId);
      } catch {
        return [];
      }
    })(),
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'get_recent_messages',
    core: true,
    displayName: '读取近期消息',
    category: 'query',
    description: '读取当前会话最近消息，offset 跳过最近 N 条，可翻阅更早历史。',
    parameters: parameters({
      limit: { type: 'integer', description: '默认30，最多100' },
      offset: { type: 'integer', description: '跳过最近N条' },
    }),
    parse: (args) =>
      z
        .object({
          limit: z.number().int().min(1).max(100).default(30),
          offset: z.number().int().min(0).default(0),
        })
        .parse(args),
    execute: async (c, value) => {
      const a = value as { limit: number; offset: number },
        list = storage
          .messages(c.chatKey)
          .filter((m) => m.self || access.allowed(c.chatKey, m.senderId));
      const messages = list
        .slice(Math.max(0, list.length - a.offset - a.limit), Math.max(0, list.length - a.offset))
        .map(summary);
      return { count: messages.length, messages };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'get_message_detail',
    displayName: '读取消息详情',
    category: 'query',
    core: true,
    description: '读取当前会话已记录消息，包含发送者、正文、引用及媒体。',
    parameters: parameters({ messageId: { type: 'string' } }, ['messageId']),
    parse: (args) => {
      const input = z
        .object({ messageId: z.string().optional(), id: z.string().optional() })
        .parse(args);
      return {
        messageId: z
          .string()
          .min(1)
          .parse(input.messageId ?? input.id),
      };
    },
    execute: async (c, value) => {
      const m = find(c.chatKey, (value as { messageId: string }).messageId);
      return { ...summary(m), reply: m.metadata?.reply, metadata: m.metadata };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'get_active_members',
    displayName: '查看活跃群友',
    category: 'query',
    description: '按当前会话近期消息统计活跃成员，不编造未出现的 QQ 号。',
    parameters: parameters({ limit: { type: 'integer' } }),
    parse: (a) => z.object({ limit: z.number().int().min(1).max(20).default(10) }).parse(a),
    execute: async (c, a) => {
      const members = new Map<
        string,
        { userId: string; name: string; count: number; lastAt: number }
      >();
      for (const m of storage
        .messages(c.chatKey)
        .filter((m) => !m.self && access.allowed(c.chatKey, m.senderId))) {
        const old = members.get(m.senderId);
        members.set(m.senderId, {
          userId: m.senderId,
          name: !old || m.timestamp >= old.lastAt ? m.senderName || m.senderId : old.name,
          count: (old?.count ?? 0) + 1,
          lastAt: Math.max(m.timestamp, old?.lastAt ?? 0),
        });
      }
      return {
        members: [...members.values()]
          .sort((a, b) => b.lastAt - a.lastAt)
          .slice(0, (a as { limit: number }).limit)
          .map((m) => ({
            ...m,
            recentCount: m.count,
            lastSeen: new Date(m.lastAt).toLocaleString('zh-CN', {
              hour12: false,
            }),
          })),
      };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'get_chats',
    displayName: '查看获准会话',
    category: 'query',
    description: '查询已获准入的会话名称和标识，跨会话发送前先查目标。',
    parameters: parameters({ limit: { type: 'integer' } }),
    parse: (a) => z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(a),
    execute: async (_c, a) => {
      const cfg = config.get();
      const keys = [
        ...new Set([
          ...cfg.admissions,
          ...Object.keys(cfg.profiles),
          ...storage.chats().map((c) => c.chatKey),
        ]),
      ]
        .filter((k) => access.allowed(k))
        .sort(
          (a, b) =>
            (storage.messages(b).at(-1)?.timestamp ?? 0) -
            (storage.messages(a).at(-1)?.timestamp ?? 0),
        )
        .slice(0, (a as { limit: number }).limit);
      return {
        count: keys.length,
        chats: keys.map((key) => ({
          chatKey: key,
          name: cfg.chatMeta[key]?.alias || obj(storage.state('console', 'chat-names'))[key] || key,
          online: config.effective(key).online,
          lastActive: storage.messages(key).at(-1)?.timestamp
            ? new Date(storage.messages(key).at(-1)!.timestamp).toLocaleString('zh-CN', {
                hour12: false,
              })
            : '',
          recentText: storage.messages(key).at(-1)?.text.slice(0, 30) ?? '',
        })),
      };
    },
  });
  const states = new Map<
    string,
    {
      refs: Map<string, number>;
      expanded: Set<string>;
      root?: StoredMessage;
      cache: Map<string, unknown>;
    }
  >();
  const runState = (c: ToolContext) => {
    const key = `${c.run.id}/${c.chatKey}`;
    let state = states.get(key);
    if (!state) {
      state = { refs: new Map(), expanded: new Set(), cache: new Map() };
      states.set(key, state);
      c.run.signal.addEventListener('abort', () => states.delete(key), {
        once: true,
      });
      if (states.size > 100) states.delete(states.keys().next().value!);
    }
    return state;
  };
  const restoreRefs = (state: ReturnType<typeof runState>, value: Record<string, unknown>) => {
    if (Array.isArray(value.nested))
      for (const ref of value.nested) {
        const item = obj(ref);
        if (
          typeof item.recordId === 'string' &&
          Number.isInteger(item.depth) &&
          Number(item.depth) <= 8 &&
          !state.refs.has(item.recordId)
        )
          state.refs.set(item.recordId, Number(item.depth));
      }
  };
  tools.register(ctx, {
    builtinQQ: true,
    name: 'read_forward',
    displayName: '展开转发消息',
    category: 'query',
    core: true,
    description:
      '展开当前会话合并转发，一次一层。首次传 messageId；嵌套层只能传上次返回的 recordId，最多8层。返回发送者、文本、图片和嵌套引用。',
    parameters: parameters({
      messageId: { type: 'string' },
      recordId: { type: 'string' },
      refresh: { type: 'boolean' },
    }),
    parse: (a) => {
      const v = z
        .object({
          messageId: z.string().optional(),
          id: z.string().optional(),
          recordId: z.string().optional(),
          refresh: z.boolean().default(false),
        })
        .parse(a);
      if (!v.messageId && !v.id && !v.recordId)
        throw new Error('请填写 messageId 或本轮发现的 recordId');
      return { ...v, messageId: v.messageId ?? v.id };
    },
    execute: async (c, value) => {
      const a = value as {
          messageId?: string;
          recordId?: string;
          refresh: boolean;
        },
        state = runState(c);
      let recordId = a.recordId,
        depth = 0;
      let rootNodes: unknown[] | undefined;
      if (recordId) {
        const known = state.refs.get(recordId);
        if (known === undefined) throw new Error('recordId 不在本轮已发现的转发中，请先展开原消息');
        depth = known;
        if (depth > 8) throw new Error('已达到最大嵌套层数8');
        if (state.expanded.has(recordId)) throw new Error('该嵌套记录已经展开，避免循环读取');
        const cached = obj(obj(state.root?.metadata?.forwardNodes)[recordId]);
        if (!a.refresh && Array.isArray(cached.messages)) {
          restoreRefs(state, cached);
          state.expanded.add(recordId);
          return cached;
        }
      } else {
        let m = find(c.chatKey, a.messageId!);
        if (state.root?.id !== m.id || a.refresh) {
          state.refs.clear();
          state.expanded.clear();
          state.cache.clear();
        }
        state.root = m;
        if (!a.refresh && state.cache.has(m.id)) return state.cache.get(m.id);
        const metadata = m.metadata ?? {};
        const persisted = obj(metadata.forward);
        if (!a.refresh && Array.isArray(persisted.messages)) {
          restoreRefs(state, persisted);
          state.cache.set(m.id, persisted);
          return persisted;
        }
        const fetched = await fetchForwardRoot(adapter, storage, m, c.run.signal);
        recordId = fetched.recordId;
        rootNodes = fetched.nodes;
      }
      const raw =
        rootNodes ??
        forwardNodes(await adapter.query('get_forward_msg', { id: recordId }, c.run.signal));
      if (!raw.length) throw new Error('转发为空或已过期');
      let chars = 0;
      const media: MessageSegment[] = [];
      const messages = raw.slice(0, 60).map((row) => {
        const item = obj(row),
          node = item.type === 'node' ? obj(item.data) : item,
          sender = obj(node.sender),
          parts = messageSegments(node.content ?? node.message ?? node.raw_message);
        const nested: string[] = [];
        for (const part of parts) {
          if (part.type === 'forward' && forwardId(part.data)) {
            const id = forwardId(part.data);
            if (!state.refs.has(id)) state.refs.set(id, depth + 1);
            nested.push(id);
          }
          if (part.type === 'image') media.push(part);
        }
        const rawText = parts.length
          ? parts
              .map((p) => (p.type === 'text' ? String(p.data.text ?? '') : `[${p.type}]`))
              .join('')
          : String(node.content ?? node.raw_message ?? '');
        const text = rawText.slice(0, Math.max(0, 6000 - chars));
        chars += text.length;
        return {
          sender: String(sender.card ?? sender.nickname ?? node.name ?? ''),
          userId: String(sender.user_id ?? node.user_id ?? node.uin ?? ''),
          text,
          nested,
          images: parts.filter((p) => p.type === 'image').length,
        };
      });
      state.expanded.add(recordId!);
      if (media.length && state.root) {
        const key = `${c.chatKey}/${state.root.localId}`;
        const old = storage.state('forward-media', key);
        storage.setState('forward-media', key, [
          ...new Map(
            [...(a.refresh ? [] : Array.isArray(old) ? old : []), ...media].map((item) => [
              JSON.stringify(item),
              item,
            ]),
          ).values(),
        ]);
      }
      const result = {
        messageId: state.root?.id,
        recordId,
        depth,
        count: raw.length,
        messages,
        images: media.length,
        imageMessageId: state.root?.id,
        nested: [...state.refs].map(([recordId, depth]) => ({
          recordId,
          depth,
        })),
        ...(raw.length > 60 || chars >= 6000 ? { truncated: true } : {}),
      };
      if (state.root && depth === 0) state.cache.set(state.root.id, result);
      if (state.root && storage.updateMessage) {
        const root = storage.messages(c.chatKey).find((m) => m.localId === state.root!.localId)!;
        const metadata = { ...root.metadata },
          direct = recordedSegments(root).some((s) => s.type === 'forward');
        metadata.originalText ??= root.text;
        if (depth === 0) {
          metadata.forward = result;
          if (a.refresh) metadata.forwardNodes = {};
        } else {
          metadata.forwardNodes = {
            ...obj(metadata.forwardNodes),
            [recordId!]: result,
          };
          metadata.forward = {
            ...obj(metadata.forward),
            nested: result.nested,
          };
        }
        const text =
          depth === 0 && direct
            ? `[合并转发聊天记录，共${raw.length}条]\n` +
              messages.map((m) => `${m.sender || m.userId}: ${m.text}`).join('\n')
            : root.text;
        state.root = storage.updateMessage(c.chatKey, root.localId, {
          text,
          metadata,
        });
        if (depth > 0) state.cache.set(root.id, metadata.forward);
      }
      return result;
    },
  });
  ctx.effect(() => states.clear());
}
