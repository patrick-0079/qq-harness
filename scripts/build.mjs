import { build as bundle } from 'esbuild';
import { build as buildConsole } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './build-extension-compat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
await bundle({
  entryPoints: [path.join(root, 'apps/server/src/main.ts')],
  outfile: path.join(root, 'dist/server/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
});
await bundle({
  entryPoints: [path.join(root, 'tools/import-legacy.ts')],
  outfile: path.join(root, 'dist/tools/import-legacy.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(pkg.dependencies),
});
await bundle({
  entryPoints: [path.join(root, 'apps/desktop/src/main.ts')],
  outfile: path.join(root, 'dist/desktop/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
});
await bundle({
  entryPoints: [path.join(root, 'tools/sqlite-maintenance.ts')],
  outfile: path.join(root, 'dist/tools/sqlite-maintenance.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
});
await buildConsole({ configFile: path.join(root, 'apps/console/vite.config.ts') });
console.log('后端、控制台与迁移工具构建完成。');
