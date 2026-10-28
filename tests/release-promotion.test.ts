import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { writeJsonAtomic } from '@qq-harness/files';
import { promoteRelease, restoreRelease, checkCandidate } from '../tools/promote-release.js';
import { hashes, sourceFingerprint, requiredChecks, sha } from '../tools/release-files.js';
import { acquireDataLock } from '../apps/server/src/lock.js';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const full = fs.realpathSync(root);
    if (
      path.dirname(full) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(full).startsWith('harness-release-')
    )
      throw new Error('清理越界');
    fs.rmSync(full, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-release-'));
  roots.push(root);
  const data = path.join(root, 'var/production'),
    candidate = path.join(root, 'var/builds/candidate');
  fs.mkdirSync(data, { recursive: true });
  for (const [file, text] of Object.entries({
    'server/main.mjs': 'export const fixture=true;',
    'console/index.html': '<p>已验收</p>',
  })) {
    const target = path.join(candidate, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const bytes = JSON.stringify({
    port: 3310,
    concurrency: 2,
    token: '',
    snowlumaDirectory: path.join(root, 'external-snow'),
    custom: '保留字段',
  });
  fs.writeFileSync(path.join(data, 'launch.json'), bytes);
  const seal = () =>
    writeJsonAtomic(path.join(candidate, 'verification.json'), {
      version: 1,
      status: 'passed',
      checks: Object.fromEntries(requiredChecks.map((name) => [name, { exitCode: 0 }])),
      files: hashes(candidate, ['verification.json']),
      sourceSha: sourceFingerprint(root),
    });
  seal();
  return { root, data, candidate, bytes, seal };
}
test('代码与扩展目录原子切换并一起回滚；已改动的扩展在只读预览阶段拒绝', () => {
  const f = fixture(),
    extensions = path.join(f.root, 'var/extension-releases/accepted');
  fs.mkdirSync(extensions, { recursive: true });
  fs.writeFileSync(path.join(extensions, 'entry.mjs'), 'fixture');
  writeJsonAtomic(path.join(extensions, 'installed-catalog.json'), {
    version: 1,
    codeHashes: [{ file: 'entry.mjs', sha256: sha('fixture') }],
  });
  expect(promoteRelease(f.root, f.candidate, false, extensions)).toMatchObject({
    applied: false,
    extensionDirectory: extensions,
  });
  const changed = promoteRelease(f.root, f.candidate, true, extensions) as { backup: string };
  expect(JSON.parse(fs.readFileSync(path.join(f.data, 'launch.json'), 'utf8')).extensionDirectory).toBe(
    extensions,
  );
  restoreRelease(f.root, changed.backup, true);
  expect(fs.readFileSync(path.join(f.data, 'launch.json'), 'utf8')).toBe(f.bytes);
  fs.writeFileSync(path.join(extensions, 'entry.mjs'), 'modified');
  expect(() => promoteRelease(f.root, f.candidate, false, extensions)).toThrow('扩展代码');
});
test('正式版本切换先预览，锁定停机数据、保留启动配置，回滚恢复字节，不改构建目录', () => {
  const f = fixture();
  expect(promoteRelease(f.root, f.candidate)).toMatchObject({ applied: false });
  expect(fs.existsSync(path.join(f.root, 'var/releases'))).toBe(false);
  const unlock = acquireDataLock(f.data);
  try {
    expect(() => promoteRelease(f.root, f.candidate, true)).toThrow('已有');
  } finally {
    unlock();
  }
  const applied = promoteRelease(f.root, f.candidate, true) as {
    applied: true;
    release: string;
    backup: string;
  };
  expect(applied.applied).toBe(true);
  expect(fs.readFileSync(path.join(applied.release, 'server/main.mjs'), 'utf8')).toContain('fixture');
  expect(JSON.parse(fs.readFileSync(path.join(f.data, 'launch.json'), 'utf8'))).toMatchObject({
    token: '',
    custom: '保留字段',
    releaseDirectory: applied.release,
  });
  expect(restoreRelease(f.root, applied.backup)).toMatchObject({ restored: false });
  restoreRelease(f.root, applied.backup, true);
  expect(fs.readFileSync(path.join(f.data, 'launch.json'), 'utf8')).toBe(f.bytes);
  expect(fs.existsSync(f.candidate)).toBe(true);
});
test('拒绝未验收、构建变动、源码变动和外部版本；回滚不覆盖切换后修改的配置', () => {
  const f = fixture(),
    verification = path.join(f.candidate, 'verification.json'),
    original = fs.readFileSync(verification, 'utf8');
  fs.writeFileSync(verification, JSON.stringify({ version: 1, status: 'pending' }));
  expect(() => checkCandidate(f.root, f.candidate)).toThrow('验收');
  fs.writeFileSync(verification, original);
  fs.writeFileSync(path.join(f.candidate, 'console/index.html'), '已改动');
  expect(() => checkCandidate(f.root, f.candidate)).toThrow('构建文件');
  f.seal();
  fs.mkdirSync(path.join(f.root, 'apps'));
  fs.writeFileSync(path.join(f.root, 'apps/a.ts'), '变更');
  expect(() => checkCandidate(f.root, f.candidate)).toThrow('源码');
  f.seal();
  expect(() => checkCandidate(f.root, f.root)).toThrow('目录');
  const applied = promoteRelease(f.root, f.candidate, true) as { backup: string };
  const file = path.join(f.data, 'launch.json'),
    launch = JSON.parse(fs.readFileSync(file, 'utf8'));
  writeJsonAtomic(file, { ...launch, port: 3320 });
  expect(() => restoreRelease(f.root, applied.backup, true)).toThrow('已修改');
});
