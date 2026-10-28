import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { liveEnvironment,loadLaunch } from './live-config.mjs';

export async function startLive(root = fileURLToPath(new URL('../', import.meta.url))) {
  const backend = path.join(loadLaunch(root).releaseDirectory, 'server/main.mjs');
  if (!fs.existsSync(backend)) throw new Error('请先 npm run build');
  Object.assign(process.env, liveEnvironment(root));
  if (!process.argv.includes('--live')) process.argv.push('--live');
  // 与后端同进程，PM2 直接监控实际内存和退出；停机消息也直接交给后端。
  await import(pathToFileURL(backend).href);
}
// PM2 通过 ProcessContainerFork 导入 ESM，argv[1] 此时是容器脚本。
const invoked = [process.argv[1], process.env.HARNESS_PM2 === '1' && process.env.pm_exec_path].some(
  (file) => file && import.meta.url === pathToFileURL(path.resolve(file)).href,
);
if (invoked) {
  try {
    await startLive();
  } catch {
    console.error('上线实例启动失败，请检查构建、launch.json、数据目录锁及本地日志');
    process.exitCode = 1;
  }
}
