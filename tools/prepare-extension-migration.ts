import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeJsonAtomic } from '@qq-harness/files';
import { compileLegacyPackage } from './compile-legacy-package.js';
import { normalizeLegacyInstructions } from '../packages/extension-compat/src/instructions.js';
import { redactConfigTree } from '@qq-harness/files';

export async function prepareExtensionMigration(sourceRoot: string, targetRoot: string) {
  const source = fs.realpathSync(sourceRoot),
    target = path.resolve(targetRoot);
  if (target === source || target.startsWith(source + path.sep) || fs.existsSync(target))
    throw new Error('预览必须使用新的独立目录，不能覆盖旧项目或已有扩展');
  const rows: Record<string, unknown>[] = [];
  const configFile = path.join(source, 'data/config.json'),
    global = fs.existsSync(configFile)
      ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''))
      : {};
  const desired: Record<string, unknown> = {},
    profiles: Record<string, unknown> = {};
  const profileRoot = path.join(source, 'data/chat-configs');
  if (fs.existsSync(profileRoot))
    for (const name of fs.readdirSync(profileRoot).filter((n) => n.endsWith('.json'))) {
      const profile = JSON.parse(
        fs.readFileSync(path.join(profileRoot, name), 'utf8').replace(/^\uFEFF/, ''),
      );
      if (/^(?:private|group):\d+$/.test(profile.key))
        profiles[profile.key] = {
          skills: profile.config?.skills ?? {},
          extensions: profile.config?.extensions ?? {},
        };
    }
  const instruction = (value: any): any =>
    typeof value === 'string'
      ? normalizeLegacyInstructions(value)
      : Array.isArray(value)
        ? value.map(instruction)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, instruction(item)]))
          : value;
  fs.mkdirSync(target, { recursive: true });
  for (const directory of ['plugins', 'skills']) {
    const parent = path.join(source, directory);
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs
      .readdirSync(parent, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(parent, entry.name),
        name = ['skill.json', 'plugin.json'].find((n) => fs.existsSync(path.join(folder, n)));
      if (!name) continue;
      let manifest: Record<string, any>;
      try {
        manifest = JSON.parse(
          fs.readFileSync(path.join(folder, name), 'utf8').replace(/^\uFEFF/, ''),
        );
      } catch (error) {
        rows.push({
          directory,
          id: entry.name,
          status: 'invalid-manifest',
          error: String(error),
        });
        continue;
      }
      if (['image-studio', 'cross-memory', 'cross-group-memory'].includes(manifest.id)) {
        rows.push({
          directory,
          id: manifest.id,
          status: 'native-port',
          nativePort: manifest.id === 'image-studio' ? 'image-studio' : 'three-tier-memory',
          dataMigration: 'native-service',
        });
        continue;
      }
      const configured = global.skills?.[manifest.id] ?? {},
        extension = global.extensions?.defaults?.[manifest.id] ?? {};
      const desiredEnabled =
        configured.enabled ?? extension.enabled ?? manifest.enabledByDefault !== false;
      desired[manifest.id] = {
        enabled: desiredEnabled,
        settings: {
          ...manifest.settings,
          ...configured,
          ...extension.settings,
        },
      };
      const destination = path.join(target, directory, entry.name);
      try {
        const result = await compileLegacyPackage(folder, destination);
        // Resource names and import.meta URLs remain package-relative. No old src/
        // directory is copied; the sole host boundary is the compiled capsule.
        fs.cpSync(folder, destination, {
          recursive: true,
          dereference: false,
          filter: (file) => {
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) throw new Error('迁移包含符号链接，需逐项确认目标');
            return !path
              .relative(folder, file)
              .split(path.sep)
              .some((n) => ['node_modules', '.git', '_安装'].includes(n));
          },
        });
        writeJsonAtomic(path.join(destination, name), {
          ...manifest,
          type: manifest.type ?? (directory === 'skills' ? 'skill' : 'plugin'),
          prompt: instruction(manifest.prompt),
          tools: instruction(manifest.tools),
          enabledByDefault: false,
          entry: 'harness-entry.mjs',
          harnessMigration: {
            version: 1,
            runtimeApi: 'legacy-v1',
            stage: 'preview',
            desiredEnabled,
            behaviorVerified: false,
            sourceEntry: manifest.entry || 'index.js',
            sha256: result.sha256,
            modules: result.modules,
          },
        });
        if (!fs.existsSync(path.join(destination, 'package.json')))
          writeJsonAtomic(path.join(destination, 'package.json'), {
            private: true,
            type: 'module',
          });
        rows.push({
          directory,
          status: 'compiled-not-behavior-verified',
          desiredEnabled,
          ...result,
          file: path.relative(target, result.file),
        });
      } catch (error) {
        rows.push({
          directory,
          id: manifest.id,
          status: 'needs-adapter',
          error: String(error),
        });
      }
    }
  }
  const report = {
    version: 1,
    source,
    target,
    createdAt: new Date().toISOString(),
    productionChanged: false,
    rows,
  };
  // Preserve the intended old state separately. Preview packages remain off until
  // their real hooks and data have been verified; no bulk enable-on-import.
  writeJsonAtomic(path.join(target, 'migration-state.json'), {
    version: 1,
    global: desired,
    profiles,
  });
  writeJsonAtomic(
    path.join(target, 'migration-state-preview.json'),
    redactConfigTree({ version: 1, global: desired, profiles }),
  );
  writeJsonAtomic(path.join(target, 'migration-preview.json'), report);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = process.argv[2] ?? path.resolve(root, '../backup/source');
  const target = process.argv[3] ?? path.join(root, 'var', 'extension-preview-' + Date.now());
  const report = await prepareExtensionMigration(source, target);
  console.log(
    JSON.stringify(
      {
        target,
        counts: report.rows.reduce<Record<string, number>>(
          (counts, row) => (
            (counts[String(row.status)] = (counts[String(row.status)] ?? 0) + 1),
            counts
          ),
          {},
        ),
      },
      null,
      2,
    ),
  );
}
