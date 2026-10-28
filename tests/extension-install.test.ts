import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { writeJsonAtomic } from '@qq-harness/files';
import {
  installExtensionMigration,
  restoreExtensionMigration,
} from '../tools/install-extension-migration.js';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import { openSqliteStorage } from '../plugins/storage-sqlite/src/index.js';
import { compileLegacyPackage } from '../tools/compile-legacy-package.js';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-extension-install-'));
  cleanups.push(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'old'),
    preview = path.join(root, 'preview'),
    data = path.join(root, 'data'),
    extensions = path.join(root, 'extensions');
  const write = (file: string, value: any) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write(path.join(source, 'skills/demo/skill.json'), {
    id: 'demo',
    name: '迁移技能',
    configSchema: { key: { secret: true } },
  });
  write(path.join(source, 'skills/demo/index.js'), 'throw Error("pending code must never run")');
  write(path.join(source, 'data/demo/private.json'), { value: 'private fixture' });
  write(path.join(source, 'data/stamina.json'), { points: 10 });
  write(path.join(preview, 'migration-preview.json'), {
    source,
    rows: [{ id: 'demo', directory: 'skills', status: 'needs-adapter', error: 'fixture dependency' }],
  });
  write(path.join(preview, 'migration-state.json'), {
    global: { demo: { enabled: false, settings: { key: 'secret-fixture' } } },
    profiles: { 'group:1': { skills: { demo: { enabled: true, key: 'session-secret' } } } },
  });
  return { root, source, preview, data, extensions };
}
test('目录、全局与会话状态、私有数据幂等迁移；未验收代码不执行，回滚可验证', async () => {
  const f = fixture();
  expect(installExtensionMigration(f.preview, f.data, f.extensions)).toMatchObject({
    applied: false,
    total: 1,
    profiles: 1,
    profileEnabled: 1,
  });
  expect(fs.existsSync(f.extensions)).toBe(false);
  fs.mkdirSync(f.extensions);
  fs.writeFileSync(path.join(f.extensions, 'README.md'), 'keep existing instructions');
  fs.mkdirSync(path.join(f.extensions, 'skills'));
  fs.writeFileSync(path.join(f.extensions, 'skills/.gitkeep'), '');
  expect(installExtensionMigration(f.preview, f.data, f.extensions)).toMatchObject({ applied: false });
  const result = installExtensionMigration(f.preview, f.data, f.extensions, true) as { backup: string };
  expect(fs.readFileSync(path.join(f.extensions, 'README.md'), 'utf8')).toBe('keep existing instructions');
  expect(fs.existsSync(path.join(f.extensions, 'skills/.gitkeep'))).toBe(true);
  expect(fs.readFileSync(path.join(f.data, 'demo/private.json'), 'utf8')).toContain('private fixture');
  expect(installExtensionMigration(f.preview, f.data, f.extensions, true)).toMatchObject({ unchanged: true });
  const app = await createApplication({
    dataDir: f.data,
    v2ExtensionDir: f.extensions,
    extensionHotReload: false,
  });
  const extensions = app.runtime.use(extensionService);
  expect(extensions.list('group:1').find((e) => e.id === 'demo')).toMatchObject({
    enabled: true,
    active: false,
    settings: { key: '******' },
    reason: expect.stringContaining('适配'),
  });
  await expect(extensions.configure('demo', { enabled: true }, 'group:1')).rejects.toThrow('适配');
  await app.stop();
  expect(restoreExtensionMigration(f.data, result.backup)).toMatchObject({ restored: true });
  expect(fs.existsSync(path.join(f.data, 'demo/private.json'))).toBe(false);
  const state = openSqliteStorage(path.join(f.data, 'harness.sqlite'));
  expect(state.store.state('extension-system', 'config')).toBe(null);
  state.close();
});
test('预览阶段拒绝已有实际包，不等待停机才发现冲突', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.extensions, 'skills/installed'), { recursive: true });
  expect(() => installExtensionMigration(f.preview, f.data, f.extensions)).toThrow('扩展根非空');
  expect(fs.existsSync(f.data)).toBe(false);
});
test('已编译包按旧开关安装；关闭时不执行顶层代码，启用与再次启用加载新实例', async () => {
  const f = fixture(),
    source = path.join(f.source, 'skills/demo'),
    compiled = path.join(f.preview, 'skills/demo');
  fs.writeFileSync(
    path.join(source, 'index.js'),
    "import fs from 'node:fs';import path from 'node:path';import {DATA_DIR} from '../../src/config.js';const file=path.join(DATA_DIR,'loaded.txt');fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(file,String(Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1));export function setup(){}",
  );
  fs.mkdirSync(compiled, { recursive: true });
  await compileLegacyPackage(source, compiled);
  writeJsonAtomic(path.join(compiled, 'skill.json'), {
    id: 'demo',
    name: '延迟加载技能',
    entry: 'harness-entry.mjs',
    enabledByDefault: false,
    harnessMigration: { stage: 'preview' },
  });
  writeJsonAtomic(path.join(f.preview, 'migration-preview.json'), {
    source: f.source,
    rows: [{ id: 'demo', directory: 'skills', status: 'compiled-not-behavior-verified' }],
  });
  writeJsonAtomic(path.join(f.preview, 'migration-state.json'), {
    global: { demo: { enabled: false, settings: {} } },
    profiles: {},
  });
  installExtensionMigration(f.preview, f.data, f.extensions, true);
  const app = await createApplication({
    dataDir: f.data,
    v2ExtensionDir: f.extensions,
    extensionHotReload: false,
  });
  cleanups.push(app.stop);
  const host = app.runtime.use(extensionService),
    marker = path.join(f.data, 'loaded.txt');
  expect(fs.existsSync(marker)).toBe(false);
  await host.configure('demo', { enabled: true });
  expect(fs.readFileSync(marker, 'utf8')).toBe('1');
  expect(host.list().find((e) => e.id === 'demo')?.active).toBe(true);
  await host.configure('demo', { enabled: false });
  await host.configure('demo', { enabled: true });
  expect(fs.readFileSync(marker, 'utf8')).toBe('2');
});
test('已有设置与私有数据优先，迁入后变化拒绝覆盖回滚；禁止写入旧工程', () => {
  const f = fixture();
  const storage = openSqliteStorage(path.join(f.data, 'harness.sqlite'));
  storage.store.setState('extension-system', 'config', {
    skills: { demo: { enabled: false, key: 'new-key' } },
  });
  storage.close();
  fs.mkdirSync(path.join(f.data, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(f.data, 'demo/private.json'), 'new-native-data');
  const result = installExtensionMigration(f.preview, f.data, f.extensions, true) as { backup: string };
  expect(fs.readFileSync(path.join(f.data, 'demo/private.json'), 'utf8')).toBe('new-native-data');
  fs.writeFileSync(path.join(f.data, 'stamina.json'), 'changed');
  expect(() => restoreExtensionMigration(f.data, result.backup)).toThrow('已变化');
  expect(() => installExtensionMigration(f.preview, f.source, f.extensions, true)).toThrow('旧工程');
});
