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
import { deepMerge } from '@qq-harness/files';
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
  private scope = new AsyncLocalStorage<{ chatKey: string; tool?: ToolContext }>();
  private queue: Promise<void> = Promise.resolve();
  private watcher?: { close(): void };
  private nativeTools = new Map<
    string,
    { signature: string; context: PluginContext; cleanups: (() => void | Promise<void>)[] }
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
      personas: () => [{ id: 'default', name: '默认人设', text: services.config.get().defaults.persona }],
      importModule: async (file) => {
        const relative = path.relative(path.join(MODULE_ROOT, 'plugins'), file);
        if (!relative.startsWith('..') && !path.isAbsolute(relative))
          return this.legacy.builtinModules[path.basename(path.dirname(file))]!;
        const module = (await import(
          pathToFileURL(file).href + `?harness=${this.instance}-${++this.importSequence}`
        )) as LegacyObject;
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
        const result = await services.model.complete(messages, [], ctx.signal);
        return { content: result.message.content, usage: result.usage };
      },
      legacyFetch: async (url, request = {}) => {
        return extensionFetch(
          url,
          { ...request, signal: AbortSignal.any([ctx.signal, request.signal ?? ctx.signal]) },
          (input) => this.legacy.fetch.validateFetchUrl(input),
        );
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
        if (event.type === 'config.changed') changed();
      }),
    );
  }
  private log = (message: unknown) => {
    this.logs.push(String(message));
    if (this.logs.length > 100) this.logs.shift();
    this.ctx.host.publish('extensions.log', { message: String(message) });
  };
  private global(): LegacyObject {
    const cfg = this.services.config.get();
    return {
      ...this.config,
      api: { ...cfg.model, vision: true, ...this.config.api },
      persona: { botName: '助手', ...this.config.persona },
      store: { ...this.config.store },
    };
  }
  private view(chatKey = this.scope.getStore()?.chatKey ?? ''): LegacyObject {
    const global = this.global();
    if (!chatKey || !this.profiles[chatKey]) return global;
    return deepMerge(global, this.profiles[chatKey]) as LegacyObject;
  }
  private update(patch: LegacyObject): LegacyObject {
    this.ctx.assertActive();
    this.config = deepMerge(this.config, patch) as LegacyObject;
    this.services.storage.setState('extension-system', 'config', this.config);
    return this.global();
  }
  private inScope<T>(chatKey: string, fn: () => T, tool = this.scope.getStore()?.tool): T {
    return this.scope.run({ chatKey, tool }, fn);
  }
  scoped<T>(chatKey: string, fn: () => T): T {
    return this.inScope(chatKey, fn);
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
      if (!result.duplicate) tool.sent++;
      const sent = {
        text,
        messageId: result.id,
        at: new Date().toISOString(),
        deduped: result.duplicate ?? false,
      };
      session!.sent.push(sent);
      return sent;
    };
    const decorations = (options: LegacyObject = {}): MessageSegment[] => [
      ...(options.replyToMessageId
        ? [{ type: 'reply', data: { id: String(options.replyToMessageId) } }]
        : []),
      ...(options.atUserId ? [{ type: 'at', data: { qq: String(options.atUserId) } }] : []),
    ];
    const media = async (key: string, segments: MessageSegment[], options: LegacyObject = {}) => {
      target(key);
      for (const segment of segments)
        if (['image', 'video', 'record'].includes(segment.type)) {
          const ref = String(segment.data.file ?? segment.data.url ?? '');
          if (/^https?:\/\//i.test(ref)) {
            const result = await this.legacy.fetch.safeFetchBinary(ref, 32 * 1024 * 1024);
            segment.data = { ...segment.data, file: `base64://${result.buffer.toString('base64')}` };
            delete segment.data.url;
          } else if (ref.startsWith('data:'))
            segment.data = { ...segment.data, file: `base64://${ref.slice(ref.indexOf(',') + 1)}` };
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
      kind: chatKey.split(':')[0],
      chatId: chatKey.split(':')[1],
      sessionId: runId,
      session,
      config: this.view(chatKey),
      signal: current?.run.signal ?? this.ctx.signal,
      triggerEntries: storage
        .messages(chatKey)
        .filter((message) => !message.self)
        .slice(-30)
        .map(convert),
      store: {
        recent: (key: string, options: number | { limit?: number } = 30) =>
          storage
            .messages(key)
            .slice(-(typeof options === 'number' ? options : (options.limit ?? 30)))
            .map(convert),
        listChats: () => storage.chats().map((chat) => chat.chatKey),
        unread: (key: string) => storage.unread(key).map(convert),
      },
      memory: {
        query: () => storage.memory(chatKey),
        append: (_key: string, text: string) =>
          storage.setMemory(chatKey, storage.memory(chatKey) + '\n' + text),
      },
      sender: {
        sendTextBatch: send,
        sendText: send,
        sendMedia: media,
        sendImage: (key: string, image: LegacyObject, options?: LegacyObject) =>
          media(key, [{ type: 'image', data: { file: image.dataUrl ?? image.url ?? image.file } }], options),
        sendSticker: (key: string, sticker: LegacyObject, options?: LegacyObject) =>
          media(
            key,
            [{ type: 'image', data: { file: sticker.dataUrl ?? sticker.url ?? sticker.file, sub_type: 1 } }],
            options,
          ),
        sendFile: (key: string, file: string, name = '') =>
          sendOne(key, `[文件] ${name || path.basename(file)}`, { file, name: name || path.basename(file) }),
      },
      onebot: {
        call: (action: string, args: LegacyObject) => {
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
    return Object.keys(this.profiles).some((key) =>
      this.inScope(key, () => this.legacy.skillManager.isEnabled(id)),
    );
  }
  private syncTools(): void {
    if (this.stopped) return;
    const definitions = this.legacy.tools.listTools() as LegacyObject[];
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
        definition.description,
        definition.parameters,
      ]);
      const old = this.nativeTools.get(definition.id);
      if (old?.signature === signature) continue;
      if (old) this.services.tools.unregister(definition.id, old.context);
      const cleanups: (() => void | Promise<void>)[] = [];
      const owner: PluginContext = { ...resourceOwner, effect: (cleanup) => cleanups.push(cleanup) };
      this.services.tools.register(owner, {
        name: definition.id,
        description: String(definition.description ?? definition.name ?? definition.id),
        parameters: definition.parameters ?? { type: 'object', properties: {} },
        available: (chatKey) => this.availability(definition.id, chatKey),
        parse: (args) => args,
        execute: (tool, args) =>
          this.inScope(
            tool.chatKey,
            async () => {
              if (!this.availability(definition.id, tool.chatKey))
                throw new Error('扩展工具在当前会话不可用');
              const current = this.legacy.tools.getTool(definition.id);
              if (!current) throw new Error('工具已卸载');
              return current.execute(this.legacyContext(tool.chatKey, tool, resourceOwner), args);
            },
            tool,
          ),
      });
      this.nativeTools.set(definition.id, { signature, context: owner, cleanups });
    }
  }
  private async load(): Promise<void> {
    if (this.stopped) return;
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
      if (this.legacy.skillManager.isEnabled(skill.manifest.id)) await skill.activate?.({ reason: 'reload' });
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
    }
    for (const id of result.pruned ?? []) {
      this.cleanupOwner(id);
      this.legacy.extensionRegistry.unregister(id);
    }
    this.syncTools();
    this.ctx.host.publish('extensions.changed', { count: this.list().length });
  }
  async reload(): Promise<void> {
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
      const { manifest } = this.legacy.manifests.normalizeManifest({ ...declaration, scope: 'global' });
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
            : (!this.legacy.extensionRegistry.hasExplicitConfig(descriptor.id, { chatKey }) &&
                ['knowledge', 'promptinject', 'skill'].includes(descriptor.type)) ||
              this.legacy.extensionRegistry.isSessionEnabled(descriptor.id, { chatKey });
          const settings = skill
            ? this.legacy.skillManager.settingsView(descriptor.id)
            : { ...this.legacy.extensionRegistry.settingsOf(descriptor.id, { chatKey }) };
          for (const [key, field] of Object.entries(descriptor.settingsSchema ?? {}) as [
            string,
            LegacyObject,
          ][])
            if (field.secret && settings[key]) settings[key] = '******';
          return {
            ...descriptor,
            enabled,
            active: skill
              ? this.legacy.skillManager.isActive(descriptor.id, { chatKey }).active
              : enabled && descriptor.status === 'active',
            scope: descriptor.scope ?? 'session',
            reason: skill
              ? this.legacy.skillManager.isActive(descriptor.id, { chatKey }).reason
              : (descriptor.error ?? ''),
            settings,
          };
        });
      const seen = new Set(rows.map((row) => row.id));
      for (const item of this.legacy.skillManager.list())
        if (!seen.has(item.id))
          rows.push({
            ...item,
            type: item.kind === 'plugin' ? 'plugin' : 'skill',
            scope: item.scope ?? 'global',
            settingsSchema: item.configSchema ?? {},
            details: {},
          });
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
        for (const [key, field] of Object.entries(row.settingsSchema ?? {}) as [string, LegacyObject][])
          if (field.secret && row.settings[key]) row.settings[key] = '******';
      return redact(rows);
    });
  }
  tabs(surface = 'repo'): LegacyObject[] {
    return this.legacy.tabs.listTabsFor(surface);
  }
  async configure(id: string, patch: LegacyObject, chatKey = ''): Promise<void> {
    const declaration = this.managerCatalog.get(id);
    const descriptor =
      this.legacy.extensionRegistry.get(id) ??
      (declaration
        ? { scope: 'global', settings: declaration.settings, settingsSchema: declaration.configSchema }
        : undefined);
    const skill = this.legacy.skillManager.registry.get(id);
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
      if (!(key in schema) && !(key in (skill?.manifest.settings ?? descriptor?.settings ?? {})))
        throw new Error(`未知设置字段：${key}`);
      if (value === '******') continue;
      values[key] = value;
    }
    if (chatKey) {
      const current = this.profiles[chatKey] ?? { skills: {}, extensions: { overrides: {} } };
      current.extensions ??= { overrides: {} };
      current.extensions.overrides ??= {};
      current.extensions.overrides[id] = {
        ...(current.extensions.overrides[id] ?? {}),
        ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }),
        settings: values,
      };
      current.skills ??= {};
      current.skills[id] = {
        ...values,
        ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }),
      };
      this.profiles[chatKey] = current;
      this.services.storage.setState('extension-system', 'profiles', this.profiles);
    } else {
      if (skill || declaration)
        this.update({
          skills: {
            [id]: { ...values, ...(patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }) },
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
        this.services.config.patch({ plugins: { [id]: Boolean(patch.enabled) } });
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
        await skill.deactivate?.({ reason: 'settings' });
        this.cleanupOwner(id);
      } else if (!wasActive && nowActive) await skill.activate?.({ reason: 'settings' });
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
      await this.reload();
    }
    const profile = this.profiles[chatKey];
    if (profile) {
      delete profile.skills?.[id];
      delete profile.extensions?.overrides?.[id];
      this.services.storage.setState('extension-system', 'profiles', this.profiles);
    }
    this.ctx.host.publish('extensions.changed', { id, chatKey });
  }
  capability(name: string, input: LegacyObject = {}, chatKey = ''): unknown {
    return this.inScope(chatKey, () =>
      this.legacy.skillManager.getCapabilityProviders(name, { chatKey })[0]?.fn(input),
    );
  }
  runHook(name: string, input: LegacyObject, chatKey = ''): Promise<LegacyObject[]> {
    return this.inScope(chatKey, () =>
      this.legacy.skillManager.runHook(name, { ...this.legacyContext(chatKey), ...input }),
    );
  }
  contributions(page: string, chatKey = ''): LegacyObject[] {
    const enabled = new Set(
      this.list(chatKey)
        .filter((row) => row.active)
        .map((row) => row.id),
    );
    return this.legacy.uiExtensionRegistry
      .listByPage(page)
      .filter((row: LegacyObject) => enabled.has(row.ownerId));
  }
  async action(owner: string, action: string, args: LegacyObject, chatKey = ''): Promise<unknown> {
    if (!this.list(chatKey).some((row) => row.id === owner && row.active))
      throw new Error('动作所属扩展未启用');
    return this.inScope(chatKey, () =>
      this.legacy.uiExtensionRegistry.invokeAction(owner, action, args, { chatKey }),
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
    if (
      !this.list(chatKey).some((row) => row.id === args.skillId && row.active) &&
      this.legacy.extensionRegistry.hasExplicitConfig(args.skillId, { chatKey })
    )
      throw new Error('技能在当前会话未启用');
    const descriptor = this.legacy.extensionRegistry.get(args.skillId);
    const resolved = this.legacy.sandbox.resolveScript(args);
    if (!resolved.ok) return resolved;
    const params = Object.fromEntries(
      (descriptor?.details?.params ?? []).map((param: LegacyObject) => [param.key, param.default ?? '']),
    );
    const settings = this.view(chatKey).skills?.['ext-skill'] ?? {};
    return this.inScope(chatKey, () =>
      this.legacy.sandbox.runSkillScript({
        ...resolved,
        ...args,
        args: { ...params, ...(args.args ?? {}) },
        timeoutMs: settings.timeoutMs ?? 5000,
        memoryMb: settings.memoryMb ?? 64,
        chatKey,
      }),
    );
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
    for (const [name, item] of this.nativeTools) this.services.tools.unregister(name, item.context);
    this.nativeTools.clear();
    this.legacy.sandbox.clearSkillScripts();
  }
}
