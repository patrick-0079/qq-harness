import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 仅读取定义，不调用 setup/start，不访问真实配置或网络。以实际 requires 为准，
// 代码中的 provide/use 仅用于补充服务提供者及可选调用关系，不冒充运行覆盖率。
const root = fileURLToPath(new URL('../', import.meta.url));
const dummy = path.join(root, 'var', 'documentation-only');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : entry.name.endsWith('.ts')
              ? [path.join(dir, entry.name)]
              : [],
        )
    : [];
const symbols = new Map();
for (const file of [
  'packages/domain/src/index.ts',
  'packages/domain/src/containers.ts',
  'packages/extension-compat/src/service.ts',
  'plugins/snowluma-runtime/src/index.ts',
  'plugins/qq-portable/src/index.ts',
]) {
  for (const match of read(file).matchAll(/export const (\w+)\s*=\s*service[\s\S]*?\(\s*['"]([^'"]+)['"]\s*,?\s*\)/g))
    symbols.set(match[1], match[2]);
}
const factories = {
  'config-file': (m) => m.configFile(dummy),
  'storage-file': (m) => m.storageFile(dummy),
  'storage-sqlite': (m) => m.storageSqlite(dummy),
  'transport-http': (m) => m.transportHttp().plugin,
  'console-api': (m) => m.consoleApi(true),
  'snowluma-runtime': (m) => m.snowlumaRuntime(),
  'qq-portable': (m) => m.qqPortable(),
  'run-inspector': (m) => m.runInspector(dummy),
  'media-runtime': (m) => m.mediaRuntime(dummy),
  'sticker-tools': (m) => m.stickerTools(dummy),
  'image-studio': (m) => m.imageStudio(dummy),
  'html-renderer':(m)=>m.htmlRenderer(),
  'container-runtime': (m) => m.containerRuntime(),
  reminders: (m) => m.reminders(dummy),
  'extension-system': (m) => m.extensionSystem({ root: dummy, dataDir: dummy }),
  'external-plugins': (m) => m.externalPlugins(dummy),
};
const modes = {
  'adapter-mock': '演示',
  'model-mock': '演示',
  'adapter-onebot': 'live',
  'model-openai': 'live',
  'model-opencode': 'live',
  'storage-file': '替代 SQLite',
  'storage-sqlite': '默认存储',
  memory: '旧简版，默认未装配',
  'external-plugins': '配置 extensionDir 时',
};
const strings = (source) => [...source.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
const entries = [];
for (const directory of fs.readdirSync(path.join(root, 'plugins')).sort()) {
  const server = `plugins/${directory}/src/index.ts`;
  const client = `plugins/${directory}/client.tsx`;
  const hasServer = fs.existsSync(path.join(root, server));
  const clientSource = fs.existsSync(path.join(root, client)) ? read(client) : '';
  let definition;
  if (hasServer) {
    const module = await import(pathToFileURL(path.join(root, server)).href);
    const candidates = factories[directory]
      ? [factories[directory](module)]
      : Object.values(module).filter(
          (value) => value && typeof value === 'object' && typeof value.setup === 'function',
        );
    if (candidates.length !== 1) throw new Error(`请显式登记插件工厂：${directory}`);
    definition = candidates[0];
  } else {
    const id = /export default defineClientPlugin\(\{\s*id:\s*['"]([^'"]+)/.exec(clientSource)?.[1];
    if (!id) throw new Error(`客户端插件缺少声明：${directory}`);
    definition = { id, requires: [] };
  }
  const requires = [...(definition.requires ?? [])].sort();
  const provides = new Set(),
    uses = new Set();
  for (const file of walk(path.join(root, 'plugins', directory, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /ctx\.(provide|use)\(\s*(?:\{\s*id:\s*['"]([^'"]+)['"]\s*\}|(\w+))/g,
    )) {
      const token = match[2] ?? symbols.get(match[3]);
      if (!token) throw new Error(`未识别的服务标记：${directory}/${match[3]}`);
      (match[1] === 'provide' ? provides : uses).add(token);
    }
  }
  const clientRequires = /requires:\s*\[([^\]]*)\]/.exec(clientSource)?.[1];
  entries.push({
    id: definition.id,
    directory,
    source: hasServer ? server : client,
    mode: modes[directory] ?? (hasServer ? '默认装配' : '客户端页面'),
    requires,
    provides: [...provides].sort(),
    optional: [...uses].filter((id) => !requires.includes(id) && !provides.has(id)).sort(),
    clientRequires: clientRequires
      ? strings(clientRequires)
      : clientSource.includes('managerClient(')
        ? ['extension-system']
        : [],
    client: Boolean(clientSource),
  });
}
const example = JSON.parse(read('extensions/example-notes/plugin.json'));
entries.push({
  id: example.id,
  directory: 'example-notes',
  source: 'extensions/example-notes/plugin.json',
  mode: '后装示例，默认关闭',
  requires: [...example.requires, 'harness.external-loader'].sort(),
  provides: [],
  optional: [],
  clientRequires: ['console-chats'],
  client: true,
});
entries.sort((a, b) => a.id.localeCompare(b.id, 'en'));
const providers = new Map();
for (const item of entries)
  for (const token of item.provides) providers.set(token, [...(providers.get(token) ?? []), item.id]);
for (const item of entries)
  for (const token of item.requires)
    if (!providers.has(token)) throw new Error(`${item.id} 的 ${token} 没有已登记提供者`);
const cell = (values) => (values.length ? values.map((v) => `\`${v}\``).join('<br>') : '—');
const resolve = (token) => `${token} → ${(providers.get(token) ?? ['动态提供']).join(' / ')}`;
const lines = [
  '# 插件依赖清单（由源码生成）',
  '',
  `覆盖 plugins/ 的 ${entries.length - 1} 个目录及 example-notes 后装示例。运行 \`npm run docs:dependencies\` 更新，\`npm run check:dependencies\` 检查漂移。`,
  '',
  '服务端 requires 填服务名；客户端 requires 填插件 ID。表里的替代提供者按启动配置择一装配，不代表同时启动。动态安装的社区扩展不在此清单内。',
  '',
  '| 插件与入口 | 装配方式 | 必需服务 → 提供者 | 对外服务 | 客户端依赖 |',
  '|---|---|---|---|---|',
  ...entries.map(
    (item) =>
      `| [${item.id}](../${item.source}) | ${item.mode} | ${cell(item.requires.map(resolve))} | ${cell(item.provides)} | ${cell(item.clientRequires)} |`,
  ),
  '',
  '## 可选服务调用',
  '',
  '以下是 src/ 中 use 调用但未列入 requires 的服务。缺席时必须有降级行为，不能把可选依赖误画成启停绑定。兼容宿主内部额外按需使用容器服务。',
  '',
  '| 消费者 | 可选服务 → 提供者 |',
  '|---|---|',
  ...entries
    .filter((item) => item.optional.length)
    .map((item) => `| ${item.id} | ${cell(item.optional.map(resolve))} |`),
  '',
];
const groups = [
  ['接入、配置、存储与模型', (x) => /^(access|adapter|config|storage|model|transport)/.test(x.id)],
  [
    '聊天、工具、记忆与提醒',
    (x) => /^(agent|basic|command|conversation|memory|outbound|reminders|tool-runtime)/.test(x.id),
  ],
  [
    '管理 API、运行时、扩展宿主与管理器',
    (x) => /^(console-api|container|snowluma|qq-portable|extension|external|ext-|example)/.test(x.id),
  ],
];
const node = (id) => 'p_' + id.replaceAll('-', '_');
for (const [title, accepts] of groups) {
  lines.push(
    `## ${title}`,
    '',
    '箭头从消费者指向提供者；虚线表示同一服务有可替代的提供者。',
    '',
    '```mermaid',
    'flowchart LR',
  );
  for (const item of entries.filter(accepts)) {
    lines.push(`  ${node(item.id)}["${item.id}"]`);
    for (const token of item.requires)
      for (const provider of providers.get(token))
        lines.push(
          `  ${node(item.id)} ${providers.get(token).length > 1 ? '-.->' : '-->'}|"${token.replace(/^harness\./, '')}"| ${node(provider)}["${provider}"]`,
        );
  }
  lines.push('```', '');
}
lines.push('## 客户端插件依赖', '', '```mermaid', 'flowchart LR');
for (const item of entries.filter((x) => x.client)) {
  lines.push(`  ${node(item.id)}["${item.id}"]`);
  for (const dep of item.clientRequires) lines.push(`  ${node(item.id)} --> ${node(dep)}["${dep}"]`);
}
lines.push(
  '```',
  '',
  '## 读图说明',
  '',
  '- 五个 v2-* 目录的运行 ID 是 ext-tool / ext-mcp / ext-skill / ext-knowledge / ext-promptinject，能力依赖统一指向 harness.extensions。',
  '- SnowLuma 进程托管与 OneBot 适配器相互独立；snowluma-runtime 可选读取适配器连接状态。关闭托管插件不会主动终止外部 QQ/SnowLuma。',
  '- qq-portable 只依赖存储与 HTTP，提供独立登录程序的管理；与 snowluma-runtime、adapter-onebot 无强制启停依赖。登录与协议就绪需分别检查。',
  '- container-session 仅在后台执行请求时调用 harness.container.jobs，避免与 container-jobs 的必需依赖形成环。',
  '- 工具、模式和 hook 归属注册它们的插件；上表的服务依赖负责 Cordis 激活和撤销，表外动态扩展还受各自清单控制。',
  '',
);
const outputs = new Map([
  ['doc/plugin-dependencies.md', lines.join('\n')],
  ['doc/plugin-dependencies.json', JSON.stringify(entries, null, 2) + '\n'],
]);
for (const [file, content] of outputs) {
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(path.join(root, file)) || read(file) !== content)
      throw new Error(`${file} 已漂移，请运行 npm run docs:dependencies`);
  } else fs.writeFileSync(path.join(root, file), content, 'utf8');
}
console.log(
  `${process.argv.includes('--check') ? '已核对' : '已生成'} ${entries.length} 个插件的服务与客户端依赖；未启动任何插件。`,
);
