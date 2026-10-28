import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { publicFetch, configuredFetch } from '@qq-harness/files';
import { compileLegacyPackage } from '../tools/compile-legacy-package.js';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import { networkProxyService } from '@qq-harness/domain';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function proxy() {
  const requests: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url?.endsWith('/redirect')) {
      res.writeHead(302, { location: 'http://127.0.0.1/private' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const port = (server.address() as { port: number }).port;
  return {
    requests,
    port,
    settings: {
      url: 'http://127.0.0.1:' + port,
      mode: 'always' as const,
      bypass: [],
      directTimeoutMs: 1000,
      username: 'fixture',
      password: 'fixture-pass',
    },
  };
}
test('公共网页经代理仍固定已验证IP、保留Host；重定向到内网在发出前拒绝', async () => {
  const f = await proxy();
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
  expect(await (await publicFetch('http://fixture.invalid/page', { proxy: f.settings })).json()).toEqual({
    ok: true,
  });
  expect(f.requests[0]?.url).toContain('93.184.216.34');
  expect(f.requests[0]?.headers.host).toBe('fixture.invalid');
  expect(f.requests[0]?.headers['proxy-authorization']).toBe(
    'Basic ' + Buffer.from('fixture:fixture-pass').toString('base64'),
  );
  await expect(publicFetch('http://fixture.invalid/redirect', { proxy: f.settings })).rejects.toThrow(
    '本机或内网',
  );
  expect(f.requests).toHaveLength(2);
});
test('可信配置接口通过代理保留POST；fallback只在未连接时重试', async () => {
  const f = await proxy();
  const unused = http.createServer();
  await new Promise<void>((r) => unused.listen(0, '127.0.0.1', r));
  const port = (unused.address() as { port: number }).port;
  await new Promise<void>((r) => unused.close(() => r()));
  const response = await configuredFetch(
    'http://0.0.0.0:' + port + '/model',
    { method: 'POST', body: '{"messages":["fixture"]}', headers: { authorization: 'Bearer fixture' } },
    { ...f.settings, mode: 'fallback' },
  );
  expect(await response.json()).toEqual({ ok: true });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.body).toBe('{"messages":["fixture"]}');
});
test('旧代理包只提供每实例代理配置；不改全局Agent，停用后恢复直连配置', async () => {
  const source = fileURLToPath(new URL('../../backup/source/plugins/net-proxy/', import.meta.url));
  if (!fs.existsSync(source)) return;
  const f = await proxy(),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-proxy-migration-'));
  cleanup.push(() => {
    const real = fs.realpathSync(root);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-proxy-migration-')
    )
      throw Error('清理越界');
    fs.rmSync(real, { recursive: true, force: true });
  });
  const target = path.join(root, 'extensions/plugins/net-proxy');
  await compileLegacyPackage(source, target);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
  fs.writeFileSync(
    path.join(target, 'plugin.json'),
    JSON.stringify({ ...manifest, entry: 'harness-entry.mjs' }),
  );
  const original = http.globalAgent;
  const app = await createApplication({
    dataDir: path.join(root, 'data'),
    v2ExtensionDir: path.join(root, 'extensions'),
    extensionHotReload: false,
  });
  cleanup.push(app.stop);
  const host = app.runtime.use(extensionService);
  await host.configure('net-proxy', {
    enabled: true,
    settings: { host: '127.0.0.1', port: f.port, mode: 'always' },
  });
  const proxyConfig = app.runtime.use(networkProxyService).get('group:1');
  expect(proxyConfig).toMatchObject({ url: 'http://127.0.0.1:' + f.port, mode: 'always' });
  expect(await (await publicFetch('http://93.184.216.34/page', { proxy: proxyConfig })).json()).toEqual({
    ok: true,
  });
  expect(http.globalAgent).toBe(original);
  await host.configure('net-proxy', { enabled: false });
  expect(app.runtime.use(networkProxyService).get('group:1')).toBeUndefined();
  expect(http.globalAgent).toBe(original);
});
