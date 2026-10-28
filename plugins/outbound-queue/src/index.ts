import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  adapterService,
  configService,
  systemControlService,
  accessService,
  outboundService,
  storageService,
  traceService,
  isChatDelivery,
  type OutboundPayload,
  type OutboundAttempt,
} from '@qq-harness/domain';
import type { RunContext } from '@qq-harness/plugin-sdk';
import { chatKeySchema } from '@qq-harness/contracts';
import { redactKnownSecrets } from '@qq-harness/files';

export const outboundQueue = definePlugin({
  id: 'outbound-queue',
  name: '串行发送与留档',
  requires: [
    adapterService.id,
    configService.id,
    accessService.id,
    storageService.id,
    systemControlService.id,
  ],
  setup(ctx) {
    const adapter = ctx.use(adapterService),
      config = ctx.use(configService),
      access = ctx.use(accessService),
      storage = ctx.use(storageService);
    const control = ctx.use(systemControlService);
    const chains = new Map<string, Promise<unknown>>();
    const recent = new Map<string, { timestamp: number; id: string }>();
    const times = new Map<string, number[]>();
    const replyBudgets = new Map<string, { limit: number; used: number; exceeded: boolean }>();
    const budgetFor = (runId: string) => {
      const direct = replyBudgets.get(runId);
      if (direct || !replyBudgets.size) return direct;
      // Cross-chat and extension operations keep their own ownership and audit
      // while sharing their parent reply's physical-message allowance.
      const runs = new Map(ctx.host.listRuns().map((run) => [run.id, run]));
      const seen = new Set<string>();
      while (runId && !seen.has(runId)) {
        seen.add(runId);
        const parent = runs.get(runId)?.parentId;
        if (!parent) return;
        const budget = replyBudgets.get(parent);
        if (budget) return budget;
        runId = parent;
      }
    };
    const payload = z.object({
      chatKey: chatKeySchema,
      text: z.string().min(1).max(100000),
      runId: z.string().optional(),
    });
    ctx.definePoint({
      id: 'outbound.prepare',
      kind: 'transform',
      schema: payload.extend({ payload: z.unknown().optional() }),
    });
    ctx.definePoint({ id: 'outbound.before', kind: 'guard', schema: payload, requiredGuard: true });
    ctx.definePoint({
      id: 'outbound.after',
      kind: 'observe',
      schema: payload.extend({
        messageId: z.string(),
        runId: z.string(),
        payload: z.unknown().optional(),
      }),
    });
    ctx.on<{ chatKey: string; text: string; runId?: string }>(
      'outbound.before',
      (value) => {
        if (!value.runId || !control.replyId(value.runId, value.chatKey, value.text))
          access.assert(value.chatKey);
        return true;
      },
      0,
    );
    const send = (run: RunContext, chatKey: string, text: string, message?: OutboundPayload) => {
      run.assertActive();
      ctx.assertActive();
      if (!control.isReply(run, chatKey, text, message)) control.assertBusiness();
      const controlReply = control.isReply(run, chatKey, text, message);
      const chainKey = controlReply ? `control:${chatKey}` : chatKey;
      const task = (chains.get(chainKey) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const signal = AbortSignal.any([run.signal, ctx.signal]);
          const assert = () => {
            ctx.assertActive();
            run.assertActive();
            if (!control.isReply(run, chatKey, text, message)) {
              control.assertBusiness();
              access.assert(chatKey);
            }
            signal.throwIfAborted();
          };
          assert();
          const prepared = await ctx.points.transform(
            'outbound.prepare',
            { chatKey, text, payload: message },
            signal,
          );
          if (prepared.chatKey !== chatKey) throw new Error('发送转换不能改变目标会话');
          text = prepared.text;
          message = prepared.payload as OutboundPayload | undefined;
          assert();
          if (message && 'typing' in message) {
            z.object({ eventType: z.union([z.literal(1), z.literal(3)]) })
              .strict()
              .parse(message.typing);
            if (!chatKey.startsWith('private:')) throw new Error('输入状态只支持当前私聊');
          }
          if (message && 'reaction' in message) {
            const value = z
                .object({
                  messageId: z.string().regex(/^-?[1-9]\d*$/),
                  emojiId: z.string().regex(/^\d{1,9}$/),
                  set: z.boolean(),
                })
                .strict()
                .parse(message.reaction),
              record = storage.messages(chatKey).find((m) => m.id === value.messageId);
            if (!chatKey.startsWith('group:') || !record)
              throw new Error('表情回应必须指向当前群已记录消息及有效表情');
            if (!record.self) access.assert(chatKey, record.senderId);
          }
          const cfg = {
            ...config.get().send,
            ...(controlReply ? { minIntervalMs: 0, maxIntervalMs: 0, byLengthMs: 0 } : {}),
          };
          const key = `${chatKey}:${text}:${message ? JSON.stringify(message) : ''}`;
          const old = recent.get(key);
          if (old && Date.now() - old.timestamp < cfg.dedupeMs) return { id: old.id, duplicate: true };
          const initialBudget = isChatDelivery(message) ? budgetFor(run.id) : undefined;
          if (initialBudget && (initialBudget.exceeded || initialBudget.used >= initialBudget.limit)) {
            initialBudget.exceeded = true;
            throw new Error(
              `已达到本轮回复消息上限：最多 ${initialBudget.limit} 条（已发送或结果待确认 ${initialBudget.used} 条）。不要继续发送或重试。`,
            );
          }
          let history = (times.get(chainKey) ?? []).filter((timestamp) => Date.now() - timestamp < 3600000);
          if (history.length >= cfg.perHour) throw new Error(`发送频率超限：每小时最多 ${cfg.perHour} 条`);
          const minute = history.filter((timestamp) => Date.now() - timestamp < 60000);
          const gap =
            cfg.minIntervalMs +
            Math.random() * Math.max(0, cfg.maxIntervalMs - cfg.minIntervalMs) +
            Math.min(8000, text.length * cfg.byLengthMs);
          const wait = Math.max(
            0,
            (history.at(-1) ?? 0) + gap - Date.now(),
            minute.length >= cfg.perMinute ? minute[0]! + 60000 - Date.now() : 0,
          );
          if (wait > 0) await delay(wait, undefined, { signal });
          assert();
          await ctx.points.guard('outbound.before', { chatKey, text, runId: run.id }, signal);
          assert();
          if (message && !adapter.sendPayload) throw new Error('当前适配器不支持媒体发送');
          const hash = createHash('sha256').update(key).digest('hex'),
            recorded = storage.state('outbound-attempts', run.id) ?? [];
          if (!Array.isArray(recorded)) throw new Error('发送审计记录损坏，已停止发送');
          const attempts = recorded as OutboundAttempt[];
          if (attempts.some((a) => a.hash === hash && ['pending', 'unknown'].includes(a.status)))
            throw new Error('同一运行此前这条发送的结果未知，请先核对聊天记录，不能直接重发');
          const attempt: OutboundAttempt = {
            effect:
              message && 'typing' in message
                ? 'typing'
                : message && 'reaction' in message
                  ? 'reaction'
                  : message && 'profileImage' in message
                    ? 'account'
                    : 'chat',
            id: randomUUID(),
            hash,
            chatKey,
            at: Date.now(),
            status: 'pending',
          };
          const budget = isChatDelivery(message) ? budgetFor(run.id) : undefined;
          if (budget && (budget.exceeded || budget.used >= budget.limit)) {
            budget.exceeded = true;
            throw new Error(
              `已达到本轮回复消息上限：最多 ${budget.limit} 条（已发送或结果待确认 ${budget.used} 条）。不要继续发送或重试。`,
            );
          }
          attempts.push(attempt);
          storage.setState('outbound-attempts', run.id, attempts);
          // Reserve before yielding to the adapter, including concurrent child
          // operations. Unknown delivery consumes a slot until the run ends.
          if (budget) budget.used++;
          let result: { id: string };
          const unbind = control.bindSignal(run, signal);
          try {
            result = message
              ? await adapter.sendPayload!(chatKey, message, signal)
              : await adapter.send(chatKey, text, signal);
          } catch (error) {
            const definite = Boolean(
              error &&
              typeof error === 'object' &&
              'definiteFailure' in error &&
              error.definiteFailure === true,
            );
            attempt.status = definite ? 'failed' : 'unknown';
            if (definite && budget) budget.used--;
            attempt.error = String(
              redactKnownSecrets(error instanceof Error ? error.message : String(error), config.get()),
            );
            try {
              storage.setState('outbound-attempts', run.id, attempts);
            } catch {
              ctx.log('发送结果记录保存失败');
            }
            try {
              ctx
                .use(traceService)
                .record(
                  run.id,
                  'outbound',
                  definite ? '发送被协议端拒绝' : '发送结果未知',
                  { chatKey, status: attempt.status, error: attempt.error },
                  { status: 'failed' },
                );
            } catch {}
            throw new Error(
              definite ? attempt.error : '发送结果未知，请先核对聊天记录，勿直接重发：' + attempt.error,
            );
          } finally {
            unbind();
          }
          attempt.status = 'delivered';
          attempt.messageId = result.id;
          let warning: string | undefined;
          try {
            storage.setState('outbound-attempts', run.id, attempts);
          } catch {
            warning = '消息已成功发送，但本地发送结果保存失败';
            ctx.log(warning);
          }
          history = history.filter((timestamp) => Date.now() - timestamp < 3600000);
          history.push(Date.now());
          times.set(chainKey, history);
          recent.set(key, { timestamp: Date.now(), id: result.id });
          for (const [candidate, value] of recent)
            if (Date.now() - value.timestamp > cfg.dedupeMs) recent.delete(candidate);
          // 发送已发生就必须记账，即使取消恰好发生在网络响应之后。
          if (isChatDelivery(message))
            try {
              storage.append(
                {
                  id: result.id,
                  chatKey,
                  senderId: 'self',
                  senderName: '助手',
                  text,
                  atMe: false,
                  timestamp: Date.now(),
                  metadata: {
                    outboundRunId: run.id,
                    selfId: adapter.identity?.().id || undefined,
                    ...(message ? { outbound: message } : {}),
                  },
                },
                true,
              );
            } catch {
              warning = '消息已成功发送，但本地消息记录保存失败';
              ctx.log(warning);
            }
          if (isChatDelivery(message))
            ctx.points.observe('outbound.after', {
              chatKey,
              text,
              messageId: result.id,
              runId: run.id,
              payload: message,
            });
          try {
            ctx.use(traceService).record(run.id, 'outbound', '发送完成', {
              chatKey,
              text,
              payload: message,
              messageId: result.id,
            });
          } catch {
            /* 诊断插件停用不影响发送 */
          }
          return { ...result, ...(warning ? { warning } : {}) };
        });
      chains.set(chainKey, task);
      void task
        .finally(() => {
          if (chains.get(chainKey) === task) chains.delete(chainKey);
        })
        .catch(() => {});
      return task;
    };
    ctx.provide(outboundService, {
      openReplyBudget: (run, limit) => {
        run.assertActive();
        z.number().int().min(1).max(100).parse(limit);
        if (replyBudgets.has(run.id)) throw Error('本轮发送额度已经建立，不能重置');
        const budget = { limit, used: 0, exceeded: false };
        replyBudgets.set(run.id, budget);
        return {
          limit,
          used: () => budget.used,
          exceeded: () => budget.exceeded,
          release: () => {
            if (replyBudgets.get(run.id) === budget) replyBudgets.delete(run.id);
          },
        };
      },
      send: async (run, chatKey, text) => {
        if (control.isReply(run, chatKey, text)) return send(run, chatKey, text);
        const size = config.get().send.hardSplitAt;
        if (!size || Array.from(text).length <= size) return send(run, chatKey, text);
        const characters = Array.from(text),
          parts: string[] = [];
        while (characters.length) {
          let cut = Math.min(size, characters.length);
          if (cut < characters.length) {
            const line = characters.slice(0, cut).lastIndexOf('\n');
            if (line > cut * 0.6) cut = line + 1;
          }
          parts.push(characters.splice(0, cut).join(''));
        }
        const results: import('@qq-harness/domain').OutboundResult[] = [],
          failedParts: { index: number; text: string; error: string }[] = [];
        for (const [index, part] of parts.entries())
          try {
            results.push(await send(run, chatKey, part));
          } catch (e) {
            run.signal.throwIfAborted();
            failedParts.push({
              index,
              text: part,
              error: e instanceof Error ? e.message : String(e),
            });
            if (budgetFor(run.id)?.exceeded) break;
          }
        if (!results.length) throw new Error(failedParts.map((f) => f.error).join('；'));
        return {
          id: results.at(-1)!.id,
          ids: results.map((r) => r.id),
          sentCount: results.filter((r) => !r.duplicate).length,
          duplicate: results.every((r) => r.duplicate),
          ...(failedParts.length ? { failedParts } : {}),
        };
      },
      sendPayload: async (run, chatKey, text, message) => {
        const size = config.get().send.hardSplitAt;
        if (
          !size ||
          !('segments' in message) ||
          message.segments.some((s) => !['text', 'reply', 'at'].includes(s.type)) ||
          Array.from(text).length <= size
        )
          return send(run, chatKey, text, message);
        const parts: import('@qq-harness/domain').MessageSegment[][] = [];
        let current: import('@qq-harness/domain').MessageSegment[] = [],
          used = 0;
        const flush = () => {
          if (current.length) parts.push(current);
          current = [];
          used = 0;
        };
        for (const segment of message.segments) {
          if (segment.type !== 'text') {
            if (used >= size) flush();
            current.push(segment);
            continue;
          }
          const chars = Array.from(String(segment.data.text ?? ''));
          while (chars.length) {
            if (used >= size) flush();
            const part = chars.splice(0, size - used).join('');
            used += Array.from(part).length;
            current.push({ type: 'text', data: { text: part } });
          }
        }
        flush();
        const results: import('@qq-harness/domain').OutboundResult[] = [],
          failedParts: { index: number; text: string; error: string }[] = [];
        for (const [index, segments] of parts.entries()) {
          const body =
            segments
              .filter((s) => s.type === 'text')
              .map((s) => String(s.data.text))
              .join('') || '[提及成员]';
          try {
            results.push(await send(run, chatKey, body, { segments }));
          } catch (error) {
            run.signal.throwIfAborted();
            failedParts.push({
              index,
              text: body,
              error: error instanceof Error ? error.message : String(error),
            });
            if (budgetFor(run.id)?.exceeded) break;
          }
        }
        if (!results.length) throw Error(failedParts.map((p) => p.error).join('；'));
        return {
          id: results.at(-1)!.id,
          ids: results.map((r) => r.id),
          sentCount: results.filter((r) => !r.duplicate).length,
          duplicate: results.every((r) => r.duplicate),
          ...(failedParts.length ? { failedParts } : {}),
        };
      },
    });
    ctx.effect(async () => {
      await Promise.allSettled([...chains.values()]);
      replyBudgets.clear();
    });
  },
});
