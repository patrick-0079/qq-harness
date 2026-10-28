import WebSocket from 'ws';
import { normalizeOneBot } from './normalize.js';
import { systemControlService } from '@qq-harness/domain';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { adapterService, configService, accessService } from '@qq-harness/domain';
import { incomingSchema, type IncomingMessage } from '@qq-harness/contracts';

export const adapterOnebot = definePlugin({
  id: 'adapter-onebot',
  name: 'OneBot v11（外部 SnowLuma）',
  requires: [configService.id, accessService.id, systemControlService.id],
  setup(ctx) {
    const config = ctx.use(configService);
    const access = ctx.use(accessService);
    const listeners = new Set<(message: IncomingMessage) => void>();
    const eventListeners = new Set<(event: Record<string, unknown>) => void>();
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let loginRetry: ReturnType<typeof setTimeout> | undefined;
    let selfId = '';
    const query = async (
      action: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<unknown> => {
      ctx.assertActive();
      if (!/^[a-zA-Z0-9_]+$/.test(action)) throw new Error('非法 OneBot action');
      if (args.group_id !== undefined) access.assert(`group:${String(args.group_id)}`);
      else if (
        args.user_id !== undefined &&
        !['get_avatar', 'get_user_avatar', 'get_stranger_info'].includes(action)
      ) {
        const key = `private:${String(args.user_id)}`;
        let allowedControl = false;
        try {
          allowedControl =
            action === 'send_private_msg' && ctx.use(systemControlService).controlSignal(signal, key);
        } catch {}
        if (!allowedControl) access.assert(key);
      } else if (/^(send_|upload_)/.test(action))
        throw new Error('OneBot 出站动作必须有明确且获准的会话目标');
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
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) throw new Error(`OneBot HTTP ${response.status}`);
      const data = (await response.json()) as {
        status: string;
        retcode: number;
        data: unknown;
        message?: string;
      };
      if (data?.status !== 'ok' || data?.retcode !== 0) {
        const error = new Error(
          `OneBot ${action} 失败：${data?.message ?? data?.retcode ?? '无效响应'}`,
        ) as Error & { definiteFailure?: boolean };
        error.definiteFailure =
          data?.status === 'failed' && typeof data.retcode === 'number' && data.retcode !== 0;
        throw error;
      }
      ctx.assertActive();
      return data.data;
    };
    const disconnect = () => {
      clearTimeout(reconnect);
      clearTimeout(loginRetry);
      reconnect = undefined;
      loginRetry = undefined;
      const old = socket;
      socket = undefined;
      selfId = '';
      // CONNECTING 状态的 terminate 会异步发 error；保留监听器消费旧连接错误。
      // 事件处理器按实例判断所有权，迟到的 close/open/message 都不能影响新连接。
      old?.terminate();
    };
    const connect = () => {
      if (ctx.signal.aborted) return;
      disconnect();
      const cfg = config.get().onebot;
      const url = new URL(cfg.wsUrl);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('OneBot WS URL 无效');
      const current = new WebSocket(url, {
        handshakeTimeout: 30000,
        headers: cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {},
      });
      socket = current;
      const isCurrent = () => socket === current && !ctx.signal.aborted;
      const login = async () => {
        try {
          const value = await query('get_login_info', {});
          if (isCurrent() && current.readyState === WebSocket.OPEN)
            selfId = String((value as { user_id?: unknown })?.user_id ?? '');
        } catch (error) {
          if (!isCurrent() || current.readyState !== WebSocket.OPEN) return;
          ctx.log(String(error));
          // WS 可先于账号就绪；失败后持续补拉，切连接或卸载时统一清理。
          loginRetry = setTimeout(() => {
            void login();
          }, 15000);
        }
      };
      current.on('open', () => {
        if (!isCurrent()) return;
        ctx.host.publish('adapter.changed', { connected: true });
        void login();
      });
      current.on('message', (bytes) => {
        if (!isCurrent()) return;
        try {
          const event = JSON.parse(bytes.toString()) as Record<string, unknown>;
          if (!event || typeof event !== 'object' || Array.isArray(event)) return;
          const parsed = normalizeOneBot(event, selfId);
          if (parsed && !access.allowed(parsed.chatKey, parsed.senderId)) {
            let control = false;
            try {
              control = ctx.use(systemControlService).authorized(parsed);
            } catch {}
            if (!control) return;
          }
          const key =
            event.group_id != null
              ? `group:${event.group_id}`
              : event.user_id != null
                ? `private:${event.user_id}`
                : undefined;
          if (!parsed && key) {
            const allowed =
              event.post_type === 'request'
                ? (access.withinBoundary ?? access.allowed)(key, String(event.user_id ?? ''))
                : access.allowed(key, String(event.user_id ?? ''));
            if (!allowed) return;
          }
          for (const listener of eventListeners)
            try {
              void Promise.resolve(listener(structuredClone(event))).catch((error) =>
                ctx.log(`OneBot 事件订阅者异常：${String(error)}`),
              );
            } catch (error) {
              ctx.log(`OneBot 事件订阅者异常：${String(error)}`);
            }
          if (!parsed) return;
          for (const listener of listeners) {
            try {
              void Promise.resolve(listener(parsed)).catch((error) =>
                ctx.log(`OneBot 订阅者异常：${String(error)}`),
              );
            } catch (error) {
              ctx.log(`OneBot 订阅者异常：${String(error)}`);
            }
          }
        } catch (error) {
          ctx.log(`OneBot 事件被忽略：${error instanceof Error ? error.message : error}`);
        }
      });
      current.on('error', (error) => {
        if (isCurrent()) ctx.log(`OneBot 连接错误：${error.message}`);
      });
      current.on('close', () => {
        if (!isCurrent()) return;
        clearTimeout(loginRetry);
        loginRetry = undefined;
        selfId = '';
        ctx.host.publish('adapter.changed', { connected: false });
        if (!ctx.signal.aborted) reconnect = setTimeout(connect, 3000);
      });
    };
    ctx.effect(() => {
      disconnect();
      listeners.clear();
      eventListeners.clear();
    });
    let connectionSettings = JSON.stringify(config.get().onebot);
    ctx.effect(
      ctx.host.subscribe((event) => {
        if (event.type !== 'config.changed' || ctx.signal.aborted) return;
        const next = JSON.stringify(config.get().onebot);
        if (next === connectionSettings) return;
        connectionSettings = next;
        ctx.host.publish('adapter.changed', { connected: false });
        connect();
      }),
    );
    ctx.provide(adapterService, {
      kind: 'onebot',
      identity: () => ({ id: selfId }),
      connected: () => socket?.readyState === WebSocket.OPEN,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      subscribeEvents: (listener) => {
        eventListeners.add(listener);
        return () => {
          eventListeners.delete(listener);
        };
      },
      query: async (action, args, signal) => {
        if (
          /^send_|^upload_(?:group|private)_file$|^(?:group|friend)_poke$|^set_(?:qq_avatar|input_status|msg_emoji_like)$/.test(
            action,
          )
        )
          throw new Error('聊天发送、拍一拍、头像和文件发送必须经过 outbound 服务');
        return query(action, args, signal);
      },
      sendPayload: async (chatKey, payload, signal) => {
        const [kind, id] = chatKey.split(':');
        if ('typing' in payload) {
          if (kind !== 'private') throw new Error('输入状态仅支持私聊');
          await query('set_input_status', { user_id: id, event_type: payload.typing.eventType }, signal);
          return { id: `typing:${Date.now()}` };
        }
        if ('reaction' in payload) {
          if (kind !== 'group') throw new Error('表情回应仅支持群聊');
          await query(
            'set_msg_emoji_like',
            {
              message_id: payload.reaction.messageId,
              emoji_id: payload.reaction.emojiId,
              set: payload.reaction.set,
            },
            signal,
          );
          return { id: `reaction:${payload.reaction.messageId}:${payload.reaction.emojiId}` };
        }
        if ('profileImage' in payload) {
          await query('set_qq_avatar', { file: payload.profileImage }, signal);
          return { id: `profile:${Date.now()}` };
        }
        if ('poke' in payload) {
          const args = { user_id: payload.poke, ...(kind === 'group' ? { group_id: id } : {}) };
          try {
            await query(kind === 'group' ? 'group_poke' : 'friend_poke', args, signal);
          } catch (error) {
            signal.throwIfAborted();
            // 仅协议明确不支持专用动作时降级，网络超时不重发已有副作用。
            if (!/unsupported|not.?found|not.?support|不支持|未知.*(?:接口|action)/i.test(String(error)))
              throw error;
            await query('send_poke', args, signal);
          }
          return { id: `poke:${Date.now()}:${payload.poke}` };
        }
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
