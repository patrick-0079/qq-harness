import { acquireDataLock } from '../apps/server/src/lock.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { configSchema, type HarnessConfig } from '@qq-harness/contracts';
import { readJson, writeJsonAtomic } from '@qq-harness/files';
import { openSqliteStorage } from '@qq-harness/storage-sqlite';
import { fileMemoryRepository } from '../plugins/storage-file/src/memory.js';
import { migrateMemoryToShort, MEMORY_MIGRATION_KEY } from '../plugins/agent-memory/src/migration.js';
import { scanLegacyMemory, importLegacyMemory } from './legacy-memory.js';
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const secret = (v: unknown) => (text(v) === '******' ? '' : text(v));
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside = (root: string, file: string) => {
  const rel = path.relative(root, file);
  return rel !== '' && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
};
export function upgradeConfig(input: unknown, catalogInput: unknown): HarnessConfig {
  const raw = object(input),
    catalog = object(catalogInput),
    cfg = configSchema.parse(raw);
  const roles = Object.entries(object(catalog.builtinPersonas)).map(([id, v]) => ({
    id,
    name: text(object(v).name) || id,
    text: text(object(v).text),
  }));
  for (const v of array(catalog.customPersonas)) {
    const p = object(v);
    roles.push({ id: text(p.id), name: text(p.name) || text(p.id), text: text(p.text) });
  }
  const merge = <T extends { id: string }>(existing: T[], incoming: T[]) => {
    const result = new Map(incoming.filter((v) => v.id).map((v) => [v.id, v]));
    for (const v of existing) result.set(v.id, v);
    return [...result.values()];
  };
  cfg.personas = merge(cfg.personas, roles);
  const prompts = array(object(catalog.prompts).items).map((v) => {
    const p = object(v);
    return { id: text(p.id), name: text(p.name) || text(p.title) || text(p.id), text: text(p.content) };
  });
  if (text(catalog.builtinCompatiblePrompt))
    prompts.push({
      id: 'builtin-compatible',
      name: '旧版内置提示词',
      text: text(catalog.builtinCompatiblePrompt),
    });
  cfg.prompts = merge(cfg.prompts, prompts);
  const keys = object(catalog.providerKeys),
    sourceApi = object(catalog.sourceApi);
  const providers = array(catalog.providers)
    .map((v) => {
      const p = object(v),
        id = text(p.id),
        baseUrl = text(p.baseURL) || text(p.baseUrl);
      return {
        id,
        currency: text(p.currency) || 'USD',
        name: text(p.displayName) || text(p.name) || id,
        baseUrl,
        apiKey:
          (baseUrl === cfg.model.baseUrl && id === text(sourceApi.provider) ? cfg.model.apiKey : '') ||
          secret(keys[id]) ||
          secret(p.apiKey),
        models: array(p.models)
          .map((m) => (typeof m === 'string' ? m : text(object(m).id)))
          .filter(Boolean),
        priceInputPerM: typeof p.priceInputPerM === 'number' ? p.priceInputPerM : null,
        priceOutputPerM: typeof p.priceOutputPerM === 'number' ? p.priceOutputPerM : null,
      };
    })
    .filter((p) => p.id && p.baseUrl);
  cfg.providers = merge(cfg.providers, providers);
  // Existing rendered personas and reply behavior remain snapshots. Catalog import does not activate bindings.
  if (!('modelSelection' in object(raw.defaults)))
    cfg.defaults.modelSelection.timeoutMs = cfg.model.timeoutMs;
  for (const [key, settings] of Object.entries(cfg.profiles))
    if (!('modelSelection' in object(object(raw.profiles)[key])))
      settings.modelSelection.timeoutMs = cfg.model.timeoutMs;
  return configSchema.parse(cfg);
}
interface Manifest {
  version: 3;
  at: string;
  files: { name: string; sha256: string; missing?: boolean }[];
}
interface UpgradeOptions {
  referenceRoot?: string;
  sessionAdmission?: boolean;
}
const markerFile = `plugin-state/memory-migration/${MEMORY_MIGRATION_KEY}.json`;
const backupNames = [
  'config.json',
  'launch.json',
  'memory-system/store.json',
  markerFile,
  'migration/management-v3.json',
  'migration/legacy-memory-provenance.json',
];
function targetInventory(root: string, ids: string[]) {
  const sqlite = path.join(root, 'harness.sqlite');
  if (fs.existsSync(sqlite)) {
    const db = new DatabaseSync(sqlite, { readOnly: true });
    try {
      const exists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_records'").get();
      const known = new Set(
        exists
          ? db
              .prepare('SELECT id FROM memory_records')
              .all()
              .map((v) => String(v.id))
          : [],
      );
      const marker = db
        .prepare('SELECT payload FROM plugin_state WHERE namespace=? AND key=?')
        .get('memory-migration', MEMORY_MIGRATION_KEY);
      return {
        toShort: marker
          ? 0
          : Number(
              db
                .prepare("SELECT COUNT(*) AS n FROM memory_records WHERE status='active' AND tier<>'short'")
                .get()?.n ?? 0,
            ),
        missing: ids.filter((id) => !known.has(id)).length,
      };
    } finally {
      db.close();
    }
  }
  const store = object(readJson(path.join(root, 'memory-system/store.json'), {})),
    records = Object.values(object(store.records));
  return {
    toShort: fs.existsSync(path.join(root, markerFile))
      ? 0
      : records.filter((v) => object(v).status === 'active' && object(v).tier !== 'short').length,
    missing: ids.filter((id) => !Object.hasOwn(object(store.records), id)).length,
  };
}
export async function upgradeManagement(dataDir: string, apply = false, options: UpgradeOptions = {}) {
  if (!apply) return upgradeUnlocked(dataDir, false, options);
  const release = acquireDataLock(dataDir);
  try {
    return await upgradeUnlocked(dataDir, true, options);
  } finally {
    release();
  }
}
async function upgradeUnlocked(dataDir: string, apply = false, options: UpgradeOptions = {}) {
  const root = fs.realpathSync(path.resolve(dataDir)),
    configFile = path.join(root, 'config.json');
  const raw = readJson(configFile, {}),
    catalog = readJson(path.join(root, 'migration/catalog.json'), {}),
    next = upgradeConfig(raw, catalog);
  const plan = options.referenceRoot ? scanLegacyMemory(options.referenceRoot, next) : undefined;
  if (plan) next.chatMeta = { ...plan.chatMeta, ...next.chatMeta };
  const launchPath = path.join(root, 'launch.json'),
    launch = object(readJson(launchPath, {}));
  const launchChanged = !!options.sessionAdmission && Object.hasOwn(launch, 'allowedChats');
  if (launchChanged) delete launch.allowedChats;
  const inventory = targetInventory(root, plan?.records.map((r) => r.id) ?? []);
  const changed =
    JSON.stringify(raw) !== JSON.stringify(next) ||
    launchChanged ||
    inventory.toShort > 0 ||
    inventory.missing > 0;
  const summary = {
    version: 3,
    changed,
    personas: next.personas.length,
    prompts: next.prompts.length,
    providers: next.providers.length,
    profiles: Object.keys(next.profiles).length,
    existingMemoriesToShort: inventory.toShort,
    legacyMemoriesToImport: inventory.missing,
    legacy: plan?.summary,
    sessionAdmission: options.sessionAdmission === true,
    preserved: ['rendered-personas', 'reply-policy', 'credentials', 'launch-port-and-runtime-settings'],
  };
  if (!apply || !changed) return { ...summary, applied: false };
  const destination = path.join(
    root,
    'backups',
    `management-v3-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  );
  fs.mkdirSync(destination, { recursive: true });
  const files: Manifest['files'] = [];
  for (const name of backupNames) {
    const original = path.join(root, name),
      target = path.join(destination, name);
    if (!fs.existsSync(original)) {
      files.push({ name, sha256: '', missing: true });
      continue;
    }
    if (!inside(root, fs.realpathSync(original))) throw new Error('备份来源路径越界');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target);
    files.push({ name, sha256: sha(target) });
  }
  const sqlite = path.join(root, 'harness.sqlite');
  if (fs.existsSync(sqlite)) {
    const db = new DatabaseSync(sqlite, { readOnly: true });
    try {
      await backup(db, path.join(destination, 'harness.sqlite'));
    } finally {
      db.close();
    }
    files.push({ name: 'harness.sqlite', sha256: sha(path.join(destination, 'harness.sqlite')) });
  } else files.push({ name: 'harness.sqlite', sha256: '', missing: true });
  writeJsonAtomic(path.join(destination, 'manifest.json'), {
    version: 3,
    at: new Date().toISOString(),
    files,
  } satisfies Manifest);
  try {
    if (plan)
      for (const file of plan.files)
        if (sha(path.join(options.referenceRoot!, file.file)) !== file.sha256)
          throw new Error('旧数据在预览后发生变化，未应用迁移');
    const settings = {
      get: () => next,
      effective: (key: string) => ({
        ...(next.profiles[key] ?? next.defaults),
        memory: { ...next.defaults.memory, ...next.memoryOverrides[key] },
      }),
    };
    let memoryResult: { converted: number; alreadyCurrent: boolean },
      importResult = { imported: 0, existing: 0 };
    if (fs.existsSync(sqlite) || !fs.existsSync(path.join(root, 'memory-system/store.json'))) {
      const target = openSqliteStorage(sqlite);
      try {
        if (plan) importResult = importLegacyMemory(plan, target.memory);
        memoryResult = migrateMemoryToShort(target.memory, target.store, settings);
      } finally {
        target.close();
      }
    } else {
      const repo = fileMemoryRepository(root),
        storage = {
          state: (namespace: string, key: string) =>
            readJson(
              path.join(
                root,
                'plugin-state',
                encodeURIComponent(namespace),
                encodeURIComponent(key) + '.json',
              ),
              null,
            ),
          setState: (namespace: string, key: string, value: unknown) =>
            writeJsonAtomic(
              path.join(
                root,
                'plugin-state',
                encodeURIComponent(namespace),
                encodeURIComponent(key) + '.json',
              ),
              value,
            ),
        };
      if (plan) importResult = importLegacyMemory(plan, repo);
      memoryResult = migrateMemoryToShort(repo, storage, settings);
    }
    writeJsonAtomic(configFile, next);
    if (launchChanged) writeJsonAtomic(launchPath, launch);
    if (plan)
      writeJsonAtomic(path.join(root, 'migration/legacy-memory-provenance.json'), {
        at: new Date().toISOString(),
        summary: plan.summary,
        files: plan.files,
      });
    writeJsonAtomic(path.join(root, 'migration/management-v3.json'), {
      ...summary,
      memoryResult,
      importResult,
      at: new Date().toISOString(),
      backup: destination,
    });
    return { ...summary, applied: true, memoryResult, importResult, backup: destination };
  } catch (error) {
    restoreUnlocked(root, destination, true);
    throw error;
  }
}
export function restoreManagement(dataDir: string, backupDir: string, apply = false) {
  if (!apply) return restoreUnlocked(dataDir, backupDir, false);
  const release = acquireDataLock(dataDir);
  try {
    return restoreUnlocked(dataDir, backupDir, true);
  } finally {
    release();
  }
}
function restoreUnlocked(dataDir: string, backupDir: string, apply = false) {
  const root = fs.realpathSync(path.resolve(dataDir)),
    source = fs.realpathSync(path.resolve(backupDir));
  if (!inside(path.join(root, 'backups'), source)) throw new Error('回滚目录必须位于该实例的 backups 内');
  const manifest = readJson(path.join(source, 'manifest.json'), {}) as Manifest;
  if (manifest.version !== 3 || !Array.isArray(manifest.files)) throw new Error('备份清单无效');
  for (const file of manifest.files) {
    if (
      ![...backupNames, 'harness.sqlite'].includes(file.name) ||
      (!file.missing &&
        (!inside(source, fs.realpathSync(path.join(source, file.name))) ||
          sha(path.join(source, file.name)) !== file.sha256))
    )
      throw new Error('备份路径或哈希校验失败');
  }
  if (apply)
    for (const file of manifest.files) {
      const target = path.join(root, file.name);
      if (!inside(root, target) || (fs.existsSync(target) && !inside(root, fs.realpathSync(target))))
        throw new Error('回滚目标越界');
      if (file.name === 'harness.sqlite')
        for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
      if (file.missing) {
        fs.rmSync(target, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(source, file.name), target);
    }
  return { restored: apply, files: manifest.files.filter((v) => !v.missing).map((v) => v.name) };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2),
    value = (name: string) => args.find((v) => v.startsWith(name + '='))?.slice(name.length + 1),
    dataDir = value('--data-dir');
  if (!dataDir || !path.isAbsolute(dataDir))
    throw new Error('需要 --data-dir=<实例绝对目录>；默认仅预览，写入需 --apply --offline');
  const apply = args.includes('--apply');
  if (apply && !args.includes('--offline')) throw new Error('写入或回滚前停止后端，并显式传入 --offline');
  const restore = value('--restore');
  console.log(
    JSON.stringify(
      restore
        ? restoreManagement(dataDir, restore, apply)
        : await upgradeManagement(dataDir, apply, {
            referenceRoot: value('--reference-root'),
            sessionAdmission: args.includes('--session-admission'),
          }),
      null,
      2,
    ),
  );
}
