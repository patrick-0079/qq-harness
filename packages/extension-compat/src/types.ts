import type { ModelMessage } from '@qq-harness/domain';

// 原 JS 导出的唯一动态边界；不传播到内核和客户端 SDK。
export type LegacyObject = Record<string, any>;
export interface ExtensionEnvironment {
  root: string;
  dataDir: string;
  builtinRoot: string;
  url(relative: string): string;
  importModule(file: string): Promise<LegacyObject>;
  view(chatKey?: string): LegacyObject;
  global(): LegacyObject;
  update(patch: LegacyObject): LegacyObject;
  personas(): LegacyObject[];
  scope<T>(chatKey: string, fn: () => T): T;
  complete(messages: ModelMessage[], options?: LegacyObject): Promise<unknown>;
  legacyFetch(url: string, options?: RequestInit): Promise<Response>;
  childSettings(id: string, defaults: LegacyObject): LegacyObject;
  shouldActivate(id: string): boolean;
  schedule(fn: () => Promise<unknown>): void;
  retainedIds(): string[];
  isManaged(id: string): boolean;
}
export interface LegacyRuntime {
  createExtensionApi(...args: any[]): LegacyObject;
  skillManager: LegacyObject;
  extensionRegistry: LegacyObject;
  extensionHookBus: LegacyObject;
  docRegistry: LegacyObject;
  uiExtensionRegistry: LegacyObject;
  tools: LegacyObject;
  tabs: LegacyObject;
  variables: LegacyObject;
  prompt: LegacyObject;
  types: LegacyObject;
  settings: LegacyObject;
  catalog: LegacyObject;
  importer: LegacyObject;
  sandbox: LegacyObject;
  fetch: LegacyObject;
  manifests: LegacyObject;
  dependencies: LegacyObject;
  knowledge: LegacyObject;
  validation: LegacyObject;
  stale: LegacyObject;
  summaries: LegacyObject;
  injection: LegacyObject;
  zip: LegacyObject;
  onToolsChanged(fn: () => void): () => void;
  builtinModules: Record<string, LegacyObject>;
  loadPlugins(options: LegacyObject): Promise<LegacyObject>;
  watchPlugins(options: LegacyObject): { close(): void };
}
export interface ExtensionDescriptor {
  description?: string;
  id: string;
  type: string;
  name: string;
  scope: string;
  version: string;
  enabled: boolean;
  active: boolean;
  reason: string;
  settings: Record<string, unknown>;
  settingsSchema: LegacyObject;
  details: Record<string, unknown>;
  managerId?: string;
}
export interface ExtensionHostOptions {
  root: string;
  dataDir: string;
  initialConfig?: LegacyObject;
  hotReload?: boolean;
  managers?: string[];
  /** Dependency injection for offline package verification; never read from UI config. */
  fetch?: (url: string, options?: RequestInit) => Promise<Response>;
}
