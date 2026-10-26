import { Context, type ForkScope } from 'cordis';
import type {
  Disposer,
  HostControl,
  HostEvent,
  PluginContext,
  PluginDefinition,
  PluginInfo,
  ServiceToken,
} from '@qq-harness/plugin-sdk';
import { ExtensionPoints } from './points.js';
import { Runs } from './runs.js';

interface Installed {
  definition: PluginDefinition;
  info: PluginInfo;
  scope?: ForkScope;
  controller?: AbortController;
}
export class Runtime implements HostControl {
  readonly cordis = new Context();
  readonly points: ExtensionPoints;
  private plugins = new Map<string, Installed>();
  private listeners = new Set<(event: HostEvent) => void>();
  private disposals = new Set<Promise<unknown>>();
  private sequence = 0;
  private _revision = 0;
  private changes: Promise<void> = Promise.resolve();
  private runs: Runs;
  private setupTimeoutMs: number;
  constructor(
    options: { concurrency?: number; setupTimeoutMs?: number; log?: (message: string) => void } = {},
  ) {
    this.setupTimeoutMs = options.setupTimeoutMs ?? 10000;
    this.points = new ExtensionPoints((message) => this.publish('log', { message }));
    this.runs = new Runs(
      (type, payload) => this.publish(type, payload),
      () => this.revision,
      options.concurrency,
    );
    this.cordis.on('internal/error', (error) => options.log?.(String(error)));
  }
  get revision(): number {
    return this._revision;
  }
  publish(type: string, payload: unknown): void {
    const event: HostEvent = { id: ++this.sequence, type, revision: this.revision, payload };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        /* 单个观察者不能中断生命周期提交。 */
      }
    }
  }
  subscribe(fn: (event: HostEvent) => void): Disposer {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private changed(): void {
    this._revision++;
    this.publish('plugins.changed', this.listPlugins());
  }
  install(definition: PluginDefinition, enabled = true): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(definition.id) || this.plugins.has(definition.id))
      throw new Error(`非法或重复插件 id：${definition.id}`);
    const item: Installed = {
      definition,
      info: {
        id: definition.id,
        name: definition.name ?? definition.id,
        version: definition.version ?? '1.0.0',
        enabled,
        requires: definition.requires ?? [],
        status: enabled ? 'waiting' : 'disabled',
        generation: 0,
        client: definition.client,
      },
    };
    this.plugins.set(definition.id, item);
    if (enabled) this.attach(item);
    this.changed();
  }
  private attach(item: Installed): void {
    item.scope = this.cordis.plugin({
      name: item.info.id,
      inject: item.info.requires,
      apply: async (cordis) => {
        const generation = ++item.info.generation;
        const controller = new AbortController();
        item.controller = controller;
        const effects: Disposer[] = [];
        item.info.status = 'loading';
        item.info.error = undefined;
        this.changed();
        const active = () =>
          !controller.signal.aborted && item.info.enabled && item.info.generation === generation;
        // 一次激活对应一组资源，逆序撤销。Cordis 负责依赖撤销与重新激活。
        cordis.effect(() => () => {
          controller.abort(new Error(`插件 ${item.info.id} 已停用`));
          const cleanup = effects.reverse().map((dispose) => {
            try {
              return Promise.resolve(dispose());
            } catch (error) {
              this.publish('log', { message: String(error), owner: item.info.id });
              return Promise.resolve();
            }
          });
          const disposal = Promise.allSettled(cleanup);
          this.disposals.add(disposal);
          void disposal.finally(() => this.disposals.delete(disposal));
          if (item.info.generation === generation && item.info.status !== 'failed')
            item.info.status = item.info.enabled ? 'waiting' : 'disabled';
          this.changed();
        });
        const ctx: PluginContext = {
          id: item.info.id,
          generation,
          signal: controller.signal,
          host: this,
          points: this.points,
          assertActive: () => {
            if (!active()) throw new Error(`插件 ${item.info.id} 已停用`);
          },
          use: <T>(token: ServiceToken<T>): T => {
            ctx.assertActive();
            const value: unknown = cordis.get(token.id);
            if (value === undefined) throw new Error(`服务不可用：${token.id}`);
            return value as T;
          },
          provide: <T>(token: ServiceToken<T>, value: T) => {
            ctx.assertActive();
            cordis.set(token.id, value);
          },
          effect: (dispose) => {
            ctx.assertActive();
            effects.push(dispose);
          },
          definePoint: (def) => {
            ctx.assertActive();
            effects.push(this.points.define(def));
          },
          on: (point, handler, order = 50) => {
            ctx.assertActive();
            effects.push(this.points.on(point, ctx.id, handler, order, active));
          },
          mode: (definition) => {
            ctx.assertActive();
            effects.push(this.runs.register(ctx.id, definition, active));
          },
          log: (message) => this.publish('log', { owner: ctx.id, message }),
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            item.definition.setup(ctx),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('插件初始化超时')), this.setupTimeoutMs);
            }),
          ]);
          ctx.assertActive();
          item.info.status = 'active';
          this.changed();
        } catch (error) {
          if (controller.signal.aborted) return;
          item.info.status = 'failed';
          item.info.error = error instanceof Error ? error.message : String(error);
          cordis.scope.cancel(error);
          this.changed();
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    });
  }
  async start(): Promise<void> {
    await this.cordis.start();
    await this.settled();
  }
  async settled(): Promise<void> {
    await this.cordis.events.flush();
    while (this.disposals.size) await Promise.all([...this.disposals]);
  }
  setEnabled(id: string, enabled: boolean): Promise<void> {
    const change = this.changes.then(async () => {
      const item = this.plugins.get(id);
      if (!item) throw new Error(`插件不存在：${id}`);
      if (item.info.enabled === enabled) return;
      item.info.enabled = enabled;
      if (enabled) {
        item.info.status = 'waiting';
        this.attach(item);
      } else {
        item.scope?.dispose();
        item.scope = undefined;
        item.info.status = 'disabled';
      }
      this.changed();
      await this.settled();
    });
    this.changes = change.catch(() => {});
    return change;
  }
  listPlugins(): PluginInfo[] {
    return [...this.plugins.values()].map((item) => structuredClone(item.info));
  }
  use<T>(token: ServiceToken<T>): T {
    const value: unknown = this.cordis.get(token.id);
    if (value === undefined) throw new Error(`服务不可用：${token.id}`);
    return value as T;
  }
  submit: HostControl['submit'] = (request) => this.runs.submit(request);
  listRuns: HostControl['listRuns'] = () => this.runs.list();
  cancel: HostControl['cancel'] = (id) => this.runs.cancel(id);
  wait: HostControl['wait'] = (id) => this.runs.wait(id);
  async stop(): Promise<void> {
    await this.runs.stop();
    await this.cordis.stop();
    await this.settled();
    this.listeners.clear();
  }
}
