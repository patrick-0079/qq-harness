import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { acquireDataLock } from '../apps/server/src/lock.js';
import { writeJsonAtomic } from '@qq-harness/files';
import { legacyContainerPool } from '../plugins/container-runtime/src/pool-state.js';
import type { ContainerPoolState } from '@qq-harness/contracts';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function open(dataDir: string, write: boolean) {
  const file = path.join(dataDir, 'harness.sqlite');
  if (fs.existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: !write });
    const get = (key: string) => {
      const row = db
        .prepare('SELECT payload FROM plugin_state WHERE namespace=? AND key=?')
        .get('container-runtime', key);
      return row ? JSON.parse(String(row.payload)) : null;
    };
    return {
      get,
      set: (key: string, value: unknown) => {
        if (value === undefined)
          db.prepare('DELETE FROM plugin_state WHERE namespace=? AND key=?').run('container-runtime', key);
        else
          db.prepare(
            'INSERT INTO plugin_state(namespace,key,payload) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET payload=excluded.payload',
          ).run('container-runtime', key, JSON.stringify(value));
      },
      close: () => db.close(),
    };
  }
  const target = (key: string) => path.join(dataDir, 'plugin-state/container-runtime', key + '.json');
  return {
    get: (key: string) =>
      fs.existsSync(target(key)) ? JSON.parse(fs.readFileSync(target(key), 'utf8')) : null,
    set: (key: string, value: unknown) => {
      if (value === undefined) fs.rmSync(target(key), { force: true });
      else writeJsonAtomic(target(key), value);
    },
    close: () => {},
  };
}
export function upgradeContainerPool(dataDir: string, apply = false, restore?: string) {
  const root = fs.realpathSync(dataDir),
    unlock = apply ? acquireDataLock(root) : () => {};
  let store: ReturnType<typeof open> | undefined;
  try {
    store = open(root, apply);
    const before = store.get('pool-v2');
    if (restore) {
      const source = fs.realpathSync(restore),
        relative = path.relative(path.join(root, 'backups'), source);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        throw Error('回滚清单必须在本实例 backups 中');
      const manifest = JSON.parse(fs.readFileSync(path.join(source, 'container-pool.json'), 'utf8'));
      if (manifest.version !== 2 || digest(manifest.before) !== manifest.beforeSha)
        throw Error('备份哈希无效');
      if (digest(before) !== manifest.afterSha)
        throw Error('迁移后绑定已变化，请先导出当前资源池，不能覆盖新数据');
      if (apply) store.set('pool-v2', manifest.existed ? manifest.before : undefined);
      return { restored: apply, backup: source };
    }
    const next: ContainerPoolState =
      before ?? legacyContainerPool(store.get('bindings'), store.get('unbound'));
    if (next.version !== 2) throw Error('不支持的资源池版本');
    const summary = {
      changed: before == null,
      resources: next.resources.length,
      bindings: next.bindings.length,
      accounts: next.bindings.map((b) => ({
        chatKey: b.chatKey,
        username: b.username,
        workspace: b.workspace,
        copyLegacyWorkspace: b.legacyWorkspace === true,
      })),
      preserved: ['settings', 'owner', 'bindings', 'unbound', 'container-files'],
      provisioning: '首次使用才创建用户；预览和迁移不执行容器命令',
    };
    if (!apply || before != null) return { ...summary, applied: false };
    const backup = path.join(
      root,
      'backups',
      'container-pool-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8),
    );
    fs.mkdirSync(backup, { recursive: true });
    writeJsonAtomic(path.join(backup, 'container-pool.json'), {
      version: 2,
      existed: before !== null,
      before,
      beforeSha: digest(before),
      afterSha: digest(next),
    });
    store.set('pool-v2', next);
    return { ...summary, applied: true, backup };
  } finally {
    store?.close();
    unlock();
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const value = (name: string) => process.argv.find((s) => s.startsWith(name + '='))?.slice(name.length + 1);
  const dir = value('--data-dir'),
    apply = process.argv.includes('--apply');
  if (!dir || !path.isAbsolute(dir)) throw Error('需要 --data-dir=<绝对路径>');
  if (apply && !process.argv.includes('--offline')) throw Error('先停止后端，写入需要 --apply --offline');
  console.log(JSON.stringify(upgradeContainerPool(dir, apply, value('--restore')), null, 2));
}
