import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const inside = (parent, file) => {
  const rel = path.relative(parent, file);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
};
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const excluded = (name) =>
  /^(?:logs?|cache|user.?data|userdata|qq-portable-data|Tencent Files|MyFiles|Crashpad|dumps?|Local Storage|Session Storage|Cookies|History|Login Data)$/i.test(
    name,
  ) || /\.(?:log|dmp|db|sqlite|sqlite3|bak|tmp)$/i.test(name);

export function inspectPortable(directory) {
  const config = JSON.parse(
    fs.readFileSync(path.join(directory, 'versions/config.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const version = String(config.curVersion ?? '');
  if (!/^\d+\.\d+\.\d+-\d+$/.test(version)) throw new Error('QQ 版本记录无效');
  for (const rel of [
    'QQ.exe',
    `versions/${version}/QQNT.dll`,
    `versions/${version}/resources/app/package.json`,
  ])
    if (!fs.existsSync(path.join(directory, rel)) || !fs.statSync(path.join(directory, rel)).isFile())
      throw new Error(`缺少 QQ 程序文件：${rel}`);
  return version;
}
export function verifyPortable(directory) {
  const version = inspectPortable(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'portable-manifest.json'), 'utf8'));
  if (
    manifest.schema !== 1 ||
    manifest.version !== version ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error('便携 QQ 清单无效或版本已变化，请重新准备');
  const canonical = fs.realpathSync(directory);
  for (const entry of manifest.files) {
    const file = path.resolve(directory, entry.path);
    if (
      !inside(canonical, file) ||
      !inside(canonical, fs.realpathSync(file)) ||
      digest(file) !== entry.sha256
    )
      throw new Error(`便携 QQ 校验失败：${entry.path}`);
  }
  return {
    version,
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, entry) => sum + entry.bytes, 0),
    verified: true,
  };
}
export function preparePortable(source, target) {
  if (!path.isAbsolute(source) || !path.isAbsolute(target)) throw new Error('来源和目标必须是绝对路径');
  source = fs.realpathSync(source);
  target = path.resolve(target);
  if (inside(source, target) || inside(target, source)) throw new Error('来源与目标目录不能重叠');
  if (fs.existsSync(target)) throw new Error('目标已存在，拒绝覆盖程序或登录数据；可先使用 check 校验');
  const version = inspectPortable(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = target + '.preparing-' + randomUUID();
  fs.mkdirSync(staging);
  const files = [];
  const copy = (relative) => {
    const from = path.join(source, relative);
    const info = fs.lstatSync(from);
    if (info.isSymbolicLink() || !inside(source, fs.realpathSync(from)))
      throw new Error('来源程序包含目录外链接，拒绝复制');
    if (excluded(path.basename(relative))) return;
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(from)) copy(path.join(relative, name));
    } else if (info.isFile()) {
      const to = path.join(staging, relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const sha256 = digest(from);
      if (digest(to) !== sha256) throw new Error('程序复制校验失败');
      files.push({ path: relative.replaceAll('\\', '/'), bytes: info.size, sha256 });
    }
  };
  // 只选程序入口、依赖和当前版本；旧账号目录、安装日志、更新包均不参与迁移。
  for (const name of fs.readdirSync(source))
    if (/^(?:QQ|QQEX|Uninstall)\.exe$/i.test(name) || /^Uninstall\.xml$/i.test(name) || /\.dll$/i.test(name))
      copy(name);
  copy('versions/config.json');
  // 与旧版复制布局一致，保留启动器的版本级设置，不能只复制主程序与 DLL。
  if (fs.existsSync(path.join(source, 'versions/setting.json'))) copy('versions/setting.json');
  if (fs.existsSync(path.join(source, 'versions/channel.json'))) copy('versions/channel.json');
  copy(`versions/${version}`);
  if (fs.existsSync(path.join(source, 'extension'))) copy('extension');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  fs.writeFileSync(
    path.join(staging, 'portable-manifest.json'),
    JSON.stringify({ schema: 1, version, preparedAt: new Date().toISOString(), files }, null, 2) + '\n',
    { flag: 'wx' },
  );
  const result = verifyPortable(staging);
  fs.renameSync(staging, target);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const target = path.resolve(root, 'runtime/qq-portable');
  try {
    if (args[0] === 'check') console.log(JSON.stringify(verifyPortable(target), null, 2));
    else if (args[0] === 'prepare' && args[1] === '--from' && args[2]) {
      const result = preparePortable(args[2], target);
      fs.mkdirSync(path.join(root, 'var/qq-portable-data'), { recursive: true });
      console.log(JSON.stringify(result, null, 2));
    } else throw new Error('用法：node scripts/portable-qq.mjs prepare --from 绝对目录 | check');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
