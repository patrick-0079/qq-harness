import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
const vendor = path.join(root, 'packages/extension-compat/vendor');
const provenance = JSON.parse(fs.readFileSync(path.join(vendor, 'provenance.json'), 'utf8'));
const generatedRuntime = fs.readFileSync(
  path.join(root, 'packages/extension-compat/generated/runtime.mjs'),
  'utf8',
);
if (/loadSkillRoot\(__extensionHost\.builtinRoot/.test(generatedRuntime))
  errors.push('兼容宿主不得自动装配内置管理器，能力应由独立 Cordis 插件提供');
for (const entry of provenance.files) {
  const digest = createHash('sha256')
    .update(fs.readFileSync(path.join(vendor, entry.file)))
    .digest('hex');
  if (digest !== entry.sha256) errors.push(`兼容快照被改写：${entry.file}（修改应放在构建适配层）`);
}
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : /\.[cm]?[jt]sx?$/.test(entry.name)
          ? [path.join(dir, entry.name)]
          : [],
    );
}
for (const file of walk(path.join(root, 'packages/kernel/src'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (
      !match[1].startsWith('.') &&
      !match[1].startsWith('node:') &&
      !['cordis', '@qq-harness/plugin-sdk'].includes(match[1])
    )
      errors.push(`${path.relative(root, file)} 依赖业务或传输层：${match[1]}`);
  }
}
for (const file of [
  ...walk(path.join(root, 'apps/console/src')),
  ...walk(path.join(root, 'packages/client-sdk/src')),
  ...walk(path.join(root, 'plugins')).filter((file) => file.endsWith('client.tsx')),
]) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (/^node:|server|@qq-harness\/(kernel|domain|files)/.test(match[1]))
      errors.push(`${path.relative(root, file)} 包含服务端依赖：${match[1]}`);
  }
}
for (const file of [
  ...walk(path.join(root, 'apps')),
  ...walk(path.join(root, 'packages')),
  ...walk(path.join(root, 'plugins')),
]) {
  const source = fs.readFileSync(file, 'utf8');
  // vendor 是校验 SHA 的原文快照；检查实际生成代码及所有新代码，忽略历史注释。
  if (file.startsWith(vendor + path.sep)) continue;
  const compiled = await transform(source, {
    loader: file.endsWith('tsx') ? 'tsx' : file.endsWith('ts') || file.endsWith('mts') ? 'ts' : 'js',
    legalComments: 'none',
  });
  if (/source-v[23]|\.\.\/source\/|process\.cwd\(/.test(compiled.code))
    errors.push(`${path.relative(root, file)} 依赖旧检出或启动目录`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('架构检查通过：内核无业务依赖，前端无 Node/服务端依赖，运行代码不引用旧检出。');
