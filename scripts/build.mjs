import { build as bundle } from 'esbuild';
import { build as buildConsole } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './build-extension-compat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output=path.resolve(process.env.HARNESS_BUILD_DIR??path.join(root,'dist'));
const relative=path.relative(path.join(root,'var/builds'),output);
if(output!==path.join(root,'dist')&&(!relative||relative.startsWith('..')||path.isAbsolute(relative)))throw new Error('独立构建目录必须在本工程 var/builds 中');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
await bundle({
  entryPoints: [path.join(root, 'apps/server/src/main.ts')],
  outfile: path.join(output, 'server/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
});
await bundle({
  entryPoints: [path.join(root, 'tools/import-legacy.ts')],
  outfile: path.join(output, 'tools/import-legacy.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(pkg.dependencies),
});
await bundle({
  entryPoints: [path.join(root, 'apps/desktop/src/main.ts')],
  outfile: path.join(output, 'desktop/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
});
await bundle({
  entryPoints: [path.join(root, 'tools/sqlite-maintenance.ts')],
  outfile: path.join(output, 'tools/sqlite-maintenance.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
});
await buildConsole({ configFile: path.join(root, 'apps/console/vite.config.ts'),build:{outDir:path.join(output,'console')} });
console.log('后端、控制台与迁移工具构建完成。');
