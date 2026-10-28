import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeJsonAtomic, deepMerge } from '@qq-harness/files';
import { openSqliteStorage } from '../plugins/storage-sqlite/src/index.js';
import { acquireDataLock } from '../apps/server/src/lock.js';

const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const read = (file: string, fallback: any = {}) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : fallback;
function child(base: string, relative: string) {
  const root = path.resolve(base),
    file = path.resolve(root, relative),
    rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('迁移路径越界');
  let current = root;
  for (const name of ['', ...rel.split(path.sep)]) {
    if (name) current = path.join(current, name);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('迁移路径包含符号链接');
  }
  return file;
}
function copyTree(source: string, target: string) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (file) => {
      if (fs.lstatSync(file).isSymbolicLink()) throw Error('迁移资源包含符号链接');
      return !['node_modules', '.git'].includes(path.basename(file));
    },
  });
}
/** Install complete inventory and retain pending packages as explicitly unavailable.
 * Compiling a package never grants it permission to run in production. */
export function installExtensionMigration(
  previewRoot: string,
  dataDir: string,
  extensionRoot: string,
  apply = false,
) {
  const preview = fs.realpathSync(previewRoot),
    target = path.resolve(extensionRoot),
    data = path.resolve(dataDir);
  if (
    target === preview ||
    target.startsWith(preview + path.sep) ||
    data === preview ||
    !path.isAbsolute(dataDir) ||
    !path.isAbsolute(extensionRoot)
  )
    throw Error('迁移目标必须为独立绝对目录');
  const report = read(path.join(preview, 'migration-preview.json'));
  const source = fs.realpathSync(report.source);
  if (
    target === source ||
    target.startsWith(source + path.sep) ||
    data === source ||
    data.startsWith(source + path.sep)
  )
    throw Error('禁止写入旧工程');
  const desired = read(path.join(preview, 'migration-state.json'));
  const fingerprint = digest({ report, desired });
  const prior = read(path.join(target, 'installed-catalog.json'), null);
  if (prior && prior.fingerprint !== fingerprint) throw Error('扩展根已有不同迁移，拒绝覆盖');
  if (prior && prior.layout !== 'scanned-packages') throw Error('旧预览安装目录需要改用新的独立扩展版本目录');
  const items = report.rows.map((row: any) => {
    const folder = child(source, path.join(row.directory, row.id));
    const manifest = read(
      path.join(folder, fs.existsSync(path.join(folder, 'skill.json')) ? 'skill.json' : 'plugin.json'),
    );
    return {
      id: row.id,
      name: manifest.name ?? row.id,
      version: manifest.version,
      type: row.directory === 'plugins' ? 'plugin' : 'skill',
      scope: manifest.scope ?? 'session',
      description: manifest.description,
      settings: desired.global?.[row.id]?.settings ?? manifest.settings ?? {},
      settingsSchema: manifest.configSchema ?? {},
      nativePort: row.status === 'native-port',
      migration: {
        status: row.status,
        desiredEnabled: desired.global?.[row.id]?.enabled ?? false,
        behaviorVerified: false,
      },
      reason:
        row.status === 'native-port'
          ? row.nativePort === 'three-tier-memory'
            ? '已由统一三层记忆与可见性规则替代，请使用记忆管理'
            : '已有原生移植，请使用图片工坊及会话图片设置'
          : row.status === 'needs-adapter'
            ? '宿主接口适配待完成：' + String(row.error ?? '').replaceAll(source, '<旧工程>')
            : '已安装并保留原有启停；逐包完整业务验收仍在继续',
    };
  });
  const summary = {
    total: items.length,
    compiled: report.rows.filter((r: any) => r.status === 'compiled-not-behavior-verified').length,
    pending: report.rows.filter((r: any) => r.status === 'needs-adapter').length,
    profiles: Object.keys(desired.profiles ?? {}).length,
    profileEnabled: Object.values(desired.profiles ?? {}).reduce<number>(
      (n, p: any) => n + Object.values(p.skills ?? {}).filter((v: any) => v.enabled === true).length,
      0,
    ),
  };
  // Preflight must run in preview too, before an operator stops a live service.
  if (
    !prior &&
    fs.existsSync(target) &&
    fs.readdirSync(target).some((n) => {
      const file = child(target, n);
      if (n === 'README.md' && fs.statSync(file).isFile()) return false;
      return (
        !['plugins', 'chat-plugins', 'skills', 'tools', 'mcp', 'knowledge', 'promptinjects'].includes(n) ||
        !fs.statSync(file).isDirectory() ||
        fs.readdirSync(file).some((name) => name !== '.gitkeep' || !fs.statSync(child(file, name)).isFile())
      );
    })
  )
    throw Error('扩展根非空，拒绝覆盖');
  if (!apply) return { applied: false, fingerprint, ...summary };
  const release = acquireDataLock(data);
  let storage: ReturnType<typeof openSqliteStorage> | undefined;
  try {
    storage = openSqliteStorage(path.join(data, 'harness.sqlite'));
    if (prior && storage.store.state('extension-migration', fingerprint))
      return { applied: false, unchanged: true, fingerprint, ...summary };
    const before = {
      config: storage.store.state('extension-system', 'config') ?? null,
      profiles: storage.store.state('extension-system', 'profiles') ?? null,
    };
    const config: any = deepMerge(
      {
        skills: Object.fromEntries(
          Object.entries(desired.global ?? {}).map(([id, v]: [string, any]) => [
            id,
            { ...v.settings, enabled: v.enabled },
          ]),
        ),
        extensions: { defaults: desired.global ?? {}, hotReload: true },
        tools: { enabled: true },
        api: { vision: true },
      },
      before.config ?? {},
    );
    const nativeConfig = read(path.join(data, 'config.json'));
    for (const id of ['ext-tool', 'ext-mcp', 'ext-skill', 'ext-knowledge', 'ext-promptinject'])
      if (nativeConfig.plugins?.[id] !== false) config.skills[id] = { ...config.skills[id], enabled: true };
    const profiles = deepMerge(desired.profiles ?? {}, before.profiles ?? {});
    const backup = path.join(data, 'backups', 'extensions-' + randomUUID());
    fs.mkdirSync(backup, { recursive: true });
    writeJsonAtomic(path.join(backup, 'state.json'), {
      version: 1,
      target,
      fingerprint,
      before,
      after: digest({ config, profiles }),
    });
    fs.mkdirSync(target, { recursive: true });
    for (const name of ['plugins', 'chat-plugins', 'skills', 'tools', 'mcp', 'knowledge', 'promptinjects'])
      fs.mkdirSync(child(target, name), { recursive: true });
    const files: { file: string; sha256: string }[] = [];
    for (const row of prior ? [] : report.rows) {
      if (row.status === 'native-port') continue;
      const original = child(source, path.join(row.directory, row.id));
      const compiled = child(preview, path.join(row.directory, row.id));
      // Pending code is retained outside scan roots; it cannot allocate resources
      // or silently execute while its installation status is being displayed.
      const ready = row.status === 'compiled-not-behavior-verified';
      const dest = child(
        target,
        path.join(...(ready ? [row.directory, row.id] : ['legacy-packages', row.directory, row.id])),
      );
      copyTree(fs.existsSync(compiled) ? compiled : original, dest);
      if (ready) {
        const name = fs.existsSync(path.join(dest, 'skill.json')) ? 'skill.json' : 'plugin.json';
        const manifest = read(path.join(dest, name));
        writeJsonAtomic(path.join(dest, name), {
          ...manifest,
          harnessMigration: { ...manifest.harnessMigration, stage: 'installed' },
        });
      }
    }
    // Existing native data wins. Track every newly imported file for exact rollback.
    const importData = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw Error('旧扩展数据包含符号链接');
        const from = path.join(dir, entry.name),
          relative = path.join(prefix, entry.name),
          to = child(data, relative);
        if (entry.isDirectory()) importData(from, relative);
        else if (entry.isFile() && !/\.(?:lock|pid|log|tmp)$/.test(entry.name) && !fs.existsSync(to)) {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
          files.push({
            file: relative,
            sha256: createHash('sha256').update(fs.readFileSync(to)).digest('hex'),
          });
        }
      }
    };
    for (const item of items) importData(child(source, path.join('data', item.id)), item.id);
    // Shared old memory is already migrated to the native three-tier service.
    for (const filename of [
      ...items.map((item: any) => item.id + '.json'),
      'affinity.json',
      'punch-card.json',
      'revenge-ledger.json',
      'stamina.json',
      'kb-hub-stats.json',
    ]) {
      const from = child(source, 'data/' + filename),
        to = child(data, filename);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.copyFileSync(from, to);
        files.push({
          file: filename,
          sha256: createHash('sha256').update(fs.readFileSync(to)).digest('hex'),
        });
      }
    }
    storage.store.setState('extension-system', 'config', config);
    storage.store.setState('extension-system', 'profiles', profiles);
    storage.store.setState('extension-migration', fingerprint, { target, backup });
    writeJsonAtomic(path.join(backup, 'files.json'), files);
    const codeHashes: { file: string; sha256: string }[] = [];
    const scan = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw Error('扩展代码包含符号链接');
        if (entry.isDirectory() && !['data', 'cache', 'logs'].includes(entry.name)) scan(file);
        else if (
          entry.isFile() &&
          (/\.(?:[cm]?js|html|css)$/.test(entry.name) ||
            /^(?:plugin|skill|tool|package|mcp|promptinject)\.json$/.test(entry.name))
        )
          codeHashes.push({
            file: path.relative(target, file),
            sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
          });
      }
    };
    scan(target);
    writeJsonAtomic(path.join(target, 'installed-catalog.json'), {
      version: 1,
      layout: 'scanned-packages',
      fingerprint,
      items,
      backup,
      codeHashes,
    });
    return { applied: true, backup, fingerprint, files: files.length, ...summary };
  } finally {
    storage?.close();
    release();
  }
}

export function restoreExtensionMigration(dataDir: string, backup: string) {
  const meta = read(path.join(backup, 'state.json')),
    files = read(path.join(backup, 'files.json'), []);
  const release = acquireDataLock(dataDir),
    storage = openSqliteStorage(path.join(dataDir, 'harness.sqlite'));
  try {
    if (
      digest({
        config: storage.store.state('extension-system', 'config'),
        profiles: storage.store.state('extension-system', 'profiles'),
      }) !== meta.after
    )
      throw Error('迁移后的扩展设置已变化，拒绝覆盖回滚');
    for (const file of files)
      if (
        createHash('sha256')
          .update(fs.readFileSync(child(dataDir, file.file)))
          .digest('hex') !== file.sha256
      )
        throw Error('迁移后的扩展数据已变化，拒绝删除');
    const catalog = read(child(meta.target, 'installed-catalog.json'));
    if (catalog.fingerprint !== meta.fingerprint) throw Error('扩展目录已变化，拒绝回滚');
    storage.store.setState('extension-system', 'config', meta.before.config);
    storage.store.setState('extension-system', 'profiles', meta.before.profiles);
    storage.store.setState('extension-migration', meta.fingerprint, null);
    for (const file of files) fs.rmSync(child(dataDir, file.file));
    // Retain copied code for diagnosis. A scanned package remains executable:
    // also restore the launch pointer to its previous extension directory before
    // restarting. This operation restores data, not the selected code version.
    fs.renameSync(
      child(meta.target, 'installed-catalog.json'),
      child(meta.target, 'rolled-back-catalog.json'),
    );
    return { restored: true, files: files.length };
  } finally {
    storage.close();
    release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    value = (key: string) => args.find((a) => a.startsWith(key + '='))?.slice(key.length + 1);
  if (!value('--data-dir')) throw Error('需要 --data-dir=<独立数据或正式数据绝对路径>');
  if ((args.includes('--apply') || value('--restore')) && !args.includes('--offline'))
    throw Error('先停止对应实例并加 --offline');
  console.log(
    JSON.stringify(
      value('--restore')
        ? restoreExtensionMigration(value('--data-dir')!, value('--restore')!)
        : installExtensionMigration(
            value('--preview')!,
            value('--data-dir')!,
            value('--extensions')!,
            args.includes('--apply'),
          ),
      null,
      2,
    ),
  );
}
