import { mediaTools } from '../../../plugins/media-tools/src/index.js';
import { htmlRenderer } from '../../../plugins/html-renderer/src/index.js';
import { stickerTools } from '../../../plugins/sticker-tools/src/index.js';
import { imageStudio } from '../../../plugins/image-studio/src/index.js';
import { webTools, createWebTools } from '../../../plugins/web-tools/src/index.js';
import { mediaRuntime } from '../../../plugins/media-runtime/src/index.js';
import { runInspector } from '../../../plugins/run-inspector/src/index.js';
import { Runtime } from '@qq-harness/kernel';
import { configFile } from '@qq-harness/config-file';
import { storageFile } from '@qq-harness/storage-file';
import { storageSqlite } from '@qq-harness/storage-sqlite';
import { restrictedAccessPolicy } from '@qq-harness/access-policy';
import { adapterMock } from '@qq-harness/adapter-mock';
import { adapterOnebot } from '@qq-harness/adapter-onebot';
import { outboundQueue } from '@qq-harness/outbound-queue';
import { modelMock } from '@qq-harness/model-mock';
import { modelOpenai } from '@qq-harness/model-openai';
import { modelOpencode } from '@qq-harness/model-opencode';
import { toolRuntime } from '@qq-harness/tool-runtime';
import { basicTools } from '@qq-harness/basic-tools';
import { agentBasic } from '@qq-harness/agent-basic';
import { conversation } from '@qq-harness/conversation';
import { conversationProactive } from '../../../plugins/conversation-proactive/src/index.js';
import { conversationManual } from '../../../plugins/conversation-manual/src/index.js';
import { transportHttp } from '@qq-harness/transport-http';
import { consoleApi } from '@qq-harness/console-api';
import { agentMemory } from '@qq-harness/agent-memory';
import { memoryIndexLexical } from '@qq-harness/memory-index-lexical';
import { reminders } from '@qq-harness/reminders';
import { externalPlugins } from '@qq-harness/external-plugins';
import { commandDirect } from '@qq-harness/command-direct';
import path from 'node:path';
import { extensionSystem } from '@qq-harness/extension-system';
import { v2Tools } from '@qq-harness/v2-tools';
import { v2Mcp } from '@qq-harness/v2-mcp';
import { v2Skills } from '@qq-harness/v2-skills';
import { v2Knowledge } from '@qq-harness/v2-knowledge';
import { v2Promptinject } from '@qq-harness/v2-promptinject';
import { configService } from '@qq-harness/domain';
import { snowlumaRuntime, type SnowlumaPluginOptions } from '@qq-harness/snowluma-runtime';
import type { PluginDefinition } from '@qq-harness/plugin-sdk';
import { containerRuntime, type ContainerOptions } from '@qq-harness/container-runtime';
import { containerSession } from '@qq-harness/container-session';
import { containerJobs } from '@qq-harness/container-jobs';
import { containerConsole } from '@qq-harness/container-console';
import { qqPortable, type QqPortableOptions } from '@qq-harness/qq-portable';
import { systemControl } from '../../../plugins/system-control/src/index.js';
import { opsControl } from '../../../plugins/ops-control/src/index.js';

export interface AppOptions {
  dataDir: string;
  extensionDir?: string;
  v2ExtensionDir?: string;
  extensionHotReload?: boolean;
  extensionFetch?: (url: string, options?: RequestInit) => Promise<Response>;
  v2Managers?: boolean;
  storage?: 'sqlite' | 'files';
  demo?: boolean;
  token?: string;
  concurrency?: number;
  initialConfig?: unknown;
  plugins?: PluginDefinition[];
  memoryIndex?: PluginDefinition;
  snowluma?: SnowlumaPluginOptions;
  qqPortable?: QqPortableOptions;
  allowedChats?: readonly string[];
  containers?: ContainerOptions;
  imageStudio?: { fetch?: Parameters<typeof imageStudio>[1] };
  web?: Parameters<typeof createWebTools>[0];
  media?: Parameters<typeof mediaRuntime>[1];
}
export async function createApplication(options: AppOptions) {
  const runtime = new Runtime({
    concurrency: options.concurrency,
    log: console.error,
  });
  const http = transportHttp({ token: options.token });
  runtime.install(
    configFile(
      options.dataDir,
      options.initialConfig ??
        (options.demo !== false
          ? {
              acceptAllSessions: true,
              send: { minIntervalMs: 0, dedupeMs: 0 },
            }
          : {}),
      {
        initialConcurrency: options.concurrency,
        onChange: (cfg) =>
          runtime.configureRuns(cfg.execution.concurrency, cfg.execution.queueLimit),
      },
    ),
  );
  await runtime.start();
  const config = runtime.use(configService);
  const managers =
    options.v2Managers === false ? [] : [v2Tools, v2Mcp, v2Skills, v2Knowledge, v2Promptinject];
  const plugins: PluginDefinition[] = [
    options.storage === 'files' ? storageFile(options.dataDir) : storageSqlite(options.dataDir),
    restrictedAccessPolicy(options.allowedChats),
    systemControl,
    options.demo !== false ? adapterMock : adapterOnebot,
    outboundQueue,
    options.demo !== false ? modelMock : modelOpenai,
    ...(options.demo === false ? [modelOpencode] : []),
    toolRuntime,
    options.web ? createWebTools(options.web) : webTools,
    mediaRuntime(options.dataDir, options.media),
    htmlRenderer(),
    basicTools,
    mediaTools,
    stickerTools(options.dataDir),
    agentBasic,
    conversation,
    conversationProactive,
    conversationManual,
    http.plugin,
    consoleApi(options.demo !== false),
    snowlumaRuntime({
      allowLaunch: options.demo === false,
      ...options.snowluma,
    }),
    qqPortable({ allowLaunch: options.demo === false, ...options.qqPortable }),
    containerRuntime({
      allowOperations: options.demo === false,
      ...options.containers,
    }),
    containerSession,
    containerJobs,
    containerConsole,
    options.memoryIndex ?? memoryIndexLexical,
    agentMemory,
    imageStudio(options.dataDir, options.imageStudio?.fetch),
    reminders(options.dataDir),
    commandDirect,
    opsControl,
    extensionSystem({
      root: options.v2ExtensionDir ?? path.join(options.dataDir, 'extensions'),
      dataDir: options.dataDir,
      hotReload: options.extensionHotReload,
      fetch: options.extensionFetch,
      managers: managers.map((plugin) => plugin.id),
    }),
    ...managers,
    {
      id: 'console-overview',
      name: '总览页面',
      client: { entry: 'builtin:console-overview' },
      setup() {},
    },
    {
      id: 'console-chats',
      name: '会话页面',
      client: { entry: 'builtin:console-chats' },
      setup() {},
    },
    {
      id: 'console-plugins',
      name: '插件管理页面',
      client: { entry: 'builtin:console-plugins' },
      setup() {},
    },
    {
      id: 'console-settings',
      name: '设置页面',
      client: { entry: 'builtin:console-settings' },
      setup() {},
    },
    runInspector(options.dataDir),
    ...(options.plugins ?? []),
    ...(options.extensionDir ? [externalPlugins(options.extensionDir)] : []),
  ];
  try {
    for (const plugin of plugins)
      runtime.install(plugin, plugin.id === 'system-control' || config.get().plugins[plugin.id] !== false);
    await runtime.start();
    return { runtime, app: http.app, stop: () => runtime.stop() };
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
