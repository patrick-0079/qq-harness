#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ServiceManager, resolvePm2, sanitize, tailFile } from './scripts/service-manager.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const args = process.argv.slice(2),
  command = args[0] ?? 'help';
const help = `QQ Harness 服务管理
用法：node manage.mjs <命令> [选项]
  setup [--no-start]       注册启动并保存；--no-start 仅登记，保持停止
  start [--all]            启动后端；--all 连同 SnowLuma / 便携 QQ
  up                       等价于 start --all
  stop                     正常停止后端及其自有 QQ / SnowLuma
  restart [--all]          重启后端并重新读取 launch.json
  status [--json]          查询 PM2、HTTP、OneBot、QQ / SnowLuma 状态
  logs [-n 60] [-f]        查看日志；-f 跟随，Ctrl+C 退出
  qq start|stop|status     单独操作便携 QQ
  snowluma start|stop|status  单独操作 SnowLuma
  doctor                   执行本地上线预检
  save                     保存当前 PM2 进程清单供 resurrect 恢复
  remove                   从 PM2 移除本工程条目并保存
默认使用 var/production；启动后控制台地址由 launch.json 决定。
组件启动依照已保存的插件设置，协议同意与 QQ 登录在页面/QQ 窗口完成。`;
function print(value) {
  if (args.includes('--json')) return console.log(JSON.stringify(value, null, 2));
  if ('status' in value) {
    console.log(
      `${value.name}: ${value.status} · PID ${value.pid ?? '-'} · HTTP ${value.ready ? '就绪' : '未就绪'} · 重启 ${value.restarts}`,
    );
    if (value.adapter)
      console.log(`OneBot: ${value.adapter.kind} / ${value.adapter.connected ? '已连接' : '未连接'}`);
    for (const key of ['qq-portable', 'snowluma'])
      if (value[key])
        console.log(`${key}: ${value[key].phase} · ${value[key].owned ? '自有' : '外部或未启动'}`);
    if (value.apiError) console.log(value.apiError);
    if (value.startHint) console.log(value.startHint);
  } else console.log(JSON.stringify(value, null, 2));
}
async function logs() {
  const index = args.findIndex((arg) => arg === '-n' || arg === '--lines');
  const lines = index < 0 ? 60 : Number(args[index + 1]);
  if (!Number.isInteger(lines) || lines < 1 || lines > 10000) throw new Error('日志行数必须为 1–10000');
  const files = ['pm2-out.log', 'pm2-error.log'].map((name) => path.join(root, 'var/logs', name));
  const positions = new Map();
  for (const file of files) {
    console.log(`--- ${path.basename(file)} ---`);
    console.log(sanitize(tailFile(file, lines), root) || '暂无日志');
    positions.set(file, fs.existsSync(file) ? fs.statSync(file).size : 0);
  }
  if (!args.includes('-f') && !args.includes('--follow')) return;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    while (!controller.signal.aborted) {
      for (const file of files) {
        if (!fs.existsSync(file)) {
          positions.set(file, 0);
          continue;
        }
        const size = fs.statSync(file).size;
        let previous = positions.get(file) ?? 0;
        if (size < previous) previous = 0;
        if (size > previous) {
          const fd = fs.openSync(file, 'r');
          try {
            const start = Math.max(previous, size - 512 * 1024),
              buffer = Buffer.alloc(size - start);
            const count = fs.readSync(fd, buffer, 0, buffer.length, start);
            process.stdout.write(sanitize(buffer.subarray(0, count).toString('utf8'), root));
          } finally {
            fs.closeSync(fd);
          }
        }
        positions.set(file, size);
      }
      await delay(500, undefined, { signal: controller.signal }).catch((error) => {
        if (error.name !== 'AbortError') throw error;
      });
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
let manager;
try {
  if (['help', '-h', '--help'].includes(command)) console.log(help);
  else if (command === 'logs') await logs();
  else if (command === 'doctor') {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'tools/preflight.ts')], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        process.exitCode = code ?? 1;
        resolve();
      });
    });
  } else {
    if (
      !['setup', 'start', 'up', 'stop', 'restart', 'status', 'save', 'remove', 'qq', 'snowluma'].includes(
        command,
      )
    )
      throw new Error('命令不存在，运行 node manage.mjs help 查看用法');
    manager = new ServiceManager(root, resolvePm2());
    await manager.connect();
    if (command === 'setup') {
      const value = args.includes('--no-start') ? await manager.setup() : await manager.start();
      await manager.save();
      print(value);
    } else if (command === 'start' || command === 'restart' || command === 'up')
      print(
        await (args.includes('--all') || command === 'up'
          ? manager.startAll(command === 'restart')
          : manager.start(command === 'restart')),
      );
    else if (command === 'remove') {
      const value = await manager.remove();
      await manager.save();
      print(value);
    } else if (command === 'qq' || command === 'snowluma')
      print(await manager.component(command, args[1] ?? 'status'));
    else print(await manager[command]());
  }
} catch (error) {
  console.error(sanitize(error instanceof Error ? error.message : String(error), root));
  process.exitCode = 1;
} finally {
  manager?.disconnect();
}
