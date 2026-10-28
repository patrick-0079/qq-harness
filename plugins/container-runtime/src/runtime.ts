import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import type { AccessService, StorageService, ContainerRuntimeService } from '@qq-harness/domain';
import {
  chatKeySchema,
  CONTAINER_WORKSPACE,
  containerSettingsSchema,
  containerExecSchema,
  type ContainerBinding,
  type ContainerResource,
  type ContainerPoolState,
  type ContainerInfo,
  type ContainerExecInput,
  type ContainerExecResult,
} from '@qq-harness/contracts';
import { runContainerCli, type ContainerCli } from './cli.js';
import { ACCOUNT_SCRIPT, sessionIdentity } from './accounts.js';
import { TASK_SCRIPT, CANCEL_SCRIPT } from './task-process.js';
import { legacyContainerPool } from './pool-state.js';

export interface ContainerOptions {
  allowOperations?: boolean;
  cli?: ContainerCli;
}
const OWNER = 'io.qq-harness.owner',
  CHAT = 'io.qq-harness.chat';
const identifier = z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/);
const edgeKey = (chat: string, id: string) => `${chat}\0${id}`;
export class ContainerRuntime implements ContainerRuntimeService {
  private value;
  private owner: string;
  private resources = new Map<string, ContainerResource>();
  private edges = new Map<string, ContainerBinding>();
  private tails = new Map<string, Promise<unknown>>();
  private epochs = new Map<string, number>();
  private active = new Map<string, { chat: string; id: string; controller: AbortController }>();
  private pending = new Map<Promise<unknown>, { chat: string; id: string }>();
  private accounts = new Map<string, ContainerBinding>();
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
    const state =
      (storage.state('container-runtime', 'pool-v2') as ContainerPoolState | undefined) ??
      legacyContainerPool(
        storage.state('container-runtime', 'bindings'),
        storage.state('container-runtime', 'unbound'),
      );
    if (state.version !== 2 || !Array.isArray(state.resources) || !Array.isArray(state.bindings))
      throw Error('容器资源池版本无效');
    for (const row of state.resources) {
      identifier.parse(row.id);
      if (!['podman', 'docker'].includes(row.engine) || typeof row.managed !== 'boolean')
        throw Error('容器资源格式无效');
      this.resources.set(row.id, { ...row });
    }
    for (const row of state.bindings) {
      const resource = this.resource(row.id);
      chatKeySchema.parse(row.chatKey);
      const identity = sessionIdentity(row.chatKey);
      this.edges.set(edgeKey(row.chatKey, row.id), { ...row, ...resource, ...identity });
    }
    this.normalizePrimary();
  }
  settings() {
    return structuredClone(this.value);
  }
  canOperate() {
    return this.options.allowOperations === true && this.value.enabled;
  }
  configure(patch: unknown) {
    this.ctx.assertActive();
    const supplied = z.record(z.string(), z.unknown()).parse(patch);
    const parsed = containerSettingsSchema.partial().strict().parse(supplied);
    const next = containerSettingsSchema.parse({
      ...this.value,
      ...Object.fromEntries(Object.keys(supplied).map((key) => [key, parsed[key as keyof typeof parsed]])),
    });
    if (next.binaryPath && !path.isAbsolute(next.binaryPath)) throw Error('容器 CLI 必须使用绝对路径');
    if (
      this.resources.size &&
      (next.engine !== this.value.engine || next.binaryPath !== this.value.binaryPath)
    )
      throw Error('请先移除资源池登记，再切换引擎或 CLI 路径');
    this.value = next;
    this.storage.setState('container-runtime', 'settings', next);
    if (!next.enabled)
      for (const item of this.active.values()) item.controller.abort(Error('容器功能已关闭'));
    this.ctx.host.publish('container.changed', {});
    return this.settings();
  }
  bindings() {
    return structuredClone([...this.edges.values()].map((e) => ({ ...e, ...this.resource(e.id) })));
  }
  has(chatKey: string) {
    return [...this.edges.values()].some((e) => e.chatKey === chatKey);
  }
  private normalizePrimary() {
    for (const chat of new Set([...this.edges.values()].map((e) => e.chatKey))) {
      const rows = [...this.edges.values()].filter((e) => e.chatKey === chat);
      const primary = rows.find((e) => e.primary) ?? rows[0];
      for (const row of rows) row.primary = row === primary;
    }
  }
  private save() {
    if (this.disposed || this.ctx.signal.aborted) return;
    const state: ContainerPoolState = {
      version: 2,
      resources: [...this.resources.values()],
      bindings: this.bindings(),
    };
    this.storage.setState('container-runtime', 'pool-v2', state);
    this.ctx.host.publish('container.changed', {});
  }
  private resource(id: string) {
    const row = this.resources.get(identifier.parse(id));
    if (!row) throw Error('容器未登记到资源池，请在设置中的容器配置登记或创建');
    return row;
  }
  private binding(chat: string, id?: string) {
    const rows = [...this.edges.values()].filter((e) => e.chatKey === chat);
    const row = id ? rows.find((e) => e.id === id) : (rows.find((e) => e.primary) ?? rows[0]);
    if (!row) throw Error('当前会话未绑定所选容器，请在会话设置选择资源池中的容器');
    return { ...row, ...this.resource(row.id) };
  }
  workspace(chat: string, id?: string) {
    this.access.assert(chat);
    return this.binding(chat, id).workspace;
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
        AbortSignal.timeout(args[1] === 'exec' ? 600000 : 30000),
      ]),
      stdin,
      maxOutputChars: args[1] === 'exec' ? this.value.maxOutputChars : 100000,
      onOutput,
    });
  }
  private ok(result: ContainerExecResult) {
    if (result.exitCode !== 0)
      throw Error(result.stderr.slice(0, 2000) || `容器 CLI 退出码 ${result.exitCode}`);
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
        this.ok(await this.call(binary, ['info', '--format', '{{json .}}'], signal));
        const image = await this.call(binary, ['image', 'inspect', this.value.image], signal);
        return {
          available: true,
          engine,
          binary,
          imageAvailable: image.exitCode === 0,
          image: this.value.image,
          allowOperations: true,
          message:
            image.exitCode !== 0
              ? '引擎可用，但配置镜像不存在；请选择已有镜像或先手工拉取'
              : this.value.enabled
                ? '引擎与镜像可用'
                : '引擎与镜像可用，容器功能已关闭',
        };
      } catch (error) {
        if (signal?.aborted || this.ctx.signal.aborted) throw error;
        errors.push(`${engine}: ${error instanceof Error ? error.message : error}`);
      }
      if (this.value.binaryPath) break;
    }
    return { available: false, message: errors.join('; ').slice(0, 2000), allowOperations: true };
  }
  private async guard(chatKey: string | undefined, operation: string, enabled = true) {
    this.ctx.assertActive();
    if (chatKey !== undefined) {
      chatKeySchema.parse(chatKey);
      this.access.assert(chatKey);
    }
    if (!this.options.allowOperations) throw Error('当前启动配置未允许容器操作');
    if (enabled && !this.value.enabled) throw Error('容器功能尚未启用');
    await this.ctx.points.guard('container.before', { chatKey, operation }, this.ctx.signal);
  }
  private info(row: ContainerResource, data?: any): ContainerInfo {
    const bindings = this.bindings().filter((e) => e.id === row.id);
    return {
      ...row,
      bindings,
      chatKeys: bindings.map((e) => e.chatKey),
      bound: bindings.length > 0,
      chatKey: bindings[0]?.chatKey,
      running: data?.State?.Running === true,
      status: String(data?.State?.Status ?? 'unavailable'),
    };
  }
  private async verified(row: ContainerResource, signal?: AbortSignal, independent = false) {
    const result = this.ok(
      await this.call(
        row.binary,
        ['container', 'inspect', row.id],
        signal,
        undefined,
        undefined,
        independent,
      ),
    );
    const data = JSON.parse(result.stdout)[0];
    if (data?.Id !== row.id) throw Error('容器身份已变化，请重新登记');
    if (
      row.managed &&
      (data?.Config?.Labels?.[OWNER] !== this.owner ||
        (row.ownerChatKey && data?.Config?.Labels?.[CHAT] !== row.ownerChatKey))
    )
      throw Error('容器归属标签不符，拒绝操作');
    return this.info(row, data);
  }
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const epoch = this.epochs.get(key) ?? 0;
    const operation = (this.tails.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (epoch !== (this.epochs.get(key) ?? 0)) throw new DOMException('排队任务已取消', 'AbortError');
        this.ctx.assertActive();
        return fn();
      });
    this.tails.set(key, operation);
    void operation
      .finally(() => {
        if (this.tails.get(key) === operation) this.tails.delete(key);
      })
      .catch(() => {});
    return operation;
  }
  async inspect(chat: string, signal?: AbortSignal, id?: string) {
    this.ctx.assertActive();
    this.access.assert(chat);
    const row = this.binding(chat, id),
      info = await this.verified(row, signal);
    // A session never receives other sessions' account metadata.
    return {
      ...info,
      cleanupPending: undefined,
      chatKey: chat,
      chatKeys: [chat],
      bindings: info.bindings
        .filter((e) => e.chatKey === chat)
        .map(({ cleanupPending: _internal, ...binding }) => binding),
    };
  }
  async list(signal?: AbortSignal) {
    this.ctx.assertActive();
    return Promise.all(
      [...this.resources.values()].map(async (row) => {
        try {
          return await this.verified(row, signal);
        } catch {
          return this.info(row);
        }
      }),
    );
  }
  async discover(signal?: AbortSignal) {
    await this.guard(undefined, 'discover', false);
    const engine = await this.status(signal);
    if (!engine.available || !engine.engine || !engine.binary) throw Error(engine.message);
    const raw = this.ok(
      await this.call(
        engine.binary,
        [
          'container',
          'ls',
          '--all',
          '--no-trunc',
          '--format',
          engine.engine === 'podman' ? 'json' : '{{json .}}',
        ],
        signal,
      ),
    ).stdout.trim();
    const rows = raw
      ? engine.engine === 'podman'
        ? JSON.parse(raw)
        : raw.split(/\r?\n/).map((s) => JSON.parse(s))
      : [];
    return rows.slice(0, 1000).map((r: any) => {
      const id = String(r.Id ?? r.ID ?? r.id);
      return {
        id,
        name: String(Array.isArray(r.Names) ? r.Names[0] : (r.Names ?? r.Name ?? id)),
        image: String(r.Image ?? ''),
        running: r.State === 'running' || r.State?.Running === true,
        registered: this.resources.has(id),
      };
    });
  }
  registerExisting(reference: string, signal?: AbortSignal) {
    return this.serial('pool', async () => {
      await this.guard(undefined, 'register');
      identifier.parse(reference);
      const engine = await this.status(signal);
      if (!engine.available || !engine.engine || !engine.binary) throw Error(engine.message);
      const data = JSON.parse(
        this.ok(await this.call(engine.binary, ['container', 'inspect', reference], signal)).stdout,
      )[0];
      const id = identifier.parse(data?.Id),
        existing = this.resources.get(id);
      if (existing) return this.verified(existing, signal);
      const labels = data.Config?.Labels ?? {};
      const row: ContainerResource = {
        id,
        name: String(data.Name ?? reference).replace(/^\//, ''),
        image: String(data.Config?.Image ?? data.ImageName ?? data.Image),
        binary: engine.binary,
        engine: engine.engine,
        managed: labels[OWNER] === this.owner,
        enabled: true,
        ...(labels[OWNER] === this.owner && labels[CHAT] ? { ownerChatKey: labels[CHAT] } : {}),
      };
      this.resources.set(id, row);
      this.save();
      return this.info(row, data);
    });
  }
  createResource(input: { name?: string; image?: string } = {}, signal?: AbortSignal) {
    return this.serial('pool', async () => {
      await this.guard(undefined, 'create');
      signal?.throwIfAborted();
      const image = containerSettingsSchema.shape.image.parse(input.image ?? this.value.image);
      const engine = await this.status(signal);
      if (!engine.available || !engine.engine || !engine.binary) throw Error(engine.message);
      this.ok(await this.call(engine.binary, ['image', 'inspect', image], signal));
      const name = identifier.parse(
        input.name || `qqh-${this.owner.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
      );
      const cfg = this.value;
      // Keep the creation operation alive through plugin cancellation to capture the immutable ID.
      const result = this.ok(
        await this.call(
          engine.binary,
          [
            'container',
            'create',
            '--pull=never',
            '--name',
            name,
            '--label',
            `${OWNER}=${this.owner}`,
            '--memory',
            `${cfg.memoryMb}m`,
            '--cpus',
            String(cfg.cpus),
            '--pids-limit',
            String(cfg.pids),
            '--cap-drop',
            'ALL',
            ...['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID', 'KILL'].flatMap((c) => [
              '--cap-add',
              c,
            ]),
            '--security-opt',
            'no-new-privileges',
            '--network',
            cfg.network,
            '--workdir',
            '/',
            '--entrypoint',
            '/bin/sh',
            image,
            '-c',
            'while :; do sleep 3600; done',
          ],
          AbortSignal.timeout(30000),
          undefined,
          undefined,
          true,
        ),
      );
      const id = identifier.parse(result.stdout.trim());
      const row: ContainerResource = {
        id,
        name,
        image,
        engine: engine.engine,
        binary: engine.binary,
        managed: true,
        enabled: true,
      };
      this.resources.set(id, row);
      // Persist even during unload: an in-flight create must not become an untracked resource.
      this.storage.setState('container-runtime', 'pool-v2', {
        version: 2,
        resources: [...this.resources.values()],
        bindings: this.bindings(),
      });
      this.ctx.assertActive();
      signal?.throwIfAborted();
      return this.startRaw(row, signal);
    });
  }
  async create(chat: string, signal?: AbortSignal) {
    await this.guard(chat, 'create');
    if (this.has(chat)) return this.inspect(chat, signal);
    const resource = await this.createResource({}, signal);
    return this.bind(chat, resource.id);
  }
  private makeBinding(chat: string, id: string): ContainerBinding {
    return { ...this.resource(id), chatKey: chat, ...sessionIdentity(chat), primary: false };
  }
  private editBindings(change: (next: Map<string, ContainerBinding>) => void) {
    return this.serial('pool', async () => {
      await this.guard(undefined, 'bind', false);
      const next = new Map([...this.edges].map(([key, row]) => [key, { ...row }]));
      change(next);
      const changed = new Set(
        [...this.edges.keys(), ...next.keys()].filter((k) => this.edges.has(k) !== next.has(k)),
      );
      for (const key of changed) {
        const row = next.get(key) ?? this.edges.get(key)!;
        if (
          this.pending.size &&
          [...this.pending.values()].some((p) => p.chat === row.chatKey && p.id === row.id)
        )
          throw Error('该会话在此容器中有运行或排队任务，请先取消');
        if (next.has(key)) {
          this.access.assert(row.chatKey);
          await this.verified(this.resource(row.id));
        }
      }
      this.edges = next;
      this.normalizePrimary();
      this.save();
    });
  }
  async setBindings(chat: string, ids: string[], primary?: string) {
    chatKeySchema.parse(chat);
    sessionIdentity(chat);
    const selected = [...new Set(z.array(identifier).max(64).parse(ids))];
    if (primary && !selected.includes(primary)) throw Error('默认容器必须在已选容器中');
    await this.editBindings((next) => {
      for (const [key, row] of next) if (row.chatKey === chat) next.delete(key);
      for (const id of selected)
        next.set(edgeKey(chat, id), {
          ...(this.edges.get(edgeKey(chat, id)) ?? this.makeBinding(chat, id)),
          primary: id === (primary ?? selected[0]),
        });
    });
    return this.bindings().filter((e) => e.chatKey === chat);
  }
  async assignResource(id: string, chats: string[]) {
    this.resource(id);
    const selected = [...new Set(z.array(chatKeySchema).max(1000).parse(chats))];
    await this.editBindings((next) => {
      for (const [key, row] of next) if (row.id === id && !selected.includes(row.chatKey)) next.delete(key);
      for (const chat of selected) {
        sessionIdentity(chat);
        const key = edgeKey(chat, id);
        if (!next.has(key)) next.set(key, this.makeBinding(chat, id));
      }
    });
    return this.verified(this.resource(id));
  }
  async bind(chat: string, id: string) {
    chatKeySchema.parse(chat);
    sessionIdentity(chat);
    await this.editBindings((next) => {
      const key = edgeKey(chat, id);
      if (!next.has(key)) next.set(key, this.makeBinding(chat, id));
    });
    return this.inspect(chat, undefined, id);
  }
  async unbind(chat: string, id?: string) {
    chatKeySchema.parse(chat);
    await this.editBindings((next) => {
      for (const [key, row] of next) if (row.chatKey === chat && (!id || id === row.id)) next.delete(key);
    });
  }
  remove(chat: string) {
    return this.unbind(chat);
  }
  removeExisting(id: string) {
    return this.serial('pool', async () => {
      await this.guard(undefined, 'remove', false);
      const row = this.resource(id);
      if ([...this.edges.values()].some((e) => e.id === id)) throw Error('请先解除此容器的所有会话绑定');
      if ([...this.pending.values()].some((e) => e.id === id)) throw Error('容器有运行或排队任务');
      if (row.cleanupPending?.length) throw Error('容器仍有待确认清理的任务，请先停用或完成清理');
      if (row.managed) {
        await this.verified(row);
        this.ok(await this.call(row.binary, ['container', 'rm', '--force', id]));
      }
      this.resources.delete(id);
      this.save();
    });
  }
  private async startRaw(row: ContainerResource, signal?: AbortSignal) {
    const info = await this.verified(row, signal);
    if (!info.running) this.ok(await this.call(row.binary, ['container', 'start', row.id], signal));
    return this.verified(row, signal);
  }
  async start(chat: string, signal?: AbortSignal, id?: string) {
    await this.guard(chat, 'start');
    const row = this.binding(chat, id);
    if (row.enabled === false) throw Error('管理员已停用此容器，请在资源池中启用');
    await this.startRaw(row, signal);
    return this.inspect(chat, signal, row.id);
  }
  async startResource(id: string, signal?: AbortSignal) {
    await this.guard(undefined, 'start');
    const row = this.resource(id);
    const result = await this.startRaw(row, signal);
    for (const task of row.cleanupPending ?? []) await this.cleanTask(row, task.id, task.username);
    delete row.cleanupPending;
    row.enabled = true;
    this.save();
    return { ...result, enabled: true };
  }
  private async cleanTask(row: ContainerResource, id: string, username: string) {
    this.ok(
      await this.call(
        row.binary,
        ['container', 'exec', '-i', '--user', '0', '--workdir', '/', row.id, 'python3', '-c', CANCEL_SCRIPT],
        AbortSignal.timeout(6000),
        JSON.stringify({ owner: this.owner, id, username }),
        undefined,
        true,
      ),
    );
  }
  private async cancelTasks(match: (p: { chat: string; id: string }) => boolean) {
    for (const p of this.pending.values())
      if (match(p)) {
        const key = 'exec:' + edgeKey(p.chat, p.id);
        this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
      }
    for (const item of this.active.values())
      if (match(item)) item.controller.abort(new DOMException('容器任务已取消', 'AbortError'));
    await Promise.allSettled([...this.pending].filter(([, p]) => match(p)).map(([promise]) => promise));
  }
  async stop(chat: string, _signal?: AbortSignal, id?: string) {
    await this.guard(chat, 'stop', false);
    if (id) this.binding(chat, id);
    await this.cancelTasks((p) => p.chat === chat && (!id || id === p.id));
  }
  async stopResource(id: string) {
    await this.guard(undefined, 'stop', false);
    const row = this.resource(id);
    row.enabled = false;
    this.save();
    await this.cancelTasks((p) => p.id === id);
    const info = await this.verified(row);
    if (info.running) this.ok(await this.call(row.binary, ['container', 'stop', '--time', '1', id]));
    delete row.cleanupPending;
    this.save();
    this.ctx.host.publish('container.changed', {});
  }
  private account(row: ContainerBinding, signal: AbortSignal) {
    return this.serial('account:' + row.id, async () => {
      const key = edgeKey(row.chatKey, row.id),
        cached = this.accounts.get(key);
      if (cached) return cached;
      const result = this.ok(
        await this.call(
          row.binary,
          [
            'container',
            'exec',
            '-i',
            '--user',
            '0',
            '--workdir',
            '/',
            row.id,
            'python3',
            '-c',
            ACCOUNT_SCRIPT,
          ],
          signal,
          JSON.stringify({
            ...sessionIdentity(row.chatKey),
            owner: this.owner,
            legacy: row.legacyWorkspace ? CONTAINER_WORKSPACE : undefined,
          }),
        ),
      );
      const identity = z
        .object({
          username: z.string(),
          uid: z.number().int().min(1000),
          gid: z.number().int().min(1000),
          home: z.string(),
          workspace: z.string(),
        })
        .parse(JSON.parse(result.stdout));
      const expected = sessionIdentity(row.chatKey);
      if (
        identity.username !== expected.username ||
        identity.home !== expected.home ||
        identity.workspace !== expected.workspace
      )
        throw Error('容器返回的用户身份无效');
      const next = { ...row, ...identity };
      this.accounts.set(key, next);
      if (this.edges.has(key)) {
        this.edges.set(key, next);
        this.save();
      }
      return next;
    });
  }
  execute(
    chat: string,
    input: ContainerExecInput,
    signal?: AbortSignal,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ) {
    const parsed = containerExecSchema.parse(input);
    return this.run(
      chat,
      ['sh', '-c', parsed.command],
      parsed.workdir,
      parsed.timeoutMs,
      signal,
      undefined,
      onOutput,
      parsed.containerId,
    );
  }
  command(chat: string, argv: string[], signal?: AbortSignal, stdin?: string, id?: string) {
    return this.run(chat, argv, CONTAINER_WORKSPACE, undefined, signal, stdin, undefined, id);
  }
  private run(
    chat: string,
    argv: string[],
    workdir: string,
    timeoutMs?: number,
    signal?: AbortSignal,
    stdin?: string,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
    id?: string,
  ) {
    this.ctx.assertActive();
    this.access.assert(chat);
    if (!argv.length || argv.some((a) => typeof a !== 'string' || a.includes('\0')))
      throw Error('容器命令参数无效');
    if (!workdir || /[\0\r\n]/.test(workdir) || workdir.length > 1000) throw Error('容器路径无效');
    // Capture the binding before queueing; changing the default cannot redirect an existing job.
    const row = this.binding(chat, id),
      key = 'exec:' + edgeKey(chat, row.id);
    const operation = this.serial(key, async () => {
      await this.guard(chat, 'exec');
      signal?.throwIfAborted();
      this.binding(chat, row.id);
      if (this.resource(row.id).enabled === false) throw Error('管理员已停用此容器');
      const controller = new AbortController(),
        task = randomUUID();
      const combined = AbortSignal.any([
        this.ctx.signal,
        controller.signal,
        ...(signal ? [signal] : []),
        AbortSignal.timeout(timeoutMs ?? this.value.timeoutMs),
      ]);
      this.active.set(task, { chat, id: row.id, controller });
      let provisioned = false;
      try {
        await this.startRaw(row, combined);
        const account = await this.account(row, combined);
        provisioned = true;
        const relative =
          workdir === CONTAINER_WORKSPACE
            ? '.'
            : workdir.startsWith(CONTAINER_WORKSPACE + '/')
              ? workdir.slice(CONTAINER_WORKSPACE.length + 1)
              : workdir;
        const cwd = path.posix.resolve(account.workspace, relative);
        const result = await this.call(
          row.binary,
          ['container', 'exec', '-i', '--user', '0', '--workdir', '/', row.id, 'python3', '-c', TASK_SCRIPT],
          combined,
          JSON.stringify({
            owner: this.owner,
            id: task,
            username: account.username,
            uid: account.uid,
            gid: account.gid,
            argv,
            workdir: cwd,
            stdin,
            timeoutMs: timeoutMs ?? this.value.timeoutMs,
          }),
          onOutput,
        );
        this.ctx.points.observe('container.after', {
          chatKey: chat,
          operation: 'exec',
          exitCode: result.exitCode,
        });
        return result;
      } finally {
        if (combined.aborted && provisioned) {
          try {
            this.ok(
              await this.call(
                row.binary,
                [
                  'container',
                  'exec',
                  '-i',
                  '--user',
                  '0',
                  '--workdir',
                  '/',
                  row.id,
                  'python3',
                  '-c',
                  CANCEL_SCRIPT,
                ],
                AbortSignal.timeout(6000),
                JSON.stringify({ owner: this.owner, id: task, username: row.username }),
                undefined,
                true,
              ),
            );
          } catch (error) {
            const resource = this.resource(row.id);
            resource.enabled = false;
            resource.cleanupPending = [
              ...(resource.cleanupPending ?? []),
              { id: task, username: row.username },
            ];
            // Keep quarantine across restart even if the runtime plugin is currently disposing.
            this.storage.setState('container-runtime', 'pool-v2', {
              version: 2,
              resources: [...this.resources.values()],
              bindings: this.bindings(),
            });
            this.ctx.log(`任务取消清理失败，已停用资源 ${row.name}：${String(error)}`);
          }
        }
        this.active.delete(task);
      }
    });
    this.pending.set(operation, { chat, id: row.id });
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  async dispose() {
    this.disposed = true;
    for (const item of this.active.values()) item.controller.abort(Error('容器插件已停用'));
    await Promise.allSettled([...this.pending.keys()]);
    await Promise.allSettled([...this.tails.values()]);
    // Containers are pool resources. Plugin unload only terminates its tasks, never shared resources.
  }
}
