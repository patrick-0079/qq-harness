import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { parseSync } from 'rolldown/utils';
import { normalizeLegacyInstructions } from '../packages/extension-compat/src/instructions.js';

// Community packages stay in the operator's extension directory. This compiler only
// rewrites their host boundary; it never bundles the old application's host.
const exportsOf: Record<string, string[]> = {
  config: ['getConfig', 'getGlobalConfig', 'updateConfig', 'DATA_DIR'],
  onebot: ['OneBotClient'],
  sender: ['SendQueue'],
  store: ['ChatStore'],
  'web-search': ['webSearch'],
  'skills/config': [
    'getSkillConfig',
    'isSkillEnabledInConfig',
    'setSkillConfig',
    'setSkillEnabled',
    'listConfiguredSkillIds',
    'markSkillDefaultOff',
    'clearSkillDefaultOff',
    'isSkillForcedDefaultOff',
  ],
  'skills/manager': ['skillManager'],
  'tool-registry': [
    'registerTool',
    'unregisterTool',
    'unregisterToolsBySkill',
    'listTools',
    'getTool',
    'listToolsByCategory',
    'listCategories',
    'getToolAvailability',
    'listAvailableTools',
    'availabilityOf',
    'isToolEnabledLegacy',
    'CATEGORY_META',
    'skillErrorText',
  ],
  logger: ['logger'],
  llm: [
    'chatCompletion',
    'chatCompletionWithRetry',
    'estimateCost',
    'addUsage',
    'emptyUsage',
    'cacheHitRate',
    'isApiConfigured',
    'resolveApiKey',
    'resolveApiEndpoint',
    'isRetryableError',
    'listModels',
  ],
  orchestrator: ['Orchestrator'],
  'chat-profiles': ['isChatAdmittedById', 'isChatDenied', 'profiledChatKeys'],
  holidays: ['upcomingHoliday'],
  'model-prices': [
    'resolveModelPrice',
    'sumCostByTime',
    'priceAt',
    'isPeakHour',
    'vendorOfConfig',
    'PEAK_WINDOWS',
  ],
  util: ['normalizeMessageList', 'escapeCqText'],
  prompt: ['appendDynamicTail', 'stripMentions'],
  'safe-fetch': [
    'safeFetch',
    'safeFetchBinary',
    'validateFetchUrl',
    'validateImageUrl',
    'browseLockState',
    'checkBrowseLock',
  ],
  'gif-to-video': ['gifFirstFrameDataUrl', 'isGifBuffer'],
  'storage/session-files': ['listLegacyFiles', 'readIndexEntries', 'readSessionFull'],
  'plugin-loader': ['loadPlugins'],
  'sticker-manager': ['localStickerPath', 'StickerManager'],
  stickers: ['saveStickerStore'],
};
export const supportedPrivateModules = Object.keys(exportsOf);
export interface CompileResult {
  id: string;
  file: string;
  sha256: string;
  modules: string[];
  sourceHashes: Record<string, string>;
}
export async function compileLegacyPackage(sourceDir: string, targetDir: string): Promise<CompileResult> {
  const source = fs.realpathSync(sourceDir),
    target = path.resolve(targetDir);
  if (target === source || target.startsWith(source + path.sep)) throw new Error('迁移输出不能写入旧包目录');
  const manifestName = ['skill.json', 'plugin.json'].find((name) => fs.existsSync(path.join(source, name)));
  if (!manifestName) throw new Error('缺少插件或技能清单');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(source, manifestName), 'utf8').replace(/^\uFEFF/, ''),
  );
  const entry = path.resolve(source, manifest.entry || 'index.js');
  if (!entry.startsWith(source + path.sep)) throw new Error('入口超出包目录');
  const modules = new Set<string>(),
    sourceHashes: Record<string, string> = {};
  const built = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'public-host-boundary',
        setup(api) {
          api.onResolve({ filter: /.*/ }, (args) => {
            if(manifest.id==='long-memory'&&args.path==='./store.js')return{path:'unified-memory',namespace:'harness-memory'};
            const observed = args.path.match(/^\.\.\/(chatter-guard|content-guard)\/index\.js$/)?.[1];
            if (observed) { modules.add('extension-observation:' + observed); return { path: observed, namespace: 'harness-observation' }; }
            const privatePath = args.path.match(/(?:^|\/)src\/(.+)\.js(?:\?.*)?$/)?.[1];
            if (privatePath) {
              if (!exportsOf[privatePath]) throw new Error(`需要公开服务适配：${privatePath}`);
              modules.add(privatePath);
              return { path: privatePath, namespace: 'harness-host' };
            }
            if (args.path.startsWith('node:') || builtinModules.includes(args.path))
              return { path: args.path, external: true };
            if (args.path.startsWith('.') && args.path.includes('?'))
              return { path: path.resolve(args.resolveDir, args.path.split('?')[0]!) };
            if (args.path === 'electron') {
              modules.add('electron');
              return { path: 'electron', namespace: 'harness-host' };
            }
          });
          api.onLoad({filter:/.*/,namespace:'harness-memory'},()=>({contents:'export const MemoryStore=__harness.module("unified-memory").MemoryStore;export const contextScope=__harness.module("unified-memory").contextScope;',loader:'js'}));
          api.onLoad({ filter: /.*/, namespace: 'harness-observation' }, args => ({ contents: 'const view=__harness.module("extension-observation").get(' + JSON.stringify(args.path) + ');export const internals=view.internals;export const matchBlocked=view.matchBlocked;', loader: 'js' }));
          api.onLoad({ filter: /.*/, namespace: 'harness-host' }, (args) => ({
            contents:
              args.path === 'electron'
                ? 'export const BrowserWindow=__harness.module("electron").BrowserWindow;export const net=__harness.module("electron").net;export default __harness.module("electron");'
                : exportsOf[args.path]!.map(
                    (name) => `export const ${name}=__harness.module(${JSON.stringify(args.path)}).${name};`,
                  ).join('\n'),
            loader: 'js',
          }));
          api.onLoad({ filter: /\.[cm]?js$/ }, (args) => {
            const relative = path.relative(source, args.path);
            if (relative.startsWith('..') || path.isAbsolute(relative))
              throw new Error(`禁止把旧宿主或包外模块打包：${args.path}`);
            const original = fs.readFileSync(args.path, 'utf8');
            sourceHashes[relative.replaceAll('\\', '/')] = createHash('sha256')
              .update(original)
              .digest('hex');
            const literals: { start: number; end: number; text: string }[] = [];
            const visit = (node: any) => {
              if (!node || typeof node !== 'object') return;
              if (manifest.id === 'net-proxy' && node.type === 'FunctionDeclaration' && ['setup','activate','deactivate','dispose'].includes(node.id?.name)) {
                literals.push({ start: node.start, end: node.end, text: node.id.name === 'setup' ? 'async function setup(skillApi){api=skillApi;loadError="";}' : 'function ' + node.id.name + '(){}' }); return;
              }
              if (manifest.id === 'net-proxy' && node.type === 'VariableDeclarator' && node.id?.name === 'providers') {
                literals.push({ start: node.init.start, end: node.init.end, text: "{'network.proxy-config':()=>{const cfg=buildConfig();return cfg.enabled?{...cfg,url:cfg.protocol+'://'+cfg.host+':'+cfg.port}:null;}}" }); return;
              }
              if (manifest.id === 'self-surf' && node.type === 'FunctionDeclaration' && ['sendTo','defaultTarget'].includes(node.id?.name)) {
                const replacement = node.id.name === 'sendTo' ? "async function sendTo(target,text){return __harness.module('source-outbound').sendTo(target,text);}" : "function defaultTarget(){return __harness.module('source-outbound').target();}";
                literals.push({ start: node.start, end: node.end, text: replacement }); modules.add('source-outbound'); return;
              }
              // Some installed skills construct a file: URL instead of a static
              // import. Resolve only the two known old-host forms, never follow that
              // URL into the retired checkout or silently keep a weakened fallback.
              if (
                node.type === 'ImportExpression' &&
                node.source.type === 'MemberExpression' &&
                node.source.property?.name === 'href'
              ) {
                const call = node.source.object;
                const oldPath =
                  call?.type === 'CallExpression' &&
                  call.callee?.name === 'pathToFileURL' &&
                  call.arguments[0]?.type === 'CallExpression' &&
                  call.arguments[0].callee?.object?.name === 'path' &&
                  call.arguments[0].callee?.property?.name === 'join' &&
                  call.arguments[0].arguments[0]?.name === 'appRoot'
                    ? call.arguments[0].arguments[1]?.value
                    : call?.type === 'NewExpression' && call.callee?.name === 'URL'
                      ? call.arguments[0]?.value
                      : undefined;
                const privateModule =
                  typeof oldPath === 'string'
                    ? oldPath.match(/^(?:\.\.\/\.\.\/)?src\/(.+)\.js$/)?.[1]
                    : undefined;
                if (privateModule) {
                  if (!exportsOf[privateModule]) throw new Error(`需要公开服务适配：${privateModule}`);
                  modules.add(privateModule);
                  literals.push({
                    start: node.start,
                    end: node.end,
                    text: `Promise.resolve(__harness.module(${JSON.stringify(privateModule)}))`,
                  });
                  return;
                }
              }
              if (node.type === 'Literal' && typeof node.value === 'string') {
                const next = normalizeLegacyInstructions(node.value);
                if (next !== node.value)
                  literals.push({ start: node.start, end: node.end, text: JSON.stringify(next) });
              }
              if (
                node.type === 'TemplateLiteral' &&
                node.quasis.every((q: any) => typeof q.value.cooked === 'string')
              ) {
                const chunks = node.quasis.map((q: any) => q.value.cooked as string),
                  next = chunks.map(normalizeLegacyInstructions);
                if (next.some((text: string, i: number) => text !== chunks[i])) {
                  const escape = (text: string) =>
                    text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
                  let text = '`';
                  for (let i = 0; i < next.length; i++) {
                    text += escape(next[i]);
                    if (node.expressions[i])
                      text += '${' + original.slice(node.expressions[i].start, node.expressions[i].end) + '}';
                  }
                  text += '`';
                  literals.push({ start: node.start, end: node.end, text });
                  return;
                }
              }
              for (const value of Object.values(node))
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            };
            visit(parseSync(args.path, original).program);
            let normalized = original;
            for (const edit of literals.sort((a, b) => b.start - a.start))
              normalized = normalized.slice(0, edit.start) + edit.text + normalized.slice(edit.end);
            let contents = normalized
              .replace(/import\(`(\.[^`$?]+)(?:\?[^`]*)?`\)/g, (_, file) => `import(${JSON.stringify(file)})`)
              .replaceAll(
                'import.meta.url',
                `__harness.url(${JSON.stringify(relative.replaceAll('\\', '/'))})`,
              )
              .replaceAll(
                'import.meta.dirname',
                `__harness.dirname(${JSON.stringify(relative.replaceAll('\\', '/'))})`,
              )
              .replaceAll('process.env.QQ_AGENT_DATA_DIR', '__harness.dataDir')
              .replaceAll('process.cwd()', '__harness.root')
              .replaceAll('globalThis.fetch', 'fetch');
            if (manifest.id === 'ark-db' && relative.replaceAll('\\', '/') === 'index.js') {
              const previous = "const DATA_DIR = path.resolve(ROOT, '../../../../data/ark-db');";
              if (!contents.includes(previous))
                throw new Error('ark-db 数据目录声明发生变化，需重新核对适配');
              contents = contents.replace(
                previous,
                "const DATA_DIR = path.join(__harness.dataDir, 'ark-db');",
              );
            }
            if (manifest.id === 'self-avatar' && relative.replaceAll('\\', '/') === 'index.js') {
              const ast = parseSync(args.path, contents).program;
              const declaration = (ast.body as any[]).find(
                (node) => node.type === 'FunctionDeclaration' && node.id?.name === 'resolveAvatarSource',
              );
              if (!declaration) throw new Error('self-avatar 图片来源函数发生变化，需重新核对适配');
              contents =
                contents.slice(0, declaration.start) +
                "async function resolveAvatarSource(ctx,args){return __harness.module('avatar-source').resolve(ctx,args);}" +
                contents.slice(declaration.end);
            }
            if (manifest.id === 'quote-target' && relative.replaceAll('\\', '/') === 'index.js') {
              const ast = parseSync(args.path, contents).program;
              const declaration = (ast.body as any[]).find(
                (node) => node.type === 'FunctionDeclaration' && node.id?.name === 'readMessages',
              );
              if (!declaration) throw new Error('quote-target 消息读取函数发生变化，需重新核对适配');
              contents =
                contents.slice(0, declaration.start) +
                "function readMessages(chatKey){return __harness.module('chat-store').recent(chatKey);}" +
                contents.slice(declaration.end);
            }
            if (manifest.id === 'scheduled-task' && relative.replaceAll('\\', '/') === 'index.js') {
              const ast = parseSync(args.path, contents).program,
                declaration = (ast.body as any[]).find(
                  (node) => node.type === 'FunctionDeclaration' && node.id?.name === 'fire',
                );
              if (!declaration) throw new Error('scheduled-task 触发函数发生变化，需重新核对适配');
              contents =
                contents.slice(0, declaration.start) +
                "async function fire(task,now){return __harness.module('scheduled-task').fire(task,now);}" +
                contents.slice(declaration.end);
              const previous = 'if (!mine && args.asOwner !== true)';
              if (!contents.includes(previous))
                throw new Error('scheduled-task 取消权限判断发生变化，需重新核对适配');
              contents = contents.replace(
                previous,
                "if (!mine && !(args.asOwner === true && __harness.module('scheduled-task').isOwner(ctx)))",
              );
            }
            if (manifest.id === 'pcstatus' && relative.replaceAll('\\', '/') === 'index.js') {
              const ast = parseSync(args.path, contents).program;
              const node = (ast.body as any[]).find(
                (node) => node.type === 'FunctionDeclaration' && node.id?.name === 'cropBackground',
              );
              if (!node) throw new Error('pcstatus 背景裁切函数发生变化，需重新核对适配');
              contents =
                contents.slice(0, node.start) +
                "async function cropBackground(bgFile,cardW,cardH){try{return await __harness.module('image-crop').crop(bgFile,cardW,cardH,CROP_FACE_SHIFT);}catch{return '';}}" +
                contents.slice(node.end);
            }
            if (manifest.id === 'ai-status' && relative.replaceAll('\\', '/') === 'index.js') {
              const replacements: Record<string, string> = {
                readTodayUsage:
                  'function readTodayUsage(){return __harness.module("runtime-status").today().usage;}',
                computeTodayCost:
                  'function computeTodayCost(){return __harness.module("runtime-status").today().cost;}',
                readRuntime: 'function readRuntime(){return __harness.module("runtime-status").runtime();}',
              };
              const ast = parseSync(args.path, contents).program,
                edits = (ast.body as any[])
                  .filter((node) => node.type === 'FunctionDeclaration' && replacements[node.id?.name])
                  .map((node) => ({ start: node.start, end: node.end, text: replacements[node.id.name]! }));
              if (edits.length !== 3) throw new Error('ai-status 数据读取函数发生变化，需重新核对适配');
              for (const edit of edits.sort((a, b) => b.start - a.start))
                contents = contents.slice(0, edit.start) + edit.text + contents.slice(edit.end);
              contents = contents.replace(
                'function costText(d) {',
                'function costText(d) { if(d.cost?.unavailable&&!d.costOverride)return "不可用（部分历史未记录计费）";',
              );
            }
            return { contents, loader: 'js', resolveDir: path.dirname(args.path) };
          });
        },
      },
    ],
  });
  let code = built.outputFiles[0]!.text;
  const ast = parseSync('capsule.mjs', code).program;
  const imports: string[] = [],
    returns: string[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  for (const node of ast.body as any[]) {
    if (node.type === 'ImportDeclaration') {
      imports.push(code.slice(node.start, node.end));
      edits.push({ start: node.start, end: node.end, text: '' });
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration || node.source) throw new Error('无法封装动态导出');
      for (const s of node.specifiers)
        returns.push(`${JSON.stringify(s.exported.name ?? s.exported.value)}:${s.local.name}`);
      edits.push({ start: node.start, end: node.end, text: '' });
    }
    if (node.type === 'ExportDefaultDeclaration' || node.type === 'ExportAllDeclaration')
      throw new Error('需要明确的插件入口导出');
  }
  const checkDynamic = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportExpression' && node.source.type !== 'Literal')
      throw new Error('存在尚未适配的动态模块路径，不能标记为可迁移');
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(checkDynamic);
      else if (value && typeof value === 'object') checkDynamic(value);
  };
  checkDynamic(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  const output = `${imports.join('\n')}\nexport const harnessCapsuleVersion=1;\nexport async function createHarnessModule(__harness){\nconst globalThis=__harness.globals,process=__harness.process;\nconst fetch=(...args)=>__harness.fetch(...args);\nconst setTimeout=(fn,ms,...args)=>__harness.setTimeout(fn,ms,...args),setInterval=(fn,ms,...args)=>__harness.setInterval(fn,ms,...args),clearTimeout=id=>__harness.clearTimer(id),clearInterval=clearTimeout;\n${code}\nreturn {${returns.join(',')}};\n}\n`;
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, 'harness-entry.mjs'),
    tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, output);
  fs.renameSync(tmp, file);
  return {
    id: String(manifest.id),
    file,
    sha256: createHash('sha256').update(output).digest('hex'),
    modules: [...modules].sort(),
    sourceHashes,
  };
}
