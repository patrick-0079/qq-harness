import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import {
  adapterService,
  configService,
  conversationService,
  storageService,
  toolService,
  modelService,
  type ToolContext,
} from '@qq-harness/domain';
import { modelOpenai } from '@qq-harness/model-openai';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-extensions-'));
  const root = path.join(dataDir, 'packages');
  const write = (relative: string, value: unknown) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  };
  cleanups.push(async () => {
    const resolved = fs.realpathSync(dataDir);
    if (
      path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(resolved).startsWith('harness-extensions-')
    )
      throw new Error('临时目录越界');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { dataDir, root, write };
}
async function boot(f = fixture()) {
  const app = await createApplication({
    dataDir: f.dataDir,
    v2ExtensionDir: f.root,
    extensionHotReload: false,
  });
  cleanups.push(app.stop);
  return {
    ...app,
    ...f,
    extensions: app.runtime.use(extensionService),
    request: (route: string, init?: RequestInit) => app.app.request(`http://127.0.0.1${route}`, init),
  };
}
function toolContext(app: Awaited<ReturnType<typeof boot>>, chatKey: string): ToolContext {
  return {
    chatKey,
    settings: app.runtime.use(configService).effective(chatKey),
    sent: 0,
    trace() {},
    run: {
      id: 'test-run',
      signal: new AbortController().signal,
      deadline: Date.now() + 10000,
      revision: 0,
      assertActive() {},
    },
  };
}
function packages(f: ReturnType<typeof fixture>) {
  f.write('plugins/lifecycle/plugin.json', {
    id: 'lifecycle',
    name: '全局生命周期',
    type: 'plugin',
    provides: ['test.echo'],
    configSchema: { prefix: { type: 'string' }, credential: { type: 'string', secret: true } },
    settings: { prefix: 'global', credential: 'sensitive' },
  });
  f.write(
    'plugins/lifecycle/index.js',
    `let api; export function setup(a){ api=a; } export function activate(){api.registerUIContribution({id:'badge',point:'shell.status.right',payload:{type:'badge',text:'扩展就绪'}});api.registerUIAction({actionId:'echo',handler: args=>({text:api.config().prefix+args.text})});} export function deactivate(){} export const providers={'test.echo': input=>input};`,
  );
  f.write('chat-plugins/hooks/plugin.json', {
    id: 'hooks',
    type: 'plugin',
    name: '会话钩子',
    settings: { suffix: 'A' },
    configSchema: { suffix: { type: 'string' } },
  });
  f.write(
    'chat-plugins/hooks/index.js',
    `let api;const counts={};const count=n=>counts[n]=(counts[n]||0)+1;export function setup(a){api=a;}export const providers={'test.hook-counts':()=>counts};export const hooks={'before-context':ctx=>{count('before-context');ctx.triggerEntries[0].text += '-上下文';},'before-llm-messages':ctx=>{count('before-llm-messages');counts.promptIncluded=ctx.messages[0].content.includes('注入验证文本');ctx.messages[1].content += '-'+api.config().suffix;},'after-response':ctx=>{count('after-response');if(ctx.response.content)ctx.response.content+='-响应';},'before-tool':ctx=>{count('before-tool');if(ctx.args?.text?.includes('BLOCK'))return {block:true,reason:'测试拦截'};},'after-tool':ctx=>{count('after-tool');ctx.session.meta.after=(ctx.session.meta.after||0)+1;}};`,
  );
  f.write('tools/echo/tool.json', {
    id: 'echo',
    type: 'tool',
    name: '测试工具',
    settings: { prefix: 'default' },
    configSchema: { prefix: { type: 'string' } },
  });
  f.write(
    'tools/echo/index.js',
    `export function setup(api){api.registerTool({id:'say',name:'回显',description:'回显',parameters:{type:'object',properties:{}},execute:async(ctx,args)=>({content:api.config().prefix+':'+args.text,chatKey:ctx.chatKey})});}`,
  );
  f.write('tools/echo/docs/guide.md', '# 工具说明\n这是回显工具');
  f.write('skills/calculator/skill.json', {
    id: 'calculator',
    type: 'skill',
    name: '计算',
    scripts: ['run.js'],
  });
  f.write('skills/calculator/run.js', 'module.exports=async({args})=>({content:String(args.a+args.b)});');
  f.write('knowledge/manual/intro.md', '# 介绍\n这是文档正文，包含知识库测试内容。');
  f.write('promptinjects/suffix/promptinject.json', { id: 'suffix', type: 'promptinject', name: '后缀' });
  f.write(
    'promptinjects/suffix/inject.js',
    `export const meta={injects:[{id:'tail',kind:'append',at:'at-tail',priority:50}]};export function append(){return '注入验证文本';}`,
  );
}
test('七目录加载、描述符/文档/工具/页签和 SQLite 会话快照', async () => {
  const f = fixture();
  packages(f);
  const app = await boot(f);
  const ext = app.extensions;
  const raw = ext.raw();
  expect(ext.list().map((row) => row.id)).toEqual(
    expect.arrayContaining(['ext-tool', 'lifecycle', 'hooks', 'echo', 'calculator', 'manual', 'suffix']),
  );
  expect(raw.catalog.listExtensionTypes().map((tab: { label: string }) => tab.label)).toEqual([
    '全局插件',
    '会话插件',
    '工具',
    'MCP',
    '技能',
    '知识',
    '上下文',
  ]);
  expect((ext.readDoc('echo.guide') as { doc: { content: string } }).doc.content).toContain('回显');
  expect((ext.readDoc('manual/intro.md') as { doc: { content: string } }).doc.content).toContain('文档正文');
  await ext.configure('echo', { enabled: true, settings: { prefix: 'global' } });
  await ext.configure('echo', { enabled: true, settings: { prefix: 'chat-one' } }, 'group:1');
  await ext.configure('echo', { settings: { prefix: 'changed-global' } });
  expect(ext.list('group:1').find((row) => row.id === 'echo')?.settings.prefix).toBe('chat-one');
  expect(ext.list('group:2').find((row) => row.id === 'echo')?.settings.prefix).toBe('changed-global');
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .some((tool) => tool.function.name === 'echo__say'),
  ).toBe(true);
  expect(
    await app.runtime.use(toolService).execute(toolContext(app, 'group:1'), 'echo__say', '{"text":"hello"}'),
  ).toMatchObject({ content: 'chat-one:hello', chatKey: 'group:1' });
  expect(JSON.stringify(ext.list())).not.toContain('sensitive');
  await expect(ext.configure('lifecycle', { enabled: false }, 'group:1')).rejects.toThrow('全局');
  await expect(ext.configure('echo', { settings: { unknown: 'x' } })).rejects.toThrow('未知');
  await app.stop();
  const next = await boot(f);
  expect(next.extensions.list('group:1').find((row) => row.id === 'echo')?.settings.prefix).toBe('chat-one');
});
test('扩展能力由独立 Cordis 插件装配，裸宿主不扫描子扩展，卸载及重装回收所属资源', async () => {
  const f = fixture();
  packages(f);
  const bare = await createApplication({
    dataDir: f.dataDir,
    v2ExtensionDir: f.root,
    extensionHotReload: false,
    v2Managers: false,
  });
  cleanups.push(bare.stop);
  expect(
    bare.runtime
      .use(extensionService)
      .list()
      .some((row) => row.type === 'tool' || row.type === 'knowledge'),
  ).toBe(false);
  expect(bare.runtime.use(extensionService).tabs()).toEqual([]);
  await bare.stop();
  const app = await boot(f);
  for (const id of ['ext-tool', 'ext-mcp', 'ext-skill', 'ext-knowledge', 'ext-promptinject'])
    expect(app.runtime.listPlugins().find((plugin) => plugin.id === id)).toMatchObject({
      status: 'active',
      client: { entry: expect.stringMatching(/^builtin:v2-/) },
    });
  await app.extensions.configure('echo', { enabled: true });
  await app.runtime.setEnabled('ext-tool', false);
  expect(app.extensions.list().some((row) => row.id === 'echo')).toBe(false);
  expect(app.extensions.tabs().some((tab) => tab.id === 'tool')).toBe(false);
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .some((tool) => tool.function.name === 'echo__say'),
  ).toBe(false);
  expect(app.extensions.raw().docRegistry.read('echo.guide').ok).toBe(false);
  await app.runtime.setEnabled('ext-tool', true);
  expect(app.extensions.list().some((row) => row.id === 'echo')).toBe(true);
  expect(app.extensions.tabs().some((tab) => tab.id === 'tool')).toBe(true);
  await app.extensions.configure('ext-tool', { enabled: false });
  await app.stop();
  const next = await boot(f);
  expect(next.runtime.listPlugins().find((plugin) => plugin.id === 'ext-tool')?.status).toBe('disabled');
  expect(next.extensions.list().find((row) => row.id === 'ext-tool')?.enabled).toBe(false);
  expect(next.extensions.tabs().some((tab) => tab.id === 'tool')).toBe(false);
});
test('MCP HTTP 原生工具、shell 策略、富媒体结果与管理器卸载', async () => {
  const f = fixture();
  const called: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    called.push(body.method);
    if (body.id == null) {
      res.writeHead(202);
      res.end();
      return;
    }
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock', version: '1' },
          }
        : body.method === 'tools/list'
          ? {
              tools: [
                { name: 'get.data', inputSchema: { type: 'object', properties: {} } },
                { name: 'run_shell', inputSchema: { type: 'object', properties: {} } },
              ],
            }
          : {
              content: [
                { type: 'text', text: 'MCP ok' },
                { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
              ],
            };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  f.write('mcp/protocol/mcp.json', {
    id: 'protocol',
    transport: 'http',
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    timeoutMs: 1000,
  });
  const app = await boot(f);
  await app.extensions.configure('protocol', { enabled: true });
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .map((tool) => tool.function.name),
  ).toContain('protocol__get_data');
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .map((tool) => tool.function.name),
  ).not.toContain('protocol__run_shell');
  const result = await app.runtime
    .use(toolService)
    .execute(toolContext(app, 'group:1'), 'protocol__get_data', '{}');
  expect(result).toMatchObject({
    content: [
      { type: 'text', text: 'MCP ok\n[图片]' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
    ],
    isError: false,
  });
  expect(called).toEqual(expect.arrayContaining(['initialize', 'tools/list', 'tools/call']));
  await app.extensions.configure('ext-mcp', { enabled: false });
  expect(app.extensions.tabs().some((tab) => tab.id === 'mcp')).toBe(false);
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .some((tool) => tool.function.name.startsWith('protocol__')),
  ).toBe(false);
});
test('热重载更新入口、删除后工具/能力/界面贡献完全撤销', async () => {
  const f = fixture();
  packages(f);
  const app = await createApplication({
    dataDir: f.dataDir,
    v2ExtensionDir: f.root,
    extensionHotReload: true,
  });
  cleanups.push(app.stop);
  const ext = app.runtime.use(extensionService);
  f.write(
    'plugins/lifecycle/index.js',
    `export const providers={'test.echo':()=> 'changed'};export function setup(){};`,
  );
  for (let i = 0; ext.capability('test.echo', {}) !== 'changed' && i < 150; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(ext.capability('test.echo', {})).toBe('changed');
  const directory = path.resolve(f.root, 'plugins/lifecycle');
  if (path.dirname(directory) !== path.join(f.root, 'plugins')) throw new Error('目录越界');
  fs.rmSync(directory, { recursive: true });
  await ext.reload();
  expect(ext.list().some((row) => row.id === 'lifecycle')).toBe(false);
  expect(ext.capability('test.echo', {})).toBeUndefined();
  expect(ext.contributions('shell')).toHaveLength(0);
});
test('模型能力串行改写请求/响应/用量，拒绝参数只建议重试一次', async () => {
  const f = fixture();
  const requests: Record<string, unknown>[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    res.setHeader('content-type', 'application/json');
    if ('rejected' in body) {
      res.statusCode = 400;
      res.end('{"error":"rejected parameter"}');
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'original' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  f.write('plugins/model-hooks/plugin.json', { id: 'model-hooks', type: 'plugin' });
  f.write(
    'plugins/model-hooks/index.js',
    `export function setup(){};export const providers={'llm.request-params':({body})=>({...body,rejected:true,order:'one'}),'llm.retry-advisor':({body,status})=>{if(status===400){const {rejected,...next}=body;return {body:next};}},'llm.response':({result})=>({result:{...result,message:{...result.message,content:'transformed'}}}),'llm.usage':()=>({reasoningTokens:7})};`,
  );
  const app = await createApplication({
    dataDir: f.dataDir,
    v2ExtensionDir: f.root,
    extensionHotReload: false,
    initialConfig: {
      plugins: { 'model-mock': false },
      model: {
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        model: 'mock',
        apiKey: 'test',
        retries: 0,
      },
    },
    plugins: [modelOpenai],
  });
  cleanups.push(app.stop);
  expect(
    await app.runtime
      .use(modelService)
      .complete([{ role: 'user', content: 'test' }], [], new AbortController().signal),
  ).toEqual({
    message: { role: 'assistant', content: 'transformed' },
    usage: { input: 4, output: 2 },
    extraUsage: { reasoningTokens: 7 },
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ rejected: true, order: 'one' });
  expect(requests[1]).not.toHaveProperty('rejected');
});
test('五个旧钩子进入实际运行，开关隔离且发送仍通过出站队列', async () => {
  const f = fixture();
  packages(f);
  const app = await boot(f);
  const cfg = app.runtime.use(configService);
  cfg.patch({ defaults: { wakeDelayMs: 0 }, send: { minIntervalMs: 0 } });
  await app.extensions.configure('hooks', { enabled: true, settings: { suffix: 'B' } }, 'group:1');
  await app.extensions.configure('hooks', { enabled: false }, 'group:2');
  const ingest = app.runtime.use(conversationService).ingest;
  await ingest({
    id: 'one',
    chatKey: 'group:1',
    text: '你好',
    senderId: '3',
    senderName: '用户',
    atMe: true,
    timestamp: Date.now(),
  });
  for (let i = 0; app.runtime.use(storageService).archives().length < 1 && i < 200; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(app.runtime.use(adapterService).sent?.[0]?.text).toContain('你好-上下文-B');
  expect(app.runtime.use(storageService).archives()[0]?.status).toBe('completed');
  expect(app.extensions.capability('test.hook-counts', {}, 'group:1')).toMatchObject({
    'before-context': 1,
    'before-llm-messages': 1,
    'after-response': 1,
    'before-tool': 2,
    'after-tool': 2,
    promptIncluded: true,
  });
  await ingest({
    id: 'two',
    chatKey: 'group:2',
    text: '不变',
    senderId: '3',
    senderName: '用户',
    atMe: true,
    timestamp: Date.now(),
  });
  for (let i = 0; app.runtime.use(storageService).archives().length < 2 && i < 200; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(app.runtime.use(adapterService).sent?.[1]?.text).toBe('演示回复：用户: 不变');
  await ingest({
    id: 'three',
    chatKey: 'group:1',
    text: 'BLOCK',
    senderId: '3',
    senderName: '用户',
    atMe: true,
    timestamp: Date.now(),
  });
  for (let i = 0; app.runtime.use(storageService).archives().length < 3 && i < 200; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(app.runtime.use(adapterService).sent).toHaveLength(2);
});
test('旧发送 API 的批量文本、引用、媒体和会话绑定共用出站队列', async () => {
  const f = fixture();
  f.write('tools/media/tool.json', { id: 'media', type: 'tool' });
  f.write(
    'tools/media/index.js',
    `export function setup(api){api.registerTool({id:'send',name:'发送测试',parameters:{type:'object',properties:{}},execute:async(ctx,args)=>{await ctx.sender.sendTextBatch(ctx.chatKey,['一','二']);await ctx.sender.sendImage(ctx.chatKey,{dataUrl:'data:image/png;base64,aGVsbG8='},{replyToMessageId:'123'});try{await ctx.sender.sendTextBatch('group:9',['越界']);}catch(error){return {content:error.message};}}});}`,
  );
  const app = await boot(f);
  await app.extensions.configure('media', { enabled: true });
  const tool = toolContext(app, 'group:1');
  const result = await app.runtime.use(toolService).execute(tool, 'media__send', '{}');
  expect(result).toMatchObject({ content: expect.stringContaining('当前会话绑定') });
  expect(tool.sent).toBe(3);
  expect(app.runtime.use(storageService).messages('group:1')).toHaveLength(3);
  expect(app.runtime.use(storageService).messages('group:9')).toHaveLength(0);
  const sent = app.runtime.use(adapterService).sent!;
  expect(sent[0]?.text).toBe('一');
  expect(sent[1]?.text).toBe('二');
  expect(JSON.parse(sent[2]!.text)).toEqual({
    segments: [
      { type: 'reply', data: { id: '123' } },
      { type: 'image', data: { file: 'base64://aGVsbG8=' } },
    ],
  });
});
test('MCP stdio 初始化、工具执行与子进程回收', async () => {
  const f = fixture();
  f.write(
    'mcp/local/server.mjs',
    `import readline from 'node:readline';const rl=readline.createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id==null)return;const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'local',version:'1'}}:m.method==='tools/list'?{tools:[{name:'ping',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'pong'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`,
  );
  f.write('mcp/local/mcp.json', {
    id: 'local',
    transport: 'stdio',
    command: process.execPath,
    args: [path.join(f.root, 'mcp/local/server.mjs')],
    timeoutMs: 2000,
  });
  const app = await boot(f);
  await app.extensions.configure('local', { enabled: true });
  expect(
    await app.runtime.use(toolService).execute(toolContext(app, 'group:1'), 'local__ping', '{}'),
  ).toMatchObject({ content: 'pong' });
  await app.extensions.configure('ext-mcp', { enabled: false });
  expect(
    app.runtime
      .use(toolService)
      .list('group:1')
      .some((tool) => tool.function.name === 'local__ping'),
  ).toBe(false);
});
test('包导入预览不写盘、新装默认关闭、动作归属、路径防护和卸载', async () => {
  const f = fixture();
  packages(f);
  const app = await boot(f);
  const body = JSON.stringify({
    files: [
      { rel: 'new/tool.json', data: Buffer.from('{"id":"new","type":"tool"}').toString('base64') },
      { rel: 'new/index.js', data: Buffer.from('export function setup(){}').toString('base64') },
    ],
  });
  expect((await app.request('/api/extensions/import?dry=1', { method: 'POST', body })).status).toBe(200);
  expect(fs.existsSync(path.join(f.root, 'tools/new'))).toBe(false);
  expect((await app.request('/api/extensions/import', { method: 'POST', body })).status).toBe(200);
  expect(app.extensions.list().find((row) => row.id === 'new')?.enabled).toBe(false);
  expect((await app.request('/api/extensions/import', { method: 'POST', body })).status).toBe(409);
  const action = await app.request('/api/extensions/lifecycle/ui-actions/echo', {
    method: 'POST',
    body: '{"text":"!"}',
  });
  expect(await action.json()).toEqual({ ok: true, result: { text: 'global!' } });
  await app.extensions.configure('lifecycle', { enabled: false });
  expect(app.extensions.contributions('shell')).toHaveLength(0);
  expect(
    (await app.request('/api/extensions/lifecycle/ui-actions/echo', { method: 'POST', body: '{}' })).status,
  ).toBe(409);
  expect((await app.request('/api/extensions/knowledge/manual/file?relPath=../../escape.md')).status).toBe(
    409,
  );
  expect((await app.request('/api/extensions/tool/new', { method: 'DELETE' })).status).toBe(200);
  expect(app.extensions.list().some((row) => row.id === 'new')).toBe(false);
});
test('独立运行实例的注册表、能力与脚本不会串扰，容器失败不伪装成沙箱成功', async () => {
  const f = fixture();
  packages(f);
  const a = await boot(f);
  const b = await boot();
  expect(b.extensions.list().some((row) => row.id === 'lifecycle')).toBe(false);
  expect(b.extensions.capability('test.echo', { value: 1 })).toBeUndefined();
  expect(a.extensions.capability('test.echo', { value: 1 })).toEqual({ value: 1 });
  const result = (await a.extensions.runScript(
    { skillId: 'calculator', script: 'run.js', args: { a: 2, b: 3 } },
    'group:1',
  )) as { ok: boolean; result: unknown };
  expect(result.ok).toBe(true);
  expect(result.result).toEqual({ content: '5' });
  expect(
    (
      (await b.extensions.runScript({ skillId: 'calculator', script: 'run.js' }, 'group:1')) as {
        ok: boolean;
      }
    ).ok,
  ).toBe(false);
  a.extensions.raw().sandbox.registerContainerBackend({
    run: () => {
      throw new Error('container down');
    },
  });
  expect(await a.extensions.runScript({ skillId: 'calculator', script: 'run.js' }, 'group:1')).toMatchObject({
    ok: false,
    backend: 'container',
  });
});
