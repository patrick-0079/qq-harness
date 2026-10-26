import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  adapterService,
  configService,
  accessService,
  outboundService,
  storageService,
  type OutboundPayload,
} from '@qq-harness/domain';
import type { RunContext } from '@qq-harness/plugin-sdk';
import { chatKeySchema } from '@qq-harness/contracts';

export const outboundQueue = definePlugin({
  id: 'outbound-queue',
  name: '串行发送与留档',
  requires: [adapterService.id, configService.id, accessService.id, storageService.id],
  setup(ctx) {
    const adapter = ctx.use(adapterService),
      config = ctx.use(configService),
      access = ctx.use(accessService),
      storage = ctx.use(storageService);
    const chains = new Map<string, Promise<unknown>>();
    const recent = new Map<string, { timestamp: number; id: string }>();
    const times = new Map<string, number[]>();
    const payload = z.object({ chatKey: chatKeySchema, text: z.string().min(1).max(100000) });
    ctx.definePoint({ id: 'outbound.before', kind: 'guard', schema: payload, requiredGuard: true });
    ctx.definePoint({ id: 'outbound.after', kind: 'observe', schema: payload });
    ctx.on<{ chatKey: string }>(
      'outbound.before',
      (value) => {
        access.assert(value.chatKey);
        return true;
      },
      0,
    );
    const send = (run: RunContext, chatKey: string, text: string, message?: OutboundPayload) => {
      run.assertActive();
      ctx.assertActive();
      const task = (chains.get(chatKey) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const signal = AbortSignal.any([run.signal, ctx.signal]);
          const assert = () => {
            ctx.assertActive();
            run.assertActive();
            access.assert(chatKey);
            signal.throwIfAborted();
          };
          assert();
          const cfg = config.get().send;
          const key = `${chatKey}:${text}:${message ? JSON.stringify(message) : ''}`;
          const old = recent.get(key);
          if (old && Date.now() - old.timestamp < cfg.dedupeMs) return { id: old.id, duplicate: true };
          let history = (times.get(chatKey) ?? []).filter((timestamp) => Date.now() - timestamp < 60000);
          const wait = Math.max(
            0,
            (history.at(-1) ?? 0) + cfg.minIntervalMs - Date.now(),
            history.length >= cfg.perMinute ? history[0]! + 60000 - Date.now() : 0,
          );
          if (wait > 0) await delay(wait, undefined, { signal });
          assert();
          await ctx.points.guard('outbound.before', { chatKey, text }, signal);
          assert();
          if (message && !adapter.sendPayload) throw new Error('当前适配器不支持媒体发送');
          const result = message
            ? await adapter.sendPayload!(chatKey, message, signal)
            : await adapter.send(chatKey, text, signal);
          history = history.filter((timestamp) => Date.now() - timestamp < 60000);
          history.push(Date.now());
          times.set(chatKey, history);
          recent.set(key, { timestamp: Date.now(), id: result.id });
          for (const [candidate, value] of recent)
            if (Date.now() - value.timestamp > cfg.dedupeMs) recent.delete(candidate);
          // 发送已发生就必须记账，即使取消恰好发生在网络响应之后。
          storage.append(
            {
              id: result.id,
              chatKey,
              senderId: 'self',
              senderName: '助手',
              text,
              atMe: false,
              timestamp: Date.now(),
              ...(message ? { metadata: { outbound: message } } : {}),
            },
            true,
          );
          ctx.points.observe('outbound.after', { chatKey, text });
          return result;
        });
      chains.set(chatKey, task);
      void task
        .finally(() => {
          if (chains.get(chatKey) === task) chains.delete(chatKey);
        })
        .catch(() => {});
      return task;
    };
    ctx.provide(outboundService, { send, sendPayload: send });
    ctx.effect(async () => {
      await Promise.allSettled([...chains.values()]);
    });
  },
});
