import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireDataLock(dataDir: string): () => void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'harness.lock');
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }), 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file);
        } catch {
          /* 只撤销本进程拥有的锁。 */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let pid: number;
      try {
        pid = Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid);
      } catch {
        throw new Error('数据目录锁格式损坏，请离线检查后处理');
      }
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('数据目录锁 PID 无效');
      try {
        process.kill(pid, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') {
          fs.unlinkSync(file);
          continue;
        }
        throw new Error('无法确认数据目录锁归属，拒绝并行写入');
      }
      throw new Error('该数据目录已有 QQ Harness 实例运行');
    }
  }
  throw new Error('无法获得数据目录锁');
}
