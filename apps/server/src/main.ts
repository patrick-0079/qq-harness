import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApplication } from './app.js';
import { acquireDataLock } from './lock.js';

let root = path.dirname(fileURLToPath(import.meta.url));
while (
  !fs.existsSync(path.join(root, 'package.json')) ||
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name !== 'qq-harness'
) {
  const parent = path.dirname(root);
  if (parent === root) throw new Error('找不到 qq-harness 工程根');
  root = parent;
}
const args = process.argv.slice(2);
const port = Number(
  args.find((arg) => arg.startsWith('--port='))?.slice(7) ?? process.env.HARNESS_PORT ?? 3310,
);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');
const ephemeral = args.includes('--ephemeral');
const dataDir = ephemeral
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'qq-harness-'))
  : path.resolve(process.env.HARNESS_DATA_DIR ?? path.join(root, 'var', 'local'));
const releaseLock = acquireDataLock(dataDir);
process.on('exit', releaseLock);
const application = await createApplication({
  dataDir,
  extensionDir: path.join(root, 'extensions'),
  v2ExtensionDir: ephemeral
    ? path.join(dataDir, 'extensions')
    : path.resolve(process.env.HARNESS_V2_EXTENSION_ROOT ?? path.join(root, 'extensions-v2')),
  demo: !args.includes('--live'),
  token: process.env.HARNESS_TOKEN,
  containers: { allowOperations: args.includes('--containers') || args.includes('--live') },
  allowedChats:
    process.env.HARNESS_ALLOWED_CHATS === undefined
      ? undefined
      : process.env.HARNESS_ALLOWED_CHATS.split(',')
          .map((key) => key.trim())
          .filter(Boolean),
});
const staticRoot = path.join(root, 'dist', 'console');
application.app.use('*', async (c, next) => {
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  await next();
});
application.app.use('*', serveStatic({ root: staticRoot }));
application.app.get('*', serveStatic({ path: path.join(staticRoot, 'index.html') }));
const server = serve({ fetch: application.app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`QQ Harness ${args.includes('--live') ? 'OneBot' : 'DEMO'}: http://127.0.0.1:${info.port}`);
  process.send?.({ type: 'ready', port: info.port });
});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await application.stop();
  releaseLock();
  if (ephemeral) {
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(dataDir));
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && /^qq-harness-[^\\/]+$/.test(relative))
      fs.rmSync(dataDir, { recursive: true, force: true });
  }
};
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
process.on('message', (message) => {
  if (message === 'shutdown')
    void stop().finally(() => {
      if (process.connected) process.disconnect?.();
    });
});
