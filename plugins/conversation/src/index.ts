import { definePlugin } from '@qq-harness/plugin-sdk';
import { incomingSchema, chatKeySchema } from '@qq-harness/contracts';
import { z } from 'zod';
import { replyDecision } from './policy.js';
import { settleActive } from './behavior.js';
import { conversationQueue, type QueuedConversation } from './queue.js';
import type { RunRecord } from '@qq-harness/plugin-sdk';
import {
  configService,
  systemControlService,
  operationsIngressService,
  storageService,
  accessService,
  adapterService,
  conversationService,
  hasOutboundEffect,
} from '@qq-harness/domain';

export const conversation = definePlugin({
  id: 'conversation',
  name: '聊天触发与聚批',
  requires: [
    configService.id,
    storageService.id,
    accessService.id,
    adapterService.id,
    'harness.agent',
    systemControlService.id,
  ],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      access = ctx.use(accessService),
      adapter = ctx.use(adapterService);
    const control = ctx.use(systemControlService);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const busy = new Set<string>();
    const seen = new Set<string>();
    const retryCounts = new Map<string, number>();
    const triggerTargets = new Map<string, number>();
    const journal = conversationQueue(storage);
    ctx.effect(
      ctx.host.subscribe((event) => {
        if (event.type !== 'run.changed') return;
        const run = event.payload as RunRecord;
        if (run.mode !== 'agent.basic') return;
        if (run.status === 'cancelled' && run.error === '运行时关闭') {
          const entry = journal.list().find((e) => e.id === run.id);
          if (entry?.status === 'queued') return;
          journal.update(run.id, 'interrupted', '服务已停止，已执行任务不自动重放');
          return;
        }
        journal.update(run.id, run.status === 'failed' ? 'interrupted' : run.status, run.error);
      }),
    );
    ctx.definePoint({
      id: 'message.received',
      kind: 'observe',
      schema: incomingSchema,
    });
    ctx.definePoint({
      id: 'trigger.evaluate',
      kind: 'guard',
      schema: incomingSchema,
    });
    ctx.definePoint({
      id: 'message.intercept',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({
        message: incomingSchema,
        localId: z.number(),
        consumed: z.boolean(),
      }),
    });
    const start = (
      chatKey: string,
      proactive = false,
      retryOf?: string,
      wake?: {
        reason?: string;
        text?: string;
        signal?: AbortSignal;
        includeUnread?: boolean;
      },
      restored?: QueuedConversation,
    ) => {
      ctx.assertActive();
      wake?.signal?.throwIfAborted();
      access.assert(chatKey);
      if (config.get().paused) throw new Error('系统已暂停自动处理');
      const settings = config.effective(chatKey);
      if (!settings.online) {
        storage.markRead(
          chatKey,
          storage.unread(chatKey).map((m) => m.localId),
        );
        throw new Error('会话已下线');
      }
      const pending = storage.unread(chatKey),
        blocked = pending.filter((m) => !access.allowed(chatKey, m.senderId));
      if (blocked.length)
        storage.markRead(
          chatKey,
          blocked.map((m) => m.localId),
        );
      const unread =
        wake && !wake.includeUnread
          ? []
          : pending.filter(
              (m) => access.allowed(chatKey, m.senderId) && (!restored || restored.ids.includes(m.localId)),
            );
      if (!unread.length && !proactive) throw new Error('当前会话没有可处理的未读消息');
      const unreadFloor = storage.messages(chatKey).at(-1)?.localId ?? 0;
      const triggerId =
        restored?.triggerId ??
        triggerTargets.get(chatKey) ??
        unread.findLast((m) => m.metadata?.triggered === true)?.localId;
      const run = ctx.host.submit({
        mode: 'agent.basic',
        partitionKey: chatKey,
        input: {
          chatKey,
          ids: unread.map((message) => message.localId),
          triggerId,
          proactive,
          retryOf,
          ...(wake
            ? {
                wake: {
                  reason: wake.reason ?? 'extension',
                  text: wake.text ?? '',
                  unreadFloor,
                },
              }
            : {}),
        },
        timeoutMs: settings.runTimeoutMs,
        maxWaitMs: restored
          ? restored.timeoutMs > 0
            ? Math.max(1, restored.timeoutMs - (Date.now() - restored.createdAt))
            : 0
          : settings.queueTimeoutMs,
      });
      if (!wake && !proactive) {
        if (restored) journal.update(restored.id, 'cancelled', '已恢复为运行 ' + run.id);
        journal.put({
          id: run.id,
          chatKey,
          ids: unread.map((m) => m.localId),
          triggerId,
          createdAt: restored?.createdAt ?? run.createdAt,
          timeoutMs: restored?.timeoutMs ?? settings.queueTimeoutMs,
          status: run.status === 'running' ? 'running' : 'queued',
        });
      }
      busy.add(chatKey);
      triggerTargets.delete(chatKey);
      const abort = () => ctx.host.cancel(run.id);
      wake?.signal?.addEventListener('abort', abort, { once: true });
      if (wake?.signal?.aborted) abort();
      void ctx.host.wait(run.id).then((result) => {
        wake?.signal?.removeEventListener('abort', abort);
        busy.delete(chatKey);
        if (result.status === 'completed') {
          retryCounts.delete(chatKey);
          const finish = (result.result as { finish?: { activeTopic?: boolean } } | undefined)?.finish;
          storage.setState(
            'conversation-active',
            chatKey,
            settleActive(
              Number(storage.state('conversation-active', chatKey) ?? 0),
              finish?.activeTopic,
              config.effective(chatKey).behavior.chatActive,
            ),
          );
        }
        if (
          result.status === 'failed' &&
          !ctx.signal.aborted &&
          access.allowed(chatKey) &&
          config.effective(chatKey).online
        ) {
          const archive = storage.archives().find((a) => a.id === result.id),
            count = retryCounts.get(chatKey) ?? 0;
          if (
            !wake &&
            archive?.sent === 0 &&
            !hasOutboundEffect(storage, result.id, chatKey) &&
            count < settings.behavior.run.retryAttempts
          ) {
            retryCounts.set(chatKey, count + 1);
            schedule(chatKey, Math.min(30000, 1000 * 2 ** count));
          }
        }
        if (
          result.status === 'completed' &&
          !ctx.signal.aborted &&
          storage.unread(chatKey).some((m) => !wake || m.localId > unreadFloor)
        )
          schedule(chatKey, config.effective(chatKey).drainDelayMs);
      });
      return run.id;
    };
    const schedule = (chatKey: string, ms: number) => {
      if (busy.has(chatKey) || config.get().paused) return;
      const old = timers.get(chatKey);
      if (old) clearTimeout(old);
      timers.set(
        chatKey,
        setTimeout(() => {
          timers.delete(chatKey);
          try {
            start(chatKey);
          } catch (error) {
            ctx.log(String(error));
          }
        }, ms),
      );
    };
    const ingest = async (raw: unknown) => {
      ctx.assertActive();
      const message = incomingSchema.parse(raw);
      const isControl = control.authorized(message);
      if (!isControl && !access.allowed(message.chatKey, message.senderId)) return;
      const key = `${message.chatKey}/${message.id}`;
      if (
        seen.has(key) ||
        storage.messages(message.chatKey).some((value) => value.id === message.id && !value.self)
      )
        return;
      seen.add(key);
      if (seen.size > 10000) seen.delete(seen.values().next().value!);
      if (isControl) {
        const stored = storage.append({
          ...message,
          metadata: { ...message.metadata, operationsCommand: true },
        });
        storage.markRead(message.chatKey, [stored.localId]);
        await ctx.use(operationsIngressService).handle(message);
        return;
      }
      const settings = config.effective(message.chatKey);
      const muteUntil = Number(storage.state('conversation-muted', message.chatKey) ?? 0);
      const commandMute =
        settings.commandMute.enabled && message.atMe && message.text.includes(settings.commandMute.command);
      if (commandMute)
        storage.setState(
          'conversation-muted',
          message.chatKey,
          settings.commandMute.durationMin
            ? Date.now() + settings.commandMute.durationMin * 60000
            : Number.MAX_SAFE_INTEGER,
        );
      if (commandMute) {
        const timer = timers.get(message.chatKey);
        if (timer) clearTimeout(timer);
        timers.delete(message.chatKey);
        storage.markRead(
          message.chatKey,
          storage.unread(message.chatKey).map((m) => m.localId),
        );
      }
      if (Number(storage.state('conversation-active', message.chatKey) ?? 0) <= Date.now())
        storage.setState('conversation-active', message.chatKey, 0);
      const decision = commandMute
        ? { trigger: false, reason: 'mute-command' }
        : muteUntil > Date.now() && message.chatKey.startsWith('group:')
          ? {
              trigger: message.atMe || message.metadata?.poke === true,
              reason: 'command-muted',
              keepUnread: false,
            }
          : replyDecision(
              settings,
              message,
              Number(storage.state('conversation-active', message.chatKey) ?? 0),
            );
      const stored = storage.append({
        ...message,
        metadata: {
          ...message.metadata,
          triggered: !config.get().paused && decision.trigger,
          triggerReason: config.get().paused ? 'global-paused' : decision.reason,
        },
      });
      ctx.points.observe('message.received', message);
      if (settings.behavior.maxPendingUnread > 0) {
        const pending = storage.unread(message.chatKey);
        if (pending.length > settings.behavior.maxPendingUnread)
          storage.markRead(
            message.chatKey,
            pending.slice(0, -settings.behavior.maxPendingUnread).map((m) => m.localId),
          );
      }
      if (!settings.online || commandMute) {
        storage.markRead(message.chatKey, [stored.localId]);
        return;
      }
      if (config.get().paused) {
        storage.markRead(message.chatKey, [stored.localId]);
        return;
      }
      const intercepted = await ctx.points.transform(
        'message.intercept',
        { message, localId: stored.localId, consumed: false },
        ctx.signal,
      );
      if (intercepted.consumed) {
        storage.markRead(message.chatKey, [stored.localId]);
        return;
      }
      if (busy.has(message.chatKey) || timers.has(message.chatKey)) return;
      const trigger = decision.trigger;
      if (!trigger) {
        if (!('keepUnread' in decision) || !decision.keepUnread)
          storage.markRead(message.chatKey, [stored.localId]);
        return;
      }
      try {
        await ctx.points.guard('trigger.evaluate', message, ctx.signal);
        triggerTargets.set(message.chatKey, stored.localId);
        schedule(message.chatKey, settings.wakeDelayMs);
      } catch {
        storage.markRead(message.chatKey, [stored.localId]);
      }
    };
    ctx.effect(
      adapter.subscribe((message) => {
        void ingest(message).catch((error) => ctx.log(String(error)));
      }),
    );

    ctx.effect(
      ctx.host.subscribe((event) => {
        if (event.type === 'config.changed' && config.get().paused) {
          for (const timer of timers.values()) clearTimeout(timer);
          timers.clear();
        }
      }),
    );
    ctx.effect(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    });
    const recoveryTimer = setTimeout(() => {
      for (const entry of journal.list().filter((e) => e.status === 'queued')) {
        try {
          if (entry.timeoutMs > 0 && Date.now() - entry.createdAt >= entry.timeoutMs)
            throw new Error('重启恢复时排队已超时');
          if (
            busy.has(entry.chatKey) ||
            config.get().paused ||
            !access.allowed(entry.chatKey) ||
            !config.effective(entry.chatKey).online
          )
            throw new Error('重启恢复时会话已暂停、下线或不再准入');
          start(entry.chatKey, false, undefined, undefined, entry);
        } catch (error) {
          journal.update(entry.id, 'cancelled', String(error));
        }
      }
    }, 0);
    ctx.effect(() => clearTimeout(recoveryTimer));
    ctx.provide(conversationService, {
      force: (chatKey, text = '', signal) => {
        chatKeySchema.parse(chatKey);
        if (busy.has(chatKey)) throw Error('会话正在运行，请等待当前轮结束');
        if (text.length > 20000) throw Error('手动触发说明超过20000字');
        const timer = timers.get(chatKey);
        if (timer) clearTimeout(timer);
        timers.delete(chatKey);
        return start(chatKey, true, undefined, {
          reason: 'manual',
          text,
          includeUnread: true,
          signal,
        });
      },
      queue: () => journal.list(),
      ingest,
      retry: (chatKey, retryOf) => {
        if (busy.has(chatKey)) throw new Error('会话正在运行');
        retryCounts.delete(chatKey);
        return start(chatKey, false, retryOf);
      },
      wake: (chatKey, options = {}) => {
        chatKeySchema.parse(chatKey);
        if (busy.has(chatKey) || timers.has(chatKey))
          throw new Error('会话正在运行或等待处理，任务保留到下一次检查');
        if (Number(storage.state('conversation-muted', chatKey) ?? 0) > Date.now())
          throw new Error('会话仍在指令禁言期');
        if ((options.text?.length ?? 0) > 20000) throw new Error('唤醒说明超过20000字');
        return start(chatKey, true, undefined, options);
      },
      resumePending: () => {
        let count = 0;
        for (const chat of storage.chats())
          if (
            !busy.has(chat.chatKey) &&
            !timers.has(chat.chatKey) &&
            access.allowed(chat.chatKey) &&
            config.effective(chat.chatKey).online &&
            storage.unread(chat.chatKey).some((m) => access.allowed(chat.chatKey, m.senderId))
          ) {
            schedule(chat.chatKey, 0);
            count++;
          }
        return count;
      },
    });
  },
});
