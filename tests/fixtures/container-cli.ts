import type { ContainerCli } from '@qq-harness/container-runtime';
import { ACCOUNT_SCRIPT } from '../../plugins/container-runtime/src/accounts.js';
import { TASK_SCRIPT, CANCEL_SCRIPT } from '../../plugins/container-runtime/src/task-process.js';

export function fakeContainerCli() {
  const calls: { binary: string; args: string[]; stdin?: string }[] = [];
  const containers = new Map<
    string,
    {
      Id: string;
      Name: string;
      Config: { Labels: Record<string, string>; Image?: string };
      State: { Running: boolean; Status: string };
    }
  >();
  const files = new Map<string, string>(),
    users = new Map<
      string,
      { username: string; uid: number; gid: number; home: string; workspace: string }
    >();
  const remote = new Set<string>();
  const flags = { failCreate: false, missingImage: false, failCleanup: false };
  let sequence = 0;
  const cli: ContainerCli = async (binary, args, options) => {
    options.signal.throwIfAborted();
    calls.push({ binary, args, stdin: options.stdin });
    const result = (stdout = '', exitCode = 0, stderr = '') => ({
      stdout: stdout.slice(0, options.maxOutputChars),
      stderr: stderr.slice(0, Math.max(0, options.maxOutputChars - stdout.length)),
      exitCode,
      truncated: stdout.length + stderr.length > options.maxOutputChars,
    });
    if (args[0] === 'info') return result('{}');
    if (args[0] === 'image') return flags.missingImage ? result('', 1, '配置镜像不存在') : result('{}');
    const action = args[1];
    if (action === 'ls') {
      const rows = [...containers.values()].map((r) => ({
        Id: r.Id,
        Names: r.Name,
        Image: r.Config.Image ?? 'fixture:test',
        State: r.State.Running ? 'running' : 'exited',
      }));
      return result(
        binary === 'docker' ? rows.map((r) => JSON.stringify(r)).join('\n') : JSON.stringify(rows),
      );
    }
    if (action === 'create') {
      if (flags.failCreate) return result('', 125, 'image missing');
      const id = (++sequence).toString(16).padStart(64, 'a'),
        labels: Record<string, string> = {};
      args.forEach((a, i) => {
        if (a === '--label') {
          const s = args[i + 1]!,
            n = s.indexOf('=');
          labels[s.slice(0, n)] = s.slice(n + 1);
        }
      });
      containers.set(id, {
        Id: id,
        Name: args[args.indexOf('--name') + 1]!,
        Config: { Labels: labels, Image: 'fixture:test' },
        State: { Running: false, Status: 'created' },
      });
      return result(id);
    }
    const row = [...containers.values()].find((r) => args.includes(r.Id) || args.includes(r.Name));
    if (!row) return result('', 1, 'No such container');
    if (action === 'inspect') return result(JSON.stringify([row]));
    if (action === 'start') {
      row.State = { Running: true, Status: 'running' };
      return result(row.Id);
    }
    if (action === 'stop') {
      row.State = { Running: false, Status: 'exited' };
      return result(row.Id);
    }
    if (action === 'rm') {
      containers.delete(row.Id);
      return result(row.Id);
    }
    if (action !== 'exec') throw Error('unknown mock action ' + action);
    const script = args.at(-1),
      job = options.stdin ? JSON.parse(options.stdin) : {};
    if (script === ACCOUNT_SCRIPT) {
      const key = row.Id + '/' + job.username;
      let user = users.get(key);
      if (!user) {
        const home = '/home/' + job.username;
        user = {
          username: job.username,
          uid: 20000 + users.size,
          gid: 20000 + users.size,
          home,
          workspace: home + '/workspace',
        };
        users.set(key, user);
      }
      return result(JSON.stringify(user));
    }
    if (script === CANCEL_SCRIPT) {
      if (flags.failCleanup) return result('', 125, 'cleanup unavailable');
      remote.delete(job.id);
      return result('cancelled');
    }
    if (script !== TASK_SCRIPT) throw Error('unexpected exec protocol');
    const command = job.argv as string[],
      file = command.at(-1),
      content = job.stdin ?? '';
    if (command[0] === 'cat') {
      const other = /^\/home\/([gp][0-9]+)\//.exec(file ?? '')?.[1];
      return other && other !== job.username
        ? result('', 1, 'Permission denied')
        : result(files.get(row.Id + '/' + file) ?? '');
    }
    if (command[0] === 'sh' && command[1] === '-c' && command[2]?.startsWith('mkdir -p')) {
      files.set(row.Id + '/' + file, content);
      return result();
    }
    if (file === 'wait') {
      remote.add(job.id);
      options.onOutput?.('stdout', 'started\n');
      return new Promise((_, reject) => {
        const abort = () => reject(options.signal.reason);
        options.signal.addEventListener('abort', abort, { once: true });
        if (options.signal.aborted) abort();
      });
    }
    if (file === 'fail') return result('', 7, 'fixture failure');
    const text = 'fixture-output\n';
    options.onOutput?.('stdout', text);
    return result(text);
  };
  return { cli, calls, containers, files, remote, flags, users };
}
