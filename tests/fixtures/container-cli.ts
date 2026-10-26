import type { ContainerCli } from '@qq-harness/container-runtime';

export function fakeContainerCli() {
  const calls: { binary: string; args: string[]; stdin?: string }[] = [];
  const containers = new Map<
    string,
    {
      Id: string;
      Name: string;
      Config: { Labels: Record<string, string> };
      State: { Running: boolean; Status: string };
    }
  >();
  const files = new Map<string, string>();
  const remote = new Set<string>();
  const flags = { failCreate: false };
  let sequence = 0;
  const cli: ContainerCli = async (binary, args, options) => {
    options.signal.throwIfAborted();
    calls.push({ binary, args, stdin: options.stdin });
    const result = (stdout = '', exitCode = 0, stderr = '') => {
      const total = stdout.length + stderr.length;
      return {
        stdout: stdout.slice(0, options.maxOutputChars),
        stderr: stderr.slice(0, Math.max(0, options.maxOutputChars - stdout.length)),
        exitCode,
        truncated: total > options.maxOutputChars,
      };
    };
    if (args[0] === 'info') return result('{}');
    const action = args[1];
    if (action === 'create') {
      if (flags.failCreate) return result('', 125, 'image missing');
      const id = (++sequence).toString(16).padStart(64, 'a');
      const labels: Record<string, string> = {};
      args.forEach((arg, i) => {
        if (arg === '--label') {
          const label = args[i + 1]!;
          const n = label.indexOf('=');
          labels[label.slice(0, n)] = label.slice(n + 1);
        }
      });
      containers.set(id, {
        Id: id,
        Name: args[args.indexOf('--name') + 1]!,
        Config: { Labels: labels },
        State: { Running: false, Status: 'created' },
      });
      return result(id);
    }
    const record = [...containers.values()].find((row) => args.includes(row.Id) || args.includes(row.Name));
    if (!record) return result('', 1, 'No such container');
    if (action === 'inspect') return result(JSON.stringify([record]));
    if (action === 'start') {
      record.State = { Running: true, Status: 'running' };
      return result(record.Id);
    }
    if (action === 'stop') {
      record.State = { Running: false, Status: 'exited' };
      remote.delete(record.Id);
      return result(record.Id);
    }
    if (action === 'rm') {
      containers.delete(record.Id);
      return result(record.Id);
    }
    if (action !== 'exec') throw new Error(`未知 mock 动作 ${action}`);
    const command = args.slice(args.indexOf(record.Id) + 1);
    if (command[0] === 'cat') return result(files.get(`${record.Id}/${command.at(-1)}`) ?? '');
    if (command[0] === 'sh' && command[1] === '-c') {
      files.set(`${record.Id}/${command.at(-1)}`, options.stdin ?? '');
      return result();
    }
    const shell = command.at(-1);
    if (shell === 'wait') {
      remote.add(record.Id);
      options.onOutput?.('stdout', 'started\n');
      return await new Promise((_, reject) => {
        const abort = () => reject(options.signal.reason);
        options.signal.addEventListener('abort', abort, { once: true });
        if (options.signal.aborted) abort();
      });
    }
    if (shell === 'fail') return result('', 7, 'fixture failure');
    const text = 'fixture-output\n';
    options.onOutput?.('stdout', text);
    return result(text);
  };
  return { cli, calls, containers, files, remote, flags };
}
