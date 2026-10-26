import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { Runtime } from '@qq-harness/kernel';
import { service } from '@qq-harness/plugin-sdk';

describe('Cordis 生命周期与通用运行骨架', () => {
  test('初始化超时回收资源，迟到 setup 不能发布服务', async () => {
    const runtime = new Runtime({ setupTimeoutMs: 10 });
    const token = service<object>('late.provider');
    let cleaned = false;
    runtime.install({
      id: 'late',
      async setup(ctx) {
        ctx.effect(() => {
          cleaned = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 40));
        ctx.provide(token, {});
      },
    });
    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(runtime.listPlugins()[0]?.status).toBe('failed');
    expect(cleaned).toBe(true);
    expect(() => runtime.use(token)).toThrow();
    await runtime.stop();
  });
  test('运行模式决定权威分区键，调用方不能绕过互斥', async () => {
    const runtime = new Runtime({ concurrency: 2 });
    let count = 0;
    let maximum = 0;
    runtime.install({
      id: 'mode',
      setup(ctx) {
        ctx.mode({
          id: 'partitioned',
          input: z.object({ key: z.string() }),
          partitionKey: (input) => input.key,
          async execute() {
            maximum = Math.max(maximum, ++count);
            await new Promise((resolve) => setTimeout(resolve, 20));
            count--;
          },
        });
      },
    });
    await runtime.start();
    const a = runtime.submit({ mode: 'partitioned', partitionKey: 'spoof-a', input: { key: 'same' } });
    const b = runtime.submit({ mode: 'partitioned', partitionKey: 'spoof-b', input: { key: 'same' } });
    await Promise.all([runtime.wait(a.id), runtime.wait(b.id)]);
    expect(maximum).toBe(1);
    await runtime.stop();
  });
  test('依赖撤销会停用消费者，重新提供后重新激活，并隔离两个运行时', async () => {
    const token = service<{ value: number }>('test.provider');
    const first = new Runtime(),
      second = new Runtime();
    let starts = 0,
      stops = 0;
    first.install({
      id: 'consumer',
      requires: [token.id],
      setup(ctx) {
        expect(ctx.use(token).value).toBe(1);
        starts++;
        ctx.effect(() => {
          stops++;
        });
      },
    });
    first.install({
      id: 'provider',
      setup(ctx) {
        ctx.provide(token, { value: 1 });
      },
    });
    await first.start();
    expect(starts).toBe(1);
    expect(() => second.use(token)).toThrow();
    await first.setEnabled('provider', false);
    expect(stops).toBe(1);
    expect(first.listPlugins().find((plugin) => plugin.id === 'consumer')?.status).toBe('waiting');
    await first.setEnabled('provider', true);
    expect(starts).toBe(2);
    await first.stop();
    await second.stop();
    expect(stops).toBe(2);
  });
  test('guard 超时拒绝，迟到 transform 不能修改提交值', async () => {
    const runtime = new Runtime();
    runtime.install({
      id: 'points',
      setup(ctx) {
        ctx.definePoint({
          id: 'guard',
          kind: 'guard',
          schema: z.object({ value: z.number() }),
          timeoutMs: 10,
          requiredGuard: true,
        });
        ctx.on('guard', async () => {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return true;
        });
        ctx.definePoint({
          id: 'change',
          kind: 'transform',
          schema: z.object({ value: z.number() }),
          timeoutMs: 10,
        });
        ctx.on<{ value: number }>('change', async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 40));
          value.value = 99;
          return value;
        });
      },
    });
    await runtime.start();
    await expect(runtime.points.guard('guard', { value: 1 })).rejects.toThrow();
    const result = await runtime.points.transform('change', { value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(result).toEqual({ value: 1 });
    await runtime.stop();
  });
  test('同分区互斥、跨分区并发、排队不计运行超时、排队取消', async () => {
    const runtime = new Runtime({ concurrency: 1 });
    const order: number[] = [];
    runtime.install({
      id: 'mode',
      setup(ctx) {
        ctx.mode({
          id: 'test',
          input: z.number(),
          execute: async (_run, value) => {
            order.push(value);
            await new Promise((resolve) => setTimeout(resolve, value === 1 ? 80 : 5));
            return value;
          },
        });
      },
    });
    await runtime.start();
    const first = runtime.submit({ mode: 'test', partitionKey: 'a', input: 1 });
    const second = runtime.submit({ mode: 'test', partitionKey: 'a', input: 2, timeoutMs: 30 });
    const third = runtime.submit({ mode: 'test', partitionKey: 'b', input: 3 });
    expect(runtime.listRuns().find((run) => run.id === second.id)?.status).toBe('queued');
    runtime.cancel(third.id);
    expect((await runtime.wait(first.id)).status).toBe('completed');
    expect((await runtime.wait(second.id)).status).toBe('completed');
    expect((await runtime.wait(third.id)).status).toBe('cancelled');
    expect(order).toEqual([1, 2]);
    await runtime.stop();
  });
});
