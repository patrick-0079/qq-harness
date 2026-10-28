// 只读取旧源码声明；不 import 旧应用，也不读取配置、聊天数据或第三方运行目录。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw new Error('请传入待比对源码的绝对路径');
const read = (file) => fs.readFileSync(path.join(source, file), 'utf8');
const oldTools = [...read('src/tools.js').matchAll(/registerTool\(\{\s*id:\s*['"]([^'"]+)['"]/g)].map(
  (match) => ({
    id: match[1],
    file: 'src/tools.js',
    line: read('src/tools.js').slice(0, match.index).split('\n').length,
  }),
);
const oldRoutes = read('src/routes.js')
  .split(/\r?\n/)
  .flatMap((line, index) => {
    const match = /method:\s*['"]([^'"]+)['"],\s*pattern:\s*(.+?),?\s*$/.exec(line);
    return match
      ? [{ method: match[1], pattern: match[2].replace(/,$/, ''), file: 'src/routes.js', line: index + 1 }]
      : [];
  });
function walk(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : /\.[cm]?[jt]sx?$/.test(entry.name)
          ? [path.join(directory, entry.name)]
          : [],
    );
}
const pluginFiles = walk(path.join(root, 'plugins')).filter((file) => !file.endsWith('client.tsx'));
const nativeTools = [];
const nativeRoutes = [];
for (const file of [...pluginFiles, ...walk(path.join(root, 'apps/server/src'))]) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file).replaceAll('\\', '/');
  for (const match of text.matchAll(/tools\.register\(ctx,\s*\{\s*name:\s*['"]([^'"]+)['"]/g))
    nativeTools.push({ id: match[1], file: relative, line: text.slice(0, match.index).split('\n').length });
  for (const match of text.matchAll(/\b(?:api|app)\.(get|post|patch|put|delete|all)\(\s*['"]([^'"]+)['"]/g))
    nativeRoutes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      file: relative,
      line: text.slice(0, match.index).split('\n').length,
    });
}
const names = new Set(nativeTools.map((tool) => tool.id));
const legacyPackages = [];
for (const directory of ['plugins', 'chat-plugins', 'tools', 'mcp', 'skills', 'knowledge', 'promptinjects']) {
  const absolute = path.join(source, directory);
  if (!fs.existsSync(absolute)) continue;
  for (const entry of fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.includes('.bak'))) {
    const base = path.join(absolute, entry.name);
    const coupledImports = new Set();
    for (const file of walk(base)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]*\/src\/[^'"]+)['"]/g))
        coupledImports.add(match[1]);
    }
    legacyPackages.push({ directory, id: entry.name, coupledImports: [...coupledImports].sort() });
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  scope:
    'Static declarations only; matching names do not establish parameter or behavior equivalence. Package IDs use directory names; no private config/data is read.',
  sourceFiles: ['src/routes.js', 'src/tools.js'].map((file) => ({
    file,
    sha256: createHash('sha256').update(read(file)).digest('hex'),
  })),
  counts: {
    oldCoreTools: oldTools.length,
    nativeNamedTools: nativeTools.length,
    oldCoreToolsWithoutNativeName: oldTools.filter((tool) => !names.has(tool.id)).length,
    oldRouteDeclarations: oldRoutes.length,
    nativeRouteDeclarations: nativeRoutes.length,
    legacyPackageDirectories: legacyPackages.length,
    legacyPackagesImportingOldInternals: legacyPackages.filter((item) => item.coupledImports.length).length,
  },
  oldTools: oldTools.map((tool) => ({
    ...tool,
    native: nativeTools.find((native) => native.id === tool.id) ?? null,
  })),
  nativeTools,
  oldRoutes,
  nativeRoutes,
  legacyPackages,
};
fs.writeFileSync(path.join(root, 'doc/migration-inventory.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.counts, null, 2));
console.log(
  '尚无原生同名工具：' +
    report.oldTools
      .filter((tool) => !tool.native)
      .map((tool) => tool.id)
      .join(', '),
);
