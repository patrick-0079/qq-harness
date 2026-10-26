// 在新运行时中执行原工程的契约断言。只替换 import 与测试环境，不修改断言。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reference-'));
const modules = {
  'extensions/index': 'extensionCore',
  'tool-registry': 'tools',
  'extensions/ui-registry': 'ui',
  'knowledge/tree': 'knowledge',
  'knowledge/ensure': 'summaries',
  'knowledge/validate': 'validation',
  'sandbox/index': 'sandbox',
};
try {
  for (const name of [
    'extension-system-test',
    'ui-extension-points-test',
    'knowledge-tree-test',
    'skill-degraded-test',
  ]) {
    let source = fs.readFileSync(
      path.join(root, 'packages/extension-compat/vendor/reference', `${name}.mjs`),
      'utf8',
    );
    source = source.replace(/^process\.env\.QQ_AGENT_DATA_DIR = .*;\r?\n/m, '');
    source = source.replace(/await import\('\.\.\/src\/([^']+)\.js'\)/g, (_, name) => {
      if (!modules[name]) throw new Error(`未适配测试 import: ${name}`);
      return `runtime.${modules[name]}`;
    });
    source = source.replace('main().catch(', 'await main().catch(');
    const prelude = `import { createLegacyRuntime } from ${JSON.stringify(pathToFileURL(path.join(root, 'packages/extension-compat/generated/runtime.mjs')).href)};
const testRoot = ${JSON.stringify(temporary)};
let config = {};
const runtime = createLegacyRuntime({ root: testRoot, dataDir: testRoot, builtinRoot: testRoot, url: rel=>new URL(rel, ${JSON.stringify(pathToFileURL(temporary + path.sep).href)}).href, global:()=>config, view:()=>config, update:patch=>(config={...config,...patch}), scope:(_,fn)=>fn(), personas:()=>[], childSettings:(_,defaults)=>defaults, shouldActivate:()=>true });\n`;
    const target = path.join(temporary, `${name}.mjs`);
    fs.writeFileSync(target, prelude + source, 'utf8');
    const run = spawnSync(process.execPath, [target], {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    const summary = (run.stdout ?? '').split('\n').filter((line) => /总结：/.test(line));
    console.log(`${name}: ${summary.join(' ').trim() || '未产生结果'}`);
    if (run.status !== 0) {
      console.error(run.stdout, run.stderr, run.error ?? '');
      process.exitCode = 1;
    }
  }
} finally {
  const absolute = fs.realpathSync(temporary);
  if (
    path.dirname(absolute) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(absolute).startsWith('harness-reference-')
  )
    throw new Error('测试清理目录越界');
  fs.rmSync(absolute, { recursive: true, force: true });
}
