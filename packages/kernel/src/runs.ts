import { randomUUID } from 'node:crypto';
import type { Disposer, ModeDefinition, RunContext, RunRecord, RunRequest } from '@qq-harness/plugin-sdk';

interface Mode {
  owner: string;
  definition: ModeDefinition;
  active: () => boolean;
}
interface Job {
  record: RunRecord;
  request: RunRequest;
  mode: Mode;
  controller: AbortController;
  resolve: (record: RunRecord) => void;
  promise: Promise<RunRecord>;
  timer?: ReturnType<typeof setTimeout>;
  operation?: boolean;
}
export class Runs {
  private modes = new Map<string, Mode>();
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private active = new Set<string>();
  private partitions = new Set<string>();
  private operationParents = new Set<string>();
  private queueLimit = 200;
  private guards = new Set<(owner: string, mode: string) => void>();
  guard(fn: (owner: string, mode: string) => void): Disposer {
    this.guards.add(fn);
    return () => {
      this.guards.delete(fn);
    };
  }
  private admit(mode: Mode) {
    for (const guard of this.guards) guard(mode.owner, mode.definition.id);
  }
  configure(concurrency: number, queueLimit: number) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 64 ||
      !Number.isInteger(queueLimit) ||
      queueLimit < 1
    )
      throw Error('运行池配置无效');
    this.concurrency = concurrency;
    this.queueLimit = queueLimit;
    this.pump();
  }
  constructor(
    private publish: (type: string, payload: unknown) => void,
    private revision: () => number,
    private concurrency = 2,
  ) {}
  register<T>(owner: string, definition: ModeDefinition<T>, active: () => boolean): Disposer {
    if (this.modes.has(definition.id)) throw new Error(`重复运行模式：${definition.id}`);
    const entry: Mode = {
      owner,
      definition: definition as ModeDefinition,
      active,
    };
    this.modes.set(definition.id, entry);
    return () => {
      if (this.modes.get(definition.id) === entry) this.modes.delete(definition.id);
      for (const job of this.jobs.values()) if (job.mode === entry) this.cancel(job.record.id);
    };
  }
  submit<T>(request: RunRequest<T>): RunRecord {
    const mode = this.modes.get(request.mode);
    if (!mode?.active()) throw new Error(`运行模式未就绪：${request.mode}`);
    this.admit(mode);
    if (
      this.queue.filter((j) => j.mode.definition.lane === mode.definition.lane).length >=
      (mode.definition.lane ? 20 : this.queueLimit)
    )
      throw new Error('运行队列已满');
    const input = mode.definition.input.parse(request.input);
    const partitionKey = mode.definition.partitionKey?.(input) ?? request.partitionKey;
    const record: RunRecord = {
      id: randomUUID(),
      owner: mode.owner,
      mode: request.mode,
      partitionKey,
      status: 'queued',
      createdAt: Date.now(),
    };
    let resolve!: (record: RunRecord) => void;
    const promise = new Promise<RunRecord>((done) => {
      resolve = done;
    });
    const job: Job = {
      record,
      request: { ...request, input },
      mode,
      controller: new AbortController(),
      promise,
      resolve,
    };
    this.jobs.set(record.id, job);
    this.queue.push(job);
    if (request.maxWaitMs && request.maxWaitMs > 0)
      job.timer = setTimeout(() => this.cancel(record.id, '排队超时'), request.maxWaitMs);
    this.publish('run.changed', structuredClone(record));
    this.pump();
    return structuredClone(record);
  }
  private pump(): void {
    while (true) {
      const activeJobs = [...this.active].map((id) => this.jobs.get(id)!);
      const index = this.queue.findIndex(
        (job) =>
          !this.partitions.has(job.record.partitionKey) &&
          activeJobs.filter((j) => j.mode.definition.lane === job.mode.definition.lane).length <
            (job.mode.definition.lane ? 1 : this.concurrency),
      );
      if (index < 0) return;
      const job = this.queue.splice(index, 1)[0]!;
      if (job.timer) clearTimeout(job.timer);
      this.active.add(job.record.id);
      this.partitions.add(job.record.partitionKey);
      void this.execute(job);
    }
  }
  async operation<T>(parent: RunContext, request: RunRequest<T>): Promise<RunRecord> {
    parent.assertActive();
    const parentJob = this.jobs.get(parent.id),
      mode = this.modes.get(request.mode);
    if (!parentJob || parentJob.record.status !== 'running' || parentJob.operation)
      throw new Error('操作必须绑定正在执行的顶层运行');
    if (this.operationParents.has(parent.id)) throw new Error('父运行已有执行中的操作');
    if (!mode?.active() || !mode.definition.operation) throw new Error('该模式不支持绑定操作');
    this.admit(mode);
    const input = mode.definition.input.parse(request.input),
      partitionKey = mode.definition.partitionKey?.(input) ?? request.partitionKey;
    const remaining = parent.deadline - Date.now();
    if (remaining <= 0) throw new Error('父运行期限已过');
    const timeoutMs =
      request.timeoutMs === 0
        ? Number.isFinite(remaining)
          ? remaining
          : 0
        : Math.min(request.timeoutMs ?? 120000, remaining);
    const record: RunRecord = {
      id: randomUUID(),
      parentId: parent.id,
      owner: mode.owner,
      mode: request.mode,
      partitionKey,
      status: 'queued',
      createdAt: Date.now(),
    };
    let resolve!: (r: RunRecord) => void;
    const promise = new Promise<RunRecord>((r) => {
      resolve = r;
    });
    const job: Job = {
      record,
      request: { ...request, input, timeoutMs },
      mode,
      controller: new AbortController(),
      promise,
      resolve,
      operation: true,
    };
    const abort = () => this.cancel(record.id, '父运行已取消');
    this.operationParents.add(parent.id);
    this.jobs.set(record.id, job);
    parent.signal.addEventListener('abort', abort, { once: true });
    try {
      parent.signal.throwIfAborted();
      // 操作不占用另一个顶层槽，也不等待父运行持有的会话锁。操作模式必须自行串行化副作用。
      await this.execute(job);
      return structuredClone(record);
    } finally {
      parent.signal.removeEventListener('abort', abort);
      this.operationParents.delete(parent.id);
    }
  }
  private async execute(job: Job): Promise<void> {
    const { record, controller, mode, request } = job;
    record.status = 'running';
    record.startedAt = Date.now();
    const timeout = request.timeoutMs ?? 120000;
    const run: RunContext = {
      id: record.id,
      signal: controller.signal,
      deadline: timeout === 0 ? Infinity : Date.now() + timeout,
      revision: this.revision(),
      assertActive: () => {
        controller.signal.throwIfAborted();
        if (record.status !== 'running') throw new Error('运行已经结束');
        if (!mode.active()) throw new Error('模式所属插件已停用');
        this.admit(mode);
      },
    };
    if (timeout > 0) job.timer = setTimeout(() => this.cancel(record.id, '运行超时'), timeout);
    this.publish('run.changed', structuredClone(record));
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          run.assertActive();
          return mode.definition.execute(run, request.input);
        }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
            once: true,
          }),
        ),
      ]);
      run.assertActive();
      record.result = structuredClone(result);
      record.status = 'completed';
    } catch (error) {
      record.status = controller.signal.aborted ? 'cancelled' : 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (job.timer) clearTimeout(job.timer);
      record.endedAt = Date.now();
      if (!job.operation) {
        this.active.delete(record.id);
        this.partitions.delete(record.partitionKey);
      }
      this.finish(job);
      this.pump();
    }
  }
  private finish(job: Job): void {
    const copy = structuredClone(job.record);
    job.resolve(copy);
    this.publish('run.changed', copy);
    // 持久化由插件订阅；内核只保留有限的诊断历史。
    if (this.jobs.size > 500) {
      for (const [id, item] of this.jobs) {
        if (item.record.endedAt) this.jobs.delete(id);
        if (this.jobs.size <= 500) break;
      }
    }
  }
  cancel(id: string, reason = '运行已取消'): boolean {
    const job = this.jobs.get(id);
    if (!job || job.record.endedAt) return false;
    job.controller.abort(new Error(reason));
    const index = this.queue.indexOf(job);
    if (index >= 0) {
      this.queue.splice(index, 1);
      if (job.timer) clearTimeout(job.timer);
      job.record.status = 'cancelled';
      job.record.error = reason;
      job.record.endedAt = Date.now();
      this.finish(job);
      this.pump();
    }
    return true;
  }
  list(): RunRecord[] {
    return [...this.jobs.values()].map((job) => structuredClone(job.record)).reverse();
  }
  async wait(id: string): Promise<RunRecord> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('运行不存在');
    return job.promise;
  }
  async stop(): Promise<void> {
    for (const id of this.jobs.keys()) this.cancel(id, '运行时关闭');
    await Promise.all([...this.jobs.values()].map((job) => job.promise));
  }
}
