export type Disposer = () => void | Promise<void>;
export interface Schema<T> {
  parse(value: unknown): T;
}
export interface ServiceToken<T> {
  readonly id: string;
  readonly __type?: T;
}
export const service = <T>(id: string): ServiceToken<T> => ({ id });
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  status: 'disabled' | 'waiting' | 'loading' | 'active' | 'failed';
  requires: string[];
  error?: string;
  generation: number;
  client?: { entry: string; css?: string[] };
}
export interface RunRequest<T = unknown> {
  mode: string;
  partitionKey: string;
  input: T;
  timeoutMs?: number;
  maxWaitMs?: number;
}
export interface RunRecord {
  id: string;
  owner?: string;
  parentId?: string;
  mode: string;
  partitionKey: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
}
export interface RunContext {
  id: string;
  signal: AbortSignal;
  deadline: number;
  revision: number;
  assertActive(): void;
}
export interface ModeDefinition<T = unknown> {
  id: string;
  /** A separate bounded lane for short management work, independent of workload slots. */
  lane?: 'control';
  /** 短暂副作用操作可借用父运行的执行槽；它仍有独立的取消、期限和记录。 */
  operation?: boolean;
  input: Schema<T>;
  partitionKey?(input: T): string;
  execute(run: RunContext, input: T): Promise<unknown>;
}
export type PointKind = 'observe' | 'transform' | 'guard';
export interface PointDefinition<T = unknown> {
  id: string;
  kind: PointKind;
  schema: Schema<T>;
  timeoutMs?: number;
  budgetMs?: number;
  requiredGuard?: boolean;
}
export interface HookMeta {
  signal: AbortSignal;
  owner: string;
}
export type HookResult<T> = void | T | boolean | { allow: boolean; reason?: string };
export interface PointBus {
  transform<T>(id: string, input: T, signal?: AbortSignal): Promise<T>;
  guard<T>(id: string, input: T, signal?: AbortSignal): Promise<void>;
  observe<T>(id: string, input: T): void;
}
export interface HostEvent {
  id: number;
  type: string;
  revision: number;
  payload: unknown;
}
export interface HostControl {
  install(definition: PluginDefinition, enabled?: boolean): void;
  listPlugins(): PluginInfo[];
  setEnabled(id: string, enabled: boolean): Promise<void>;
  listRuns(): RunRecord[];
  submit<T>(request: RunRequest<T>): RunRecord;
  operation<T>(parent: RunContext, request: RunRequest<T>): Promise<RunRecord>;
  cancel(id: string): boolean;
  wait(id: string): Promise<RunRecord>;
  subscribe(fn: (event: HostEvent) => void): Disposer;
  publish(type: string, payload: unknown): void;
  readonly revision: number;
}
export interface PluginContext {
  readonly id: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly host: HostControl;
  readonly points: PointBus;
  use<T>(token: ServiceToken<T>): T;
  provide<T>(token: ServiceToken<T>, value: T): void;
  effect(dispose: Disposer): void;
  definePoint<T>(definition: PointDefinition<T>): void;
  on<T>(
    point: string,
    handler: (input: T, meta: HookMeta) => HookResult<T> | Promise<HookResult<T>>,
    order?: number,
  ): void;
  mode<T>(definition: ModeDefinition<T>): void;
  guardRuns(guard: (owner: string, mode: string) => void): void;
  assertActive(): void;
  log(message: string): void;
}
export interface PluginDefinition {
  id: string;
  name?: string;
  version?: string;
  requires?: string[];
  client?: { entry: string; css?: string[] };
  setup(context: PluginContext): void | Promise<void>;
}
export const definePlugin = (plugin: PluginDefinition): PluginDefinition => plugin;
