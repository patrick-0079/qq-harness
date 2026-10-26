import type { Disposer, HookMeta, HookResult, PointBus, PointDefinition } from '@qq-harness/plugin-sdk';

type Handler = (input: unknown, meta: HookMeta) => unknown | Promise<unknown>;
interface Listener {
  owner: string;
  handler: Handler;
  order: number;
  seq: number;
  active: () => boolean;
}
export class ExtensionPoints implements PointBus {
  private definitions = new Map<string, PointDefinition>();
  private listeners = new Map<string, Listener[]>();
  private seq = 0;
  constructor(private report: (message: string) => void) {}
  define<T>(def: PointDefinition<T>): Disposer {
    if (this.definitions.has(def.id)) throw new Error(`重复扩展点：${def.id}`);
    this.definitions.set(def.id, def as PointDefinition);
    return () => {
      if (this.definitions.get(def.id) === def) this.definitions.delete(def.id);
    };
  }
  on<T>(
    id: string,
    owner: string,
    handler: (value: T, meta: HookMeta) => HookResult<T> | Promise<HookResult<T>>,
    order: number,
    active: () => boolean,
  ): Disposer {
    if (!this.definitions.has(id)) throw new Error(`扩展点尚未定义：${id}`);
    const entry: Listener = { owner, handler: handler as Handler, order, seq: ++this.seq, active };
    this.listeners.set(id, [...(this.listeners.get(id) ?? []), entry]);
    return () => {
      this.listeners.set(
        id,
        (this.listeners.get(id) ?? []).filter((item) => item !== entry),
      );
    };
  }
  private async execute(
    id: string,
    value: unknown,
    kind: 'guard' | 'transform',
    signal?: AbortSignal,
  ): Promise<unknown> {
    const def = this.definitions.get(id);
    if (!def || def.kind !== kind) throw new Error(`扩展点不可用：${id}`);
    let current = def.schema.parse(structuredClone(value));
    const entries = (this.listeners.get(id) ?? [])
      .filter((x) => x.active())
      .sort((a, b) => a.order - b.order || a.seq - b.seq);
    if (kind === 'guard' && def.requiredGuard && !entries.length) throw new Error(`必需守卫缺失：${id}`);
    const deadline = performance.now() + (def.budgetMs ?? 5000);
    for (const item of entries) {
      signal?.throwIfAborted();
      const ms = Math.min(def.timeoutMs ?? 1000, deadline - performance.now());
      if (ms <= 0) {
        if (kind === 'guard') throw new Error(`守卫预算耗尽：${id}`);
        this.report(`扩展点预算耗尽：${id}`);
        break;
      }
      const abort = new AbortController();
      const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() =>
            item.handler(structuredClone(current), { owner: item.owner, signal: combined }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              abort.abort();
              reject(new Error(`扩展点超时：${id}`));
            }, ms);
          }),
          new Promise<never>((_, reject) => {
            combined.addEventListener('abort', () => reject(combined.reason ?? new Error('已取消')), {
              once: true,
            });
          }),
        ]);
        combined.throwIfAborted();
        if (!item.active() || this.definitions.get(id) !== def) throw new Error(`扩展点已撤销：${id}`);
        if (kind === 'guard') {
          if (
            result === false ||
            (result && typeof result === 'object' && 'allow' in result && result.allow === false)
          ) {
            throw new Error(
              result && typeof result === 'object' && 'reason' in result
                ? String(result.reason)
                : `守卫拒绝：${id}`,
            );
          }
        } else if (result !== undefined) current = def.schema.parse(result);
      } catch (error) {
        if (kind === 'guard' || signal?.aborted) throw error;
        this.report(`${id}/${item.owner}：${error instanceof Error ? error.message : error}`);
      } finally {
        if (timer) clearTimeout(timer);
        abort.abort();
      }
    }
    return current;
  }
  async transform<T>(id: string, input: T, signal?: AbortSignal): Promise<T> {
    return (await this.execute(id, input, 'transform', signal)) as T;
  }
  async guard<T>(id: string, input: T, signal?: AbortSignal): Promise<void> {
    await this.execute(id, input, 'guard', signal);
  }
  observe<T>(id: string, input: T): void {
    const def = this.definitions.get(id);
    if (!def || def.kind !== 'observe') return;
    const value = def.schema.parse(structuredClone(input));
    for (const item of this.listeners.get(id) ?? []) {
      if (!item.active()) continue;
      // 观察者拿到独立副本，不能通过延迟修改影响已经提交的业务状态。
      const signal = AbortSignal.timeout(def.timeoutMs ?? 1000);
      Promise.resolve()
        .then(() => item.handler(structuredClone(value), { owner: item.owner, signal }))
        .catch((error) => this.report(`${id}/${item.owner}：${String(error)}`));
    }
  }
}
