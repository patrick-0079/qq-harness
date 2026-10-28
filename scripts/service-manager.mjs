import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { loadLaunch } from './live-config.mjs';

const require = createRequire(import.meta.url);
export function resolvePm2() {
  const candidates = [
    process.env.HARNESS_PM2_MODULE,
    'pm2',
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/pm2'),
    process.env.npm_config_prefix && path.join(process.env.npm_config_prefix, 'lib/node_modules/pm2'),
    path.join(path.dirname(process.execPath), 'node_modules/pm2'),
    '/usr/local/lib/node_modules/pm2',
    '/usr/lib/node_modules/pm2',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw new Error('PM2 模块无法加载，请检查本机安装');
    }
  }
  throw new Error('未找到 PM2，请安装 PM2 或设置 HARNESS_PM2_MODULE 为其绝对模块目录');
}
export const openPort = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
export function sanitize(text, root) {
  const values = [];
  try {
    values.push(loadLaunch(root).token);
  } catch {
    /* 缺少配置时仍可读取 PM2 日志。 */
  }
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'var/production/config.json'), 'utf8'));
    values.push(config.model?.apiKey, config.onebot?.accessToken, config.onebot?.httpAccessToken);
  } catch {
    /* 不影响管理已有实例。 */
  }
  let output = String(text);
  for (const value of values
    .filter((value) => typeof value === 'string' && value.length)
    .sort((a, b) => b.length - a.length))
    output = output.split(value).join('[REDACTED]');
  return output.replace(/(Bearer\s+)[\w.\-+/=]+/gi, '$1[REDACTED]');
}
export function tailFile(file, lines = 60) {
  if (!fs.existsSync(file)) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size,
      length = Math.min(size, 512 * 1024);
    const data = Buffer.alloc(length);
    fs.readSync(fd, data, 0, length, size - length);
    let text = data.toString('utf8');
    if (size > length) text = text.slice(text.indexOf('\n') + 1);
    return text.replace(/\r/g, '').trimEnd().split('\n').slice(-lines).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

export class ServiceManager {
  constructor(root, pm2, options = {}) {
    this.root = root;
    this.pm2 = pm2;
    this.fetch = options.fetch ?? fetch;
    this.portOpen = options.portOpen ?? openPort;
    this.waitMs = options.waitMs ?? 15000;
    this.app = require(path.join(root, 'ecosystem.config.cjs')).apps[0];
    if (this.app.name !== 'qq-harness') throw new Error('PM2 配置名称必须为 qq-harness');
  }
  call(method, ...args) {
    return new Promise((resolve, reject) =>
      this.pm2[method](...args, (error, result) =>
        error ? reject(new Error(`PM2 ${method} 失败`)) : resolve(result),
      ),
    );
  }
  async connect() {
    await this.call('connect');
  }
  disconnect() {
    this.pm2.disconnect();
  }
  async entries() {
    return await this.call('list');
  }
  owned(entries) {
    const matches = entries.filter((entry) => entry.name === this.app.name);
    if (matches.length > 1) throw new Error('检测到重名 PM2 实例，请先消除重复条目');
    const entry = matches[0];
    if (
      entry &&
      (path.resolve(entry.pm2_env.pm_exec_path) !== path.resolve(this.app.script) ||
        path.resolve(entry.pm2_env.pm_cwd) !== path.resolve(this.root))
    )
      throw new Error('同名 PM2 条目不属于本工程，拒绝操作');
    return entry;
  }
  async api(route, init) {
    const launch = loadLaunch(this.root);
    // Launch waits for Windows process inspection and a startup grace period.
    // A four-second read timeout can report failure after the component started.
    const timeoutMs = init?.method === 'POST' ? 45000 : /\/api\/(qq-portable|snowluma)\/status$/.test(route) ? 15000 : 4000;
    const response = await this.fetch(launch.baseUrl + route, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
      headers: {
        ...(launch.token ? { authorization: `Bearer ${launch.token}` } : {}),
        'content-type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`管理接口 ${route} 返回 HTTP ${response.status}`);
    return response.json();
  }
  async setup() {
    const entry = this.owned(await this.entries());
    if (!entry) {
      fs.mkdirSync(path.join(this.root, 'var/logs'), { recursive: true });
      await this.call('start', { ...this.app, autostart: false });
    }
    return {
      registered: true,
      started: false,
      initialStart:
        !entry || entry.pm2_env.autostart === false
          ? `node "${path.join(this.root, 'manage.mjs')}" start`
          : undefined,
    };
  }
  async start(restart = false) {
    loadLaunch(this.root);
    const entries = await this.entries(),
      entry = this.owned(entries);
    if (
      entries.some(
        (item) =>
          ['qq-agent', 'qq-agent-boot'].includes(item.name) &&
          !['stopped', 'errored'].includes(item.pm2_env.status),
      )
    )
      throw new Error('旧 qq-agent / qq-agent-boot 仍在运行，请先完成上线交接');
    if (
      !['online', 'launching'].includes(entry?.pm2_env.status) &&
      (await this.portOpen(loadLaunch(this.root).port))
    )
      throw new Error('目标端口被其他进程占用，拒绝重复启动');
    if (!entry) {
      fs.mkdirSync(path.join(this.root, 'var/logs'), { recursive: true });
      await this.call('start', this.app);
    } else if (restart || entry.pm2_env.status !== 'online') {
      // 从配置重启才能应用 shutdown_with_message、就绪等待等新版设置。
      await this.call('restart', { apps: [{ ...this.app, autostart: true }] }, { updateEnv: true });
    }
    const deadline = Date.now() + this.waitMs;
    while (Date.now() < deadline) {
      try {
        if ((await this.api('/api/health')).ok) return this.status();
      } catch {
        /* PM2 online 与 HTTP 就绪可能有短暂差距。 */
      }
      await delay(250);
    }
    throw new Error('后端就绪检查超时，请运行 logs 查看原因');
  }
  async stop() {
    const entry = this.owned(await this.entries());
    if (entry && entry.pm2_env.status !== 'stopped') await this.call('stop', entry.pm_id);
    return { stopped: true };
  }
  async startAll(restart = false) {
    await this.start(restart);
    let snowluma = await this.api('/api/snowluma/status');
    if (!snowluma.webuiReady) await this.component('snowluma', 'start');
    const deadline = Date.now() + this.waitMs;
    while (!snowluma.webuiReady && Date.now() < deadline) {
      snowluma = await this.api('/api/snowluma/status');
      if (!snowluma.webuiReady) await delay(250);
    }
    if (!snowluma.webuiReady) throw new Error('SnowLuma 就绪超时，请核对其协议同意和托管设置；后端继续运行');
    const qq = await this.api('/api/qq-portable/status');
    if (!qq.owned && qq.phase !== 'external') await this.component('qq', 'start');
    return this.status();
  }
  async remove() {
    const entry = this.owned(await this.entries());
    if (entry) await this.call('delete', entry.pm_id);
    return { removed: true };
  }
  async save() {
    await this.call('dump', true);
    return { saved: true };
  }
  async status() {
    const entry = this.owned(await this.entries());
    const result = {
      name: this.app.name,
      status: entry?.pm2_env.status ?? 'not-registered',
      pid: entry?.pid || null,
      restarts: entry?.pm2_env.restart_time ?? 0,
      uptimeMs: entry?.pm2_env.status === 'online' ? Math.max(0, Date.now() - entry.pm2_env.pm_uptime) : 0,
      memoryBytes: entry?.monit?.memory ?? 0,
      ready: false,
    };
    if (entry?.pm2_env.autostart === false)
      result.startHint =
        '首次注册保留了 autostart=false；请用 node manage.mjs start 从配置启动，再执行 save。';
    if (entry?.pm2_env.status !== 'online') return result;
    try {
      const value = await this.api('/api/status');
      result.ready = true;
      result.demo = value.demo;
      result.adapter = value.adapter;
      result.plugins = {
        total: value.plugins.length,
        failed: value.plugins.filter((plugin) => plugin.status === 'failed').length,
      };
      result.runs = {
        active: value.runs.filter((run) => run.status === 'running').length,
        queued: value.runs.filter((run) => run.status === 'queued').length,
      };
      for (const component of ['snowluma', 'qq-portable']) {
        try {
          const status = await this.api(`/api/${component}/status`);
          result[component] = { phase: status.phase, owned: status.owned, pid: status.pid };
        } catch {
          result[component] = { phase: 'unavailable' };
        }
      }
    } catch {
      result.apiError = '管理接口尚未就绪或认证失败';
    }
    return result;
  }
  async component(name, action) {
    if (!['qq', 'snowluma'].includes(name) || !['start', 'stop', 'status'].includes(action))
      throw new Error('组件命令无效');
    const entry = this.owned(await this.entries());
    if (entry?.pm2_env.status !== 'online') throw new Error('请先启动 qq-harness');
    const route = name === 'qq' ? 'qq-portable' : 'snowluma';
    const value = await this.api(
      `/api/${route}/${action === 'start' ? 'launch' : action}`,
      action === 'status' ? undefined : { method: 'POST' },
    );
    const status = value.status ?? value;
    return { component: name, action, phase: status.phase, owned: status.owned, pid: status.pid };
  }
}
