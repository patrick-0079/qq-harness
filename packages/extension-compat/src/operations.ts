import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginContext, RunContext } from '@qq-harness/plugin-sdk';
import {
  configService,
  accessService,
  storageService,
  traceService,
  type ToolContext,
  type TraceService,
  type ModelResponse,
} from '@qq-harness/domain';
import { chatKeySchema, type Archive } from '@qq-harness/contracts';

/** Deferred package work gets its own run instead of reusing a finished reply.
 * Callbacks never cross HTTP: the mode accepts a one-use in-memory ticket. */
export function extensionOperations(ctx: PluginContext, enabled: (id: string, chatKey: string) => boolean) {
  const tickets = new Map<
      string,
      {
        owner: string;
        signal: AbortSignal;
        chatKey: string;
        title: string;
        parentId?: string;
        fn: (tool: ToolContext) => Promise<unknown>;
      }
    >(),
    running = new Map<string, Archive>(),
    runningTools = new Map<string, ToolContext>();
  ctx.mode({
    id: 'extension.operation',
    operation: true,
    input: z.object({ ticket: z.string().uuid(), chatKey: chatKeySchema }),
    partitionKey: (v) => `extension:${v.chatKey}`,
    execute: async (run, input) => {
      const job = tickets.get(input.ticket);
      if (!job || job.chatKey !== input.chatKey) throw new Error('扩展操作已失效');
      const config = ctx.use(configService),
        storage = ctx.use(storageService),
        signal = AbortSignal.any([run.signal, job.signal, ctx.signal]);
      const assert = () => {
        run.assertActive();
        signal.throwIfAborted();
        ctx.use(accessService).assert(job.chatKey);
        if (!enabled(job.owner, job.chatKey)) throw new Error('扩展已在目标会话停用');
        if (config.get().paused || !config.effective(job.chatKey).online)
          throw new Error('目标会话已暂停或下线');
      };
      assert();
      const bound: RunContext = { ...run, signal, assertActive: assert };
      const tool: ToolContext = {
        run: bound,
        chatKey: job.chatKey,
        settings: config.effective(job.chatKey),
        sent: 0,
        trace() {},
      };
      const archive: Archive = {
        id: run.id,
        chatKey: job.chatKey,
        mode: 'extension.operation',
        startedAt: Date.now(),
        endedAt: 0,
        status: 'running',
        reason: job.title,
        sent: 0,
        trace: [],
        usage: { input: 0, output: 0 },
      };
      if (job.parentId) {
        const children = storage.state('outbound-children', job.parentId) ?? [];
        if (!Array.isArray(children)) throw new Error('扩展操作父运行记录损坏');
        storage.setState('outbound-children', job.parentId, [
          ...children,
          { runId: run.id, chatKey: job.chatKey },
        ]);
      }
      running.set(run.id, archive);
      runningTools.set(run.id, tool);
      let detail: TraceService | undefined;
      try {
        detail = ctx.use(traceService);
      } catch {}
      detail?.start(run.id, job.chatKey);
      detail?.record(run.id, 'trigger', job.title, { owner: job.owner });
      try {
        const value = await job.fn(tool);
        assert();
        archive.status = 'completed';
        return value;
      } catch (error) {
        archive.status = signal.aborted ? 'cancelled' : 'failed';
        archive.reason = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        running.delete(run.id);
        runningTools.delete(run.id);
        archive.sent = tool.sent;
        archive.endedAt = Date.now();
        storage.archive(archive);
        detail?.end(run.id, archive.status);
      }
    },
  });
  const execute = async <T>(
    owner: string,
    signal: AbortSignal,
    chatKey: string,
    title: string,
    fn: (tool: ToolContext) => Promise<T>,
    parent?: RunContext,
  ): Promise<T> => {
    ctx.assertActive();
    signal.throwIfAborted();
    chatKeySchema.parse(chatKey);
    if (!enabled(owner, chatKey)) throw new Error('扩展已在目标会话停用');
    ctx.use(accessService).assert(chatKey);
    const active = parent && runningTools.get(parent.id);
    if (active) {
      if (active.chatKey !== chatKey) throw new Error('嵌套扩展操作不能越过当前会话绑定');
      const combined = AbortSignal.any([signal, active.run.signal]),
        run = {
          ...active.run,
          signal: combined,
          assertActive: () => {
            active.run.assertActive();
            combined.throwIfAborted();
            if (!enabled(owner, chatKey)) throw new Error('扩展已在目标会话停用');
          },
        };
      const nested = { ...active, run };
      const value = await fn(nested);
      run.assertActive();
      active.sent += Math.max(0, nested.sent - active.sent);
      return value;
    }
    const ticket = randomUUID();
    tickets.set(ticket, { owner, signal, chatKey, title, fn, parentId: parent?.id });
    let id: string | undefined;
    const abort = () => {
      if (id) ctx.host.cancel(id);
    };
    signal.addEventListener('abort', abort, { once: true });
    const unsubscribe = ctx.host.subscribe((event) => {
      if (event.type !== 'run.changed' || id || !parent) return;
      const record = event.payload as { id: string; parentId?: string; mode: string };
      if (record.parentId === parent.id && record.mode === 'extension.operation') {
        id = record.id;
        if (signal.aborted) abort();
      }
    });
    try {
      const request = {
        mode: 'extension.operation',
        partitionKey: `extension:${chatKey}`,
        input: { ticket, chatKey },
        timeoutMs: ctx.use(configService).effective(chatKey).runTimeoutMs,
      };
      const live =
        parent &&
        ctx.host.listRuns().find((r) => r.id === parent.id && r.status === 'running' && !r.parentId);
      const result = live
        ? await ctx.host.operation(parent!, request)
        : await (async () => {
            const run = ctx.host.submit(request);
            id = run.id;
            if (signal.aborted) abort();
            return ctx.host.wait(run.id);
          })();
      if (result.status !== 'completed') throw new Error(result.error ?? '扩展操作未完成');
      return result.result as T;
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', abort);
      tickets.delete(ticket);
    }
  };
  ctx.effect(() => {
    tickets.clear();
  });
  return {
    execute,
    owns: (id: string) => running.has(id),
    account: (runId: string, result: ModelResponse) => {
      const archive = running.get(runId);
      if (!archive) throw new Error('模型用量没有绑定扩展运行');
      archive.usage.input += result.usage.input;
      archive.usage.output += result.usage.output;
      if (result.billing) (archive.usage.models ??= []).push({ ...result.billing, ...result.usage });
      if (result.extraUsage) {
        archive.usage.extra ??= {};
        for (const [key, value] of Object.entries(result.extraUsage))
          archive.usage.extra[key] = (archive.usage.extra[key] ?? 0) + value;
      }
    },
  };
}
