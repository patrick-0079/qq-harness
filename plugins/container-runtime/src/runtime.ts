import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import type { AccessService, StorageService, ContainerRuntimeService } from '@qq-harness/domain';
import {
  chatKeySchema,
  CONTAINER_WORKSPACE,
  containerSettingsSchema,
  containerExecSchema,
  type ContainerBinding,
  type ContainerInfo,
  type ContainerExecInput,
  type ContainerExecResult,
} from '@qq-harness/contracts';
import { runContainerCli, type ContainerCli } from './cli.js';

export interface ContainerOptions {
  allowOperations?: boolean;
  cli?: ContainerCli;
}
const OWNER = 'io.qq-harness.owner';
const CHAT = 'io.qq-harness.chat';
export class ContainerRuntime implements ContainerRuntimeService {
  private value;
  private owner: string;
  private records = new Map<string, ContainerBinding>();
  private tails = new Map<string, Promise<unknown>>();
  private epochs = new Map<string, number>();
  private active = new Map<string, AbortController>();
  private pending = new Set<Promise<unknown>>();
  private disposed = false;
  private cli: ContainerCli;
  constructor(
    private ctx: PluginContext,
    private storage: StorageService,
    private access: AccessService,
    private options: ContainerOptions,
  ) {
    this.cli = options.cli ?? runContainerCli;
    this.value = containerSettingsSchema.parse(storage.state('container-runtime', 'settings') ?? {});
    this.owner = z
      .string()
      .uuid()
      .parse(storage.state('container-runtime', 'owner') ?? randomUUID());
    storage.setState('container-runtime', 'owner', this.owner);
    for (const record of (storage.state('container-runtime', 'bindings') ?? []) as ContainerBinding[]) {
      chatKeySchema.parse(record.chatKey);
      if (!/^[a-zA-Z0-9_.-]+$/.test(record.id) || !['docker', 'podman'].includes(record.engine))
        throw new Error('容器绑定格式无效');
      this.records.set(record.chatKey, record);
    }
  }
  settings() {
    return structuredClone(this.value);
  }
  canOperate() {
    return this.options.allowOperations === true && this.value.enabled;
  }
  configure(patch: unknown) {
    this.ctx.assertActive();
    const next = containerSettingsSchema.parse({
      ...this.value,
      ...containerSettingsSchema.partial().strict().parse(patch),
    });
    if (next.binaryPath && !path.isAbsolute(next.binaryPath)) throw new Error('容器 CLI 必须使用绝对路径');
    if (this.records.size && (next.engine !== this.value.engine || next.binaryPath !== this.value.binaryPath))
      throw new Error('请先删除本工程的容器绑定，再切换引擎或 CLI 路径');
    this.value = next;
    this.storage.setState('container-runtime', 'settings', next);
    if (!next.enabled)
      for (const controller of this.active.values()) controller.abort(new Error('容器功能已关闭'));
    this.ctx.host.publish('container.changed', {});
    return this.settings();
  }
  bindings() {
    return structuredClone([...this.records.values()]);
  }
  has(chatKey: string) {
    return this.records.has(chatKey);
  }
  private save() {
    if (this.disposed || this.ctx.signal.aborted) return;
    this.storage.setState('container-runtime', 'bindings', this.bindings());
    this.ctx.host.publish('container.changed', {});
  }
  private call(
    binary: string,
    args: string[],
    signal?: AbortSignal,
    stdin?: string,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
    independent = false,
  ) {
    return this.cli(binary, args, {
      signal: AbortSignal.any([
        ...(independent ? [] : [this.ctx.signal]),
        ...(signal ? [signal] : []),
        AbortSignal.timeout(args[1] === 'exec' ? 600000 : args[1] === 'create' ? 30000 : 15000),
      ]),
      stdin,
      maxOutputChars: args[0] === 'container' && args[1] === 'exec' ? this.value.maxOutputChars : 65536,
      onOutput,
    });
  }
  private requireOk(result: ContainerExecResult) {
    if (result.exitCode !== 0)
      throw new Error(result.stderr.slice(0, 2000) || `容器 CLI 退出码 ${result.exitCode}`);
    return result;
  }
  async status(signal?: AbortSignal) {
    if (!this.options.allowOperations)
      return { available: false, message: '当前启动配置未允许容器操作', allowOperations: false };
    const engines = this.value.engine === 'auto' ? (['podman', 'docker'] as const) : [this.value.engine];
    const errors: string[] = [];
    for (const engine of engines) {
      const binary = this.value.binaryPath || engine;
      try {
        this.requireOk(await this.call(binary, ['info', '--format', '{{json .}}'], signal));
        return {
          available: true,
          engine,
          binary,
          message: '引擎可用',
          allowOperations: this.options.allowOperations === true,
        };
      } catch (error) {
        if (signal?.aborted || this.ctx.signal.aborted) throw error;
        errors.push(`${engine}: ${error instanceof Error ? error.message : error}`);
      }
      if (this.value.binaryPath) break;
    }
    return {
      available: false,
      message: errors.join('; ').slice(0, 2000),
      allowOperations: this.options.allowOperations === true,
    };
  }
  private async guard(chatKey: string, operation: string, enabled = true) {
    this.ctx.assertActive();
    chatKeySchema.parse(chatKey);
    this.access.assert(chatKey);
    if (!this.options.allowOperations)
      throw new Error('当前启动配置未允许容器操作，请使用 --containers 或 live 配置');
    if (enabled && !this.value.enabled) throw new Error('容器功能尚未启用');
    await this.ctx.points.guard('container.before', { chatKey, operation }, this.ctx.signal);
  }
  private record(chatKey: string) {
    const value = this.records.get(chatKey);
    if (!value) throw new Error('当前会话尚未绑定本工程的容器，请先在容器页面创建');
    return value;
  }
  private async verified(
    record: ContainerBinding,
    signal?: AbortSignal,
    independent = false,
  ): Promise<ContainerInfo> {
    const result = this.requireOk(
      await this.call(
        record.binary,
        ['container', 'inspect', record.id],
        signal,
        undefined,
        undefined,
        independent,
      ),
    );
    const data = JSON.parse(result.stdout)[0];
    if (data?.Config?.Labels?.[OWNER] !== this.owner || data?.Config?.Labels?.[CHAT] !== record.chatKey)
      throw new Error('容器不属于本工程或当前会话，拒绝操作');
    return {
      ...record,
      running: data.State?.Running === true,
      status: String(data.State?.Status ?? 'unknown'),
    };
  }
  private serial<T>(chatKey: string, fn: () => Promise<T>): Promise<T> {
    const epoch = this.epochs.get(chatKey) ?? 0;
    const operation = (this.tails.get(chatKey) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (epoch !== (this.epochs.get(chatKey) ?? 0))
          throw new DOMException('容器会话的排队操作已取消', 'AbortError');
        return fn();
      });
    this.tails.set(chatKey, operation);
    this.pending.add(operation);
    void operation
      .finally(() => {
        this.pending.delete(operation);
        if (this.tails.get(chatKey) === operation) this.tails.delete(chatKey);
      })
      .catch(() => {});
    return operation;
  }
  async inspect(chatKey: string, signal?: AbortSignal) {
    this.ctx.assertActive();
    this.access.assert(chatKey);
    return this.verified(this.record(chatKey), signal);
  }
  async list(signal?: AbortSignal) {
    return Promise.all(
      this.bindings()
        .filter((r) => this.access.allowed(r.chatKey))
        .map(async (r) => {
          try {
            return await this.verified(r, signal);
          } catch {
            return { ...r, running: false, status: 'unavailable' };
          }
        }),
    );
  }
  create(chatKey: string, signal?: AbortSignal) {
    return this.serial(chatKey, async () => {
      await this.guard(chatKey, 'create');
      signal?.throwIfAborted();
      if (this.has(chatKey)) return this.verified(this.record(chatKey), signal);
      const engine = await this.status(signal);
      if (!engine.available || !engine.engine || !engine.binary) throw new Error(engine.message);
      const name = `qqh-${this.owner.slice(0, 8)}-${createHash('sha256').update(chatKey).digest('hex').slice(0, 12)}`;
      const record: ContainerBinding = {
        chatKey,
        name,
        id: name,
        engine: engine.engine,
        binary: engine.binary,
        image: this.value.image,
      };
      // 先登记候选名称；创建期间停用插件时也能按归属标签回收迟到创建的容器。
      this.records.set(chatKey, record);
      this.save();
      try {
        const cfg = this.value;
        const created = this.requireOk(
          await this.call(
            record.binary,
            [
              'container',
              'create',
              '--pull=never',
              '--name',
              name,
              '--label',
              `${OWNER}=${this.owner}`,
              '--label',
              `${CHAT}=${chatKey}`,
              '--memory',
              `${cfg.memoryMb}m`,
              '--cpus',
              String(cfg.cpus),
              '--pids-limit',
              String(cfg.pids),
              '--cap-drop',
              'ALL',
              '--security-opt',
              'no-new-privileges',
              '--network',
              cfg.network,
              '--workdir',
              '/',
              '--entrypoint',
              '/bin/sh',
              cfg.image,
              '-c',
              'while :; do sleep 3600; done',
            ],
            AbortSignal.timeout(30000),
            undefined,
            undefined,
            true,
          ),
        );
        const id = created.stdout.trim();
        if (!/^[a-f0-9]{12,64}$/i.test(id)) throw new Error('容器引擎没有返回有效容器 ID');
        record.id = id;
        this.save();
        this.ctx.assertActive();
        signal?.throwIfAborted();
        return await this.startRaw(record, signal);
      } catch (error) {
        await this.stopRaw(record).catch(() => {});
        try {
          const check = await this.call(
            record.binary,
            ['container', 'inspect', record.id],
            AbortSignal.timeout(5000),
            undefined,
            undefined,
            true,
          );
          if (
            check.exitCode !== 0 &&
            /no such (object|container)|no container with|does not exist|not found/i.test(check.stderr)
          ) {
            this.records.delete(chatKey);
            this.save();
          }
        } catch {
          /* 无法确认是否已创建时保留绑定，不能丢失清理归属。 */
        }
        throw error;
      }
    });
  }
  private async startRaw(record: ContainerBinding, signal?: AbortSignal) {
    const info = await this.verified(record, signal);
    if (!info.running)
      this.requireOk(await this.call(record.binary, ['container', 'start', record.id], signal));
    this.requireOk(
      await this.call(
        record.binary,
        ['container', 'exec', '--workdir', '/', record.id, 'mkdir', '-p', '--', CONTAINER_WORKSPACE],
        signal,
      ),
    );
    return this.verified(record, signal);
  }
  start(chatKey: string, signal?: AbortSignal) {
    return this.serial(chatKey, async () => {
      await this.guard(chatKey, 'start');
      return this.startRaw(this.record(chatKey), signal);
    });
  }
  private async stopRaw(record: ContainerBinding) {
    const info = await this.verified(record, AbortSignal.timeout(5000), true);
    if (info.running)
      this.requireOk(
        await this.call(
          record.binary,
          ['container', 'stop', '--time', '1', record.id],
          AbortSignal.timeout(10000),
          undefined,
          undefined,
          true,
        ),
      );
  }
  async stop(chatKey: string) {
    await this.guard(chatKey, 'stop', false);
    this.epochs.set(chatKey, (this.epochs.get(chatKey) ?? 0) + 1);
    this.active.get(chatKey)?.abort(new DOMException('容器已停止', 'AbortError'));
    await this.serial(chatKey, () => this.stopRaw(this.record(chatKey)));
    this.ctx.host.publish('container.changed', {});
  }
  async remove(chatKey: string) {
    await this.guard(chatKey, 'remove', false);
    this.epochs.set(chatKey, (this.epochs.get(chatKey) ?? 0) + 1);
    this.active.get(chatKey)?.abort(new DOMException('容器正在删除', 'AbortError'));
    return this.serial(chatKey, async () => {
      const record = this.record(chatKey);
      await this.verified(record);
      this.requireOk(await this.call(record.binary, ['container', 'rm', '--force', record.id]));
      this.records.delete(chatKey);
      this.save();
    });
  }
  execute(
    chatKey: string,
    input: ContainerExecInput,
    signal?: AbortSignal,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ) {
    const parsed = containerExecSchema.parse(input);
    const workdir = this.containerPath(parsed.workdir);
    return this.run(
      chatKey,
      ['sh', '-lc', parsed.command],
      workdir,
      parsed.timeoutMs,
      signal,
      undefined,
      onOutput,
    );
  }
  command(chatKey: string, argv: string[], signal?: AbortSignal, stdin?: string) {
    return this.run(chatKey, argv, CONTAINER_WORKSPACE, undefined, signal, stdin);
  }
  containerPath(value: string) {
    if (!value || /[\0\r\n]/.test(value) || value.length > 1000) throw new Error('容器内路径无效');
    return path.posix.resolve(CONTAINER_WORKSPACE, value);
  }
  private run(
    chatKey: string,
    argv: string[],
    workdir: string,
    timeoutMs?: number,
    signal?: AbortSignal,
    stdin?: string,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ) {
    return this.serial(chatKey, async () => {
      await this.guard(chatKey, 'exec');
      signal?.throwIfAborted();
      const record = this.record(chatKey);
      const controller = new AbortController();
      this.active.set(chatKey, controller);
      const combined = AbortSignal.any([
        this.ctx.signal,
        controller.signal,
        signal ?? new AbortController().signal,
        AbortSignal.timeout(timeoutMs ?? this.value.timeoutMs),
      ]);
      try {
        await this.startRaw(record, combined);
        const result = await this.call(
          record.binary,
          [
            'container',
            'exec',
            ...(stdin === undefined ? [] : ['-i']),
            '--workdir',
            workdir,
            record.id,
            ...argv,
          ],
          combined,
          stdin,
          onOutput,
        );
        this.ctx.points.observe('container.after', { chatKey, operation: 'exec', exitCode: result.exitCode });
        return result;
      } finally {
        // 杀掉宿主 CLI 不等于结束远端 exec。取消/超时必须停止此会话容器，避免遗留计算。
        if (combined.aborted)
          await this.stopRaw(record).catch((error) => this.ctx.log(`容器取消清理失败：${String(error)}`));
        this.active.delete(chatKey);
      }
    });
  }
  async dispose() {
    this.disposed = true;
    for (const controller of this.active.values()) controller.abort(new Error('容器插件已停用'));
    await Promise.allSettled([...this.pending]);
    if (this.options.allowOperations)
      await Promise.allSettled(
        this.bindings().map(async (r) => {
          try {
            await this.stopRaw(r);
          } catch {
            this.ctx.log(`停止本工程容器 ${r.name} 失败，请在引擎恢复后检查容器状态`);
          }
        }),
      );
  }
}
