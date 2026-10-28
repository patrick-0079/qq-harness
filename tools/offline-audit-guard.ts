import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';

/** Run only in an isolated audit child. This is test instrumentation, not a
 * security sandbox for hostile code. Production never installs these patches. */
export function offlineAuditGuard(root: string, codeRoot: string) {
  const restore: (() => void)[] = [],
    attempts: { kind: string; operation: string }[] = [];
  const originals = { realpath: fs.realpathSync, lstat: fs.lstatSync };
  const inside = (base: string, file: string) => file === base || file.startsWith(base + path.sep);
  const resolved = (value: unknown) => {
    if (typeof value === 'number') throw new Error('离线审计不接受包自行提供的文件描述符');
    if (value instanceof URL) value = fileURLToPath(value);
    if (Buffer.isBuffer(value)) value = value.toString();
    if (typeof value !== 'string') throw new Error('离线审计文件路径无效');
    return path.resolve(value);
  };
  const boundary = (value: unknown, write = false) => {
    const file = resolved(value),
      relative = path.relative(codeRoot, file);
    const code =
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !['var', 'dist', '.git'].includes(relative.split(path.sep)[0]!);
    if (!inside(root, file) && (write || !code)) throw new Error('离线审计拒绝访问测试目录外的数据');
    // Do not let a package create a link and subsequently write through it.
    let cursor = file;
    while (true) {
      try {
        if (originals.lstat(cursor).isSymbolicLink()) throw new Error('离线审计拒绝符号链接');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  };
  const patch = (object: any, key: string, fn: Function) => {
    const old = object[key];
    object[key] = fn;
    restore.push(() => {
      object[key] = old;
    });
  };
  const deny = (kind: string, operation: string) => {
    attempts.push({ kind, operation });
    throw new Error(`离线 mock 禁止 ${kind}: ${operation}`);
  };
  for (const object of [childProcess])
    for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
      patch(object, method, () => deny('process', method));
  for (const [object, methods] of [
    [http, ['request', 'get']],
    [https, ['request', 'get']],
    [net, ['connect', 'createConnection']],
    [net.Socket.prototype, ['connect']],
    [tls, ['connect']],
    [dgram, ['createSocket']],
    [dns, ['lookup', 'resolve', 'resolve4', 'resolve6']],
    [dns.promises, ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ] as const)
    for (const method of methods) patch(object, method, () => deny('network', method));
  patch(globalThis, 'fetch', () => deny('network', 'fetch'));
  for (const method of ['exit', 'abort', 'kill', 'chdir'])
    patch(process, method, () => deny('process', method));
  const read = [
    'readFile',
    'stat',
    'lstat',
    'access',
    'realpath',
    'readdir',
    'readlink',
    'opendir',
    'createReadStream',
    'watch',
    'watchFile',
  ];
  const write = [
    'writeFile',
    'appendFile',
    'mkdir',
    'rm',
    'rmdir',
    'unlink',
    'truncate',
    'chmod',
    'chown',
    'utimes',
    'createWriteStream',
  ];
  for (const [names, isWrite] of [
    [read, false],
    [write, true],
  ] as const)
    for (const name of names)
      for (const object of [fs, fs.promises])
        for (const suffix of object === fs ? ['', 'Sync'] : ['']) {
          const key = name + suffix,
            original = (object as any)[key];
          if (typeof original !== 'function') continue;
          patch(object, key, (...args: unknown[]) => {
            boundary(args[0], isWrite);
            return original.apply(object, args);
          });
        }
  for (const object of [fs, fs.promises]) {
    for (const name of ['open', 'openSync']) {
      const original = (object as any)[name];
      if (typeof original === 'function')
        patch(object, name, (...args: unknown[]) => {
          const flags = args[1];
          boundary(args[0], typeof flags !== 'string' || /[wa+]/.test(flags));
          return original.apply(object, args);
        });
    }
    for (const name of ['rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync']) {
      const original = (object as any)[name];
      if (typeof original === 'function')
        patch(object, name, (...args: unknown[]) => {
          boundary(args[0], name.startsWith('rename'));
          boundary(args[1], true);
          return original.apply(object, args);
        });
    }
    for (const name of ['symlink', 'symlinkSync', 'link', 'linkSync'])
      if (typeof (object as any)[name] === 'function') patch(object, name, () => deny('filesystem', name));
  }
  patch(fs, 'existsSync', (file: unknown) => {
    try {
      boundary(file);
      return fs.statSync(file as string) != null;
    } catch {
      return false;
    }
  });
  syncBuiltinESMExports();
  return {
    attempts,
    stop() {
      for (const fn of restore.reverse()) fn();
      syncBuiltinESMExports();
    },
  };
}
