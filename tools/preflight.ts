import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { configSchema } from '@qq-harness/contracts';
import { verifyPortable } from '../scripts/portable-qq.mjs';
import { loadLaunch } from '../scripts/live-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = path.join(root, 'var/production');
const checks: { check: string; status: 'pass' | 'pending' | 'fail'; detail?: string }[] = [];
const add = (check: string, success: boolean, detail?: string) =>
  checks.push({ check, status: success ? 'pass' : 'fail', detail });
const portOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
try {
  add('Node.js 24+', Number(process.versions.node.split('.')[0]) >= 24);
  const portable = verifyPortable(path.join(root, 'runtime/qq-portable'));
  add('便携 QQ 程序哈希', portable.verified, `${portable.version}, ${portable.files} files`);
  add(
    '构建产物',
    ['dist/server/main.mjs', 'dist/console/index.html'].every((file) => fs.existsSync(path.join(root, file))),
  );
  const config = configSchema.parse(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')));
  const launch = loadLaunch(root);
  add(
    '模型渠道与凭据',
    Boolean(
      config.model.model &&
      config.model.apiKey &&
      ['http:', 'https:'].includes(new URL(config.model.baseUrl).protocol),
    ),
  );
  add(
    'OneBot 独立配置',
    ['ws:', 'wss:'].includes(new URL(config.onebot.wsUrl).protocol) &&
      ['http:', 'https:'].includes(new URL(config.onebot.httpUrl).protocol) &&
      Boolean(config.onebot.accessToken),
  );
  add(
    '会话准入',
    launch.allowedChats === undefined ||
      (Array.isArray(launch.allowedChats) &&
        launch.allowedChats.length > 0 &&
        launch.allowedChats.every(
          (key: string) =>
            (config.admissions.includes(key) || Object.hasOwn(config.profiles, key)) &&
            !config.deniedChats.includes(key),
        )),
  );
  add(
    '管理令牌',
    launch.token === '' || launch.token.length >= 32,
    launch.token ? '已启用管理令牌验证' : '已关闭，本机控制台无需填写管理令牌',
  );
  add('目标实例未运行', !fs.existsSync(path.join(data, 'harness.lock')));
  add('目标端口空闲', !(await portOpen(launch.port)));
  add(
    'SnowLuma 程序存在',
    Boolean(launch.snowlumaDirectory && fs.existsSync(path.join(launch.snowlumaDirectory, 'index.mjs'))),
  );
  checks.push({
    check: '生产切换与账号登录',
    status: 'pending',
    detail: '停止旧消费者及开机编排后，启动新实例，在 QQ 窗口登录并验收；本命令不启动服务或发送消息',
  });
  const report = {
    checkedAt: new Date().toISOString(),
    staticReady: !checks.some((item) => item.status === 'fail'),
    liveVerified: false,
    checks,
  };
  fs.writeFileSync(path.join(data, 'preflight.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.staticReady) process.exitCode = 1;
} catch {
  console.error('上线预检失败，请核对本地迁移配置、程序清单与构建产物。未输出配置内容。');
  process.exitCode = 1;
}
