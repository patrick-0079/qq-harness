import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** A live PID may have been reused after the original owner exited. Unknown identity stays locked. */
export function processOwnsLock(pid: number, lockTime: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('锁 PID 无效');
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
  try {
    const started =
      pid === process.pid
        ? Date.now() - process.uptime() * 1000
        : process.platform === 'win32'
          ? Date.parse(
              execFileSync(
                'powershell.exe',
                [
                  '-NoProfile',
                  '-NonInteractive',
                  '-Command',
                  `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
                ],
                { encoding: 'utf8', windowsHide: true, timeout: 5000 },
              ).trim(),
            )
          : NaN;
    return !Number.isFinite(started) || started <= lockTime + 1000;
  } catch {
    return true;
  }
}

// 锁按第三方安装目录命名，跨不同 Harness 数据目录也能阻止并发启动。
export function lockDirectory(
  directory: string,
  lockRoot = path.join(os.tmpdir(), 'qq-harness-process-locks'),
  label = '运行程序',
): () => void {
  fs.mkdirSync(lockRoot, { recursive: true });
  const canonical = fs.realpathSync(directory);
  const key = createHash('sha256')
    .update(process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    .digest('hex');
  const file = path.join(lockRoot, key + '.lock');
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file);
        } catch {
          /* 其他代的锁不能删除。 */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: { pid?: number };
      const original = fs.readFileSync(file, 'utf8');
      const lockTime = fs.statSync(file).mtimeMs;
      try {
        owner = JSON.parse(original);
      } catch {
        throw new Error(label + ' 安装目录的锁无法确认归属，请检查残留锁');
      }
      if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0)
        throw new Error(label + ' 安装目录锁的 PID 无效');
      if (processOwnsLock(owner.pid!, lockTime))
        throw new Error('其他 Harness 实例正在管理此 ' + label + ' 目录');
      // Recheck ownership before isolating a stale lock; never stop the process that reused its PID.
      if (fs.readFileSync(file, 'utf8') !== original) continue;
      fs.renameSync(file, file + '.stale-' + randomUUID());
    }
  }
  throw new Error(label + ' 安装目录锁获取失败');
}
