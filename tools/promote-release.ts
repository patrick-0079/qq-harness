import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '@qq-harness/files';
import { acquireDataLock } from '../apps/server/src/lock.js';
import { loadLaunch, releaseDirectory, managedExtensionDirectory } from '../scripts/live-config.mjs';
import { hashes, ownedChild, requiredChecks, sha, sourceFingerprint } from './release-files.js';
export function checkCandidate(root: string, candidate: string) {
  const folder = ownedChild(path.join(root, 'var/builds'), candidate),
    file = path.join(folder, 'verification.json');
  const verified = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    verified.version !== 1 ||
    verified.status !== 'passed' ||
    requiredChecks.some((name) => verified.checks?.[name]?.exitCode !== 0)
  )
    throw new Error('版本尚未通过全部验收');
  if (verified.sourceSha !== sourceFingerprint(root)) throw new Error('验收后源码已变化，请重新验证');
  if (JSON.stringify(verified.files) !== JSON.stringify(hashes(folder, ['verification.json'])))
    throw new Error('验收后的构建文件发生变化');
  for (const file of ['server/main.mjs', 'console/index.html'])
    if (!fs.existsSync(path.join(folder, file))) throw new Error('版本缺少后端或控制台入口');
  return { folder, verified };
}
export function promoteRelease(root: string, candidate: string, apply = false, extensions?: string) {
  const checked = checkCandidate(root, candidate),
    launch = loadLaunch(root),
    file = path.join(launch.dataDir, 'launch.json'),
    before = fs.readFileSync(file);
  const extension = extensions ? managedExtensionDirectory(root, extensions) : undefined;
  if (extension) {
    const catalog = JSON.parse(fs.readFileSync(path.join(extension, 'installed-catalog.json'), 'utf8'));
    if (catalog.version !== 1 || !Array.isArray(catalog.codeHashes)) throw Error('扩展版本缺少完整性清单');
    for (const row of catalog.codeHashes) {
      const file = ownedChild(extension, path.join(extension, row.file));
      if (sha(fs.readFileSync(file)) !== row.sha256) throw Error('扩展代码已变化，拒绝上线');
    }
  }
  if (!apply)
    return {
      applied: false,
      candidate: checked.folder,
      current: launch.releaseDirectory,
      checks: requiredChecks,
      ...(extension ? { extensionDirectory: extension } : {}),
    };
  const unlock = acquireDataLock(launch.dataDir);
  try {
    if (sha(before) !== sha(fs.readFileSync(file))) throw new Error('上线配置在预览后发生变化');
    const target = ownedChild(
      path.join(root, 'var/releases'),
      path.join(
        root,
        'var/releases',
        new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8),
      ),
    );
    fs.cpSync(checked.folder, target, { recursive: true, dereference: false });
    if (JSON.stringify(hashes(target, ['verification.json'])) !== JSON.stringify(checked.verified.files))
      throw new Error('复制后的版本校验失败');
    releaseDirectory(root, target);
    const backup = path.join(launch.dataDir, 'backups', 'release-' + randomUUID());
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'launch.json'), before);
    const next = {
      ...JSON.parse(before.toString('utf8').replace(/^\uFEFF/, '')),
      releaseDirectory: target,
      ...(extension ? { extensionDirectory: extension } : {}),
    };
    writeJsonAtomic(path.join(backup, 'manifest.json'), {
      version: 1,
      kind: 'release-pointer',
      beforeSha: sha(before),
      afterJsonSha: sha(JSON.stringify(next)),
      target,
      previous: launch.releaseDirectory,
    });
    writeJsonAtomic(file, next);
    return { applied: true, release: target, backup };
  } finally {
    unlock();
  }
}
export function restoreRelease(root: string, backup: string, apply = false) {
  const launch = loadLaunch(root),
    folder = ownedChild(path.join(launch.dataDir, 'backups'), backup),
    record = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')),
    bytes = fs.readFileSync(path.join(folder, 'launch.json'));
  if (record.version !== 1 || record.kind !== 'release-pointer' || sha(bytes) !== record.beforeSha)
    throw new Error('版本备份校验失败');
  if (launch.releaseDirectory !== record.target) throw new Error('当前版本已发生变化，拒绝覆盖');
  if (
    sha(JSON.stringify(JSON.parse(fs.readFileSync(path.join(launch.dataDir, 'launch.json'), 'utf8')))) !==
    record.afterJsonSha
  )
    throw new Error('上线配置在切换后已修改，拒绝覆盖');
  const original = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  releaseDirectory(root, original.releaseDirectory);
  if (apply) {
    const unlock = acquireDataLock(launch.dataDir);
    try {
      const file = path.join(launch.dataDir, 'launch.json'),
        temp = file + '.' + randomUUID() + '.tmp';
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, file);
    } finally {
      unlock();
    }
  }
  return { restored: apply, release: record.previous };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    get = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1),
    root = path.resolve(get('--root') ?? fileURLToPath(new URL('../', import.meta.url))),
    candidate = get('--candidate'),
    backup = get('--restore');
  if (args.includes('--apply') && !args.includes('--offline'))
    throw new Error('切换版本须先停机并显式传 --offline');
  if (!candidate && !backup) throw new Error('需要 --candidate=<验收构建> 或 --restore=<备份>');
  console.log(
    JSON.stringify(
      backup
        ? restoreRelease(root, backup, args.includes('--apply'))
        : promoteRelease(root, candidate!, args.includes('--apply'), get('--extensions')),
      null,
      2,
    ),
  );
}
