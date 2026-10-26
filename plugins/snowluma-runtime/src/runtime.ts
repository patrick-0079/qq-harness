import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import {
  snowlumaSettingsSchema,
  type SnowlumaSettings,
  type SnowlumaStatus,
  type SnowlumaLog,
} from '@qq-harness/contracts';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import type { ConfigService, StorageService } from '@qq-harness/domain';
import { lockInstallation } from './process-lock.js';

export interface SnowlumaPluginOptions {
  allowLaunch?: boolean;
  lockRoot?: string;
}
export function isPortOpen(host: string, port: number, timeout = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeout, () => finish(false));
  });
}
function loopback(url: URL): void {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('SnowLuma 启动探测只允许回环地址');
}
function portOf(url: URL) {
  return Number(url.port || (['https:', 'wss:'].includes(url.protocol) ? 443 : 80));
}
function installation(settings: SnowlumaSettings) {
  if (!settings.directory) return { installed: false, directory: '', webui: null, hookAutoLoad: null };
  if (!path.isAbsolute(settings.directory)) throw new Error('SnowLuma 目录必须是绝对路径');
  const directory = path.resolve(settings.directory);
  const entry = path.join(directory, 'index.mjs');
  const installed = fs.existsSync(entry) && fs.statSync(entry).isFile();
  if (!installed) return { installed: false, directory, webui: null, hookAutoLoad: null };
  let webui = new URL('http://127.0.0.1:5099/');
  let hookAutoLoad: boolean | null = null;
  const runtime = path.join(directory, 'config/runtime.json');
  if (fs.existsSync(runtime)) {
    // 只提取公开的地址与 hook 状态，不回传第三方配置对象或令牌。
    let config: Record<string, any>;
    try {
      config = JSON.parse(fs.readFileSync(runtime, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('SnowLuma runtime.json 无法解析，请在第三方运行时中修复');
    }
    const host = String(config.webuiHost || '127.0.0.1');
    const port = Number(config.webuiPort || 5099);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SnowLuma WebUI 端口无效');
    const localHost = ['0.0.0.0', '::', '[::]'].includes(host) ? '127.0.0.1' : host;
    webui = new URL(
      `${config.webuiTls?.enabled ? 'https' : 'http'}://${localHost.includes(':') && !localHost.startsWith('[') ? `[${localHost}]` : localHost}:${port}/`,
    );
    hookAutoLoad = typeof config.hookAutoLoad === 'boolean' ? config.hookAutoLoad : null;
  }
  loopback(webui);
  return { installed, directory, webui, hookAutoLoad };
}

export class SnowlumaRuntime {
  private settings: SnowlumaSettings;
  private child?: ChildProcess;
  private release?: () => void;
  private phase: SnowlumaStatus['phase'] = 'stopped';
  private message = '';
  private buffer: SnowlumaLog[] = [];
  private starting?: Promise<SnowlumaStatus>;
  private stopping?: Promise<void>;
  private epoch = 0;
  private disposed = false;
  constructor(
    private ctx: PluginContext,
    private storage: StorageService,
    private config: ConfigService,
    readonly options: SnowlumaPluginOptions,
    private connected: () => boolean,
  ) {
    this.settings = snowlumaSettingsSchema.parse(storage.state('snowluma-runtime', 'settings') ?? {});
  }
  getSettings(): SnowlumaSettings {
    return structuredClone(this.settings);
  }
  configure(patch: unknown): SnowlumaSettings {
    this.ctx.assertActive();
    if (this.child || this.starting || this.stopping)
      throw new Error('请先停止本插件管理的 SnowLuma，再修改启动设置');
    const next = snowlumaSettingsSchema.partial().strict().parse(patch);
    const settings = snowlumaSettingsSchema.parse({ ...this.settings, ...next });
    if (
      (settings.directory && !path.isAbsolute(settings.directory)) ||
      (settings.nodePath && !path.isAbsolute(settings.nodePath))
    )
      throw new Error('目录和 Node 路径必须使用绝对路径');
    this.settings = settings;
    this.storage.setState('snowluma-runtime', 'settings', settings);
    this.changed();
    return this.getSettings();
  }
  logs(): SnowlumaLog[] {
    return this.buffer.slice(-200);
  }
  private log(text: string, stream: SnowlumaLog['stream'] = 'host') {
    const token = this.config.get().onebot.accessToken;
    let safe = token ? text.split(token).join('[REDACTED]') : text;
    safe = safe
      .replace(/(Bearer\s+)[\w.\-+/=]+/gi, '$1[REDACTED]')
      .replace(
        /((?:accessToken|access_token|token|apiKey|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi,
        '$1[REDACTED]',
      );
    const line: SnowlumaLog = { at: Date.now(), stream, text: safe.slice(0, 2000) };
    this.buffer.push(line);
    if (this.buffer.length > 500) this.buffer.shift();
    this.ctx.host.publish('snowluma.log', line);
  }
  private changed() {
    this.ctx.host.publish('snowluma.changed', {
      phase: this.phase,
      owned: Boolean(this.child),
      pid: this.child?.pid ?? null,
    });
  }
  async status(): Promise<SnowlumaStatus> {
    const info = installation(this.settings);
    const ready = info.webui
      ? await isPortOpen(info.webui.hostname.replace(/^\[|\]$/g, ''), portOf(info.webui))
      : false;
    const owned = Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null);
    const phase =
      this.phase === 'stopping'
        ? 'stopping'
        : owned
          ? ready
            ? 'running'
            : 'starting'
          : ready
            ? 'external'
            : this.phase === 'failed'
              ? 'failed'
              : !info.installed
                ? 'unconfigured'
                : 'stopped';
    if (phase !== this.phase) {
      this.phase = phase;
      this.changed();
    }
    return {
      phase,
      installed: info.installed,
      owned,
      pid: owned ? (this.child!.pid ?? null) : null,
      webuiReady: ready,
      webuiUrl: info.webui?.href ?? '',
      onebotConnected: this.connected(),
      hookAutoLoad: info.hookAutoLoad,
      allowLaunch: this.options.allowLaunch === true,
      message:
        this.message ||
        (phase === 'external'
          ? '检测到外部服务，本插件没有进程所有权'
          : phase === 'unconfigured'
            ? '请配置独立 SnowLuma 安装目录'
            : ''),
    };
  }
  start(): Promise<SnowlumaStatus> {
    if (this.starting) return this.starting;
    const revision = ++this.epoch;
    const active = () => {
      this.ctx.assertActive();
      if (this.disposed || revision !== this.epoch) throw new Error('SnowLuma 启动已取消');
    };
    const operation = (async () => {
      active();
      if (this.stopping) throw new Error('SnowLuma 正在停止');
      if (this.child) return this.status();
      if (!this.options.allowLaunch) throw new Error('当前为演示配置，真实进程启动仅在 live 配置中开放');
      if (this.settings.mode !== 'managed') throw new Error('外部模式只读取状态；请先选择托管模式');
      if (!this.settings.acceptEula || !this.settings.acceptPrivacy)
        throw new Error('启动前需要用户明确同意 SnowLuma 的 EULA 和隐私政策');
      const info = installation(this.settings);
      if (!info.installed || !info.webui) throw new Error('SnowLuma index.mjs 不存在');
      const entry = fs.realpathSync(path.join(info.directory, 'index.mjs'));
      const relative = path.relative(fs.realpathSync(info.directory), entry);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('SnowLuma 入口不能经符号链接越出安装目录');
      const configured = this.config.get().onebot;
      const endpoints = [info.webui, new URL(configured.wsUrl), new URL(configured.httpUrl)];
      for (const url of endpoints) {
        loopback(url);
        if (await isPortOpen(url.hostname.replace(/^\[|\]$/g, ''), portOf(url)))
          throw new Error(`端口 ${portOf(url)} 已有服务，拒绝重复启动 SnowLuma`);
        active();
      }
      const node =
        this.settings.nodePath ||
        (fs.existsSync(path.join(info.directory, 'node.exe'))
          ? path.join(info.directory, 'node.exe')
          : process.execPath);
      if (!path.isAbsolute(node) || !fs.existsSync(node)) throw new Error('Node 可执行文件不存在');
      this.release = lockInstallation(info.directory, this.options.lockRoot);
      active();
      this.phase = 'starting';
      this.message = '';
      this.changed();
      const child = spawn(node, [entry], {
        cwd: info.directory,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: { ...process.env, SNOWLUMA_ACCEPT_EULA: '1', SNOWLUMA_ACCEPT_PRIVACY: '1' },
      });
      this.child = child;
      const finish = () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.release?.();
        this.release = undefined;
        if (this.phase !== 'failed') this.phase = 'stopped';
        this.changed();
      };
      child.once('exit', (code, signal) => {
        this.log(`进程退出：code=${code ?? ''}, signal=${signal ?? ''}`);
        finish();
      });
      const capture = (stream: NodeJS.ReadableStream | null, name: 'stdout' | 'stderr') => {
        if (!stream) return;
        let pending = '';
        stream.setEncoding?.('utf8');
        stream.on('data', (chunk) => {
          pending += String(chunk);
          let index: number;
          while ((index = pending.indexOf('\n')) >= 0) {
            this.log(pending.slice(0, index).replace(/\r$/, ''), name);
            pending = pending.slice(index + 1);
          }
          if (pending.length > 4000) {
            this.log(pending.slice(0, 4000), name);
            pending = '';
          }
        });
        stream.on('end', () => {
          if (pending) this.log(pending, name);
        });
      };
      capture(child.stdout, 'stdout');
      capture(child.stderr, 'stderr');
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', (error) => {
          this.phase = 'failed';
          this.message = 'SnowLuma 进程启动失败';
          this.log(this.message, 'stderr');
          finish();
          reject(error);
        });
      });
      active();
      this.log(`已启动本插件管理的 SnowLuma，pid=${child.pid}`);
      return this.status();
    })().catch((error) => {
      if (!this.child) {
        this.release?.();
        this.release = undefined;
      }
      if (!this.disposed && revision === this.epoch) {
        this.phase = 'failed';
        this.message = error instanceof Error ? error.message : String(error);
        this.changed();
      }
      throw error;
    });
    this.starting = operation;
    void operation
      .finally(() => {
        if (this.starting === operation) this.starting = undefined;
      })
      .catch(() => {});
    return operation;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    ++this.epoch;
    const operation = (async () => {
      await this.starting?.catch(() => {});
      const child = this.child;
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      this.phase = 'stopping';
      this.changed();
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      // 只操作仍持有 ChildProcess 句柄的自有子树，绝不枚举或终止外部 SnowLuma/QQ。
      if (process.platform === 'win32' && child.pid)
        await new Promise<void>((resolve, reject) =>
          execFile(
            'taskkill.exe',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            (error) =>
              error && child.exitCode === null && child.signalCode === null
                ? reject(new Error('无法停止本插件管理的进程树'))
                : resolve(),
          ),
        );
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('等待 SnowLuma 退出超时')), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      this.log('已停止本插件管理的 SnowLuma');
    })();
    this.stopping = operation;
    void operation
      .finally(() => {
        if (this.stopping === operation) this.stopping = undefined;
      })
      .catch(() => {});
    return operation;
  }
  async dispose() {
    this.disposed = true;
    await this.stop();
  }
}
