import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { z } from 'zod';
import {
  qqPortableSettingsSchema,
  type QqPortableSettings,
  type QqPortableStatus,
} from '@qq-harness/contracts';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import type { StorageService } from '@qq-harness/domain';
import { lockDirectory } from '@qq-harness/files';
import { inside, windowsQqProcess, type QqProcessDriver } from './process.js';

export interface QqPortableOptions {
  allowLaunch?: boolean;
  directory?: string;
  dataDirectory?: string;
  lockRoot?: string;
  driver?: QqProcessDriver;
  startupGraceMs?: number;
}

function installation(settings: QqPortableSettings) {
  if (!settings.directory) return { installed: false, version: '', executable: '' };
  if (!path.isAbsolute(settings.directory)) throw new Error('便携 QQ 程序目录必须为绝对路径');
  const executable = path.join(settings.directory, 'QQ.exe');
  if (!fs.existsSync(executable)) return { installed: false, version: '', executable };
  const root = fs.realpathSync(settings.directory);
  if (!fs.statSync(executable).isFile() || !inside(root, fs.realpathSync(executable)))
    throw new Error('QQ.exe 必须位于便携安装目录内');
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'versions/config.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const version = String(config.curVersion ?? '');
  if (!/^\d+\.\d+\.\d+-\d+$/.test(version)) throw new Error('便携 QQ 当前版本记录无效');
  for (const name of ['QQNT.dll', 'resources/app/package.json']) {
    const file = path.join(root, 'versions', version, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !inside(root, fs.realpathSync(file)))
      throw new Error(`便携 QQ 缺少有效程序文件：${name}`);
  }
  return { installed: true, version, executable: fs.realpathSync(executable) };
}

export class QqPortableRuntime {
  private settings: QqPortableSettings;
  private driver: QqProcessDriver;
  private child?: ChildProcess;
  private release?: () => void;
  private starting?: Promise<QqPortableStatus>;
  private stopping?: Promise<void>;
  private epoch = 0;
  private disposed = false;
  private phase: QqPortableStatus['phase'] = 'unconfigured';
  private message = '';
  constructor(
    private ctx: PluginContext,
    private storage: StorageService,
    private options: QqPortableOptions,
  ) {
    this.settings = qqPortableSettingsSchema.parse(
      storage.state('qq-portable', 'settings') ?? {
        directory: options.directory,
        dataDirectory: options.dataDirectory,
      },
    );
    this.driver = options.driver ?? windowsQqProcess;
  }
  getSettings() {
    return structuredClone(this.settings);
  }
  configure(patch: unknown) {
    this.ctx.assertActive();
    if (this.child || this.starting || this.stopping) throw new Error('请先停止便携 QQ，再修改目录');
    // Zod 的带 default 字段经 partial 后仍可能填默认值；先合并显式字段，避免清空未提交的目录。
    const next = qqPortableSettingsSchema
      .strict()
      .parse({ ...this.settings, ...z.record(z.string(), z.unknown()).parse(patch) });
    for (const value of [next.directory, next.dataDirectory])
      if (value && !path.isAbsolute(value)) throw new Error('便携 QQ 目录必须为绝对路径');
    this.storage.setState('qq-portable', 'settings', next);
    this.settings = next;
    this.message = '';
    this.phase = 'unconfigured';
    this.changed();
    return this.getSettings();
  }
  private changed() {
    this.ctx.host.publish('qq-portable.changed', { phase: this.phase, owned: Boolean(this.child) });
  }
  async status(): Promise<QqPortableStatus> {
    let installed = false,
      version = '',
      external: number | null = null;
    try {
      const info = installation(this.settings);
      installed = info.installed;
      version = info.version;
      if (installed && !this.child && this.driver.supported) {
        const root = fs.realpathSync(this.settings.directory);
        external =
          (await this.driver.list()).find((process) => inside(root, process.executable))?.pid ?? null;
      }
      if (!this.child && !this.starting && !this.stopping && this.phase !== 'failed')
        this.phase = external ? 'external' : installed ? 'ready' : 'unconfigured';
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
      if (!this.child) this.phase = 'failed';
    }
    return {
      phase: external ? 'external' : this.phase,
      installed,
      version,
      owned: Boolean(this.child),
      pid: this.child?.pid ?? external,
      allowLaunch: this.options.allowLaunch === true && this.driver.supported,
      message: external ? '检测到外部便携 QQ；本插件不会接管或停止它' : this.message,
    };
  }
  start(): Promise<QqPortableStatus> {
    if (this.starting) return this.starting;
    const epoch = ++this.epoch;
    const active = () => {
      this.ctx.assertActive();
      if (this.disposed || epoch !== this.epoch) throw new Error('便携 QQ 启动已取消');
    };
    const operation = (async () => {
      active();
      if (this.stopping) throw new Error('便携 QQ 正在停止');
      if (this.child) return this.status();
      if (!this.options.allowLaunch) throw new Error('演示模式不启动真实 QQ');
      if (!this.driver.supported) throw new Error('便携 QQ 仅支持 Windows');
      const info = installation(this.settings);
      if (!info.installed) throw new Error('请先准备便携 QQ 程序文件');
      const root = fs.realpathSync(this.settings.directory);
      if (!this.settings.dataDirectory || !path.isAbsolute(this.settings.dataDirectory))
        throw new Error('请配置独立的便携 QQ 数据目录');
      if (inside(root, this.settings.dataDirectory) || inside(this.settings.dataDirectory, root))
        throw new Error('QQ 程序目录与数据目录必须相互独立');
      // 安装锁跨数据目录生效；数据锁阻止不同 QQ 副本同时使用同一 profile。
      const releaseProgram = lockDirectory(root, this.options.lockRoot, '便携 QQ');
      this.release = releaseProgram;
      fs.mkdirSync(this.settings.dataDirectory, { recursive: true });
      const data = fs.realpathSync(this.settings.dataDirectory);
      if (inside(root, data) || inside(data, root)) throw new Error('QQ 数据目录经链接指向程序目录');
      const releaseData = lockDirectory(data, this.options.lockRoot, '便携 QQ 数据');
      this.release = () => {
        releaseData();
        releaseProgram();
      };
      if ((await this.driver.list()).some((process) => inside(root, process.executable)))
        throw new Error('此便携 QQ 已由外部进程运行，请先自行退出该实例');
      active();
      this.phase = 'starting';
      this.message = '';
      this.changed();
      const child = this.driver.launch(info.executable, data);
      this.child = child;
      const finish = () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.release?.();
        this.release = undefined;
        if (this.phase !== 'failed') this.phase = 'ready';
        this.changed();
      };
      child.once('exit', (code, signal) => {
        if (this.child === child && this.phase !== 'stopping' && (code !== 0 || signal)) {
          this.phase = 'failed';
          this.message = `便携 QQ 退出：code=${code ?? ''}${code !== null && code >= 0 ? ` (0x${code.toString(16).padStart(8, '0')})` : ''}, signal=${signal ?? ''}`;
        }
        finish();
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => {
          this.phase = 'failed';
          this.message = '便携 QQ 程序启动失败';
          finish();
          reject(new Error(this.message));
        });
      });
      active();
      // spawn 仅表示创建成功；启动器立即崩溃时不能向界面报告“运行中”。
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onExit: () => void = () => {};
      let onAbort: () => void = () => {};
      try {
        await new Promise<void>((resolve, reject) => {
          const failed = () =>
            reject(new Error(this.message || '便携 QQ 启动器提前退出，请检查程序文件和运行环境'));
          onExit = failed;
          onAbort = () => reject(new Error('便携 QQ 启动已取消'));
          child.once('exit', onExit);
          this.ctx.signal.addEventListener('abort', onAbort, { once: true });
          if (child.exitCode !== null || child.signalCode !== null || this.child !== child) return failed();
          if (this.ctx.signal.aborted) return onAbort();
          timer = setTimeout(resolve, this.options.startupGraceMs ?? 1200);
        });
      } finally {
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        this.ctx.signal.removeEventListener('abort', onAbort);
      }
      active();
      if (this.child === child) this.phase = 'running';
      this.changed();
      return this.status();
    })().catch((error) => {
      if (!this.child) {
        this.release?.();
        this.release = undefined;
      }
      if (!this.disposed && epoch === this.epoch) {
        this.phase = 'failed';
        this.message = String(error.message ?? error);
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onExit: () => void = () => {};
      const exited = new Promise<void>((resolve) => {
        onExit = resolve;
        child.once('exit', onExit);
      });
      try {
        // 从未启动的外部进程不可能走到这里；只按持有的 ChildProcess 回收子树。
        await this.driver.stop(child);
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('等待便携 QQ 退出超时')), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        child.removeListener('exit', onExit);
      }
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
