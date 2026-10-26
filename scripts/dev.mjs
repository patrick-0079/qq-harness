import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const processes = [
  spawn(
    process.execPath,
    [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', path.join(root, 'apps/server/src/main.ts')],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  ),
  spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      '--config',
      path.join(root, 'apps/console/vite.config.ts'),
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  ),
];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of processes)
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
