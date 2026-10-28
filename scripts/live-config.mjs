import fs from 'node:fs';
import path from 'node:path';

export function releaseDirectory(root,selected){
  if(selected===undefined||selected==='')return path.join(root,'dist');
  if(typeof selected!=='string'||!path.isAbsolute(selected))throw new Error('上线版本必须是绝对目录');
  const base=path.resolve(root,'var/releases'),folder=path.resolve(selected),relative=path.relative(base,folder);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('上线版本必须属于本工程 var/releases');
  let current=base;
  for(const item of ['',...relative.split(path.sep)]){if(item)current=path.join(current,item);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('上线版本路径不能包含符号链接');}
  return folder;
}

export function managedExtensionDirectory(root, selected) {
  if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw new Error('扩展版本目录必须为绝对路径');
  const base=path.resolve(root,'var/extension-releases'),target=path.resolve(selected),relative=path.relative(base,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('扩展版本必须属于本工程 var/extension-releases');
  let current=base;for(const name of ['',...relative.split(path.sep)]){if(name)current=path.join(current,name);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('扩展版本路径不能包含符号链接');}
  return target;
}
export function loadLaunch(root) {
  const dataDir = path.join(root, 'var/production');
  let launch;
  try {
    launch = JSON.parse(fs.readFileSync(path.join(dataDir, 'launch.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('无法读取 var/production/launch.json，请先完成配置迁移');
  }
  // 本机控制台可不设管理令牌；空值也必须覆盖继承环境，避免 PM2 保留旧令牌。
  const token = launch.token === undefined ? '' : launch.token;
  if (
    !Number.isInteger(launch.port) ||
    launch.port < 1 ||
    launch.port > 65535 ||
    !Number.isInteger(launch.concurrency) ||
    launch.concurrency < 1 ||
    launch.concurrency > 64 ||
    typeof token !== 'string' ||
    (token !== '' && token.length < 32) ||
    (launch.allowedChats !== undefined &&
      (!Array.isArray(launch.allowedChats) ||
        !launch.allowedChats.length ||
        !launch.allowedChats.every((key) => /^(group|private):\d+$/.test(key)))) ||
    (launch.snowlumaDirectory &&
      (typeof launch.snowlumaDirectory !== 'string' || !path.isAbsolute(launch.snowlumaDirectory)))
  )
    throw new Error('launch.json 的端口、并发、令牌、会话范围或 SnowLuma 路径无效');
  if (launch.extensionDirectory !== undefined) {
    managedExtensionDirectory(root,launch.extensionDirectory);
  }
  return { ...launch, token, dataDir,releaseDirectory:releaseDirectory(root,launch.releaseDirectory),baseUrl: `http://127.0.0.1:${launch.port}` };
}

export function liveEnvironment(root, inherited = process.env) {
  const launch = loadLaunch(root);
  return {
    ...inherited,
    NODE_ENV: 'production',
    HARNESS_DATA_DIR: launch.dataDir,
    HARNESS_PORT: String(launch.port),
    HARNESS_TOKEN: launch.token,
    HARNESS_CONCURRENCY: String(launch.concurrency),
    HARNESS_ALLOWED_CHATS: launch.allowedChats?.join(',') ?? '',
    HARNESS_SNOWLUMA_DIR: launch.snowlumaDirectory ?? '',
    HARNESS_RELEASE_DIR:launch.releaseDirectory,
    HARNESS_V2_EXTENSION_ROOT:launch.extensionDirectory??path.join(root,'extensions-v2'),
  };
}
