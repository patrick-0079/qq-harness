import WebSocket from 'ws';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { adapterService, configService, accessService } from '@qq-harness/domain';
import { incomingSchema, type IncomingMessage } from '@qq-harness/contracts';

export const adapterOnebot = definePlugin({
  id: 'adapter-onebot',
  name: 'OneBot v11（外部 SnowLuma）',
  requires: [configService.id, accessService.id],
  setup(ctx) {
    const config = ctx.use(configService);
    const access = ctx.use(accessService);
    const listeners = new Set<(message: IncomingMessage) => void>();
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let selfId = '';
    const query = async (
      action: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<unknown> => {
      ctx.assertActive();
      if (!/^[a-zA-Z0-9_]+$/.test(action)) throw new Error('非法 OneBot action');
      if (args.group_id !== undefined) access.assert(`group:${String(args.group_id)}`);
      else if (args.user_id !== undefined) access.assert(`private:${String(args.user_id)}`);
      else if (/^(send_|upload_)/.test(action)) throw new Error('OneBot 出站动作必须有明确且获准的会话目标');
      const cfg = config.get().onebot;
      const url = new URL(cfg.httpUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('OneBot HTTP URL 无效');
      url.pathname = url.pathname.replace(/\/$/, '') + '/' + action;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.httpAccessToken || cfg.accessToken
            ? { authorization: `Bearer ${cfg.httpAccessToken || cfg.accessToken}` }
            : {}),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.any([ctx.signal, signal ?? AbortSignal.timeout(30000)]),
      });
      if (!response.ok) throw new Error(`OneBot HTTP ${response.status}`);
      const data = (await response.json()) as {
        status: string;
        retcode: number;
        data: unknown;
        message?: string;
      };
      if (data.status !== 'ok' || data.retcode !== 0)
        throw new Error(`OneBot ${action} 失败：${data.message ?? data.retcode}`);
      ctx.assertActive();
      return data.data;
    };
    const connect = () => {
      if (ctx.signal.aborted) return;
      const cfg = config.get().onebot;
      const url = new URL(cfg.wsUrl);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('OneBot WS URL 无效');
      socket = new WebSocket(url, {
        headers: cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {},
      });
      socket.on('open', () => {
        ctx.host.publish('adapter.changed', { connected: true });
        void query('get_login_info', {})
          .then((value) => {
            selfId = String((value as { user_id?: unknown }).user_id ?? '');
          })
          .catch((error) => ctx.log(String(error)));
      });
      socket.on('message', (bytes) => {
        try {
          const event = JSON.parse(bytes.toString()) as Record<string, unknown>;
          if (event.post_type !== 'message' || !['group', 'private'].includes(String(event.message_type)))
            return;
          const kind = event.message_type as string;
          if (String(event.user_id) === String(event.self_id ?? selfId)) return;
          const chatKey = `${kind}:${String(kind === 'group' ? event.group_id : event.user_id)}`;
          if (!access.allowed(chatKey, String(event.user_id))) return;
          const sender = event.sender as { card?: string; nickname?: string } | undefined;
          const segments = Array.isArray(event.message)
            ? (event.message as { type: string; data: Record<string, unknown> }[])
            : [];
          const id = String(event.self_id ?? selfId);
          const text = segments.length
            ? segments
                .map((segment) =>
                  segment.type === 'text'
                    ? String(segment.data.text ?? '')
                    : segment.type === 'at'
                      ? `@${String(segment.data.qq)}`
                      : `[${segment.type}]`,
                )
                .join('')
            : String(event.raw_message ?? event.message ?? '');
          const parsed = incomingSchema.parse({
            id: String(event.message_id),
            chatKey,
            senderId: String(event.user_id),
            senderName: sender?.card || sender?.nickname || '',
            text,
            atMe: segments.some((segment) => segment.type === 'at' && String(segment.data.qq) === id),
            timestamp: Number(event.time ?? Date.now() / 1000) * 1000,
            metadata: { segments, selfId: id },
          });
          for (const listener of listeners) listener(parsed);
        } catch (error) {
          ctx.log(`OneBot 事件被忽略：${error instanceof Error ? error.message : error}`);
        }
      });
      socket.on('error', (error) => ctx.log(`OneBot 连接错误：${error.message}`));
      socket.on('close', () => {
        ctx.host.publish('adapter.changed', { connected: false });
        if (!ctx.signal.aborted) reconnect = setTimeout(connect, 3000);
      });
    };
    ctx.effect(() => {
      if (reconnect) clearTimeout(reconnect);
      socket?.removeAllListeners();
      socket?.terminate();
      listeners.clear();
    });
    ctx.provide(adapterService, {
      kind: 'onebot',
      connected: () => socket?.readyState === WebSocket.OPEN,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      query,
      sendPayload: async (chatKey, payload, signal) => {
        const [kind, id] = chatKey.split(':');
        const data = (await query(
          'file' in payload
            ? kind === 'group'
              ? 'upload_group_file'
              : 'upload_private_file'
            : kind === 'group'
              ? 'send_group_msg'
              : 'send_private_msg',
          {
            [kind === 'group' ? 'group_id' : 'user_id']: id,
            ...('file' in payload
              ? { file: payload.file, name: payload.name }
              : { message: payload.segments }),
          },
          signal,
        )) as { message_id?: unknown; file_id?: unknown };
        return { id: String(data?.message_id ?? data?.file_id ?? `upload:${Date.now()}`) };
      },
      send: async (chatKey, text, signal) => {
        const [kind, id] = chatKey.split(':');
        const data = (await query(
          kind === 'group' ? 'send_group_msg' : 'send_private_msg',
          {
            [kind === 'group' ? 'group_id' : 'user_id']: id,
            message: [{ type: 'text', data: { text } }],
          },
          signal,
        )) as { message_id: unknown };
        return { id: String(data.message_id) };
      },
    });
    connect();
  },
});
