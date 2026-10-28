// 显式运行的本机 PM2 集成验收；仅使用独立 PM2_HOME 与假 HTTP 后端。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ServiceManager, resolvePm2, openPort } from '../../scripts/service-manager.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, 'var/verification/pm2-smoke-' + process.pid);
fs.mkdirSync(directory, { recursive: true });
const home = path.join(directory, 'daemon');
process.env.PM2_HOME = home;
const appRoot = path.join(directory, 'fixture');
fs.mkdirSync(path.join(appRoot, 'var/production'), { recursive: true });
fs.mkdirSync(path.join(appRoot, 'dist/server'), { recursive: true });
const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const token = randomBytes(32).toString('hex');
fs.writeFileSync(
  path.join(appRoot, 'var/production/launch.json'),
  JSON.stringify({ port, concurrency: 1, token, allowedChats: ['group:123'] }),
);
fs.writeFileSync(
  path.join(appRoot, 'dist/server/main.mjs'),
  `
import http from 'node:http';
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');
if(req.headers.authorization!=='Bearer '+process.env.HARNESS_TOKEN){res.writeHead(401);return res.end('{}');}
res.end(JSON.stringify(req.url==='/api/health'?{ok:true}:req.url==='/api/status'?{demo:false,adapter:{kind:'fixture',connected:false},plugins:[],runs:[]}:{phase:'ready',owned:false,pid:null}));});
server.listen(Number(process.env.HARNESS_PORT),'127.0.0.1',()=>process.send('ready'));
process.on('message',message=>{if(message==='shutdown')server.close(()=>process.disconnect());});`,
);
fs.mkdirSync(path.join(appRoot, 'scripts'));
for (const name of ['start-live.mjs', 'live-config.mjs'])
  fs.copyFileSync(path.join(root, 'scripts', name), path.join(appRoot, 'scripts', name));
const entry = path.join(appRoot, 'scripts/start-live.mjs');
fs.writeFileSync(
  path.join(appRoot, 'ecosystem.config.cjs'),
  `module.exports=${JSON.stringify({
    apps: [
      {
        name: 'qq-harness',
        cwd: appRoot,
        script: entry,
        interpreter: process.execPath,
        exec_mode: 'fork',
        instances: 1,
        wait_ready: true,
        listen_timeout: 10000,
        shutdown_with_message: true,
        kill_timeout: 10000,
        autorestart: false,
        vizion: false,
        out_file: path.join(directory, 'out.log'),
        error_file: path.join(directory, 'error.log'),
        env: { HARNESS_PM2: '1' },
      },
    ],
  })};`,
);
// Windows 版 PM2 忽略 PM2_HOME 的默认管道命名。使用进程内 daemon，
// 并显式替换三条管道；不允许任何测试连接默认 rpc.sock/pub.sock。
const api = resolvePm2();
const pm2 = new api.custom({ pm2_home: home, daemon_mode: false });
const pipeRoot =
  process.platform === 'win32' ? `\\\\.\\pipe\\harness-pm2-smoke-${process.pid}-` : path.join(home, 'smoke-');
pm2._conf.DAEMON_RPC_PORT = pipeRoot + 'rpc.sock';
pm2._conf.DAEMON_PUB_PORT = pipeRoot + 'pub.sock';
pm2._conf.INTERACTOR_RPC_PORT = pipeRoot + 'interactor.sock';
pm2.Client.rpc_socket_file = pm2._conf.DAEMON_RPC_PORT;
pm2.Client.pub_socket_file = pm2._conf.DAEMON_PUB_PORT;
assert.ok(
  pm2.Client.rpc_socket_file.includes(`smoke-${process.pid}-`) ||
    pm2.Client.rpc_socket_file.startsWith(home + path.sep),
);
const manager = new ServiceManager(appRoot, pm2);
const steps = [];
let passed = false;
try {
  await manager.connect();
  await manager.setup();
  assert.equal((await manager.status()).status, 'stopped');
  steps.push('register-stopped');
  await manager.save();
  steps.push('save');
  const first = await manager.start();
  assert.equal(first.ready, true);
  steps.push('start-ready');
  const again = await manager.start();
  assert.equal(again.pid, first.pid);
  steps.push('start-idempotent');
  const restarted = await manager.start(true);
  assert.equal(restarted.ready, true);
  assert.notEqual(restarted.pid, first.pid);
  steps.push('restart-new-pid');
  await manager.stop();
  assert.equal((await manager.status()).status, 'stopped');
  assert.equal(await openPort(port), false);
  steps.push('stop-graceful');
  // 按用户实际使用方式，直接按名称重启；不能只验证管理器的配置重启。
  await new Promise((resolve, reject) =>
    pm2.restart('qq-harness', (error) => (error ? reject(error) : resolve())),
  );
  assert.equal((await manager.status()).ready, true);
  const entries = await manager.entries();
  assert.notEqual(entries.find((entry) => entry.name === 'qq-harness').pm2_env.autostart, false);
  steps.push('native-name-restart');
  await manager.stop();
  await manager.remove();
  await manager.save();
  assert.equal((await manager.status()).status, 'not-registered');
  steps.push('remove-save-empty');
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: true, steps }, null, 2));
  console.log(JSON.stringify({ passed: true, steps }, null, 2));
  passed = true;
} catch (error) {
  console.error(error.message);
} finally {
  await manager.stop().catch(() => {});
  manager.disconnect();
  // daemon 在本测试进程内；退出关闭其管道和定时器，绝不调用 killDaemon。
  setTimeout(() => process.exit(passed ? 0 : 1), 100);
}
