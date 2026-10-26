import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

// 锁按第三方安装目录命名，跨不同 Harness 数据目录也能阻止并发启动。
export function lockInstallation(
  directory: string,
  lockRoot = path.join(os.tmpdir(), 'qq-harness-process-locks'),
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
      try {
        owner = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        throw new Error('SnowLuma 安装目录的锁无法确认归属，请检查残留锁');
      }
      if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0)
        throw new Error('SnowLuma 安装目录锁的 PID 无效');
      try {
        process.kill(owner.pid!, 0);
        throw new Error('其他 Harness 实例正在管理此 SnowLuma 目录');
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe;
      }
      // 只隔离已确认 PID 不存在的旧锁，不按进程名清理任何程序。
      fs.renameSync(file, file + '.stale-' + randomUUID());
    }
  }
  throw new Error('SnowLuma 安装目录锁获取失败');
}
