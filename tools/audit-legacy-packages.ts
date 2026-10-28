import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileLegacyPackage } from './compile-legacy-package.js';
import { writeJsonAtomic } from '@qq-harness/files';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import { offlineAuditGuard } from './offline-audit-guard.js';

const codeRoot = fileURLToPath(new URL('../', import.meta.url));
const cleanError = (error: unknown, root: string) =>
  String(error).replaceAll(root, '<audit>').replaceAll(codeRoot, '<project>').slice(0, 1800);

async function child(root: string, id: string) {
  const guard = offlineAuditGuard(root, codeRoot),
    savedLog = console.log,
    savedError = console.error;
  const logs: string[] = [];
  console.log = console.error = (...args) => {
    logs.push(args.map(String).join(' ').slice(0, 600));
  };
  let app: Awaited<ReturnType<typeof createApplication>> | undefined;
  const result: Record<string, unknown> = {
    id,
    stage: 'loading-only',
    behaviorVerified: false,
    enabled: false,
  };
  try {
    app = await createApplication({
      dataDir: path.join(root, 'data'),
      v2ExtensionDir: path.join(root, 'extensions'),
      v2Managers: false,
      extensionHotReload: false,
      extensionFetch: async () => {
        throw new Error('离线 mock 禁止网络请求');
      },
      initialConfig: { acceptAllSessions: true, legacyGlobal: { skills: { [id]: { enabled: false } } } },
    });
    const host = app.runtime.use(extensionService),
      row = host.list().find((row) => row.id === id);
    result.disabled = row
      ? {
          loaded: !row.details?.loadError,
          active: row.active,
          reason: row.reason,
          loadError: (row as any).loadError ?? null,
        }
      : null;
    const skill = host.raw().skillManager.registry.get(id);
    result.disabled = {
      ...(result.disabled as object),
      loaded: Boolean(skill && !skill.loadError),
      error: skill?.loadError ?? null,
    };
    if (skill && !skill.loadError) {
      await host.configure(id, { enabled: true });
      const active = host.list().find((row) => row.id === id);
      result.enabled = true;
      result.activation = {
        active: active?.active,
        reason: active?.reason,
        tools: host.raw().skillManager.registry.get(id)?.toolIds ?? [],
        capabilities: (active as any)?.implementedCapabilities ?? [],
        hooks:(active as any)?.hooks??[],
      };
      await new Promise((resolve) => setTimeout(resolve, 50));
      await host.configure(id, { enabled: false });
      result.disabledAgain = !host.list().find((row) => row.id === id)?.active;
    }
    result.diagnostics = host
      .diagnostics()
      .filter((line) => !/0 失败/.test(line) && /失败|error|Exception|未适配|未激活/i.test(line))
      .map((line) => cleanError(line, root));
  } catch (error) {
    result.error = cleanError(error, root);
  } finally {
    try {
      await app?.stop();
      result.stopped = true;
    } catch (error) {
      result.stopError = cleanError(error, root);
    }
    result.blockedAttempts = guard.attempts;
    result.logs = logs
      .filter((line) => /失败|error|Exception/i.test(line))
      .map((line) => cleanError(line, root))
      .slice(-20);
    guard.stop();
    console.log = savedLog;
    console.error = savedError;
    writeJsonAtomic(path.join(root, 'result.json'), result);
  }
}

export async function auditLegacyPackages(sourceRoot: string, targetRoot: string, ids?: string[]) {
  const source = fs.realpathSync(sourceRoot),
    target = path.resolve(targetRoot);
  if (
    fs.existsSync(target) ||
    target === source ||
    target.startsWith(source + path.sep) ||
    !target.startsWith(path.join(codeRoot, 'var') + path.sep)
  )
    throw new Error('审计输出必须使用本工程 var 下的新目录');
  const rows: Record<string, any>[] = [];
  fs.mkdirSync(target, { recursive: true });
  for (const directory of ['plugins', 'skills'])
    for (const entry of fs
      .readdirSync(path.join(source, directory), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const folder = path.join(source, directory, entry.name),
        manifestName = ['skill.json', 'plugin.json'].find((name) => fs.existsSync(path.join(folder, name)));
      if (!manifestName) continue;
      const manifest = JSON.parse(
          fs.readFileSync(path.join(folder, manifestName), 'utf8').replace(/^\uFEFF/, ''),
        ),
        id = String(manifest.id);
      if (ids && !ids.includes(id)) continue;
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('旧包标识无效');
      if (['image-studio','cross-memory','cross-group-memory'].includes(id)) {
        rows.push({ id, directory, status: 'native-port-separate-tests' });
        continue;
      }
      const root = path.join(target, id),
        destination = path.join(root, 'extensions', directory, id);
      try {
        const compiled = await compileLegacyPackage(folder, destination);
        fs.cpSync(folder, destination, {
          recursive: true,
          filter: (file) => {
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) throw new Error('资源包含符号链接');
            if (
              path
                .relative(folder, file)
                .split(path.sep)
                .some((n) => ['node_modules', '.git', '_安装', 'data', 'logs'].includes(n))
            )
              return false;
            return (
              stat.isDirectory() ||
              (/\.(?:[cm]?js|html|css|svg|png|jpe?g|webp|gif|woff2?|ttf)$/i.test(file) &&
                stat.size <= 16 * 1024 * 1024)
            );
          },
        });
        writeJsonAtomic(path.join(destination, manifestName), {
          ...manifest,
          entry: 'harness-entry.mjs',
          harnessMigration: { stage: 'audit', behaviorVerified: false },
        });
        writeJsonAtomic(path.join(destination, 'package.json'), { private: true, type: 'module' });
        rows.push({
          id,
          directory,
          status: 'compiled',
          root,
          sourceHashes: compiled.sourceHashes,
          modules: compiled.modules,
        });
      } catch (error) {
        rows.push({ id, directory, status: 'needs-adapter', error: cleanError(error, target) });
      }
    }
  const run = promisify(execFile);
  // Compile before installing the child's process mocks: esbuild owns a helper.
  for (const row of rows.filter((row) => row.status === 'compiled')) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|appdata|localappdata|userprofile|pathext|comspec)$/i.test(key),
      ),
    );
    try {
      await run(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', row.root, row.id],
        { cwd: codeRoot, env, windowsHide: true, timeout: 20000, maxBuffer: 256 * 1024 },
      );
      row.status = 'audited';
    } catch (error) {
      row.status = 'audit-process-failed';
      row.error = cleanError((error as any).killed ? '审计子进程超时（可能存在未清理资源）' : error, target);
    }
    const result = path.join(row.root, 'result.json');
    if (fs.existsSync(result)) row.audit = JSON.parse(fs.readFileSync(result, 'utf8'));
    console.log(
      JSON.stringify({
        id: row.id,
        status: row.status,
        loaded: row.audit?.disabled?.loaded,
        active: row.audit?.activation?.active,
      }),
    );
    writeJsonAtomic(path.join(target, 'audit-report.json'), {
      version: 1,
      createdAt: new Date().toISOString(),
      scope: 'loading-and-lifecycle-only',
      behaviorVerified: false,
      rows,
    });
  }
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    scope: 'loading-and-lifecycle-only',
    behaviorVerified: false,
    rows,
  };
  writeJsonAtomic(path.join(target, 'audit-report.json'), report);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === '--child') await child(path.resolve(process.argv[3]!), process.argv[4]!);
  else {
    const target = path.join(codeRoot, 'var', 'package-audit-' + Date.now()),
      report = await auditLegacyPackages(
        process.argv[2] ?? path.resolve(codeRoot, '../backup/source'),
        target,
        process.argv[3]?.split(','),
      );
    console.log(
      JSON.stringify({
        target,
        counts: report.rows.reduce<Record<string, number>>(
          (counts, row) => ((counts[row.status] = (counts[row.status] ?? 0) + 1), counts),
          {},
        ),
      }),
    );
  }
}
