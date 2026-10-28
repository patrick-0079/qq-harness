import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export interface QqProcess {
  pid: number;
  executable: string;
}
export interface QqProcessDriver {
  supported: boolean;
  list(): Promise<QqProcess[]>;
  launch(executable: string, dataDirectory: string): ChildProcess;
  stop(child: ChildProcess): Promise<void>;
}
export const windowsQqProcess: QqProcessDriver = {
  supported: process.platform === 'win32',
  async list() {
    // 路径不插入 PowerShell 代码；查询失败必须报错，不能误判“没有 QQ”。
    const script =
      "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -Filter \"Name='QQ.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress";
    const system = process.env.SystemRoot ?? 'C:\\Windows';
    const { stdout } = await exec(
      path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const raw: unknown = JSON.parse(stdout.trim().replace(/^\uFEFF/, '') || '[]');
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return rows.map((row: { ProcessId?: unknown; ExecutablePath?: unknown }) => {
      if (!Number.isSafeInteger(row.ProcessId) || Number(row.ProcessId) <= 0 || !row.ExecutablePath)
        throw new Error('无法确认现有 QQ 进程路径，暂不启动便携实例');
      return { pid: Number(row.ProcessId), executable: String(row.ExecutablePath) };
    });
  },
  launch(executable, dataDirectory) {
    // 登录窗口由用户交互；不使用 shell，不继承日常 QQ 的 profile，不采集 QQ 日志。
    // 与旧版已验证的 Windows 启动方式一致：独立进程组及有效输出管道。
    // 仍保留 ChildProcess 句柄，卸载时按自有 PID 回收，不按 QQ.exe 名称清理。
    const child = spawn(executable, [`--user-data-dir=${dataDirectory}`], {
      cwd: path.dirname(executable),
      windowsHide: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 消费输出防止缓冲区阻塞，但不将第三方账号日志暴露给控制台。
    child.stdout?.resume();
    child.stderr?.resume();
    return child;
  },
  async stop(child) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const system = process.env.SystemRoot ?? 'C:\\Windows';
    try {
      await exec(path.join(system, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      });
    } catch {
      if (child.exitCode === null && child.signalCode === null)
        throw new Error('无法停止本插件启动的便携 QQ');
    }
  },
};

export function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}
