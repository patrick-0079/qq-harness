import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import type {
  ConfigService,
  StorageService,
  ToolService,
  OutboundService,
  AdapterService,
  ModelService,
  ToolContext,
  MessageSegment,
  OutboundPayload,
} from '@qq-harness/domain';
import {
  deepMerge,
  stripSessionSecrets,
  publicFetch,
  publicAddress,
  browseGuard,
  firstGifFrame,
} from '@qq-harness/files';
import * as promptBridge from './prompt-bridge.js';
import {
  memoryService,
  memoryAgentService,
  memberMemoryService,
  replySegments,
  stickerService,
  mediaService,
  webService,
  type HttpProxySettings,
} from '@qq-harness/domain';
import { htmlRendererService } from '@qq-harness/domain';
import { electronBridge } from './electron-bridge.js';
import sharp from 'sharp';
import { normalizeLegacyInstructions } from './instructions.js';
import { legacyArchive, todayAccounting } from './archive-bridge.js';
import { traceService, accessService } from '@qq-harness/domain';
import { conversationService } from '@qq-harness/domain';
import { systemControlService } from '@qq-harness/domain';
import { extensionOperations } from './operations.js';
import { onebotBridge } from './onebot-bridge.js';
import { senderBridge } from './sender-bridge.js';
import { stickerPolicyBridge } from './sticker-bridge.js';
import { nativeMemoryStore } from './memory-store-bridge.js';
import { createLegacyRuntime } from '../generated/runtime.mjs';
import type {
  ExtensionEnvironment,
  ExtensionHostOptions,
  LegacyObject,
  LegacyRuntime,
  ExtensionDescriptor,
} from './types.js';
import type { ExtensionService } from './service.js';
import { extensionFetch } from './fetch.js';
import { capsuleEnvironment } from './capsule.js';
import { createCoreUtilities } from '@qq-harness/legacy-core';

export const EXTENSION_DIRS = [
  'plugins',
  'chat-plugins',
  'tools',
  'mcp',
  'skills',
  'knowledge',
  'promptinjects',
] as const;
let packageRoot = path.dirname(fileURLToPath(import.meta.url));
while (
  !fs.existsSync(path.join(packageRoot, 'package.json')) ||
  JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).name !== 'qq-harness'
) {
  const parent = path.dirname(packageRoot);
  if (parent === packageRoot) throw new Error('找不到扩展框架安装目录');
  packageRoot = parent;
}
const MODULE_ROOT = path.join(packageRoot, 'packages/extension-compat/vendor');
const SECRET = /api.?key|access.?token|^token$|secret|password|cookie/i;
export function redact(value: unknown): any {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET.test(key) && typeof entry === 'string' ? (entry ? '******' : '') : redact(entry),
    ]),
  );
}
export class ExtensionHost implements ExtensionService {
  readonly legacy: LegacyRuntime;
  private config: LegacyObject;
  private profiles: Record<string, LegacyObject>;
  private scope = new AsyncLocalStorage<{
    chatKey: string;
    tool?: ToolContext;
    owner?: string;
    ownerSignal?: AbortSignal;
  }>();
  private queue: Promise<void> = Promise.resolve();
  private watcher?: { close(): void };
  private nativeTools = new Map<
    string,
    {
      signature: string;
      context: PluginContext;
      cleanups: (() => void | Promise<void>)[];
    }
  >();
  private instance = randomUUID();
  private importSequence = 0;
  private stopped = false;
  private sessions = new Map<string, LegacyObject>();
  private logs: string[] = [];
  private scheduled = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Set<Promise<unknown>>();
  private managerCatalog = new Map<string, LegacyObject>();
  private managers = new Map<string, { owner: PluginContext; skill: LegacyObject }>();
  private capsuleResources = new Set<{ dispose(): void | Promise<void> }>();
  private lifecycle = new Set<Promise<unknown>>();
  private loading = false;
  private scriptJobs = new Map<AbortController, { id: string; chatKey: string }>();
  private committedTools = new Map<string, LegacyObject>();
  private configRead?: {
    native: ReturnType<ConfigService['get']>;
    global?: LegacyObject;
    views: Map<string, LegacyObject>;
  };
  private operations: ReturnType<typeof extensionOperations>;
  private fetch = (url: string, options: RequestInit = {}) => {
    const request = {
      ...options,
      signal: AbortSignal.any([this.ctx.signal, options.signal ?? this.ctx.signal]),
    };
    return this.options.fetch
      ? this.options.fetch(url, request)
      : extensionFetch(url, request, (input) => this.legacy.fetch.validateFetchUrl(input), this.proxy());
  };
  constructor(
    private ctx: PluginContext,
    readonly options: ExtensionHostOptions,
    private services: {
      config: ConfigService;
      storage: StorageService;
      tools: ToolService;
      outbound: OutboundService;
      adapter: AdapterService;
      model: ModelService;
    },
  ) {
    if (!path.isAbsolute(options.root) || !path.isAbsolute(options.dataDir))
      throw new Error('扩展根与数据目录必须使用绝对路径');
    fs.mkdirSync(options.root, { recursive: true });
    for (const dir of EXTENSION_DIRS) fs.mkdirSync(path.join(options.root, dir), { recursive: true });
    fs.mkdirSync(options.dataDir, { recursive: true });
    for (const id of options.managers ?? []) {
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('管理器 id 非法');
      const manifest = JSON.parse(
        fs.readFileSync(path.join(MODULE_ROOT, 'plugins', id, 'plugin.json'), 'utf8'),
      );
      this.managerCatalog.set(id, manifest);
    }
    this.config = deepMerge(
      {
        skills: {},
        extensions: { defaults: {}, hotReload: options.hotReload ?? true },
        tools: { enabled: true },
        api: { vision: true },
      },
      services.storage.state('extension-system', 'config') ?? options.initialConfig ?? {},
    ) as LegacyObject;
    this.profiles =
      (services.storage.state('extension-system', 'profiles') as Record<string, LegacyObject>) ?? {};
    const environment: ExtensionEnvironment = {
      root: options.root,
      dataDir: options.dataDir,
      builtinRoot: path.join(MODULE_ROOT, 'plugins'),
      url: (relative) => pathToFileURL(path.join(options.root, relative)).href,
      global: () => this.global(),
      view: (key) => this.view(key),
      update: (patch) => this.update(patch),
      scope: (key, fn) => this.inScope(key, fn),
      personas: () => [
        {
          id: 'default',
          name: '默认人设',
          text: services.config.get().defaults.persona,
        },
      ],
      importModule: async (file) => {
        const relative = path.relative(path.join(MODULE_ROOT, 'plugins'), file);
        if (!relative.startsWith('..') && !path.isAbsolute(relative))
          return this.legacy.builtinModules[path.basename(path.dirname(file))]!;
        const declarationFile = ['skill.json', 'plugin.json']
          .map((name) => path.join(path.dirname(file), name))
          .find((file) => fs.existsSync(file));
        const installed = declarationFile ? JSON.parse(fs.readFileSync(declarationFile, 'utf8')) : {};
        if (installed.harnessMigration?.stage === 'installed') {
          const enabled = (chatKey: string) => {
            const view = this.view(chatKey),
              id = installed.id;
            return (
              view.skills?.[id]?.enabled ??
              view.extensions?.overrides?.[id]?.enabled ??
              view.extensions?.defaults?.[id]?.enabled ??
              installed.enabledByDefault !== false
            );
          };
          if (
            !enabled('') &&
            ![
              ...new Set([
                ...Object.keys(this.profiles),
                ...Object.keys(this.services.config.get().profiles),
              ]),
            ].some(enabled)
          )
            return {
              setup() {},
              __harnessCleanup: async () => {},
              __harnessSignal: this.ctx.signal,
            };
        }
        if (path.basename(path.dirname(file)) === 'ops-ctrl') return { setup() {}, __harnessCleanup: async () => {}, __harnessSignal: this.ctx.signal };
        let module = (await import(
          pathToFileURL(file).href + `?harness=${this.instance}-${++this.importSequence}`
        )) as LegacyObject;
        if (module.harnessCapsuleVersion === 1 && typeof module.createHarnessModule === 'function') {
          const manifestFile = ['skill.json', 'plugin.json']
            .map((name) => path.join(path.dirname(file), name))
            .find((file) => fs.existsSync(file));
          const declaration = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
          if (declaration.harnessMigration?.stage === 'preview')
            throw new Error('这是未验收的迁移预览；完成行为验证后才能装入运行实例');
          const id = String(declaration.id ?? path.basename(path.dirname(file)));
          const modules = this.capsuleModules(id, path.dirname(file));
          const environment = capsuleEnvironment({
            root: path.dirname(file),
            dataDir: options.dataDir,
            modules,
            fetch: (url, init) => environmentFetch(url, init),
            log: this.log,
            ...(id === 'self-surf'
              ? {
                  runTimer: (fn: () => unknown) => {
                    const inherited = this.scope.getStore();
                    try {
                      inherited?.tool?.run.assertActive();
                      if (inherited?.tool) return fn();
                    } catch {
                      /* A later timer needs a fresh owned operation. */
                    }
                    const configured = this.inScope('', () =>
                      this.legacy.skillManager.settingsOf(id),
                    ).targetChat;
                    const chatKey = /^(?:group|private):\d+$/.test(configured ?? '')
                      ? configured
                      : /^\d+$/.test(configured ?? '')
                        ? 'private:' + configured
                        : '';
                    if (!chatKey) throw Error('自己上网的后台任务需要明确设置目标会话');
                    return this.operations.execute(
                      id,
                      environment.signal,
                      chatKey,
                      '自己上网后台任务',
                      (tool) => this.inScope(chatKey, async () => fn(), tool, id),
                    );
                  },
                }
              : {}),
          });
          // Public fetch remains DNS/redirect checked; an imported package gets no
          // ambient network permission or access to the old monolithic host.
          const environmentFetch = (url: string, init?: RequestInit) => this.fetch(url, init);
          let cleanupTask: Promise<void> | undefined;
          const cleanup = () =>
            (cleanupTask ??= (async () => {
              environment.dispose();
              try {
                await modules.$cleanup?.dispose?.();
              } finally {
                this.capsuleResources.delete(resource);
              }
            })());
          const resource = { dispose: cleanup };
          this.capsuleResources.add(resource);
          try {
            module = await module.createHarnessModule(environment);
            if (typeof module.activate === 'function') {
              const activate = module.activate;
              module = {
                ...module,
                activate: (value: LegacyObject = {}) => activate({ ...value, ...modules.$activation }),
              };
            }
            if (module.hooks)
              module = {
                ...module,
                hooks: Object.fromEntries(
                  Object.entries(module.hooks).map(([name, fn]) => [
                    name,
                    typeof fn !== 'function'
                      ? fn
                      : (...args: unknown[]) =>
                          this.inScope(
                            this.scope.getStore()?.chatKey ?? '',
                            () => {
                              modules.$lifecycle!.signal.throwIfAborted();
                              return fn(...args);
                            },
                            this.scope.getStore()?.tool,
                            id,
                          ),
                  ]),
                ),
              };
            const dispose = module.dispose;
            module = {
              ...module,
              __harnessCleanup: cleanup,
              __harnessSignal: modules.$lifecycle!.signal,
              __harnessIngress: modules.$ingress,
              __harnessProtocol: modules.$protocol,
              __harnessSender: modules.$sender,
              __harnessStickerPolicy: modules.$stickerPolicy,
              dispose: async (...args: unknown[]) => {
                try {
                  await dispose?.(...args);
                } finally {
                  await cleanup();
                }
              },
            };
          } catch (error) {
            await cleanup();
            throw error;
          }
        }
        for (const key of ['activate', 'deactivate', 'dispose'])
          if (typeof module[key] === 'function') {
            const fn = module[key];
            module = {
              ...module,
              [key]: (...args: unknown[]) => {
                const value = fn(...args);
                if (!value || typeof value.then !== 'function') return value;
                const task = Promise.resolve(value);
                this.lifecycle.add(task);
                void task.then(
                  () => this.lifecycle.delete(task),
                  (error) => {
                    this.lifecycle.delete(task);
                    this.log(error);
                  },
                );
                return task;
              },
            };
          }
        if (module.vars) {
          for (const name of ['plugin.json', 'skill.json', 'tool.json']) {
            const manifest = path.join(path.dirname(file), name);
            if (fs.existsSync(manifest)) {
              const id = JSON.parse(fs.readFileSync(manifest, 'utf8')).id;
              this.legacy.variables.registerVarConverters(id, module.vars);
              break;
            }
          }
        }
        return module;
      },
      complete: async (messages) => {
        const current = this.scope.getStore();
        const result = await services.model.complete(
          messages,
          [],
          current?.tool?.run.signal ?? ctx.signal,
          current?.chatKey ? { chatKey: current.chatKey, runId: current.tool?.run.id } : undefined,
        );
        return { content: result.message.content, usage: result.usage };
      },
      legacyFetch: async (url, request = {}) => {
        return this.fetch(url, request);
      },
      childSettings: (id: string, defaults: LegacyObject) => {
        const cfg = this.view();
        return (
          cfg.extensions?.overrides?.[id]?.settings ?? {
            ...defaults,
            ...cfg.extensions?.defaults?.[id]?.settings,
          }
        );
      },
      shouldActivate: (id) => this.shouldActivate(id),
      retainedIds: () => [...this.managers.keys()],
      isManaged: (id) => this.managerCatalog.has(id),
      schedule: (fn) => {
        if (this.stopped) return;
        const timer = setTimeout(() => {
          this.scheduled.delete(timer);
          if (this.stopped) return;
          const task = fn().catch((error) => this.log(error));
          this.pending.add(task);
          void task.finally(() => this.pending.delete(task));
        }, 0);
        this.scheduled.add(timer);
      },
    };
    this.legacy = createLegacyRuntime(environment);
    this.operations = extensionOperations(ctx, (id, chatKey) =>
      this.scoped(chatKey, () => this.legacy.skillManager.isActive(id, { chatKey }).active),
    );
    ctx.effect(this.legacy.onToolsChanged(() => this.syncTools()));
    // 描述符与旧工具可用性方法对 chatKey 参数形状曾不一致，在边界统一而不复制判定。
    const enabled = this.legacy.extensionRegistry.isSessionEnabled.bind(this.legacy.extensionRegistry);
    this.legacy.extensionRegistry.isSessionEnabled = (id: string, context: LegacyObject | string = {}) =>
      enabled(id, typeof context === 'string' ? { chatKey: context } : context);
    const register = this.legacy.extensionRegistry.register.bind(this.legacy.extensionRegistry);
    this.legacy.extensionRegistry.register = (descriptor: LegacyObject) => {
      const saved = this.config.extensions?.defaults?.[descriptor.id]?.settings;
      if (saved) descriptor.settings = { ...descriptor.settings, ...saved };
      return register(descriptor);
    };
    const changed = () => {
      if (!this.stopped) this.syncTools();
    };
    ctx.effect(
      ctx.host.subscribe((event) => {
        if (event.type === 'profile.created') {
          const chatKey = (event.payload as { chatKey: string }).chatKey;
          if (!this.profiles[chatKey]) {
            this.snapshotProfile(chatKey);
          }
        }
        if (event.type === 'profile.restored') {
          const { chatKey, section } = event.payload as {
            chatKey: string;
            section: string;
          };
          if (section === 'all' || section === 'tools') {
            delete this.profiles[chatKey];
            this.snapshotProfile(chatKey);
            this.syncTools();
          }
        }
        if (event.type === 'config.changed') {
          this.invalidateConfigRead();
          for (const [controller, job] of this.scriptJobs)
            if (!this.ctx.use(accessService).allowed(job.chatKey)) controller.abort();
          changed();
        }
      }),
    );
  }
  private log = (message: unknown) => {
    this.logs.push(String(message));
    if (this.logs.length > 100) this.logs.shift();
    this.ctx.host.publish('extensions.log', { message: String(message) });
  };
  private snapshotProfile(chatKey: string) {
    const profile: LegacyObject = { skills: {}, extensions: { overrides: {} } };
    for (const row of this.list(chatKey))
      if (row.scope !== 'global') {
        const settings = stripSessionSecrets(row.settings);
        profile.skills[row.id] = { ...settings, enabled: row.enabled };
        profile.extensions.overrides[row.id] = {
          enabled: row.enabled,
          settings,
        };
      }
    this.profiles[chatKey] = profile;
    this.invalidateConfigRead();
    this.services.storage.setState('extension-system', 'profiles', this.profiles);
  }
  private capsuleModules(id: string, packageDir: string): Record<string, LegacyObject> {
    // Each migrated package gets a separate facade class. Its old prototype patch
    // is invoked from a public ingress point and cannot remove another package's
    // wrapper during unload. No old Orchestrator implementation is loaded.
    const host = this;
    const lifetime = new AbortController();
    const signal = () =>
      AbortSignal.any([
        this.ctx.signal,
        lifetime.signal,
        this.scope.getStore()?.tool?.run.signal ?? this.ctx.signal,
      ]);
    const fetch = (url: string, init: RequestInit = {}) =>
      this.fetch(url, {
        ...init,
        signal: AbortSignal.any([signal(), init.signal ?? signal()]),
      });
    class IngressFacade {
      passed = false;
      pending: Promise<unknown>[] = [];
      onIncoming(_chatKey: string, _entry: LegacyObject) {
        this.passed = true;
      }
      get sender() {
        const sender = host.legacyContext(host.scope.getStore()?.chatKey ?? '').sender;
        return new Proxy(sender, {
          get: (target, method) => {
            const fn = target[method as string];
            return typeof fn === 'function'
              ? (...args: unknown[]) => {
                  const task = Promise.resolve(fn(...args));
                  this.pending.push(task);
                  return task;
                }
              : fn;
          },
        });
      }
      get store() {
        return host.legacyContext(host.scope.getStore()?.chatKey ?? '').store;
      }
      emit(type: string, chatKey: string) {
        host.ctx.host.publish(type, { chatKey });
      }
    }
    const base = IngressFacade.prototype.onIncoming;
    const sender = senderBridge((chatKey, messages, options) =>
      this.legacyContext(chatKey).sender.sendTextBatch(chatKey, messages, options),
    );
    const stickerPolicy = stickerPolicyBridge();
    const ingress = {
      active: () => IngressFacade.prototype.onIncoming !== base,
      invoke: async (chatKey: string, entry: LegacyObject) => {
        const facade = new IngressFacade();
        await facade.onIncoming(chatKey, entry);
        await Promise.allSettled(facade.pending);
        return !facade.passed;
      },
    };
    const config = {
      getConfig: () => this.view(),
      getGlobalConfig: () => this.global(),
      updateConfig: (patch: LegacyObject) => this.update(patch),
      DATA_DIR: this.options.dataDir,
    };
    const utilities = createCoreUtilities({
      dataDir: this.options.dataDir,
      config: () => this.view(),
      fetch: (url, init) => fetch(String(url), init),
      safeFetch: (url, init) => this.legacy.fetch.safeFetch(url, { ...init, signal: signal() }),
    });
    const logger = Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [
        level,
        (...args: unknown[]) => this.log(`[${level}] ${args.map(String).join(' ')}`),
      ]),
    );
    const chatCompletion = async (args: LegacyObject) => {
      const current = this.scope.getStore(),
        requestSignal = AbortSignal.any([signal(), args.signal ?? signal()]);
      requestSignal.throwIfAborted();
      const complete = async (tool: ToolContext) =>
        this.inScope(
          tool.chatKey,
          async () => {
            const result = await this.services.model.complete(
              args.messages,
              args.tools ?? [],
              AbortSignal.any([tool.run.signal, requestSignal]),
              {
                chatKey: tool.chatKey,
                runId: tool.run.id,
                purpose: 'auxiliary',
                ...(args.temperature != null ? { temperature: Number(args.temperature) } : {}),
                ...(Number(args.maxTokens) > 0 ? { maxTokens: Number(args.maxTokens) } : {}),
                toolChoice: args.toolChoice ?? 'auto',
                overrides: args.overrides ?? undefined,
                thinkingMode: args.skillContext?.thinkingMode,
                context: args.skillContext,
              },
            );
            this.operations.account(tool.run.id, result);
            return result;
          },
          tool,
          id,
        );
      if (!current?.chatKey) throw new Error('辅助模型调用必须绑定具体会话');
      const result =
        current.tool && this.operations.owns(current.tool.run.id)
          ? await complete(current.tool)
          : await this.operations.execute(
              id,
              requestSignal,
              current.chatKey,
              '扩展辅助模型',
              complete,
              current.tool?.run,
            );
      requestSignal.throwIfAborted();
      this.ctx.host.publish('model.auxiliary', {
        chatKey: current?.chatKey,
        runId: current?.tool?.run.id,
        usage: result.usage,
      });
      return {
        ...result,
        usage: {
          ...result.rawUsage,
          prompt_tokens: result.usage.input,
          completion_tokens: result.usage.output,
          total_tokens: result.usage.input + result.usage.output,
        },
      };
    };
    const emptyUsage = () => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      calls: 0,
    });
    const addUsage = (target: LegacyObject, usage: LegacyObject) => {
      target.promptTokens += Number(usage.prompt_tokens) || 0;
      target.completionTokens += Number(usage.completion_tokens) || 0;
      target.totalTokens +=
        Number(usage.total_tokens) ||
        (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
      target.cachedTokens =
        (target.cachedTokens || 0) +
        (usage.prompt_tokens_details?.cached_tokens ??
          usage.prompt_cache_hit_tokens ??
          usage.cached_tokens ??
          0);
      return target;
    };
    const profileKeys = () => Object.keys(this.services.config.get().profiles);
    class ChatStore {
      constructor(_limit?: number) {}
      recent(chatKey: string, options: LegacyObject = {}) {
        const bound = host.scope.getStore()?.chatKey;
        if (!bound || bound !== chatKey) throw Error('历史读取必须绑定当前会话');
        return host.legacyContext(chatKey).store.recent(chatKey, options);
      }
    }
    const security = () => this.global().security ?? {};
    const safeFetch = async (url: string, options: LegacyObject = {}) => {
      const request = {
          signal: signal(),
          maxBytes: 200000,
          proxy: this.proxy()?.webFetch === false ? undefined : this.proxy(),
          truncate: true,
          ...(options.browseLocked ? { allowUrl: browseGuard(security()) } : {}),
        },
        response = await (this.options.fetch ?? publicFetch)(url, request);
      const raw = await response.text();
      return {
        url: response.url || url,
        statusCode: response.status,
        truncated: response.headers.get('x-harness-truncated') === 'true' || raw.length > 50000,
        body: raw.slice(0, 50000),
      };
    };
    const safeFetchBinary = async (url: string, maxBytes = 12 * 1024 * 1024, options: LegacyObject = {}) => {
      const request = {
          signal: signal(),
          maxBytes,
          proxy: this.proxy()?.webFetch === false ? undefined : this.proxy(),
          allowPrivate: security().allowPrivateImageHosts === true,
          ...(options.browseLocked ? { allowUrl: browseGuard(security()) } : {}),
        },
        response = await (this.options.fetch ?? publicFetch)(url, request);
      if (!response.ok) throw new Error(`图片下载 HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('图片下载超过大小上限');
      return {
        buffer,
        contentType: response.headers.get('content-type') || '',
      };
    };
    const closers = new Set<() => Promise<void>>();
    const toolRows = () => this.services.tools.catalog?.(this.scope.getStore()?.chatKey ?? '') ?? [];
    const toolDefinition = (row: ReturnType<typeof toolRows>[number]) => ({
      ...row,
      id: row.id,
      name: row.name,
      skillId: row.owner === 'basic-tools' ? null : row.owner,
      execute: async (_ctx: unknown, args: unknown) => {
        const tool = this.scope.getStore()?.tool;
        if (!tool) throw new Error('调用工具必须绑定当前运行');
        return this.services.tools.execute(tool, row.id, JSON.stringify(args ?? {}));
      },
    });
    const publicTools = {
      ...this.legacy.tools,
      listTools: () => toolRows().map(toolDefinition),
      getTool: (name: string) => {
        const row = toolRows().find((t) => t.id === name);
        return row ? toolDefinition(row) : this.legacy.tools.getTool(name);
      },
      listToolsByCategory: (category: string) =>
        toolRows()
          .filter((t) => t.category === category)
          .map(toolDefinition),
      listCategories: () => [...new Set(toolRows().map((t) => t.category))],
      listAvailableTools: () =>
        toolRows()
          .filter((t) => t.enabled)
          .map(toolDefinition),
      getToolAvailability: (name: string) => {
        const row = toolRows().find((t) => t.id === name);
        return row
          ? {
              id: name,
              enabled: row.enabled,
              reason: row.reason,
              core: row.core,
              code: row.enabled ? null : 'unavailable',
              skillId: row.owner,
            }
          : this.legacy.tools.getToolAvailability(name);
      },
      availabilityOf: () =>
        toolRows().map((t) => ({
          id: t.id,
          enabled: t.enabled,
          reason: t.reason,
          core: t.core,
          skillId: t.owner,
        })),
    };
    const electron = electronBridge({
      renderer: () => this.ctx.use(htmlRendererService),
      signal,
      roots: [packageDir, this.options.dataDir],
      fetch,
      own: (close) => {
        closers.add(close);
        return () => {
          closers.delete(close);
        };
      },
    });
    const protocol = onebotBridge({
      identity: () => this.services.adapter.identity?.() ?? { id: '' },
      query: async (action, args) => {
        signal().throwIfAborted();
        const current = this.scope.getStore()?.chatKey;
        if (action === 'get_login_info') {
          const identity = this.services.adapter.identity?.();
          if (identity?.id) return { user_id: identity.id, nickname: identity.name ?? '' };
        }
        if (args.group_id != null && current && current !== `group:${args.group_id}`)
          throw new Error('群协议查询必须绑定当前会话');
        if (
          args.message_id != null &&
          (!current || !this.services.storage.messages(current).some((m) => m.id === String(args.message_id)))
        )
          throw new Error('消息协议查询必须使用当前会话记录');
        return this.services.adapter.query(action, args, signal());
      },
      interact: async (action, args) => {
        const current = this.scope.getStore();
        let chatKey: string, payload: OutboundPayload, title: string;
        if (action === 'set_input_status') {
          chatKey = `private:${String(args.user_id)}`;
          if (current?.chatKey && current.chatKey !== chatKey) throw new Error('输入状态不能跨会话');
          if (![1, 3].includes(Number(args.event_type))) throw new Error('输入状态类型无效');
          payload = { typing: { eventType: Number(args.event_type) as 1 | 3 } };
          title = '更新输入状态';
        } else {
          const mid = String(args.message_id),
            keys = current?.chatKey ? [current.chatKey] : this.services.storage.chats().map((c) => c.chatKey);
          const matching = keys.filter(
            (key) =>
              key.startsWith('group:') &&
              this.ctx.use(accessService).allowed(key) &&
              this.services.storage.messages(key).some((m) => m.id === mid),
          );
          if (matching.length !== 1) throw new Error('表情回应目标不存在、越界或不唯一');
          chatKey = matching[0]!;
          payload = {
            reaction: {
              messageId: mid,
              emojiId: String(args.emoji_id),
              set: args.set !== false,
            },
          };
          title = '设置消息表情回应';
        }
        return this.operations.execute(
          id,
          signal(),
          chatKey,
          title,
          (tool) =>
            this.inScope(
              chatKey,
              async () => {
                const result = await this.services.outbound.sendPayload(tool.run, chatKey, title, payload);
                return { message_id: result.id };
              },
              tool,
              id,
            ),
          current?.tool?.run,
        );
      },
    });
    return {
      onebot: { OneBotClient: protocol.OneBotClient },
      $protocol: protocol,
      $lifecycle: { signal: lifetime.signal },
      $activation: {
        config: {
          get: () => this.view(),
          patch: (patch: LegacyObject) => this.update(patch),
          dataDir: this.options.dataDir,
        },
        orchestrator: {
          wake: (chatKey: string, options: LegacyObject = {}) => {
            lifetime.signal.throwIfAborted();
            if (!this.scoped(chatKey, () => this.legacy.skillManager.isActive(id, { chatKey }).active))
              throw new Error('任务所属扩展在目标会话未启用');
            return this.ctx.use(conversationService).wake(chatKey, {
              reason: String(options.proactiveReason ?? id),
              text: String(options.text ?? ''),
              signal: lifetime.signal,
            });
          },
        },
      },
      $cleanup: {
        dispose: async () => {
          lifetime.abort(new Error('扩展实例已停用或卸载'));
          await Promise.allSettled([...closers].map((close) => close()));
          closers.clear();
        },
      },
      $ingress: ingress,
      $sender: sender,
      $stickerPolicy: stickerPolicy,
      stickers: { saveStickerStore: stickerPolicy.saveStickerStore },
      sender: { SendQueue: sender.SendQueue },
      'unified-memory': nativeMemoryStore({
        agent: () => this.ctx.use(memoryAgentService),
        memory: () => this.ctx.use(memoryService),
        storage: this.services.storage,
        config: this.services.config,
        access: this.ctx.use(accessService),
        chatKey: () => this.scope.getStore()?.chatKey ?? '',
      }),
      store: { ChatStore },
      'web-search': {
        webSearch: (query: string) => this.ctx.use(webService).search(query, signal()),
      },
      'source-outbound': {
        target: () => {
          const target =
            this.legacy.skillManager.settingsOf(id)?.targetChat || this.scope.getStore()?.chatKey || '';
          return /^\d+$/.test(target) ? 'private:' + target : target;
        },
        sendTo: async (target: string, text: string) => {
          const current = this.scope.getStore()?.tool;
          if (!current) throw Error('发送必须属于当前运行');
          current.run.assertActive();
          const chatKey = /^\d+$/.test(target) ? 'private:' + target : target;
          if (chatKey === current.chatKey)
            return this.legacyContext(chatKey).sender.sendTextBatch(chatKey, [text]);
          const result = await this.services.tools.execute(
            current,
            'send_to',
            JSON.stringify({ targetChatKey: chatKey, messages: [text] }),
          );
          if ((result as LegacyObject)?.isError)
            throw Error(String((result as LegacyObject).error ?? '跨会话发送失败'));
          return result;
        },
      },
      'extension-observation': {
        get: (owner: string) => {
          if (!['chatter-guard', 'content-guard'].includes(owner)) throw Error('未公开的扩展观察接口');
          const resolve = () => {
            signal().throwIfAborted();
            const chatKey = this.scope.getStore()?.chatKey ?? '';
            if (
              !chatKey ||
              !this.inScope(chatKey, () => this.legacy.skillManager.isActive(owner, { chatKey }).active)
            )
              return undefined;
            return this.legacy.skillManager.registry.get(owner);
          };
          return {
            matchBlocked: (text: string, cfg: LegacyObject) => resolve()?.matchBlocked?.(text, cfg) ?? null,
            internals: {
              streaks: {
                get: (key: string) => {
                  const chatKey = this.scope.getStore()?.chatKey;
                  if (!chatKey || !key.startsWith(chatKey + '|')) throw Error('扩展观察不能读取其他会话状态');
                  return structuredClone(resolve()?.internals?.streaks?.get(key));
                },
              },
            },
          };
        },
      },
      config,
      prompt: promptBridge,
      electron,
      orchestrator: { Orchestrator: IngressFacade },
      'skills/config': this.legacy.settings,
      'skills/manager': { skillManager: this.legacy.skillManager },
      'tool-registry': publicTools,
      logger: { logger },
      'image-crop': {
        crop: async (file: string, width: number, height: number, shift = 0) => {
          const image = sharp(fs.readFileSync(file), {
              limitInputPixels: 100_000_000,
            }),
            info = await image.metadata();
          if (!info.width || !info.height) return '';
          const ratio = width / height,
            cropWidth = Math.min(info.width, Math.round(info.height * ratio)),
            cropHeight = Math.min(info.height, Math.round(info.width / ratio)),
            left = Math.round((info.width - cropWidth) / 2),
            top = Math.max(
              0,
              Math.min(
                info.height - cropHeight,
                Math.round((info.height - cropHeight) / 2 - info.height * shift),
              ),
            );
          const bytes = await image
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .resize(Math.round(width), Math.round(height))
            .jpeg({ quality: 86 })
            .toBuffer();
          return bytes.length < 512 ? '' : `data:image/jpeg;base64,${bytes.toString('base64')}`;
        },
      },
      'safe-fetch': {
        safeFetch,
        safeFetchBinary,
        validateFetchUrl: async (url: string) => {
          const r = await publicAddress(url);
          return { url: r.url, ip: r.address };
        },
        validateImageUrl: async (url: string) => {
          await publicAddress(url, security().allowPrivateImageHosts === true);
          return url;
        },
        browseLockState: () => security().browseLock ?? {},
        checkBrowseLock: (url: string) => {
          try {
            browseGuard(security())(new URL(url));
            return {
              enabled: security().browseLock?.enabled === true,
              allowed: true,
              host: new URL(url).hostname,
            };
          } catch {
            return {
              enabled: true,
              allowed: false,
              host: new URL(url).hostname,
            };
          }
        },
      },
      'gif-to-video': {
        gifFirstFrameDataUrl: (bytes: Uint8Array) =>
          firstGifFrame('data:image/gif;base64,' + Buffer.from(bytes).toString('base64')),
        isGifBuffer: (bytes: Uint8Array) => /^GIF8[79]a$/.test(Buffer.from(bytes).subarray(0, 6).toString()),
      },
      holidays: utilities.calendar,
      'model-prices': utilities.prices,
      util: utilities.util,
      'sticker-manager': {
        StickerManager: stickerPolicy.StickerManager,
        localStickerPath: (ref: string) => this.ctx.use(stickerService).localPath(ref),
      },
      'chat-store': {
        recent: (chatKey: string) =>
          this.legacyContext(this.scope.getStore()?.chatKey ?? '').store.recent(chatKey, {
            limit: 1000,
          }),
      },
      'scheduled-task': {
        isOwner: (context: LegacyObject) => {
          const callers = [
            ...new Set<string>(
              (context.session?.trigger ?? [])
                .filter((m: LegacyObject) => !m.self)
                .map((m: LegacyObject) => String(m.senderId)),
            ),
          ];
          if (callers.length !== 1) return false;
          const userId = callers[0];
          for (const provider of this.legacy.skillManager.getCapabilityProviders('message.owner-check', {
            chatKey: context.chatKey,
          }))
            if (provider.fn({ userId })?.isOwner === true) return true;
          const configured = String(
            this.view(context.chatKey).skills?.['owner-console']?.ownerQq ?? '',
          ).trim();
          return /^\d{5,15}$/.test(configured) && configured === userId;
        },
        fire: async (task: LegacyObject, now: number) => {
          signal().throwIfAborted();
          const control=this.ctx.use(systemControlService),presence=control.get();
          if(presence.state==='offline'||(presence.revision>0&&Number(task.dueAt)<=presence.changedAt&&Number(task.createdAt??0)<presence.changedAt)){
            control.log({source:'scheduler',actor:'system',action:'scheduled-task',status:'skipped',message:`过期定时任务已跳过：${String(task.id)}`});
            return {status:'skipped'};
          }
          const chatKey = String(task.chatKey ?? '');
          if (!this.scoped(chatKey, () => this.legacy.skillManager.isActive(id, { chatKey }).active))
            throw new Error('任务所属扩展在目标会话未启用');
          const late = now - Number(task.dueAt) > 90000,
            who = String(task.createdByName ?? task.createdBy ?? '当前会话用户'),
            text = `【定时任务 ${String(task.id)}】${late ? '延迟触发。' : ''}\n${who}此前保存的事项：\n${String(task.text ?? '')}\n原计划时间：${new Date(Number(task.dueAt)).toLocaleString('zh-CN')}。`;
          return this.ctx
            .use(conversationService)
            .wake(chatKey, { reason: id, text, signal: lifetime.signal });
        },
      },
      'avatar-source': {
        resolve: async (context: LegacyObject, args: LegacyObject) => {
          const chatKey = this.scope.getStore()?.chatKey;
          if (!chatKey || context.chatKey !== chatKey) throw new Error('头像图片必须绑定当前会话');
          const selected = ['stickerId', 'messageId', 'imageUrl'].filter((key) =>
            String(args?.[key] ?? '').trim(),
          );
          if (selected.length !== 1) throw new Error('请从 stickerId、messageId、imageUrl 中只选一个来源');
          const media = this.ctx.use(mediaService);
          let image: { bytes: Uint8Array; mime: string };
          let label: string;
          if (selected[0] === 'messageId') {
            const message = this.services.storage
              .messages(chatKey)
              .find((m) => m.id === String(args.messageId));
            if (!message) throw new Error('当前会话没有这条图片消息');
            this.ctx.use(accessService).assert(chatKey, message.senderId);
            const index = Number(args.imageIndex ?? 0);
            if (!Number.isInteger(index) || index < 0) throw new Error('imageIndex 必须是从0开始的整数');
            const reference = media
              .references(chatKey, message.localId)
              .filter((ref) => ref.kind === 'image')[index];
            if (!reference) throw new Error('这条消息没有所选图片');
            image = await media.image(chatKey, message.localId, reference.index, signal());
            label = `当前会话消息 ${message.id} 里的第 ${index + 1} 张图`;
          } else {
            let reference = String(args.imageUrl ?? '');
            label = '你提供的公开图片';
            if (selected[0] === 'stickerId') {
              const sticker = await this.ctx.use(stickerService).find(String(args.stickerId));
              if (!sticker) throw new Error('没有找到这个表情，请先 list_stickers');
              reference = String(sticker.url ?? '');
              label = `自己的表情 ${args.stickerId}`;
            } else if (!/^https?:\/\//i.test(reference))
              throw new Error('imageUrl 仅支持公开 http(s) 图片链接');
            if (reference.startsWith('file:')) {
              const local = this.ctx.use(stickerService).localPath(reference);
              if (!local) throw new Error('表情文件不在受控表情库');
              if (fs.statSync(local).size > 5 * 1024 * 1024) throw new Error('头像图片太大');
              reference = 'base64://' + fs.readFileSync(local).toString('base64');
            }
            image = await media.fetchImage(reference, signal(), {
              maxBytes: 5 * 1024 * 1024,
            });
          }
          return {
            ref: 'base64://' + Buffer.from(image.bytes).toString('base64'),
            label,
          };
        },
      },
      'runtime-status': {
        today: () => todayAccounting(this.services.storage.archives()),
        runtime: () => ({
          pid: String(process.pid),
          uptimeMs: process.uptime() * 1000,
          startedAt: Date.now() - process.uptime() * 1000,
          logName: null,
          logSize: 0,
          warnings: 0,
          logsAvailable: false,
        }),
      },
      'storage/session-files': {
        listLegacyFiles: () => [],
        readIndexEntries: () =>
          this.services.storage
            .archives()
            .filter((a) => this.ctx.use(accessService).allowed(a.chatKey))
            .map((a) => legacyArchive(a)),
        readSessionFull: (archiveId: string) => {
          const archive = this.services.storage.archives().find((a) => a.id === archiveId);
          if (!archive || !this.ctx.use(accessService).allowed(archive.chatKey)) return null;
          const current = this.scope.getStore()?.chatKey;
          if (current && current !== archive.chatKey) return legacyArchive(archive);
          let detail;
          try {
            detail = this.ctx.use(traceService).get(archive.id);
          } catch {}
          return legacyArchive(archive, detail, true);
        },
      },
      'plugin-loader': {
        loadPlugins: async () => {
          throw new Error('扩展加载由宿主生命周期管理，请使用扩展管理页重载');
        },
      },
      'chat-profiles': {
        profiledChatKeys: () =>
          id === 'self-surf' && this.scope.getStore()?.chatKey
            ? [this.scope.getStore()!.chatKey]
            : profileKeys(),
        isChatAdmittedById: (kind: string, id: string) => {
          const cfg = this.services.config.get();
          return (
            !cfg.deniedChats.includes(`${kind}:${id}`) &&
            (cfg.acceptAllSessions ||
              cfg.admissions.includes(`${kind}:${id}`) ||
              profileKeys().includes(`${kind}:${id}`))
          );
        },
        isChatDenied: (kind: string, id: string) =>
          this.services.config.get().deniedChats.includes(`${kind}:${id}`),
      },
      llm: {
        chatCompletion,
        chatCompletionWithRetry: chatCompletion,
        emptyUsage,
        addUsage,
        cacheHitRate: (usage: LegacyObject) =>
          usage?.promptTokens ? Math.min(1, Math.max(0, (usage.cachedTokens || 0) / usage.promptTokens)) : 0,
        estimateCost: (usage: LegacyObject, options: LegacyObject = {}) => {
          const price = utilities.prices.resolveModelPrice(
            options.model ?? this.view().api.model,
            this.view(),
          );
          const at = price.peak && options.at ? utilities.prices.priceAt(price, options.at) : price;
          const cached = Math.min(usage.cachedTokens || 0, usage.promptTokens || 0),
            breakdown = {
              fresh: (((usage.promptTokens || 0) - cached) * (at.in || 0)) / 1e6,
              cached: (cached * (at.cached ?? at.in ?? 0)) / 1e6,
              output: ((usage.completionTokens || 0) * (at.out || 0)) / 1e6,
            };
          return {
            cost: breakdown.fresh + breakdown.cached + breakdown.output,
            breakdown,
            source: price.source,
            matched: price.matched,
            prices: { in: at.in, out: at.out, cached: at.cached },
            peak: Boolean(at.peak),
            hasPeakTiers: Boolean(price.peak),
          };
        },
        resolveApiKey: (cfg: LegacyObject = this.view().api) => cfg.apiKey,
        resolveApiEndpoint: (cfg: LegacyObject = this.view().api) => cfg.baseUrl,
        isApiConfigured: (cfg: LegacyObject = this.view().api) => Boolean(cfg.baseUrl && cfg.model),
        isRetryableError: (error: unknown) => /429|5\d\d|timeout|ECONNRESET|EAI_AGAIN/i.test(String(error)),
        listModels: async () =>
          this.services.config.get().providers.flatMap((p) => p.models.map((id) => ({ id, provider: p.id }))),
      },
    };
  }
  private global(): LegacyObject {
    if (this.configRead?.global) return this.configRead.global;
    const cfg = this.configRead?.native ?? this.services.config.get();
    const base = deepMerge(cfg.legacyGlobal, this.config) as LegacyObject;
    const native = this.nativeView(
      {
        ...base,
        api: { ...base.api, ...cfg.model },
        persona: { botName: '助手', ...base.persona },
      },
      cfg.defaults,
    );
    native.providers = cfg.providers.map((p) => ({
      ...p,
      baseURL: p.baseUrl,
      displayName: p.name,
    }));
    native.dshProviderKeys = Object.fromEntries(cfg.providers.map((p) => [p.id, p.apiKey]));
    native.snowluma = { ...base.snowluma, ...cfg.onebot };
    native.skills = deepMerge(cfg.defaults.legacySession.skills ?? {}, base.skills ?? {});
    if (this.configRead) this.configRead.global = native;
    return native;
  }
  private nativeView(
    base: LegacyObject,
    settings: import('@qq-harness/contracts').ChatSettings,
  ): LegacyObject {
    const legacy = settings.legacySession as LegacyObject;
    const merged = deepMerge(base, legacy) as LegacyObject;
    const selection = settings.modelSelection;
    const provider = (this.configRead?.native ?? this.services.config.get()).providers.find(
      (p) => p.id === selection.providerId,
    );
    merged.api = {
      ...merged.api,
      maxRounds: settings.maxRounds,
      model: selection.model || merged.api?.model,
      provider: selection.providerId || merged.api?.provider,
      temperature: selection.temperature ?? merged.api?.temperature,
      thinkingMode: selection.thinkingMode,
      thinkingEffort: selection.thinkingEffort,
      thinkingBudget: selection.thinkingBudget,
      ...(provider ? { baseUrl: provider.baseUrl, apiKey: provider.apiKey } : {}),
      fallbackModels: selection.fallbacks.map((v) => ({
        provider: v.providerId,
        model: v.model,
      })),
    };
    merged.tools = structuredClone(settings.tools);
    if (true)
      merged.store = {
        ...merged.store,
        reply: settings.behavior.reply,
        keywordRules: settings.behavior.keywordRules,
        peakSchedule: settings.behavior.peakSchedule,
        historyCount: settings.behavior.historyCount,
        markConditionMissRead: settings.behavior.markConditionMissRead,
        maxPendingUnread: settings.behavior.maxPendingUnread,
        promptAnchor: settings.behavior.promptAnchor,
      };
    merged.chatActive = settings.behavior.chatActive;
    merged.proactive = settings.behavior.proactive;
    merged.availability = { online: settings.online };
    merged.commandMute = settings.commandMute;
    // 扩展管理器的修改是同一份设置的最新值，不能被迁移时的默认快照盖回去。
    return merged;
  }
  private view(chatKey = this.scope.getStore()?.chatKey ?? ''): LegacyObject {
    const cached = this.configRead?.views.get(chatKey);
    if (cached) return cached;
    const global = this.global();
    if (!chatKey) return global;
    const native = (this.configRead?.native ?? this.services.config.get()).profiles[chatKey]
      ? this.nativeView(global, this.services.config.effective(chatKey))
      : global;
    const view = this.profiles[chatKey]
      ? (deepMerge(native, this.profiles[chatKey]) as LegacyObject)
      : native;
    this.configRead?.views.set(chatKey, view);
    return view;
  }
  private invalidateConfigRead() {
    if (!this.configRead) return;
    this.configRead.native = this.services.config.get();
    this.configRead.global = undefined;
    this.configRead.views.clear();
  }
  private update(patch: LegacyObject): LegacyObject {
    this.ctx.assertActive();
    if (patch.tools) {
      const chatKey = this.scope.getStore()?.chatKey;
      if (chatKey) this.services.config.saveProfile(chatKey, { tools: patch.tools });
      else this.services.config.patch({ defaults: { tools: patch.tools } });
    }
    this.config = deepMerge(this.config, patch) as LegacyObject;
    this.invalidateConfigRead();
    this.services.storage.setState('extension-system', 'config', this.config);
    return this.global();
  }
  private inScope<T>(
    chatKey: string,
    fn: () => T,
    tool = this.scope.getStore()?.tool,
    owner = this.scope.getStore()?.owner,
  ): T {
    const inherited = this.scope.getStore();
    const ownerSignal =
      owner && owner !== inherited?.owner
        ? this.legacy.skillManager.registry.get(owner)?.__harnessSignal
        : inherited?.ownerSignal;
    // Reuse immutable configuration reads within one synchronous operation.
    // Never retain this cache across await, where settings may change.
    const previous = this.configRead;
    this.configRead ??= {
      native: this.services.config.get(),
      views: new Map(),
    };
    try {
      return this.scope.run({ chatKey, tool, owner, ownerSignal }, fn);
    } finally {
      this.configRead = previous;
    }
  }
  scoped<T>(chatKey: string, fn: () => T): T {
    return this.inScope(chatKey, fn);
  }
  proxy(chatKey = this.scope.getStore()?.chatKey ?? ''): HttpProxySettings | undefined {
    return this.inScope(chatKey, () => {
      const provider = this.legacy.skillManager.getCapabilityProviders('network.proxy-config', {
        chatKey,
      })[0];
      return provider?.fn() ?? undefined;
    });
  }
  withTool<T>(tool: ToolContext, fn: () => T): T {
    return this.inScope(tool.chatKey, fn, tool);
  }
  configView(chatKey = ''): LegacyObject {
    return this.view(chatKey);
  }
  forgetRun(id: string) {
    this.sessions.delete(id);
  }
  markImported(id: string) {
    this.update({
      skills: { [id]: { enabled: false } },
      extensions: { defaults: { [id]: { enabled: false } } },
    });
  }
  private legacyContext(chatKey: string, tool?: ToolContext, resourceOwner?: PluginContext): LegacyObject {
    const current = tool ?? this.scope.getStore()?.tool;
    const runId =
      current?.run.id ??
      this.ctx.host.listRuns().find((run) => run.partitionKey === chatKey && run.status === 'running')?.id ??
      `idle:${chatKey}`;
    let session = this.sessions.get(runId);
    if (!session) {
      session = { id: runId, chatKey, sent: [], meta: {}, messages: [] };
      this.sessions.set(runId, session);
    }
    const storage = this.services.storage;
    const visible = (message: { self: boolean; senderId: string }) =>
      message.self || this.ctx.use(accessService).allowed(chatKey, message.senderId);
    const stickerLibrary = () => this.ctx.use(stickerService);
    const convert = (value: LegacyObject) => ({
      ...value,
      ...(value.metadata ?? {}),
      id: value.localId,
      mid: value.id,
      ts: value.timestamp,
    });
    const target = (key: string) => {
      this.ctx.assertActive();
      resourceOwner?.assertActive();
      if (this.stopped) throw new Error('扩展宿主已停止');
      const scope = this.scope.getStore();
      scope?.ownerSignal?.throwIfAborted();
      if (scope?.owner) {
        const owner = scope.owner,
          skill = this.legacy.skillManager.registry.get(owner);
        const active = skill
          ? this.legacy.skillManager.isActive(owner, { chatKey }).active
          : !this.legacy.extensionRegistry.get(owner) ||
            this.legacy.extensionRegistry.isSessionEnabled(owner, { chatKey });
        if (!active) throw new Error('扩展已在当前会话停用');
      }
      if (!current) throw new Error('发送必须绑定当前运行');
      current.run.assertActive();
      if (key !== chatKey) throw new Error('扩展发送不能越过当前会话绑定');
      return current;
    };
    const sendOne = async (key: string, text: string, payload?: OutboundPayload) => {
      const tool = target(key);
      const result = payload
        ? await this.services.outbound.sendPayload(tool.run, key, text, payload)
        : await this.services.outbound.send(tool.run, key, text);
      if (!result.duplicate && (!payload || !('profileImage' in payload))) tool.sent++;
      const sent = {
        text,
        messageId: result.id,
        at: new Date().toISOString(),
        deduped: result.duplicate ?? false,
      };
      if (!payload || !('profileImage' in payload)) session!.sent.push(sent);
      return sent;
    };
    const decorations = (options: LegacyObject = {}): MessageSegment[] =>
      replySegments(storage, chatKey, options);
    const media = async (key: string, segments: MessageSegment[], options: LegacyObject = {}) => {
      target(key);
      for (const segment of segments)
        if (['image', 'video', 'record'].includes(segment.type)) {
          const ref = String(segment.data.file ?? segment.data.url ?? '');
          if (/^https?:\/\//i.test(ref)) {
            const result = await this.legacy.fetch.safeFetchBinary(ref, 32 * 1024 * 1024);
            segment.data = {
              ...segment.data,
              file: `base64://${result.buffer.toString('base64')}`,
            };
            delete segment.data.url;
          } else if (ref.startsWith('data:'))
            segment.data = {
              ...segment.data,
              file: `base64://${ref.slice(ref.indexOf(',') + 1)}`,
            };
        }
      return sendOne(
        key,
        segments
          .map((segment) => (segment.type === 'text' ? String(segment.data.text) : `[${segment.type}]`))
          .join(''),
        { segments: [...decorations(options), ...segments] },
      );
    };
    const send = async (key: string, values: string[] | string, options: LegacyObject = {}) => {
      const sent = [],
        failed = [];
      for (const [index, text] of (Array.isArray(values) ? values : [values]).entries()) {
        try {
          sent.push(
            decorations(options).length
              ? await media(key, [{ type: 'text', data: { text } }], options)
              : await sendOne(key, text),
          );
        } catch (error) {
          failed.push({ index, text, error: String(error) });
        }
      }
      if (!sent.length && failed.length) throw new Error(failed[0]!.error);
      return { sent, failed };
    };
    return {
      chatKey,
      selfId: this.services.adapter.identity?.().id ?? '',
      selfNickname: this.services.adapter.identity?.().name ?? '',
      kind: chatKey.split(':')[0],
      chatId: chatKey.split(':')[1],
      sessionId: runId,
      session,
      triggerUserIds: (session.trigger ?? []).map((m: LegacyObject) => m.senderId).filter(Boolean),
      proactive: session.proactive ?? false,
      config: this.view(chatKey),
      signal: current?.run.signal ?? this.ctx.signal,
      stickers: {
        find: (id: string) => stickerLibrary().find(id),
        get entries() {
          return stickerLibrary().entries();
        },
      },
      triggerEntries: storage
        .messages(chatKey)
        .filter((message) => !message.self && visible(message))
        .slice(-30)
        .map(convert),
      store: {
        recent: (key: string, options: number | { limit?: number; includeSelf?: boolean } = 30) => {
          if (key !== chatKey) throw new Error('消息读取必须绑定当前会话');
          return storage
            .messages(key)
            .filter(
              (m) => visible(m) && (typeof options === 'number' || options.includeSelf !== false || !m.self),
            )
            .slice(-(typeof options === 'number' ? options : (options.limit ?? 30)))
            .map(convert);
        },
        listChats: () =>
          storage
            .chats()
            .filter((chat) => this.ctx.use(accessService).allowed(chat.chatKey))
            .map((chat) => chat.chatKey),
        unread: (key: string) => {
          if (key !== chatKey) throw new Error('未读消息必须属于当前会话');
          return storage.unread(key).filter(visible).map(convert);
        },
        markEntryRead: (key: string, id: number) => {
          if (key !== chatKey) throw new Error('标记消息必须属于当前会话');
          storage.markRead(key, [id]);
        },
        markRead: (key: string, ids: number[]) => {
          if (key !== chatKey) throw new Error('标记消息必须属于当前会话');
          storage.markRead(key, ids);
        },
        findByMid: (key: string, id: string) => {
          if (key !== chatKey) throw new Error('消息查询必须属于当前会话');
          const message = storage.messages(key).find((m) => m.id === String(id));
          return message && visible(message) ? convert(message) : undefined;
        },
      },
      memory: {
        query: (key = chatKey) => {
          if (key !== chatKey) throw new Error('记忆读取必须绑定当前会话');
          return {
            memberImpression: this.ctx.use(memberMemoryService).query(chatKey),
          };
        },
        append: (key: string, category: string, text?: string, options: LegacyObject = {}) => {
          if (key !== chatKey) throw new Error('记忆写入必须绑定当前会话');
          if (text === undefined)
            return this.ctx
              .use(memoryAgentService)
              .request({ chatKey, tier: 'scratchpad', instruction: category, origin: 'compatibility' });
          if (category !== 'memberImpression') throw new Error('不支持的记忆分类');
          return this.ctx.use(memberMemoryService).append(chatKey, {
            userId: String(options.userId ?? ''),
            target: String(options.target ?? ''),
            content: text,
          });
        },
        remove: (key: string, category: string, selector: LegacyObject = {}) => {
          if (key !== chatKey || category !== 'memberImpression')
            throw new Error('记忆删除必须绑定当前会话与成员印象分类');
          return this.ctx.use(memberMemoryService).remove(chatKey, selector);
        },
      },
      sender: {
        poke: (key: string, userId?: string) => {
          const tool = target(key),
            targetId = userId || (!key.startsWith('group:') ? key.split(':')[1] : undefined);
          if (!targetId || !/^\d+$/.test(targetId)) throw new Error('拍一拍需要数字 QQ 号');
          return sendOne(tool.chatKey, `[拍一拍] ${targetId}`, {
            poke: targetId,
          });
        },
        sendTextBatch: send,
        sendText: send,
        sendMedia: media,
        sendImage: (key: string, image: LegacyObject, options?: LegacyObject) =>
          media(
            key,
            [
              {
                type: 'image',
                data: { file: image.dataUrl ?? image.url ?? image.file },
              },
            ],
            options,
          ),
        sendSticker: (key: string, sticker: LegacyObject, options?: LegacyObject) =>
          media(
            key,
            [
              {
                type: 'image',
                data: {
                  file: sticker.dataUrl ?? sticker.url ?? sticker.file,
                  sub_type: 1,
                },
              },
            ],
            options,
          ),
        sendFile: (key: string, file: string, name = '') =>
          sendOne(key, `[文件] ${name || path.basename(file)}`, {
            file,
            name: name || path.basename(file),
          }),
      },
      onebot: {
        call: async (action: string, args: LegacyObject) => {
          if (action === 'set_qq_avatar') {
            const tool = target(chatKey),
              image = await this.ctx.use(mediaService).fetchImage(String(args.file ?? ''), tool.run.signal, {
                maxBytes: 5 * 1024 * 1024,
              });
            const bytes = await sharp(image.bytes, {
              limitInputPixels: 40_000_000,
              animated: false,
            })
              .resize({
                width: 640,
                height: 640,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .jpeg({ quality: 90 })
              .toBuffer();
            const sent = await sendOne(chatKey, '[修改自己的头像]', {
              profileImage: 'base64://' + bytes.toString('base64'),
            });
            return { message_id: sent.messageId };
          }
          if (/^(send_|upload_|set_)/.test(action)) throw new Error('出站或管理动作必须使用受控宿主服务');
          return this.services.adapter.query(action, args, current?.run.signal);
        },
      },
    };
  }
  private availability(name: string, chatKey: string): boolean {
    return this.inScope(
      chatKey,
      () =>
        this.legacy.tools.getToolAvailability(name, {
          toolsCfg: this.view(chatKey).tools,
          runtimeContext: this.legacyContext(chatKey),
          skills: this.legacy.skillManager,
        }).enabled === true,
    );
  }
  private shouldActivate(id: string): boolean {
    if (this.inScope('', () => this.legacy.skillManager.isEnabled(id))) return true;
    return [
      ...new Set([...Object.keys(this.profiles), ...Object.keys(this.services.config.get().profiles)]),
    ].some((key) => this.inScope(key, () => this.legacy.skillManager.isEnabled(id)));
  }
  private syncTools(): void {
    if (this.stopped || this.loading) return;
    const definitions = this.legacy.tools.listTools() as LegacyObject[];
    this.committedTools = new Map(definitions.map((tool) => [String(tool.id), tool]));
    const alive = new Set(definitions.map((tool) => String(tool.id)));
    for (const [id, old] of this.nativeTools)
      if (!alive.has(id)) {
        this.services.tools.unregister(id, old.context);
        this.nativeTools.delete(id);
      }
    for (const definition of definitions) {
      const managerId = this.legacy.extensionRegistry.get(definition.skillId)?.managerId;
      const resourceOwner = this.managers.get(managerId)?.owner ?? this.ctx;
      const signature = JSON.stringify([
        resourceOwner.id,
        resourceOwner.generation,
        definition.name,
        definition.description,
        definition.parameters,
      ]);
      const old = this.nativeTools.get(definition.id);
      if (old?.signature === signature) continue;
      if (old) this.services.tools.unregister(definition.id, old.context);
      const cleanups: (() => void | Promise<void>)[] = [];
      const owner: PluginContext = {
        ...resourceOwner,
        effect: (cleanup) => cleanups.push(cleanup),
      };
      const description = normalizeLegacyInstructions(
        String(definition.description ?? definition.name ?? definition.id),
      );
      this.services.tools.register(owner, {
        name: definition.id,
        defaultEnabled: definition.defaultEnabled,
        displayName: String(definition.name ?? definition.id),
        description:
          definition.skillId === 'long-memory'
            ? description.replace('物理删除', '停止检索并保留历史') +
              ' 使用统一三层记忆：新增先写短期，修改为草稿，短期整理后生效。'
            : description,
        parameters: definition.parameters ?? { type: 'object', properties: {} },
        available: (chatKey) => this.availability(definition.id, chatKey),
        parse: (args) => args,
        execute: (tool, args) =>
          this.inScope(
            tool.chatKey,
            async () => {
              if (!this.availability(definition.id, tool.chatKey))
                throw new Error('扩展工具在当前会话不可用');
              const current = this.committedTools.get(definition.id);
              if (!current) throw new Error('工具已卸载');
              return current.execute(this.legacyContext(tool.chatKey, tool, resourceOwner), args);
            },
            tool,
            definition.skillId,
          ),
      });
      this.nativeTools.set(definition.id, {
        signature,
        context: owner,
        cleanups,
      });
    }
  }
  private async load(): Promise<void> {
    if (this.stopped) return;
    this.loading = true;
    try {
      const result = await this.legacy.loadPlugins({
        roots: {
          plugins: path.join(this.options.root, 'plugins'),
          skills: path.join(this.options.root, 'skills'),
          chatPlugins: path.join(this.options.root, 'chat-plugins'),
        },
        log: this.log,
        runtime: {
          sender: new Proxy(
            {},
            {
              get:
                (_, method) =>
                (...args: unknown[]) =>
                  this.legacyContext(this.scope.getStore()?.chatKey ?? '').sender[method as string](...args),
            },
          ),
        },
      });
      for (const { owner, skill } of this.managers.values()) {
        if (owner.signal.aborted) continue;
        await skill.deactivate?.({ reason: 'reload' });
        owner.assertActive();
        if (this.legacy.skillManager.isEnabled(skill.manifest.id))
          await skill.activate?.({ reason: 'reload' });
      }
      for (const row of this.legacy.skillManager.registry.list()) {
        // 变量转换器与旧五钩子仍然归属于原扩展，不提升会话插件的管理权限。
        const id = row.manifest.id;
        if (row.manifest.type === 'plugin') {
          this.legacy.extensionRegistry.register({
            type: 'plugin',
            id,
            name: row.manifest.name,
            version: row.manifest.version,
            settings: row.manifest.settings,
            settingsSchema: row.manifest.configSchema,
            managerId: 'plugins',
            scope: row.manifest.scope,
            details: { dir: row.dir },
          });
          const descriptor = this.legacy.extensionRegistry.get(id);
          if (descriptor) descriptor.scope = row.manifest.scope;
        }
        // A disabled package may allocate at module top level or in setup. Retire
        // that instance now; enabling it imports a fresh instance, never a corpse.
        if (row.__harnessCleanup && !this.shouldActivate(id)) {
          await row.__harnessCleanup();
          row.__harnessSuspended = true;
          this.cleanupOwner(id);
        }
      }
      for (const id of result.pruned ?? []) {
        this.cleanupOwner(id);
        this.legacy.extensionRegistry.unregister(id);
      }
    } finally {
      this.loading = false;
    }
    this.syncTools();
    while (this.lifecycle.size) await Promise.allSettled([...this.lifecycle]);
    this.ctx.host.publish('extensions.changed', { count: this.list().length });
  }
  async reload(): Promise<void> {
    for (const controller of this.scriptJobs.keys()) controller.abort();
    const operation = this.queue.then(() => this.load());
    this.queue = operation.catch(() => {});
    return operation;
  }
  async attachManager(owner: PluginContext, id: string): Promise<void> {
    if (owner.id !== id) throw new Error('管理器声明必须归属于当前插件');
    const declaration = this.managerCatalog.get(id);
    if (!declaration) throw new Error(`未声明的管理器插件：${id}`);
    const operation = this.queue.then(async () => {
      owner.assertActive();
      this.ctx.assertActive();
      if (this.managers.has(id)) throw new Error(`管理器重复装配：${id}`);
      const mod = this.legacy.builtinModules[id];
      if (!mod) throw new Error(`管理器实现不存在：${id}`);
      // 原生插件开关是管理器的唯一运行来源；兼容配置只供旧模块读取。
      this.update({ skills: { [id]: { enabled: true } } });
      const { manifest } = this.legacy.manifests.normalizeManifest({
        ...declaration,
        scope: 'global',
      });
      const api = this.legacy.createExtensionApi('plugin', id, manifest.permissions ?? [], {
        scope: 'global',
        builtin: true,
      });
      const skill = {
        manifest,
        dir: path.join(MODULE_ROOT, 'plugins', id),
        kind: 'plugin',
        source: 'plugin',
        toolIds: [],
        api,
        ...mod,
        loadError: null,
      };
      this.legacy.skillManager.register(skill);
      this.managers.set(id, { owner, skill });
      owner.effect(() => this.detachManager(owner, id));
      await mod.setup?.(api);
      owner.assertActive();
      await mod.activate?.({ reason: 'cordis-load' });
      owner.assertActive();
      this.syncTools();
      this.ctx.host.publish('extensions.changed', { id });
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async detachManager(owner: PluginContext, id: string): Promise<void> {
    const operation = this.queue.then(async () => {
      const current = this.managers.get(id);
      if (current?.owner !== owner) return;
      this.managers.delete(id);
      for (const method of ['deactivate', 'dispose']) {
        try {
          await current.skill[method]?.({ reason: 'cordis-unload' });
        } catch (error) {
          this.log(error);
        }
      }
      this.legacy.skillManager.capabilities.removeOwner(id);
      this.legacy.skillManager.registry.unregister(id);
      this.legacy.extensionRegistry.unregisterByManager(id);
      this.legacy.extensionRegistry.unregister(id);
      this.cleanupOwner(id);
      this.syncTools();
      this.ctx.host.publish('extensions.changed', { id });
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async start(): Promise<void> {
    await this.reload();
    // 保留旧版三个监听根；所有 reload 走同一队列，关闭时必须撤销防抖计时器。
    if (this.options.hotReload !== false && this.config.extensions?.hotReload !== false) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const watchers = ['plugins', 'chat-plugins', 'skills'].map((dir) =>
        fs.watch(path.join(this.options.root, dir), { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void this.reload().catch((error) => this.log(error));
          }, 500);
        }),
      );
      this.watcher = {
        close: () => {
          clearTimeout(timer);
          for (const watcher of watchers) watcher.close();
        },
      };
    }
  }
  private cleanupOwner(id: string) {
    this.legacy.uiExtensionRegistry.unregisterByOwner(id);
    this.legacy.tabs.unregisterTabsByOwner(id);
    this.legacy.extensionHookBus.unregister(id);
    this.legacy.variables.unregisterVarConverters(id);
  }
  list(chatKey = ''): ExtensionDescriptor[] {
    return this.inScope(chatKey, () => {
      const rows: ExtensionDescriptor[] = this.legacy.extensionRegistry
        .list()
        .map((descriptor: LegacyObject) => {
          const skill = this.legacy.skillManager.registry.get(descriptor.id);
          const enabled = skill
            ? this.legacy.skillManager.isEnabled(descriptor.id)
            : (!this.legacy.extensionRegistry.hasExplicitConfig(descriptor.id, {
                chatKey,
              }) &&
                ['knowledge', 'promptinject', 'skill'].includes(descriptor.type)) ||
              this.legacy.extensionRegistry.isSessionEnabled(descriptor.id, {
                chatKey,
              });
          const settings = skill
            ? this.legacy.skillManager.settingsView(descriptor.id)
            : {
                ...this.legacy.extensionRegistry.settingsOf(descriptor.id, {
                  chatKey,
                }),
              };
          const activity = skill ? this.legacy.skillManager.isActive(descriptor.id, { chatKey }) : undefined;
          for (const [key, field] of Object.entries(descriptor.settingsSchema ?? {}) as [
            string,
            LegacyObject,
          ][])
            if (field.secret && settings[key]) settings[key] = '******';
          return {
            ...descriptor,
            enabled,
            active: skill ? activity!.active : enabled && descriptor.status === 'active',
            scope: descriptor.scope ?? 'session',
            reason: skill ? activity!.reason : (descriptor.error ?? ''),
            settings,
          };
        });
      const seen = new Set(rows.map((row) => row.id));
      for (const skill of this.legacy.skillManager.registry.list())
        if (!seen.has(skill.manifest.id)) {
          const item = this.legacy.skillManager.status(skill.manifest.id, {
            chatKey,
          });
          rows.push({
            ...item,
            type: item.kind === 'plugin' ? 'plugin' : 'skill',
            scope: item.scope ?? 'global',
            settingsSchema: item.configSchema ?? {},
            details: {},
          });
        }
      const catalogFile = path.join(this.options.root, 'installed-catalog.json');
      if (fs.existsSync(catalogFile)) {
        const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
        for (const item of catalog.items ?? []) {
          const existing = rows.find((row) => row.id === item.id);
          if (existing) {
            existing.details = {
              ...existing.details,
              migration: item.migration,
            };
            continue;
          }
          const settings = this.inScope(chatKey, () => this.view(chatKey).skills?.[item.id] ?? {});
          rows.push({
            id: item.id,
            type: item.type,
            scope: item.scope ?? 'session',
            name: item.name,
            version: item.version ?? '1',
            description: item.description ?? '',
            enabled: settings.enabled === true,
            active: false,
            reason: item.reason ?? '已迁移目录与配置，业务兼容验收待完成',
            settings: { ...item.settings, ...settings },
            settingsSchema: item.settingsSchema ?? {},
            details: {
              migration: item.migration,
              installed: true,
              nativePort: item.nativePort ?? false,
            },
          });
        }
      }
      for (const [id, declaration] of this.managerCatalog) {
        const info = this.ctx.host.listPlugins().find((plugin) => plugin.id === id);
        let row = rows.find((row) => row.id === id);
        if (!row) {
          row = {
            id,
            type: 'plugin',
            name: declaration.name,
            version: declaration.version,
            scope: 'global',
            enabled: false,
            active: false,
            reason: '',
            settings: { ...declaration.settings, ...this.config.skills?.[id] },
            settingsSchema: declaration.configSchema ?? {},
            details: { builtin: true },
          };
          rows.push(row);
        }
        row.enabled = info?.enabled === true;
        row.active = info?.status === 'active' && this.managers.has(id);
        row.reason = row.active ? '' : (info?.error ?? '管理器插件未启用');
      }
      for (const row of rows)
        if (row.type === 'skill' && row.details.scripts)
          row.details.backend = this.legacy.sandbox.isContainerAvailable({
            chatKey,
          })
            ? 'container'
            : 'sandbox';
      for (const row of rows)
        if (row.id === 'long-memory' && row.settingsSchema.dataDir)
          row.settingsSchema = {
            ...row.settingsSchema,
            dataDir: {
              ...row.settingsSchema.dataDir,
              type: 'internal',
              description: '旧独立数据库路径仅供迁移追溯；现使用统一三层记忆数据库',
            },
          };
      for (const row of rows)
        for (const [key, field] of Object.entries(row.settingsSchema ?? {}) as [string, LegacyObject][])
          if (field.secret && row.settings[key]) row.settings[key] = '******';
      return redact(rows);
    });
  }
  tabs(surface = 'repo'): LegacyObject[] {
    return this.legacy.tabs.listTabsFor(surface);
  }
  async configure(id: string, patch: LegacyObject, chatKey = ''): Promise<void> {
    if(id==='ops-ctrl' && patch.enabled===true) throw new Error('旧运维插件已由原生运维控制台替代');
    if (patch.enabled === false)
      for (const [controller, job] of this.scriptJobs)
        if ((job.id === id || id === 'ext-skill') && (!chatKey || job.chatKey === chatKey))
          controller.abort();
    const declaration = this.managerCatalog.get(id);
    const descriptor =
      this.legacy.extensionRegistry.get(id) ??
      (declaration
        ? {
            scope: 'global',
            settings: declaration.settings,
            settingsSchema: declaration.configSchema,
          }
        : undefined);
    const skill = this.legacy.skillManager.registry.get(id);
    const catalogFile = path.join(this.options.root, 'installed-catalog.json');
    const catalogEntry =
      !descriptor && !skill && fs.existsSync(catalogFile)
        ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')).items?.find((item: LegacyObject) => item.id === id)
        : undefined;
    if (catalogEntry) {
      if (patch.enabled === true)
        throw new Error(catalogEntry.reason ?? '此扩展的业务兼容验收尚未通过，不能启用');
      if (patch.settings) throw new Error('此扩展迁移设置已保留，完成适配后才能修改');
      if (patch.enabled === false) {
        if (chatKey) {
          this.profiles[chatKey] ??= { skills: {} };
          this.profiles[chatKey].skills ??= {};
          this.profiles[chatKey].skills[id] = {
            ...this.profiles[chatKey].skills[id],
            enabled: false,
          };
          this.services.storage.setState('extension-system', 'profiles', this.profiles);
        } else this.update({ skills: { [id]: { enabled: false } } });
        return;
      }
    }
    if (!descriptor && !skill) throw new Error('扩展不存在');
    const wasActive = skill && this.shouldActivate(id);
    if (chatKey && (skill?.manifest.scope === 'global' || descriptor?.scope === 'global'))
      throw new Error('全局插件不能由单个会话停用或覆盖');
    const schema = skill?.manifest.configSchema ?? descriptor?.settingsSchema ?? {};
    const old = this.inScope(chatKey, () =>
      skill
        ? this.legacy.skillManager.settingsOf(id)
        : this.legacy.extensionRegistry.settingsOf(id, { chatKey }),
    );
    const values: LegacyObject = { ...old };
    for (const [key, value] of Object.entries(patch.settings ?? {})) {
      if (id === 'long-memory' && key === 'dataDir') {
        if (value !== old[key]) throw Error('长期记忆已接入统一三层服务，不再使用独立 dataDir');
        continue;
      }
      if (!(key in schema) && !(key in (skill?.manifest.settings ?? descriptor?.settings ?? {})))
        throw new Error(`未知设置字段：${key}`);
      if (value === '******') continue;
      if (chatKey && (schema[key]?.secret || SECRET.test(key)))
        throw new Error(`凭据“${key}”请在全局扩展设置中管理，会话只能继承`);
      values[key] = value;
    }
    if (chatKey) {
      const sessionValues: LegacyObject = stripSessionSecrets(values);
      for (const [key, field] of Object.entries(schema) as [string, LegacyObject][])
        if (field.secret) delete sessionValues[key];
      const current = this.profiles[chatKey] ?? {
        skills: {},
        extensions: { overrides: {} },
      };
      current.extensions ??= { overrides: {} };
      current.extensions.overrides ??= {};
      current.extensions.overrides[id] = {
        ...(current.extensions.overrides[id] ?? {}),
        ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }),
        settings: sessionValues,
      };
      current.skills ??= {};
      current.skills[id] = {
        ...sessionValues,
        ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }),
      };
      this.profiles[chatKey] = current;
      this.services.storage.setState('extension-system', 'profiles', this.profiles);
    } else {
      if (skill || declaration)
        this.update({
          skills: {
            [id]: {
              ...values,
              ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }),
            },
          },
        });
      this.update({
        extensions: {
          defaults: {
            [id]: {
              ...(this.config.extensions?.defaults?.[id] ?? {}),
              settings: values,
              ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }),
            },
          },
        },
      });
    }
    if (declaration) {
      if (patch.enabled !== undefined) {
        this.services.config.patch({
          plugins: { [id]: Boolean(patch.enabled) },
        });
        await this.ctx.host.setEnabled(id, Boolean(patch.enabled));
      }
      if (patch.settings || patch.enabled === true) await this.reload();
      this.ctx.host.publish('extensions.changed', { id });
      return;
    }
    if (descriptor && !chatKey) descriptor.settings = values;
    if (skill) {
      const nowActive = this.shouldActivate(id);
      if (wasActive && !nowActive) {
        try {
          await skill.deactivate?.({ reason: 'settings' });
        } finally {
          if (skill.__harnessCleanup) {
            await skill.__harnessCleanup();
            skill.__harnessSuspended = true;
          }
          this.cleanupOwner(id);
        }
      } else if (!wasActive && nowActive) {
        if (skill.__harnessSuspended) await this.reload();
        else await skill.activate?.({ reason: 'settings' });
      }
    }
    if (!chatKey && patch.settings) await this.reload();
    this.syncTools();
    this.ctx.host.publish('extensions.changed', { id, chatKey });
  }
  async clearSettings(id: string, chatKey: string): Promise<void> {
    if (!chatKey) {
      delete this.config.skills?.[id];
      delete this.config.extensions?.defaults?.[id];
      this.services.storage.setState('extension-system', 'config', this.config);
    }
    const profile = this.profiles[chatKey];
    if (profile) {
      delete profile.skills?.[id];
      delete profile.extensions?.overrides?.[id];
      this.services.storage.setState('extension-system', 'profiles', this.profiles);
    }
    await this.reload();
    this.ctx.host.publish('extensions.changed', { id, chatKey });
  }
  capability(name: string, input: LegacyObject = {}, chatKey = ''): unknown {
    return this.inScope(chatKey, () =>
      this.legacy.skillManager.getCapabilityProviders(name, { chatKey })[0]?.fn(input),
    );
  }
  runHook(name: string, input: LegacyObject, chatKey = ''): Promise<LegacyObject[]> {
    return this.inScope(chatKey, async () => {
      const context = this.legacyContext(chatKey),
        session = context.session;
      if (Array.isArray(input.triggerEntries)) session.trigger = input.triggerEntries;
      if (typeof input.proactive === 'boolean') session.proactive = input.proactive;
      if (Number.isInteger(input.round)) session.rounds = input.round;
      const before = session.messages.length;
      const results = await this.legacy.skillManager.runHook(name, {
        ...context,
        ...input,
      });
      // Old presentation-only notes stay in trace storage; they are not fake
      // chat messages and are not fed back to the model as assistant output.
      if (session.messages.length > before && this.scope.getStore()?.tool) {
        try {
          this.ctx.use(traceService).record(this.scope.getStore()!.tool!.run.id, 'context', '扩展运行记录', {
            messages: session.messages.slice(before),
          });
        } catch {}
      }
      return results;
    });
  }
  context(chatKey: string): LegacyObject {
    return this.legacyContext(chatKey);
  }
  async observeOutbound(value: {
    chatKey: string;
    text: string;
    messageId: string;
    payload?: OutboundPayload;
  }) {
    for (const skill of this.legacy.skillManager.registry.list()) {
      const id = skill.manifest.id;
      if (
        !skill.__harnessProtocol ||
        !this.scoped(
          value.chatKey,
          () => this.legacy.skillManager.isActive(id, { chatKey: value.chatKey }).active,
        )
      )
        continue;
      try {
        await this.inScope(
          value.chatKey,
          () => skill.__harnessProtocol.observe(value),
          this.scope.getStore()?.tool,
          id,
        );
      } catch (error) {
        this.legacy.skillManager.recordError(id, error);
      }
    }
  }
  hasIngress(chatKey: string) {
    return this.legacy.skillManager.registry
      .list()
      .some(
        (skill: LegacyObject) =>
          skill.__harnessIngress?.active() &&
          this.scoped(
            chatKey,
            () => this.legacy.skillManager.isActive(skill.manifest.id, { chatKey }).active,
          ),
      );
  }
  async intercept(tool: ToolContext, message: LegacyObject): Promise<boolean> {
    return this.withTool(tool, async () => {
      for (const skill of this.legacy.skillManager.registry.list()) {
        const id = skill.manifest.id,
          entry = skill.__harnessIngress;
        if (!entry) continue;
        if (!entry.active() || !this.legacy.skillManager.isActive(id, { chatKey: tool.chatKey }).active)
          continue;
        if (await this.inScope(tool.chatKey, () => entry.invoke(tool.chatKey, message), tool, id))
          return true;
      }
      return false;
    });
  }
  contributions(page: string, chatKey = ''): LegacyObject[] {
    const candidates = this.legacy.uiExtensionRegistry.listByPage(page);
    if (!candidates.length) return [];
    return this.inScope(chatKey, () => {
      const enabled = new Map<string, boolean>();
      return candidates.filter((row: LegacyObject) => {
        if (!enabled.has(row.ownerId)) {
          const skill = this.legacy.skillManager.registry.get(row.ownerId);
          const descriptor = this.legacy.extensionRegistry.get(row.ownerId);
          enabled.set(
            row.ownerId,
            skill
              ? this.legacy.skillManager.isActive(row.ownerId, { chatKey }).active
              : Boolean(
                  descriptor?.status === 'active' &&
                  this.legacy.extensionRegistry.isSessionEnabled(row.ownerId, {
                    chatKey,
                  }),
                ),
          );
        }
        return enabled.get(row.ownerId);
      });
    });
  }
  async action(owner: string, action: string, args: LegacyObject, chatKey = ''): Promise<unknown> {
    if (!this.list(chatKey).some((row) => row.id === owner && row.active))
      throw new Error('动作所属扩展未启用');
    return this.inScope(chatKey, () =>
      this.legacy.uiExtensionRegistry.invokeAction(owner, action, args, {
        chatKey,
      }),
    );
  }
  readDoc(id: string, chatKey = ''): unknown {
    const result = this.legacy.docRegistry.read(id);
    if (!result.ok) return result;
    const owner = result.doc.ownerId;
    if (
      !this.list(chatKey).some((row) => row.id === owner && row.active) &&
      this.legacy.extensionRegistry.hasExplicitConfig(owner, { chatKey })
    )
      throw new Error('文档所属扩展未启用');
    return result;
  }
  async runScript(args: LegacyObject, chatKey: string): Promise<unknown> {
    this.ctx.assertActive();
    this.ctx.use(accessService).assert(chatKey);
    if (this.list(chatKey).some((row) => row.id === args.skillId && !row.active))
      throw new Error('技能在当前会话未启用');
    const descriptor = this.legacy.extensionRegistry.get(args.skillId);
    const resolved = this.legacy.sandbox.resolveScript(args);
    if (!resolved.ok) return resolved;
    const params = Object.fromEntries(
      (descriptor?.details?.params ?? []).map((param: LegacyObject) => [param.key, param.default ?? '']),
    );
    const settings = this.view(chatKey).skills?.['ext-skill'] ?? {};
    const controller = new AbortController();
    const owner = this.scope.getStore();
    const signal = AbortSignal.any([
      this.ctx.signal,
      controller.signal,
      ...(owner?.tool ? [owner.tool.run.signal] : []),
      ...(owner?.ownerSignal ? [owner.ownerSignal] : []),
    ]);
    signal.throwIfAborted();
    this.scriptJobs.set(controller, { id: args.skillId, chatKey });
    try {
      return await this.inScope(chatKey, () =>
        this.legacy.sandbox.runSkillScript({
          ...resolved,
          ...args,
          args: { ...params, ...(args.args ?? {}) },
          timeoutMs: Math.min(600000, Math.max(200, Number(settings.timeoutMs) || 5000)),
          memoryMb: Math.min(256, Math.max(16, Number(settings.memoryMb) || 64)),
          chatKey,
          signal,
        }),
      );
    } finally {
      this.scriptJobs.delete(controller);
    }
  }
  async prepareTool(chatKey: string, name: string, args: LegacyObject) {
    if (name !== 'send_message' || !Array.isArray(args.messages)) return args;
    let messages = args.messages;
    for (const skill of this.legacy.skillManager.registry.list()) {
      const id = skill.manifest.id;
      if (
        !skill.__harnessSender?.active() ||
        !this.inScope(chatKey, () => this.legacy.skillManager.isActive(id, { chatKey }).active)
      )
        continue;
      messages = await this.inScope(
        chatKey,
        () => skill.__harnessSender.prepare(chatKey, messages, args),
        this.scope.getStore()?.tool,
        id,
      );
    }
    return { ...args, messages };
  }
  async prepareStickers(chatKey: string, entries: LegacyObject[]) {
    for (const skill of this.legacy.skillManager.registry.list()) {
      const id = skill.manifest.id;
      if (
        !skill.__harnessStickerPolicy?.active() ||
        !this.inScope(chatKey, () => this.legacy.skillManager.isActive(id, { chatKey }).active)
      )
        continue;
      entries = await this.inScope(
        chatKey,
        () => skill.__harnessStickerPolicy.prepare(entries),
        this.scope.getStore()?.tool,
        id,
      );
    }
    return entries;
  }
  renderTemplate(text: string, owner = '') {
    return this.legacy.variables.renderTemplate(text, { ownerId: owner });
  }
  raw(): LegacyObject {
    return this.legacy as unknown as LegacyObject;
  }
  diagnostics() {
    return this.logs.slice();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    for (const controller of this.scriptJobs.keys()) controller.abort();
    this.watcher?.close();
    for (const timer of this.scheduled) clearTimeout(timer);
    this.scheduled.clear();
    await this.queue;
    for (const item of this.legacy.skillManager.registry.list()) {
      for (const method of ['deactivate', 'dispose']) {
        try {
          await item[method]?.({ reason: 'shutdown' });
        } catch (error) {
          this.log(error);
        }
      }
      this.legacy.skillManager.capabilities.removeOwner(item.manifest.id);
      this.legacy.skillManager.registry.unregister(item.manifest.id);
      this.cleanupOwner(item.manifest.id);
    }
    await Promise.allSettled([...this.pending]);
    while (this.lifecycle.size) await Promise.allSettled([...this.lifecycle]);
    await Promise.allSettled([...this.capsuleResources].map((environment) => environment.dispose()));
    this.capsuleResources.clear();
    for (const [name, item] of this.nativeTools) this.services.tools.unregister(name, item.context);
    this.nativeTools.clear();
    this.legacy.sandbox.clearSkillScripts();
  }
}
