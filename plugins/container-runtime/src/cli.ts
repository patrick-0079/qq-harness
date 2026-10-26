import { spawn } from 'node:child_process';
import type { ContainerExecResult } from '@qq-harness/contracts';

export interface CliOptions {
  signal: AbortSignal;
  maxOutputChars: number;
  stdin?: string;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}
export type ContainerCli = (
  binary: string,
  args: string[],
  options: CliOptions,
) => Promise<ContainerExecResult>;

// shell 始终关闭；模型的命令只能作为 OCI exec 的容器内参数，不能成为宿主命令。
export const runContainerCli: ContainerCli = (binary, args, options) =>
  new Promise((resolve, reject) => {
    options.signal.throwIfAborted();
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '',
      truncated = false;
    const capture = (stream: 'stdout' | 'stderr', text: string) => {
      const used = stdout.length + stderr.length;
      const kept = text.slice(0, Math.max(0, options.maxOutputChars - used));
      if (kept.length < text.length) truncated = true;
      if (stream === 'stdout') stdout += kept;
      else stderr += kept;
      if (kept) options.onOutput?.(stream, kept);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => capture('stdout', text));
    child.stderr.on('data', (text: string) => capture('stderr', text));
    const abort = () => {
      child.kill();
    };
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.once('error', (error) => {
      options.signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code) => {
      options.signal.removeEventListener('abort', abort);
      if (options.signal.aborted) reject(options.signal.reason);
      else resolve({ exitCode: code ?? -1, stdout, stderr, truncated });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin);
  });
