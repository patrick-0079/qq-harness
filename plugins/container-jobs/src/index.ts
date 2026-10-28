import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema, containerExecSchema, type ContainerJob } from '@qq-harness/contracts';
import {
  accessService,
  configService,
  storageService,
  toolService,
  containerSessionService,
  containerJobsService,
  containerRuntimeService,
} from '@qq-harness/domain';

export const containerJobs = definePlugin({
  id: 'container-jobs',
  name: '容器后台任务',
  requires: [
    containerSessionService.id,
    containerRuntimeService.id,
    storageService.id,
    toolService.id,
    accessService.id,
    configService.id,
  ],
  setup(ctx) {
    const storage = ctx.use(storageService),
      session = ctx.use(containerSessionService);
    const jobs = new Map<string, ContainerJob>();
    const active = new Map<string, { controller: AbortController; done: Promise<void> }>();
    let closing = false;
    for (const job of (storage.state(ctx.id, 'jobs') ?? []) as ContainerJob[]) {
      jobs.set(
        job.id,
        job.status === 'running'
          ? { ...job, status: 'interrupted', endedAt: Date.now(), error: '进程重启，任务未恢复' }
          : job,
      );
    }
    const save = () => {
      if (!closing && !ctx.signal.aborted) storage.setState(ctx.id, 'jobs', [...jobs.values()]);
    };
    save();
    const get = (chatKey: string, id: string) => {
      ctx.assertActive();
      ctx.use(accessService).assert(chatKey);
      const job = jobs.get(id);
      if (!job || job.chatKey !== chatKey) throw new Error('任务不属于当前会话或不存在');
      return job;
    };
    const list = (chatKey: string) => {
      ctx.assertActive();
      ctx.use(accessService).assert(chatKey);
      return structuredClone([...jobs.values()].filter((j) => j.chatKey === chatKey));
    };
    ctx.definePoint({
      id: 'container.job.ended',
      kind: 'observe',
      schema: z.object({ id: z.string(), chatKey: chatKeySchema, status: z.string() }),
    });
    ctx.provide(containerJobsService, {
      start(chatKey, raw) {
        ctx.assertActive();
        ctx.use(accessService).assert(chatKey);
        if (
          !session.available(chatKey) ||
          ctx.use(configService).effective(chatKey).plugins[ctx.id] === false
        )
          throw new Error('当前会话容器后台任务不可用');
        if (
          active.size >= 16 ||
          [...jobs.values()].filter((j) => j.chatKey === chatKey && j.status === 'running').length >= 2
        )
          throw new Error('后台任务数量已达上限');
        const input = containerExecSchema.parse(raw);
        const selected = ctx
          .use(containerRuntimeService)
          .bindings()
          .filter((row) => row.chatKey === chatKey);
        const binding = input.containerId
          ? selected.find((row) => row.id === input.containerId)
          : (selected.find((row) => row.primary) ?? selected[0]);
        if (!binding) throw Error('当前会话未绑定所选容器');
        input.containerId = binding.id;
        for (const [id, row] of jobs) {
          if (jobs.size < 100) break;
          if (row.status !== 'running') jobs.delete(id);
        }
        const job: ContainerJob = {
          id: randomUUID(),
          chatKey,
          containerId: binding.id,
          command: input.command,
          status: 'running',
          createdAt: Date.now(),
          stdout: '',
          stderr: '',
          truncated: false,
        };
        jobs.set(job.id, job);
        save();
        const controller = new AbortController();
        const signal = AbortSignal.any([ctx.signal, controller.signal]);
        const done = Promise.resolve().then(async () => {
          try {
            const result = await session.execute(chatKey, input, signal, (stream, text) => {
              job[stream] = (job[stream] + text).slice(0, 100000);
            });
            Object.assign(job, result, { status: result.exitCode === 0 ? 'completed' : 'failed' });
          } catch (error) {
            job.status =
              signal.aborted || (error instanceof Error && error.name === 'AbortError')
                ? 'cancelled'
                : 'failed';
            job.error = error instanceof Error ? error.message : String(error);
          } finally {
            job.endedAt = Date.now();
            active.delete(job.id);
            save();
            if (!closing && !ctx.signal.aborted) {
              const event = { id: job.id, chatKey, status: job.status };
              ctx.host.publish('container.job.ended', event);
              ctx.points.observe('container.job.ended', event);
            }
          }
        });
        active.set(job.id, { controller, done });
        return structuredClone(job);
      },
      list,
      get: (chatKey, id) => structuredClone(get(chatKey, id)),
      async cancel(chatKey, id) {
        const job = get(chatKey, id),
          running = active.get(id);
        if (running) {
          running.controller.abort(new Error('任务已取消；仅清理此任务的进程树'));
          await running.done;
        }
        return structuredClone(job);
      },
    });
    ctx.effect(async () => {
      closing = true;
      for (const item of active.values()) item.controller.abort(new Error('容器任务插件已停用'));
      await Promise.allSettled([...active.values()].map((item) => item.done));
    });
    const tools = ctx.use(toolService);
    for (const [name, description, schema, params, execute] of [
      ['container_job_list', '查看当前会话的容器后台任务。', z.object({}), {}, (chat: string) => list(chat)],
      [
        'container_job_output',
        '读取当前会话后台任务的状态和有界输出。',
        z.object({ id: z.string().uuid() }),
        { id: { type: 'string' } },
        (chat: string, id: string) => structuredClone(get(chat, id)),
      ],
      [
        'container_job_kill',
        '取消后台任务并清理此任务的进程树；保留共享容器、其他任务和文件。',
        z.object({ id: z.string().uuid() }),
        { id: { type: 'string' } },
        (chat: string, id: string) => ctx.use(containerJobsService).cancel(chat, id),
      ],
    ] as const)
      tools.register(ctx, {
        name,
        description,
        parameters: {
          type: 'object',
          properties: params,
          required: name === 'container_job_list' ? [] : ['id'],
          additionalProperties: false,
        },
        available: (chatKey) => session.available(chatKey),
        parse: (value) => schema.parse(value),
        execute: async (tool, args) => execute(tool.chatKey, (args as { id?: string }).id ?? ''),
      });
  },
});
