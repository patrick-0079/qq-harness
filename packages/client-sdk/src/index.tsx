import * as React from 'react';
import {
  createContext,
  useContext,
  useSyncExternalStore,
  Component,
  Suspense,
  type ComponentType,
  type ReactNode,
} from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { PluginDto } from '@qq-harness/contracts';

export interface SlotProps {
  context: Record<string, unknown>;
}
export interface PageContribution {
  id: string;
  path: string;
  title: string;
  icon?: string;
  order?: number;
  component: ComponentType;
}
export interface SlotContribution {
  id: string;
  title?: string;
  order?: number;
  component: ComponentType<SlotProps>;
}
type Cleanup = () => void | Promise<void>;
export interface ClientContext {
  id: string;
  signal: AbortSignal;
  react: typeof React;
  api: ApiClient;
  queries: QueryClient;
  page(value: PageContribution): void;
  defineSlot(id: string): void;
  slot(point: string, value: SlotContribution): void;
  effect(cleanup: Cleanup): void;
}
export interface ClientPlugin {
  id: string;
  requires?: string[];
  setup(context: ClientContext): void | Promise<void>;
}
export const defineClientPlugin = (value: ClientPlugin) => value;
export class ApiClient {
  private sessionToken = '';
  private sessionAt = 0;
  constructor(
    private token: () => string = () => sessionStorage.getItem('harness-token') ?? '',
    private signal?: AbortSignal,
  ) {}
  scoped(signal: AbortSignal) {
    return new ApiClient(this.token, signal);
  }
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.token();
    if (token && (this.sessionToken !== token || Date.now() - this.sessionAt > 3600000)) {
      const session = await fetch('/api/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: this.signal ?? options.signal,
      });
      if (!session.ok) throw new Error('管理令牌无效');
      this.sessionToken = token;
      this.sessionAt = Date.now();
    }
    const response = await fetch(path, {
      ...options,
      signal: this.signal
        ? AbortSignal.any([this.signal, ...(options.signal ? [options.signal] : [])])
        : options.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
        ...options.headers,
      },
    });
    const data: unknown = await response.json();
    if (!response.ok)
      throw new Error((data as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
    return data as T;
  }
  async events(onEvent: (type: string) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch('/api/events', {
          signal,
          headers: this.token() ? { Authorization: `Bearer ${this.token()}` } : {},
        });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        // 重连时拉完整快照，避免依赖事件回放范围。
        onEvent('hello');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
          let index: number;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const type = /^event:\s*(.+)$/m.exec(event)?.[1];
            if (type && type !== 'heartbeat') onEvent(type);
          }
          if (buffer.length > 2 * 1024 * 1024) throw new Error('SSE 消息过大');
        }
      } catch {
        if (signal.aborted) return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}
interface Owned<T> {
  owner: string;
  value: T;
}
interface ActiveClient {
  plugin: ClientPlugin;
  abort: AbortController;
  cleanup: Cleanup[];
  signature: string;
}
export class ClientHost {
  readonly api: ApiClient;
  readonly queries: QueryClient;
  private pages = new Map<string, Owned<PageContribution>>();
  private slots = new Map<string, string>();
  private contributions = new Map<string, Owned<SlotContribution> & { point: string }>();
  private active = new Map<string, ActiveClient>();
  private listeners = new Set<() => void>();
  private version = 0;
  private batching = false;
  private operations: Promise<void> = Promise.resolve();
  readonly errors = new Map<string, string>();
  constructor(
    private load: (plugin: PluginDto) => Promise<ClientPlugin>,
    api = new ApiClient(),
    queries = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  ) {
    this.api = api;
    this.queries = queries;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.version;
  private changed() {
    this.version++;
    if (!this.batching) for (const listener of this.listeners) listener();
  }
  listPages() {
    return [...this.pages.values()]
      .sort((a, b) => (a.value.order ?? 50) - (b.value.order ?? 50))
      .map((item) => item);
  }
  listSlot(point: string) {
    return [...this.contributions.values()]
      .filter((item) => item.point === point)
      .sort((a, b) => (a.value.order ?? 50) - (b.value.order ?? 50));
  }
  sync(plugins: PluginDto[]): Promise<void> {
    const operation = this.operations.then(async () => {
      this.batching = true;
      const desired = new Map(
        plugins
          .filter((plugin) => plugin.enabled && plugin.status === 'active' && plugin.client)
          .map((plugin) => [plugin.id, plugin]),
      );
      for (const [id, entry] of [...this.active].reverse()) {
        const descriptor = desired.get(id);
        if (
          !descriptor ||
          entry.signature !== `${descriptor.version}/${descriptor.generation}/${descriptor.client?.entry}` ||
          entry.plugin.requires?.some((requirement) => !desired.has(requirement))
        )
          await this.unload(id);
      }
      const pending = [...desired.values()].filter((plugin) => !this.active.has(plugin.id));
      for (let pass = 0; pending.length && pass <= desired.size; pass++) {
        for (let index = pending.length - 1; index >= 0; index--) {
          const descriptor = pending[index]!;
          try {
            const plugin = await this.load(descriptor);
            if (plugin.id !== descriptor.id) throw new Error('客户端插件 ID 与清单不一致');
            if (plugin.requires?.some((requirement) => !this.active.has(requirement))) continue;
            pending.splice(index, 1);
            await this.activate(
              plugin,
              `${descriptor.version}/${descriptor.generation}/${descriptor.client?.entry}`,
              descriptor.client?.css,
            );
            this.errors.delete(plugin.id);
          } catch (error) {
            this.errors.set(descriptor.id, error instanceof Error ? error.message : String(error));
            const failedIndex = pending.findIndex((item) => item.id === descriptor.id);
            if (failedIndex >= 0) pending.splice(failedIndex, 1);
          }
        }
      }
      for (const plugin of pending) this.errors.set(plugin.id, '客户端依赖未就绪');
      this.batching = false;
      this.changed();
    });
    const complete = operation.finally(() => {
      this.batching = false;
      this.changed();
    });
    this.operations = complete.catch(() => {});
    return complete;
  }
  private async activate(plugin: ClientPlugin, signature: string, css: string[] = []) {
    const entry: ActiveClient = { plugin, abort: new AbortController(), cleanup: [], signature };
    this.active.set(plugin.id, entry);
    const assert = () => {
      entry.abort.signal.throwIfAborted();
    };
    const own = <T,>(map: Map<string, Owned<T>>, id: string, value: T) => {
      assert();
      if (map.has(id)) throw new Error(`重复贡献：${id}`);
      const record = { owner: plugin.id, value };
      map.set(id, record);
      entry.cleanup.push(() => {
        if (map.get(id) === record) map.delete(id);
      });
      this.changed();
    };
    const context: ClientContext = {
      id: plugin.id,
      signal: entry.abort.signal,
      react: React,
      api: this.api.scoped(entry.abort.signal),
      queries: this.queries,
      effect: (cleanup) => {
        assert();
        entry.cleanup.push(cleanup);
      },
      page: (page) => own(this.pages, page.path, page),
      defineSlot: (id) => {
        assert();
        if (this.slots.has(id)) throw new Error(`重复插槽：${id}`);
        this.slots.set(id, plugin.id);
        entry.cleanup.push(() => {
          if (this.slots.get(id) === plugin.id) this.slots.delete(id);
        });
      },
      slot: (point, value) => {
        assert();
        if (!point.startsWith('shell.') && !this.slots.has(point)) throw new Error(`插槽未定义：${point}`);
        const key = `${point}/${plugin.id}/${value.id}`;
        if (this.contributions.has(key)) throw new Error(`重复插槽贡献：${key}`);
        const record = { owner: plugin.id, value, point };
        this.contributions.set(key, record);
        entry.cleanup.push(() => {
          if (this.contributions.get(key) === record) this.contributions.delete(key);
        });
        this.changed();
      },
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      for (const href of css) {
        if (!href.startsWith('/api/plugin-assets/')) throw new Error('插件样式路径不受信任');
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.plugin = plugin.id;
        document.head.appendChild(link);
        entry.cleanup.push(() => link.remove());
      }
      await Promise.race([
        plugin.setup(context),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('客户端插件初始化超时')), 5000);
        }),
      ]);
    } catch (error) {
      await this.unload(plugin.id);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async unload(id: string) {
    const entry = this.active.get(id);
    if (!entry) return;
    entry.abort.abort();
    this.active.delete(id);
    for (const cleanup of entry.cleanup.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        this.errors.set(id, `清理失败：${String(error)}`);
      }
    }
    await this.queries.cancelQueries({ predicate: (query) => query.queryKey.includes(id) });
    this.queries.removeQueries({ predicate: (query) => query.queryKey.includes(id) });
    this.changed();
  }
  async stop() {
    await this.operations;
    for (const id of [...this.active.keys()].reverse()) await this.unload(id);
  }
}
const HostContext = createContext<ClientHost | null>(null);
export const ClientHostProvider = HostContext.Provider;
export function useHost() {
  const host = useContext(HostContext);
  if (!host) throw new Error('客户端插件宿主未挂载');
  return host;
}
export function useHostVersion() {
  const host = useHost();
  return useSyncExternalStore(host.subscribe, host.snapshot, host.snapshot);
}
export class PluginBoundary extends Component<{ children: ReactNode; name: string }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="error" role="alert">
        {this.props.name}：{this.state.error}
      </div>
    ) : (
      this.props.children
    );
  }
}
export function Slot({ point, context = {} }: { point: string; context?: Record<string, unknown> }) {
  const host = useHost();
  useHostVersion();
  return (
    <>
      {host.listSlot(point).map(({ owner, value }) => (
        <PluginBoundary key={`${owner}/${value.id}`} name={owner}>
          <Suspense fallback={<span>加载中…</span>}>
            <value.component context={context} />
          </Suspense>
        </PluginBoundary>
      ))}
    </>
  );
}
