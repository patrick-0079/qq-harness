// 只迁移项目自身的扩展运行时与五个内置管理器，不复制社区包或运行数据。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw new Error('请传入旧检出的绝对路径');
const output = path.join(root, 'packages/extension-compat/vendor');
const files = ['src/plugin-loader.js', 'src/tool-registry.js', 'src/safe-fetch.js', 'src/zip-install.js'];
for (const dir of ['src/extensions', 'src/skills', 'src/mcp', 'src/knowledge', 'src/sandbox']) {
  for (const file of fs.readdirSync(path.join(source, dir)))
    if (file.endsWith('.js')) files.push(`${dir}/${file}`);
}
for (const id of ['ext-tool', 'ext-mcp', 'ext-knowledge', 'ext-skill', 'ext-promptinject']) {
  files.push(`plugins/${id}/index.js`, `plugins/${id}/plugin.json`);
}
const records = [];
for (const name of [
  'extension-system-test',
  'ui-extension-points-test',
  'knowledge-tree-test',
  'skill-degraded-test',
]) {
  const file = `test/${name}.mjs`;
  const content = fs.readFileSync(path.join(source, file));
  fs.mkdirSync(path.join(output, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(output, 'reference', `${name}.mjs`), content);
  records.push({ file: `reference/${name}.mjs`, sha256: createHash('sha256').update(content).digest('hex') });
}
for (const file of files) {
  const content = fs.readFileSync(path.join(source, file));
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  records.push({ file, sha256: createHash('sha256').update(content).digest('hex') });
}
if (fs.existsSync(path.join(source, 'LICENSE')))
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'));
fs.writeFileSync(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    { importedAt: new Date().toISOString(), origin: 'QQ-agent extension-system-v2', files: records },
    null,
    2,
  ) + '\n',
);
console.log(`已迁移 ${files.length} 个框架/内置管理器文件；适配改动单独保留在 bridge 中。`);
