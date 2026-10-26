import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../packages/extension-compat/', import.meta.url));
const vendor = path.join(root, 'vendor');
const result = await build({
  entryPoints: [path.join(root, 'bridge/entry.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  write: false,
  plugins: [
    {
      name: 'isolate-legacy-environment',
      setup(api) {
        api.onResolve({ filter: /(?:config|chat-profiles|llm)\.js$/ }, (args) => {
          const resolved = path.resolve(args.resolveDir, args.path);
          for (const name of ['config', 'chat-profiles', 'llm'])
            if (resolved === path.join(vendor, 'src', `${name}.js`))
              return { path: path.join(root, 'bridge', `${name}.js`) };
        });
        api.onLoad({ filter: /\.js$/ }, (args) => {
          let text = fs.readFileSync(args.path, 'utf8');
          if (!args.path.startsWith(vendor + path.sep)) return;
          const rel = path.relative(vendor, args.path).replaceAll('\\', '/');
          text = text.replaceAll('import.meta.url', `__extensionHost.url(${JSON.stringify(rel)})`);
          if (rel === 'src/plugin-loader.js') {
            text = text.replace('globalThis.fetch', '__extensionHost.legacyFetch');
            text = text.replace(
              'builtin: Boolean(manifest.builtin)',
              'builtin: dir.startsWith(__extensionHost.builtinRoot + path.sep)',
            );
            text = text.replace(
              'mod = await import(`${entryUrl}?t=${Date.now()}`)',
              'mod = await __extensionHost.importModule(entryPath)',
            );
            // 原生 Cordis 插件负责装配管理器；旧扫描器只处理用户包。
            text = text.replace(
              'skillManager.pruneMissing(aliveIds, {})',
              'skillManager.pruneMissing([...aliveIds, ...__extensionHost.retainedIds()], {})',
            );
            text = text.replace(
              'const allLoaded = [...skillRes.loaded, ...pluginRes.loaded, ...chatRes.loaded].map((r) => r.skill).filter(Boolean);',
              'const allLoaded = skillManager.registry.list();',
            );
            text = text.replace(
              "s?.manifest?.type && typeof s.activate === 'function'",
              "s?.manifest?.type && typeof s.activate === 'function' && !__extensionHost.isManaged(s.manifest.id)",
            );
            text = text.replace(
              "await s.activate({ reason: 'load' });",
              "if (__extensionHost.shouldActivate(id)) await s.activate({ reason: 'load' });",
            );
          }
          if (rel.startsWith('plugins/')) {
            text = text.replace(
              'renderConfigDeep({ ...(descriptor.settings || {}) }, { ownerId: pkgId })',
              'renderConfigDeep(__extensionHost.childSettings(pkgId, descriptor.settings || {}), { ownerId: pkgId })',
            );
            text = text
              .replace(
                /await import\(`\$\{pathToFileURL\(entryAbs\)\.href\}\?t=\$\{Date\.now\(\)\}`\)/g,
                'await __extensionHost.importModule(entryAbs)',
              )
              .replace(
                /await import\(`\$\{pathToFileURLSafe\(entryAbs\)\}\?t=\$\{Date\.now\(\)\}`\)/g,
                'await __extensionHost.importModule(entryAbs)',
              );
          }
          if (rel === 'src/mcp/client.js')
            text = text.replace('cwd: cwd || process.cwd()', 'cwd: cwd || __extensionHost.root');
          if (rel === 'plugins/ext-knowledge/index.js')
            text = text
              .replace('const base = process.env.QQ_AGENT_DATA_DIR', 'const base = __extensionHost.dataDir')
              .replace(
                "path.join(process.env.QQ_AGENT_DATA_DIR, 'knowledge-summaries')",
                "path.join(__extensionHost.dataDir, 'knowledge-summaries')",
              )
              .replace(
                'setTimeout(() => { runSummaryTask().catch(() => {}); }, 0);',
                '__extensionHost.schedule(() => runSummaryTask());',
              );
          return { contents: text, loader: 'js', resolveDir: path.dirname(args.path) };
        });
      },
    },
  ],
});
fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'generated/runtime.mjs'),
  `// Generated from the locally vendored extension runtime. Do not edit.\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nexport function createLegacyRuntime(__extensionHost) {\nconst module = { exports: {} }; const exports = module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;\n}\n`,
);
console.log('扩展兼容运行时已构建；每个调用独立创建注册表与管理器状态。');
