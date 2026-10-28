import { expect, test } from 'vitest';
import { Runtime } from '@qq-harness/kernel';
import type { RunContext } from '@qq-harness/plugin-sdk';
import { z } from 'zod';
test('绑定操作继承取消、记录目标与父子关系，不能通过普通模式或嵌套操作绕过调度', async () => {
  const runtime = new Runtime({ concurrency: 1 });
  let child = '';
  let nested = '';
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  runtime.install({
    id: 'operations',
    setup(ctx) {
      ctx.mode({
        id: 'op',
        operation: true,
        input: z.object({}),
        partitionKey: () => 'target:2',
        execute: async (run) => {
          child = run.id;
          try {
            await ctx.host.operation(run, { mode: 'op', partitionKey: 'ignored', input: {} });
          } catch (e) {
            nested = String(e);
          }
          started();
          await new Promise<void>((_resolve, reject) =>
            run.signal.addEventListener('abort', () => reject(run.signal.reason), { once: true }),
          );
        },
      });
      ctx.mode({ id: 'ordinary', input: z.object({}), execute: async () => {} });
      ctx.mode({
        id: 'parent',
        input: z.object({}),
        execute: async (run) => {
          await expect(
            ctx.host.operation(run, { mode: 'ordinary', partitionKey: 'ordinary', input: {} }),
          ).rejects.toThrow('不支持绑定操作');
          return ctx.host.operation(run, { mode: 'op', partitionKey: 'ignored', input: {} });
        },
      });
    },
  });
  await runtime.start();
  try {
    const parent = runtime.submit({ mode: 'parent', partitionKey: 'source:1', input: {} });
    await ready;
    runtime.cancel(parent.id);
    expect((await runtime.wait(parent.id)).status).toBe('cancelled');
    expect(await runtime.wait(child)).toMatchObject({
      status: 'cancelled',
      parentId: parent.id,
      partitionKey: 'target:2',
    });
    expect(nested).toContain('顶层运行');
  } finally {
    await runtime.stop();
  }
});
test('运行完成后旧上下文立即失效，不能被延迟回调继续用来发送', async () => {
  const runtime = new Runtime();
  let captured: RunContext | undefined;
  runtime.install({
    id: 'completed-context',
    setup(ctx) {
      ctx.mode({
        id: 'complete',
        input: z.object({}),
        execute: async (run) => {
          captured = run;
          run.assertActive();
          return 'done';
        },
      });
    },
  });
  await runtime.start();
  try {
    const run = runtime.submit({ mode: 'complete', partitionKey: 'test', input: {} });
    expect((await runtime.wait(run.id)).status).toBe('completed');
    expect(() => captured!.assertActive()).toThrow('已经结束');
  } finally {
    await runtime.stop();
  }
});

test('不限时的父运行可绑定不限时操作；有限父期限始终约束子操作', async () => {
  const runtime = new Runtime({ concurrency: 1 }),
    deadlines: number[] = [];
  runtime.install({
    id: 'operation-deadlines',
    setup(ctx) {
      ctx.mode({
        id: 'deadline-op',
        operation: true,
        input: z.object({}),
        execute: async (run) => {
          deadlines.push(run.deadline);
          return 'done';
        },
      });
      ctx.mode({
        id: 'deadline-parent',
        input: z.object({}),
        execute: (run) =>
          ctx.host.operation(run, { mode: 'deadline-op', partitionKey: 'target', input: {}, timeoutMs: 0 }),
      });
    },
  });
  await runtime.start();
  try {
    const unlimited = runtime.submit({
      mode: 'deadline-parent',
      partitionKey: 'first',
      input: {},
      timeoutMs: 0,
    });
    expect((await runtime.wait(unlimited.id)).status).toBe('completed');
    expect(deadlines[0]).toBe(Infinity);
    const limited = runtime.submit({
      mode: 'deadline-parent',
      partitionKey: 'second',
      input: {},
      timeoutMs: 2000,
    });
    expect((await runtime.wait(limited.id)).status).toBe('completed');
    expect(deadlines[1]).toBeLessThanOrEqual(Date.now() + 2000);
    expect(deadlines[1]).toBeGreaterThan(Date.now());
  } finally {
    await runtime.stop();
  }
});
