import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { compileLegacyPackage } from '../tools/compile-legacy-package.js';
import { prepareExtensionMigration } from '../tools/prepare-extension-migration.js';
import { installExtensionMigration } from '../tools/install-extension-migration.js';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService, ExtensionHost } from '@qq-harness/extension-compat';
import {
  adapterService,
  configService,
  conversationService,
  storageService,
  modelService,
  toolService,
  type ToolContext,
} from '@qq-harness/domain';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseSync } from 'rolldown/utils';
import { stripMentions } from '../packages/extension-compat/src/prompt-bridge.js';
import { htmlRendererService, traceService } from '@qq-harness/domain';
import sharp from 'sharp';
import { mockSnowluma } from './fixtures/snowluma.js';
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.useRealTimers();
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-capsule-'));
  cleanups.push(() => {
    const full = fs.realpathSync(root);
    if (
      path.dirname(full) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(full).startsWith('harness-capsule-')
    )
      throw new Error('清理越界');
    fs.rmSync(full, { recursive: true, force: true });
  });
  return root;
}
test.each(['plugin', 'skill'])(
  '迁移的 %s 声明类型后仍使用原有API，注册工具和能力不丢失',
  async (type) => {
    const root = fixture(),
      oldRoot = path.join(root, 'old'),
      source = path.join(oldRoot, type === 'skill' ? 'skills' : 'plugins', 'typed-legacy'),
      preview = path.join(root, 'preview'),
      target = path.join(root, 'extensions'),
      dataDir = path.join(root, 'data');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, type + '.json'),
      JSON.stringify({
        id: 'typed-legacy',
        name: '有类型的旧包',
        settings: { value: '原值' },
      }),
    );
    fs.writeFileSync(
      path.join(source, 'index.js'),
      `let api;
    export function setup(a) {api=a; a.registerTool({id:'typed_probe', name:'类型回归', parameters:{type:'object',properties:{}},execute:async()=>({content:'可调用'})});}
    export const providers={'typed.inspect':()=>api.config().value};`,
    );
    await prepareExtensionMigration(oldRoot, preview);
    installExtensionMigration(preview, dataDir, target, true);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(target, type === 'skill' ? 'skills' : 'plugins', 'typed-legacy', type + '.json'),
        'utf8',
      ),
    );
    expect(manifest).toMatchObject({
      type,
      harnessMigration: { runtimeApi: 'legacy-v1', stage: 'installed' },
    });
    const app = await createApplication({
      dataDir,
      v2ExtensionDir: target,
      extensionHotReload: false,
    });
    cleanups.push(app.stop);
    const host = app.runtime.use(extensionService),
      row = host.raw().skillManager.registry.get('typed-legacy');
    expect(row.loadError).toBeNull();
    expect(host.raw().skillManager.getCapabilityProviders('typed.inspect', {})[0].fn()).toBe(
      '原值',
    );
    const tools = app.runtime.use(toolService),
      id = 'typed-legacy__typed_probe';
    expect(tools.catalog?.('group:1').some((t) => t.id === id)).toBe(true);
    expect(
      await tools.execute(
        {
          chatKey: 'group:1',
          settings: app.runtime.use(configService).effective('group:1'),
          sent: 0,
          trace() {},
          run: {
            id: 'typed-test',
            revision: 0,
            deadline: Infinity,
            signal: new AbortController().signal,
            assertActive() {},
          },
        },
        id,
        '{}',
      ),
    ).toMatchObject({ content: '可调用' });
    expect(host.list().find((item) => item.id === 'typed-legacy')?.type).toBe(type);
  },
);
test('迁移胶囊适配配置、能力、局部动态导入，热重载实例状态隔离', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/example'),
    target = path.join(root, 'extensions/plugins/example');
  fs.mkdirSync(source, { recursive: true });
  const manifest = {
    id: 'example',
    name: '迁移示例',
    settings: { suffix: '默认' },
    configSchema: { suffix: { type: 'string' } },
    entry: 'index.js',
  };
  fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(source, 'helper.js'), 'export const value="子模块";');
  fs.writeFileSync(
    path.join(source, 'index.js'),
    'import {getConfig,DATA_DIR} from "../../src/config.js";const helper=await import(`./helper.js?t=${Date.now()}`);let api;let count=0;export function setup(a){api=a;}export const providers={"example.inspect":()=>({count:++count,persona:getConfig().persona.botName,suffix:api.config().suffix,helper:helper.value,dataDir:DATA_DIR})};',
  );
  const result = await compileLegacyPackage(source, target);
  expect(result.modules).toEqual(['config']);
  fs.writeFileSync(
    path.join(target, 'plugin.json'),
    JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
  );
  const app = await createApplication({
    dataDir: path.join(root, 'data'),
    v2ExtensionDir: path.join(root, 'extensions'),
    extensionHotReload: false,
  });
  cleanups.push(app.stop);
  const host = app.runtime.use(extensionService);
  const inspect = () =>
    host.raw().skillManager.getCapabilityProviders('example.inspect', {})[0].fn();
  expect(inspect()).toMatchObject({
    count: 1,
    suffix: '默认',
    helper: '子模块',
    dataDir: path.join(root, 'data'),
  });
  await host.configure('example', { settings: { suffix: '已改' } });
  expect(inspect()).toMatchObject({ count: 1, suffix: '已改' });
  await host.reload();
  expect(inspect()).toMatchObject({ count: 1, suffix: '已改' });
  expect(app.runtime.use(configService).get().profiles).toEqual({});
});
test('未知私有宿主依赖明确拒绝，旧源码保持原样', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/unknown');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ id: 'unknown' }));
  const original =
    'import {secret} from "../../src/unknown-host.js";export const providers={test:()=>secret};';
  fs.writeFileSync(path.join(source, 'index.js'), original);
  await expect(compileLegacyPackage(source, path.join(root, 'new'))).rejects.toThrow(
    '需要公开服务适配',
  );
  expect(fs.readFileSync(path.join(source, 'index.js'), 'utf8')).toBe(original);
});

test('未知动态模块路径不能被误记为迁移成功', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/dynamic');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ id: 'dynamic' }));
  fs.writeFileSync(
    path.join(source, 'index.js'),
    'const file=process.env.UNKNOWN_MODULE;export const providers={probe:()=>import(file)};',
  );
  await expect(compileLegacyPackage(source, path.join(root, 'new'))).rejects.toThrow(
    '尚未适配的动态模块路径',
  );
});
test('纯工具算法在真实 Node ESM 进程可用，不能依赖测试运行器提供 require', () => {
  const module = new URL('../packages/legacy-core/generated/runtime.mjs', import.meta.url).href;
  const code = `import {createCoreUtilities} from ${JSON.stringify(module)};const u=createCoreUtilities({config:()=>({}),fetch:()=>{throw new Error('禁止联网')},safeFetch:async(url)=>({url,body:'mock-only'})});console.log(JSON.stringify(await u.web.webFetch('https://fixture.invalid')));`;
  expect(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  ).toContain('mock-only');
});
const commandSource = fileURLToPath(
  new URL('../../backup/source/plugins/ccb-command/', import.meta.url),
);
test('迁移包重载等待异步关闭，失败保留旧工具及旧入站拦截，成功后切换新实例', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/stale'),
    target = path.join(root, 'extensions/plugins/stale');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'plugin.json'),
    JSON.stringify({ id: 'stale', settings: {}, configSchema: {} }),
  );
  const write = (version: string, fail = false) =>
    fs.writeFileSync(
      path.join(source, 'index.js'),
      `import fs from 'node:fs';import path from 'node:path';import {DATA_DIR} from '../../src/config.js';import {Orchestrator} from '../../src/orchestrator.js';const versionLabel=${JSON.stringify(version)};setInterval(()=>fs.appendFileSync(path.join(DATA_DIR,'timer.txt'),versionLabel+' '),5);let api;const original=Orchestrator.prototype.onIncoming;export function setup(a){api=a;a.registerTool({id:'probe',name:'重载测试',parameters:{type:'object',properties:{}},execute:async()=>({content:${JSON.stringify(version)}})});${version === 'new' ? "if(!fs.existsSync(path.join(DATA_DIR,'closed.txt')))throw new Error('未等待异步关闭');" : ''}${fail ? "throw new Error('fixture setup failure');" : ''}}export function activate(){Orchestrator.prototype.onIncoming=function(key){void this.sender.sendTextBatch(key,[${JSON.stringify(version)}]);};}export async function deactivate(){await new Promise(resolve=>setTimeout(resolve,15));fs.writeFileSync(path.join(DATA_DIR,'closed.txt'),'closed');Orchestrator.prototype.onIncoming=original;}`,
    );
  write('old');
  await compileLegacyPackage(source, target);
  fs.writeFileSync(
    path.join(target, 'plugin.json'),
    JSON.stringify({ id: 'stale', entry: 'harness-entry.mjs', settings: {}, configSchema: {} }),
  );
  const app = await createApplication({
    dataDir: path.join(root, 'data'),
    v2ExtensionDir: path.join(root, 'extensions'),
    v2Managers: false,
    extensionHotReload: false,
  });
  cleanups.push(app.stop);
  const host = app.runtime.use(extensionService),
    tools = app.runtime.use(toolService),
    adapter = app.runtime.use(adapterService);
  const c: ToolContext = {
    chatKey: 'group:1',
    settings: app.runtime.use(configService).effective('group:1'),
    sent: 0,
    trace() {},
    run: {
      id: 'stale-test',
      revision: 0,
      deadline: Infinity,
      signal: new AbortController().signal,
      assertActive() {},
    },
  };
  expect(await tools.execute(c, 'stale__probe', '{}')).toMatchObject({ content: 'old' });
  write('broken', true);
  await compileLegacyPackage(source, target);
  await host.reload();
  expect(await tools.execute(c, 'stale__probe', '{}')).toMatchObject({ content: 'old' });
  await app.runtime.use(conversationService).ingest({
    id: 'stale-command',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试',
    text: '指令',
    atMe: false,
    timestamp: Date.now(),
  });
  expect(adapter.sent![0]!.text).toBe('old');
  fs.rmSync(path.join(root, 'data/closed.txt'));
  write('new');
  await compileLegacyPackage(source, target);
  await host.reload();
  expect(await tools.execute(c, 'stale__probe', '{}')).toMatchObject({ content: 'new' });
  fs.writeFileSync(path.join(root, 'data/timer.txt'), '');
  await new Promise((resolve) => setTimeout(resolve, 25));
  const timers = fs.readFileSync(path.join(root, 'data/timer.txt'), 'utf8');
  expect(timers).toContain('new');
  expect(timers).not.toContain('old');
  expect(timers).not.toContain('broken');
});
test.skipIf(!fs.existsSync(commandSource))(
  '真实旧 CCB 包经公共入站点在触发判定前执行，发送绑定运行、停用后无残留',
  async () => {
    const root = fixture(),
      target = path.join(root, 'extensions/plugins/ccb-command'),
      manifest = JSON.parse(fs.readFileSync(path.join(commandSource, 'plugin.json'), 'utf8'));
    await compileLegacyPackage(commandSource, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      extensionHotReload: false,
      v2Managers: false,
    });
    cleanups.push(app.stop);
    const host = app.runtime.use(extensionService);
    await host.configure('ccb-command', {
      enabled: true,
      settings: { pregnantChance: 0, explodeChance: 0, cooldownSec: 0 },
    });
    expect(host.list().find((row) => row.id === 'ccb-command')).toMatchObject({
      enabled: true,
      active: true,
    });
    const storage = app.runtime.use(storageService),
      adapter = app.runtime.use(adapterService);
    const message = (id: string) => ({
      id,
      chatKey: 'group:1',
      senderId: '2',
      senderName: '测试',
      text: '/ccb @测试成员',
      atMe: false,
      timestamp: Date.now(),
    });
    await app.runtime.use(conversationService).ingest(message('command-1'));
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent![0]!.text).toContain("你和'测试成员'");
    expect(storage.unread('group:1')).toHaveLength(0);
    expect(app.runtime.listRuns().filter((r) => r.mode === 'agent.basic')).toHaveLength(0);
    expect(
      app.runtime
        .listRuns()
        .some((r) => r.mode === 'extension.ingress' && r.status === 'completed'),
    ).toBe(true);
    await host.configure('ccb-command', { enabled: false });
    await app.runtime.use(conversationService).ingest(message('command-2'));
    expect(adapter.sent).toHaveLength(1);
  },
);
test.skipIf(!fs.existsSync(commandSource))(
  '旧 auto-finish 与 at-mention 接入真实模型循环及出站转换，停用后恢复原行为',
  async () => {
    const root = fixture();
    for (const id of ['auto-finish', 'at-mention']) {
      const source = path.resolve(commandSource, '..', id),
        target = path.join(root, 'extensions/plugins', id),
        manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
      await compileLegacyPackage(source, target);
      fs.writeFileSync(
        path.join(target, 'plugin.json'),
        JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
      );
    }
    let calls = 0;
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: {
        acceptAllSessions: true,
        defaults: { wakeDelayMs: 0 },
        send: { minIntervalMs: 0, dedupeMs: 0 },
        legacyGlobal: {
          skills: { 'auto-finish': { enabled: true }, 'at-mention': { enabled: true } },
        },
      },
    });
    cleanups.push(app.stop);
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(async () => {
      calls++;
      const name = calls === 3 ? 'finish' : 'send_message',
        args = calls === 3 ? { mode: 'spoken' } : { messages: ['@测试成员 你好'] };
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: String(calls),
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        usage: { input: 1, output: 1 },
      };
    });
    const host = app.runtime.use(extensionService),
      storage = app.runtime.use(storageService),
      adapter = app.runtime.use(adapterService);
    const ingest = (id: string) =>
      app.runtime.use(conversationService).ingest({
        id,
        chatKey: 'group:1',
        senderId: '2',
        senderName: '测试成员',
        text: '测试',
        atMe: true,
        timestamp: Date.now(),
      });
    const wait = async (count: number) => {
      const end = Date.now() + 3000;
      while (storage.archives().length < count && Date.now() < end)
        await new Promise((r) => setTimeout(r, 5));
      expect(storage.archives()).toHaveLength(count);
    };
    await ingest('first');
    await wait(1);
    expect(calls).toBe(1);
    expect(adapter.sent).toHaveLength(1);
    expect(JSON.parse(adapter.sent![0]!.text)).toMatchObject({
      segments: [
        { type: 'at', data: { qq: '2' } },
        { type: 'text', data: { text: expect.stringContaining('你好') } },
      ],
    });
    await host.configure('auto-finish', { enabled: false });
    await host.configure('at-mention', { enabled: false });
    await ingest('second');
    await wait(2);
    expect(calls).toBe(3);
    expect(adapter.sent![1]!.text).toBe('@测试成员 你好');
  },
);
test.skipIf(!fs.existsSync(commandSource))(
  '旧 member-aliases 的修改、匹配、重启及提示词尾部注入保持行为',
  async () => {
    const root = fixture(),
      source = path.resolve(commandSource, '../member-aliases'),
      target = path.join(root, 'extensions/plugins/member-aliases'),
      manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
    await compileLegacyPackage(source, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const options = {
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: { acceptAllSessions: true, defaults: { wakeDelayMs: 0 } },
    };
    const app = await createApplication(options);
    cleanups.push(app.stop);
    const host = app.runtime.use(extensionService);
    await host.configure('member-aliases', { enabled: true });
    expect(
      host.capability(
        'member.alias-set',
        { uid: '2', aliases: ['测试外号'], mode: 'set' },
        'group:1',
      ),
    ).toMatchObject({ ok: true });
    expect(
      host.capability('member.alias-match', { text: '测试外号来了', alias: '测试外号' }, 'group:1'),
    ).toMatchObject({ hit: true });
    let captured: unknown[] = [];
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(async (messages) => {
      captured = structuredClone(messages);
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'end',
              type: 'function',
              function: {
                name: 'finish',
                arguments: '{"mode":"silent","silentReason":"仅验证称呼提示"}',
              },
            },
          ],
        },
        usage: { input: 0, output: 0 },
      };
    });
    await app.runtime.use(conversationService).ingest({
      id: 'alias-test',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '群友',
      text: '测试外号来了',
      atMe: true,
      timestamp: Date.now(),
    });
    const until = Date.now() + 3000;
    while (!captured.length && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
    expect(JSON.stringify(captured)).toContain('【称呼对照】');
    expect((captured[0] as any).content).not.toContain('【称呼对照】');
    await app.stop();
    const next = await createApplication(options);
    cleanups.push(next.stop);
    expect(
      next.runtime.use(extensionService).capability('member.alias-list', { uid: '2' }, 'group:1'),
    ).toMatchObject({ aliases: ['测试外号'] });
  },
);
test.skipIf(!fs.existsSync(commandSource))('关键词剥离 @ 与引用块使用同输入对照旧纯函数', () => {
  const file = path.resolve(commandSource, '../../src/prompt.js'),
    source = fs.readFileSync(file, 'utf8'),
    ast = parseSync(file, source).program;
  const functions = (ast.body as any[])
    .map((node) => (node.type === 'ExportNamedDeclaration' ? node.declaration : node))
    .filter(
      (node) =>
        node?.type === 'FunctionDeclaration' &&
        ['stripMentions', 'stripReplyBlocks'].includes(node.id.name),
    );
  const old = new Function(
    functions.map((node) => source.slice(node.start, node.end)).join('\n') +
      ';return stripMentions;',
  )() as typeof stripMentions;
  for (const input of [
    undefined,
    {},
    { text: '你好 @摸鱼群友 正文' },
    { text: '[引用 A：[图片] 吃鱼] 真实正文' },
    { text: '@名字(QQ:123) 正文', atNames: ['@名字(QQ:123)'] },
    { text: '[CQ:at,qq=123] [引用未闭合' },
    { text: '[引用A] 中间 [引用B:[嵌套]] 结尾' },
  ])
    expect(stripMentions(input as any)).toBe(old(input as any));
});

test('迁移实例的 globalThis 和可选链数据路径彼此隔离', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/globals');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ id: 'globals' }));
  fs.writeFileSync(
    path.join(source, 'index.js'),
    'globalThis.__harnessIsolation=(globalThis.__harnessIsolation||0)+1;export const providers={"globals.probe":()=>({count:globalThis.__harnessIsolation,data:process.env?.QQ_AGENT_DATA_DIR,dir:import.meta.dirname})};',
  );
  for (const n of ['a', 'b']) {
    const target = path.join(root, n, 'extensions/plugins/globals');
    await compileLegacyPackage(source, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ id: 'globals', entry: 'harness-entry.mjs' }),
    );
    const app = await createApplication({
      dataDir: path.join(root, n, 'data'),
      v2ExtensionDir: path.join(root, n, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
    });
    cleanups.push(app.stop);
    expect(app.runtime.use(extensionService).capability('globals.probe', {})).toEqual({
      count: 1,
      data: path.join(root, n, 'data'),
      dir: target,
    });
  }
  expect((globalThis as any).__harnessIsolation).toBeUndefined();
});

test('停用清理顶层定时器和网络，阻止迟到发送；重新启用及继承恢复创建新实例', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/lifetime'),
    target = path.join(root, 'extensions/chat-plugins/lifetime');
  fs.mkdirSync(source, { recursive: true });
  const manifest = { id: 'lifetime', name: '生命周期', enabledByDefault: false, scope: 'session' };
  fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(source, 'index.js'),
    `import fs from 'node:fs';import path from 'node:path';import {DATA_DIR} from '../../src/config.js';import {chatCompletion} from '../../src/llm.js';let ticks=0;setInterval(()=>{ticks++;fs.writeFileSync(path.join(DATA_DIR,'ticks.txt'),String(ticks));},5);export const providers={'lifetime.ticks':()=>ticks};export function activate(){void fetch('https://fixture.invalid/owned').catch(()=>{});}export function setup(api){api.registerTool({id:'late',name:'延后发言',parameters:{type:'object',properties:{}},execute:async ctx=>{await chatCompletion({messages:[{role:'user',content:'fixture'}]});return ctx.sender.sendTextBatch(ctx.chatKey,['迟到结果']);}});}`,
  );
  await compileLegacyPackage(source, target);
  fs.writeFileSync(
    path.join(target, 'plugin.json'),
    JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
  );
  const signals: AbortSignal[] = [];
  const app = await createApplication({
    dataDir: path.join(root, 'data'),
    v2ExtensionDir: path.join(root, 'extensions'),
    v2Managers: false,
    extensionHotReload: false,
    extensionFetch: async (_url, init) => {
      const signal = init!.signal!;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  cleanups.push(app.stop);
  const host = app.runtime.use(extensionService),
    file = path.join(root, 'data/ticks.txt'),
    wait = () => new Promise((r) => setTimeout(r, 35));
  await wait();
  expect(fs.existsSync(file)).toBe(false);
  expect(signals).toHaveLength(0);
  await host.configure('lifetime', { enabled: true });
  await wait();
  expect(fs.existsSync(file), JSON.stringify(host.list())).toBe(true);
  expect(Number(fs.readFileSync(file, 'utf8'))).toBeGreaterThan(0);
  expect(signals).toHaveLength(1);
  let complete!: (value: any) => void;
  const model = vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const c: ToolContext = {
    chatKey: 'group:1',
    settings: app.runtime.use(configService).effective('group:1'),
    sent: 0,
    trace() {},
    run: {
      id: 'late-test',
      revision: 0,
      deadline: Infinity,
      signal: new AbortController().signal,
      assertActive() {},
    },
  };
  const pending = app.runtime.use(toolService).execute(c, 'lifetime__late', '{}');
  while (!complete) await new Promise((r) => setTimeout(r, 1));
  await host.configure('lifetime', { enabled: false });
  expect(signals[0]!.aborted).toBe(true);
  const stopped = fs.readFileSync(file, 'utf8');
  await wait();
  expect(fs.readFileSync(file, 'utf8')).toBe(stopped);
  complete({ message: { role: 'assistant', content: 'fixture' }, usage: { input: 1, output: 1 } });
  expect(await pending).toMatchObject({ error: expect.stringMatching(/停用|取消/) });
  expect(
    app.runtime
      .listRuns()
      .some((r) => r.mode === 'extension.operation' && r.status === 'cancelled'),
  ).toBe(true);
  expect(app.runtime.use(adapterService).sent).toHaveLength(0);
  model.mockRestore();
  await host.configure('lifetime', { enabled: true }, 'group:1');
  await wait();
  expect(signals).toHaveLength(2);
  expect(signals[1]!.aborted).toBe(false);
  await host.clearSettings('lifetime', 'group:1');
  expect(signals[1]!.aborted).toBe(true);
  const reset = fs.readFileSync(file, 'utf8');
  await wait();
  expect(fs.readFileSync(file, 'utf8')).toBe(reset);
  await host.configure('lifetime', { enabled: true });
  await wait();
  expect(signals).toHaveLength(3);
  expect(signals[2]!.aborted).toBe(false);
});
test('旧辅助模型调用保留输出预算、温度、思考关闭、显式模型和每会话转换器作用域', async () => {
  const root = fixture(),
    source = path.join(root, 'old/plugins/aux'),
    target = path.join(root, 'extensions/plugins/aux');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ id: 'aux' }));
  fs.writeFileSync(
    path.join(source, 'index.js'),
    'import {chatCompletion} from "../../src/llm.js";import {OneBotClient} from "../../src/onebot.js";export const providers={"aux.ask":()=>chatCompletion({messages:[{role:"user",content:"仅测试"}],temperature:0,maxTokens:8,overrides:{model:"judge-fixture"},skillContext:{thinkingMode:"off"}}),"llm.request-params":async({body,context})=>{await new OneBotClient().call("set_input_status",{user_id:"12345",event_type:1});return {...body,scope:context.chatKey};}};',
  );
  await compileLegacyPackage(source, target);
  fs.writeFileSync(
    path.join(target, 'plugin.json'),
    JSON.stringify({ id: 'aux', entry: 'harness-entry.mjs' }),
  );
  const snow = await mockSnowluma();
  cleanups.push(snow.close);
  const requests: any[] = [];
  snow.actions.set('v1/chat/completions', ({ args }) => {
    requests.push(args);
    return {
      body: {
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, prompt_cache_hit_tokens: 1 },
      },
    };
  });
  const app = await createApplication({
    dataDir: path.join(root, 'data'),
    demo: false,
    v2ExtensionDir: path.join(root, 'extensions'),
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      model: {
        ...snow.config,
        baseUrl: snow.config.httpUrl + '/v1',
        model: 'chat-fixture',
        apiKey: 'mock-key',
        retries: 0,
      },
      onebot: snow.config,
      acceptAllSessions: true,
      defaults: { legacySession: { api: { visionModel: 'different-vision' } } },
    },
  });
  cleanups.push(app.stop);
  const host = app.runtime.use(extensionService) as ExtensionHost;
  app.runtime.install({
    id: 'aux-parent',
    setup(ctx) {
      ctx.mode({
        id: 'aux-parent',
        input: { parse: () => ({}) },
        execute: async (run) => {
          const tool: ToolContext = {
            run,
            chatKey: 'private:12345',
            settings: app.runtime.use(configService).effective('private:12345'),
            sent: 0,
            trace() {},
          };
          return host.withTool(tool, () => host.capability('aux.ask', {}, tool.chatKey));
        },
      });
    },
  });
  await app.runtime.start();
  const parent = app.runtime.submit({
      mode: 'aux-parent',
      partitionKey: 'private:12345',
      input: {},
    }),
    completed = await app.runtime.wait(parent.id);
  expect(completed.status).toBe('completed');
  const result = completed.result;
  expect(result).toMatchObject({
    finishReason: 'length',
    usage: { prompt_tokens: 3, completion_tokens: 2, prompt_cache_hit_tokens: 1 },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    model: 'judge-fixture',
    temperature: 0,
    max_tokens: 8,
    enable_thinking: false,
    scope: 'private:12345',
  });
  const auxiliary = app.runtime
    .use(storageService)
    .archives()
    .find((a) => a.mode === 'extension.operation');
  expect(auxiliary?.usage).toMatchObject({ input: 3, output: 2, extra: { cached_tokens: 1 } });
  expect(auxiliary?.sent).toBe(0);
  expect(snow.calls.filter((c) => c.action === 'set_input_status')).toHaveLength(1);
});
test.skipIf(!fs.existsSync(commandSource))(
  '旧今日用量从新档案统计，主人访问生效且非主人拒绝',
  async () => {
    const root = fixture(),
      source = path.resolve(commandSource, '../../skills/usage-report'),
      target = path.join(root, 'extensions/skills/usage-report'),
      manifest = JSON.parse(fs.readFileSync(path.join(source, 'skill.json'), 'utf8'));
    await compileLegacyPackage(source, target);
    fs.writeFileSync(
      path.join(target, 'skill.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: {
        acceptAllSessions: true,
        legacyGlobal: { skills: { 'owner-identity': { ids: '12345' } } },
      },
    });
    cleanups.push(app.stop);
    await app.runtime.use(extensionService).configure('usage-report', { enabled: true });
    app.runtime.use(storageService).archive({
      id: 'recorded',
      chatKey: 'group:1',
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      status: 'completed',
      sent: 0,
      trace: [],
      usage: { input: 100, output: 20, extra: { cached_tokens: 10 } },
    });
    const context = (chatKey: string): ToolContext => ({
      chatKey,
      settings: app.runtime.use(configService).effective(chatKey),
      sent: 0,
      trace() {},
      run: {
        id: 'usage-test',
        revision: 0,
        deadline: Infinity,
        signal: new AbortController().signal,
        assertActive() {},
      },
    });
    const allowed = await app.runtime
      .use(toolService)
      .execute(context('private:12345'), 'usage-report__today', '{}');
    expect((allowed as any).isError).not.toBe(true);
    expect(JSON.stringify(allowed)).toContain('120');
    expect(
      await app.runtime
        .use(toolService)
        .execute(context('private:99999'), 'usage-report__today', '{}'),
    ).toMatchObject({ isError: true });
  },
);

test.skipIf(!fs.existsSync(commandSource))(
  '旧头像技能恢复账号身份、多模态预览及三种图片来源；修改通过 outbound 留档',
  async () => {
    const root = fixture(),
      source = path.resolve(commandSource, '../../skills/self-avatar'),
      target = path.join(root, 'extensions/skills/self-avatar'),
      manifest = JSON.parse(fs.readFileSync(path.join(source, 'skill.json'), 'utf8'));
    const compiled = await compileLegacyPackage(source, target);
    expect(compiled.modules).toEqual(['safe-fetch', 'sticker-manager']);
    fs.writeFileSync(
      path.join(target, 'skill.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#db3029' },
    })
      .png()
      .toBuffer();
    const fetch = vi.fn(
      async () => new Response(png, { headers: { 'content-type': 'image/png' } }),
    );
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      extensionFetch: fetch,
      media: { fetch },
      initialConfig: { acceptAllSessions: true, send: { minIntervalMs: 0, dedupeMs: 0 } },
    });
    cleanups.push(app.stop);
    const host = app.runtime.use(extensionService),
      storage = app.runtime.use(storageService),
      adapter = app.runtime.use(adapterService),
      tools = app.runtime.use(toolService);
    await host.configure('self-avatar', { enabled: true });
    vi.spyOn(adapter, 'query').mockImplementation(async (action) =>
      action === 'fetch_custom_face_detail'
        ? [{ emoji_id: 'face-avatar', url: 'https://fixture.invalid/sticker.png', desc: 'fixture' }]
        : {},
    );
    for (const [chatKey, id] of [
      ['group:1', '40001'],
      ['group:2', '40002'],
    ])
      storage.append({
        id: id!,
        chatKey: chatKey!,
        senderId: '2',
        senderName: '测试',
        text: '把这张图做头像',
        atMe: false,
        timestamp: Date.now(),
        metadata: {
          segments: [{ type: 'image', data: { file: 'base64://' + png.toString('base64') } }],
        },
      });
    const c: ToolContext = {
      chatKey: 'group:1',
      settings: app.runtime.use(configService).effective('group:1'),
      sent: 0,
      trace() {},
      run: {
        id: 'avatar-test',
        revision: 0,
        deadline: Infinity,
        signal: new AbortController().signal,
        assertActive() {},
      },
    };
    const call = (name: string, args: unknown) =>
      tools.execute(c, 'self-avatar__' + name, JSON.stringify(args));
    expect(await call('view_avatar', { send: false })).toMatchObject({
      content: [{ type: 'text' }, { type: 'image_url' }],
    });
    expect(adapter.sent).toHaveLength(0);
    expect(fetch.mock.calls.length).toBe(1);
    expect(await call('set_avatar', { messageId: '40002' })).toMatchObject({ isError: true });
    expect(adapter.sent).toHaveLength(0);
    for (const args of [
      { messageId: '40001' },
      { imageUrl: 'https://fixture.invalid/avatar.png' },
      { stickerId: 'face-avatar' },
    ])
      expect(await call('set_avatar', args)).toMatchObject({
        content: expect.stringContaining('QQ 接口已接受'),
      });
    expect(adapter.sent).toHaveLength(3);
    expect(c.sent).toBe(0);
    expect(storage.messages('group:1').filter((m) => m.self)).toHaveLength(0);
    expect(await tools.execute(c, 'finish', '{"mode":"spoken"}')).toMatchObject({ isError: true });
    for (const sent of adapter.sent!) {
      const payload = JSON.parse(sent.text);
      expect(payload.profileImage).toMatch(/^base64:\/\//);
      expect(
        (await sharp(Buffer.from(payload.profileImage.slice(9), 'base64')).metadata()).format,
      ).toBe('jpeg');
    }
    await host.configure('self-avatar', { settings: { allowAvatarChange: false } });
    expect(await call('set_avatar', { messageId: '40001' })).toMatchObject({
      isError: true,
      content: expect.stringContaining('关闭'),
    });
    expect(adapter.sent).toHaveLength(3);
  },
);

test.skipIf(!fs.existsSync(commandSource))(
  '旧响应钩子得到完整响应和会话，消息被顶掉后自动引用原目标；详细思考进入轨迹',
  async () => {
    const root = fixture();
    for (const id of ['quote-target', 'detailed-thinking']) {
      const source = path.resolve(commandSource, '..', id),
        target = path.join(root, 'extensions/plugins', id),
        manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
      await compileLegacyPackage(source, target);
      fs.writeFileSync(
        path.join(target, 'plugin.json'),
        JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
      );
    }
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: {
        acceptAllSessions: true,
        defaults: { wakeDelayMs: 0, maxRounds: 5 },
        send: { minIntervalMs: 0, dedupeMs: 0 },
      },
    });
    cleanups.push(app.stop);
    const storage = app.runtime.use(storageService);
    for (const id of ['quote-target', 'detailed-thinking'])
      await app.runtime.use(extensionService).configure(id, { enabled: true });
    let calls = 0;
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(async () => {
      calls++;
      if (calls === 1)
        storage.append({
          id: '40002',
          chatKey: 'group:1',
          senderId: '3',
          senderName: '乙',
          text: '此时插入新消息',
          atMe: false,
          timestamp: Date.now(),
        });
      return {
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: 'fixture reasoning only',
          tool_calls: [
            {
              id: String(calls),
              type: 'function',
              function: {
                name: calls === 1 ? 'send_message' : 'finish',
                arguments: JSON.stringify(
                  calls === 1 ? { messages: ['回复甲的消息'] } : { mode: 'spoken' },
                ),
              },
            },
          ],
        },
        usage: { input: 1, output: 1 },
      };
    });
    await app.runtime.use(conversationService).ingest({
      id: '40001',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '甲',
      text: '请回答',
      atMe: true,
      timestamp: Date.now(),
    });
    const until = Date.now() + 4000;
    while (!storage.archives().length && Date.now() < until)
      await new Promise((r) => setTimeout(r, 5));
    expect(storage.archives()).toHaveLength(1);
    const sent = app.runtime.use(adapterService).sent!;
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.text).segments).toContainEqual({
      type: 'reply',
      data: { id: '40001' },
    });
    const payload = app.runtime.use(traceService).get(storage.archives()[0]!.id);
    expect(
      payload?.events
        .filter((e) => e.title === '扩展运行记录')
        .map((e) => JSON.stringify(e.data))
        .join('\n'),
    ).toContain('【深度思考】');
  },
);

test.skipIf(!fs.existsSync(commandSource))(
  '旧引用规范通过真实 before-tool 拦截，原始参数仍为 JSON 字符串且轮次正确',
  async () => {
    const root = fixture(),
      source = path.resolve(commandSource, '../quote-reply'),
      target = path.join(root, 'extensions/plugins/quote-reply'),
      manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
    await compileLegacyPackage(source, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: {
        acceptAllSessions: true,
        defaults: { wakeDelayMs: 0, maxRounds: 6 },
        send: { minIntervalMs: 0, dedupeMs: 0 },
        legacyGlobal: { skills: { 'quote-reply': { enabled: true, requireQuote: true } } },
      },
    });
    cleanups.push(app.stop);
    const inputs: any[] = [];
    let calls = 0;
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(async (messages) => {
      inputs.push(structuredClone(messages));
      calls++;
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: String(calls),
              type: 'function',
              function: {
                name: calls === 3 ? 'finish' : 'send_message',
                arguments: JSON.stringify(
                  calls === 3
                    ? { mode: 'spoken' }
                    : {
                        messages: ['带引用的回复'],
                        ...(calls === 2 ? { replyToMessageId: 40001 } : {}),
                      },
                ),
              },
            },
          ],
        },
        usage: { input: 1, output: 1 },
      };
    });
    await app.runtime.use(conversationService).ingest({
      id: '40001',
      chatKey: 'group:1',
      senderId: '2',
      senderName: '甲',
      text: '请回复',
      atMe: true,
      timestamp: Date.now(),
    });
    const storage = app.runtime.use(storageService),
      until = Date.now() + 4000;
    while (!storage.archives().length && Date.now() < until)
      await new Promise((r) => setTimeout(r, 5));
    expect(storage.archives()).toHaveLength(1);
    expect(calls).toBe(3);
    expect(JSON.stringify(inputs[1])).toContain('引用');
    expect(app.runtime.use(adapterService).sent).toHaveLength(1);
  },
);

test.skipIf(!fs.existsSync(commandSource))(
  '旧主人识别按真实触发号码切换人设，保留会话规则与提示词；历史和自称不能切换',
  async () => {
    const root = fixture(),
      source = path.resolve(commandSource, '../owner-identity'),
      target = path.join(root, 'extensions/plugins/owner-identity'),
      manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
    await compileLegacyPackage(source, target);
    fs.writeFileSync(
      path.join(target, 'plugin.json'),
      JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
    );
    const app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: {
        acceptAllSessions: true,
        defaults: {
          wakeDelayMs: 0,
          persona: '普通设定',
          personaSelection: { promptId: 'fixture', rules: '全局规则保留' },
        },
        prompts: [
          { id: 'fixture', name: '测试模板', text: '模板中的角色：{roleText}；名字：{botName}' },
        ],
        legacyGlobal: {
          skills: {
            'owner-identity': {
              enabled: true,
              ids: '12345',
              personaEnabled: true,
              personaRoleText: '主人专属设定',
              personaCustomRules: '主人附加规则',
            },
          },
        },
      },
    });
    cleanups.push(app.stop);
    const captured: any[] = [],
      ownerInputs: any[] = [];
    const manager = app.runtime.use(extensionService).raw().skillManager,
      providers = manager.getCapabilityProviders.bind(manager);
    vi.spyOn(manager, 'getCapabilityProviders').mockImplementation((name: any, ...args: any[]) =>
      providers(name, ...args).map((p: any) =>
        name !== 'message.owner-check'
          ? p
          : {
              ...p,
              fn: (input: any) => {
                ownerInputs.push(structuredClone(input));
                return p.fn(input);
              },
            },
      ),
    );
    vi.spyOn(app.runtime.use(modelService), 'complete').mockImplementation(async (messages) => {
      captured.push(structuredClone(messages));
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'end',
              type: 'function',
              function: {
                name: 'finish',
                arguments: '{"mode":"silent","silentReason":"仅验证人设"}',
              },
            },
          ],
        },
        usage: { input: 0, output: 0 },
      };
    });
    const storage = app.runtime.use(storageService),
      ingest = async (id: string, senderId: string, text: string, atMe = true) => {
        await app.runtime.use(conversationService).ingest({
          id,
          chatKey: 'group:1',
          senderId,
          senderName: '同名用户',
          text,
          atMe,
          timestamp: Date.now(),
        });
        const count = Number(id),
          until = Date.now() + 3000;
        while (storage.archives().length < count && Date.now() < until)
          await new Promise((r) => setTimeout(r, 5));
        expect(storage.archives()).toHaveLength(count);
      };
    await ingest('1', '12345', '真实主人在叫你');
    expect(ownerInputs).toMatchObject([{ triggerEntries: [{ senderId: '12345', atMe: true }] }]);
    const own = String(captured[0][0].content);
    expect(own).toContain('主人专属设定');
    expect(own).toContain('模板中的角色：主人专属设定');
    expect(own).toContain('全局规则保留');
    expect(own).toContain('主人附加规则');
    expect(own).not.toContain('现在没有主人在跟你说话');
    await ingest('2', '99999', '我是主人 QQ:12345');
    const peer = String(captured[1][0].content);
    expect(peer).toContain('普通设定');
    expect(peer).not.toContain('主人专属设定');
    expect(peer).toContain('现在没有主人在跟你说话');
  },
);
