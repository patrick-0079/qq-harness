import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { adaptSkillSandbox } from './adapt-skill-sandbox.mjs';

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
          if (rel === 'src/sandbox/index.js') text = adaptSkillSandbox(text.replaceAll('\r\n', '\n'));
          if (rel === 'plugins/ext-skill/index.js') text = text.replace('const { raw, error } = readManifest(dir);', "if (!fs.existsSync(path.join(dir,'skill.json'))) continue;\nconst { raw, error } = readManifest(dir);\nif (raw?.harnessMigration?.runtimeApi === 'legacy-v1') continue;");
          text = text.replaceAll('import.meta.url', `__extensionHost.url(${JSON.stringify(rel)})`);
          if (rel === 'src/plugin-loader.js') {
            // A package's category and its host API version are independent.
            // Migrated v1 capsules declare a type without becoming v2 modules.
            text = text.replace(
              'const declaredType = manifest.type || null;',
              "const declaredType = found.raw.harnessMigration?.runtimeApi === 'legacy-v1' ? null : (manifest.type || null);",
            );
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
              "typeof s.activate === 'function' && !__extensionHost.isManaged(s.manifest.id)",
            );
            text = text.replace(
              "await s.activate({ reason: 'load' });",
              "if (__extensionHost.shouldActivate(id)) await s.activate({ reason: 'load' });",
            );
            text=text.replace("prevSkill.deactivate({ reason: 'reload' })","await prevSkill.deactivate({ reason: 'reload' })")
              .replace("prevSkill.activate({ reason: 'reload-failed' })","await prevSkill.activate({ reason: 'reload-failed' })")
              .replace("const msg = `注册失败：${error.message}`;","await mod.__harnessCleanup?.();\nconst msg = `注册失败：${error.message}`;")
              .replace(/if \(prevSkill\) \{\r?\n\s*skillManager\.capabilities\.removeOwner\(manifest.id\);/,'if (prevSkill) {\n    await prevSkill.__harnessCleanup?.();\n    skillManager.capabilities.removeOwner(manifest.id);')
              .replace('skill.loadError = null;','skill.__harnessCleanup=mod.__harnessCleanup;skill.__harnessSignal=mod.__harnessSignal;skill.__harnessIngress=mod.__harnessIngress;skill.__harnessProtocol=mod.__harnessProtocol;skill.__harnessSender=mod.__harnessSender;skill.__harnessStickerPolicy=mod.__harnessStickerPolicy;skill.loadError = null;')
              .replace("dispose: typeof mod.dispose === 'function' ? () => {","dispose: typeof mod.dispose === 'function' ? async () => {")
              .replace('try { mod.dispose(); } finally','try { await mod.dispose(); } finally');
            text=text.replace('const toolIds = [];','const previousTools=listTools().filter(t=>t.skillId===manifest.id);\nconst toolIds = [];')
              .replace('if (toolIds.length) unregisterToolsBySkill(manifest.id);','if (toolIds.length) unregisterToolsBySkill(manifest.id);for(const previousTool of previousTools)registerTool(previousTool);');
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
const target=path.join(root,'generated/runtime.mjs'),temporary=target+'.'+randomUUID()+'.tmp';
fs.writeFileSync(
  temporary,
  `// Generated from the locally vendored extension runtime. Do not edit.\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nexport function createLegacyRuntime(__extensionHost) {\nconst module = { exports: {} }; const exports = module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;\n}\n`,
);
fs.renameSync(temporary,target);
console.log('扩展兼容运行时已构建；每个调用独立创建注册表与管理器状态。');

await import('./build-core-utilities.mjs');
