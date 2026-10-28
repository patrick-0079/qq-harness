import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import { offlineAuditGuard } from './offline-audit-guard.js';
import { writeJsonAtomic } from '@qq-harness/files';
const root = fileURLToPath(new URL('../', import.meta.url)),
  folder = path.resolve(process.argv[2] ?? '');
if (!folder.startsWith(path.join(root, 'var/extension-rehearsal-')))
  throw Error('只允许独立演练目录');
// Prepare synthetic input before enabling the package filesystem guard: the
// native atomic writer uses a checked file descriptor internally.
const configFile = path.join(folder, 'data/config.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
config.defaults = {
  ...config.defaults,
  legacySession: { ...config.defaults?.legacySession, auditPadding: 'x'.repeat(100000) },
};
writeJsonAtomic(configFile, config);
const guard = offlineAuditGuard(folder, root),
  savedLog = console.log,
  savedError = console.error;
console.log = console.error = () => {};
let app: Awaited<ReturnType<typeof createApplication>> | undefined, result: Record<string, unknown>;
try {
  app = await createApplication({
    dataDir: path.join(folder, 'data'),
    v2ExtensionDir: path.join(folder, 'extensions'),
    extensionHotReload: false,
    extensionFetch: async () => {
      throw Error('离线演练禁止网络');
    },
  });
  const host = app.runtime.use(extensionService),
    packages = host
      .raw()
      .skillManager.registry.list()
      .filter((row: any) => !row.manifest.id.startsWith('ext-'));
  const failed = packages.filter((row: any) => row.loadError).map((row: any) => row.manifest.id);
  const expected = JSON.parse(
    fs.readFileSync(path.join(folder, 'extensions/installed-catalog.json'), 'utf8'),
  ).items.filter((item: any) => item.migration.status === 'compiled-not-behavior-verified').length;
  // Synthetic configuration reproduces list-polling costs without reading
  // production chat history or credentials.
  const requests: { route: string; status: number; durationMs: number }[] = [];
  for (const route of [
    '/api/ui/contributions?page=shell',
    '/api/extensions',
    '/api/extension-tools?chat=default',
    '/api/ui/contributions?page=shell',
    '/api/health',
  ]) {
    const started = Date.now(),
      response = await app.app.request('http://127.0.0.1' + route);
    await response.arrayBuffer();
    requests.push({ route, status: response.status, durationMs: Date.now() - started });
    if (response.status !== 200) throw Error('演练接口失败：' + route);
  }
  result = {
    at: new Date().toISOString(),
    total: host.list().length,
    loaded: packages.length,
    expected,
    failed,
    pluginsFailed: app.runtime
      .listPlugins()
      .filter((p) => p.status === 'failed')
      .map((p) => p.id),
    blockedOperations: guard.attempts.length,
    requests,
  };
  if (
    failed.length ||
    packages.length !== expected ||
    (result.pluginsFailed as string[]).length ||
    guard.attempts.length
  )
    process.exitCode = 1;
} catch (error) {
  result = { failed: true, error: String(error) };
  process.exitCode = 1;
} finally {
  await app?.stop();
  guard.stop();
  console.log = savedLog;
  console.error = savedError;
}
writeJsonAtomic(path.join(folder, 'runtime-rehearsal.json'), result!);
console.log(JSON.stringify({ folder, ...result! }));
