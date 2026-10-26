import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';

test('后装插件默认关闭，启用后提供 API 与客户端入口，停用同时撤销且不暴露服务端源码', async () => {
  const extensionDir = fileURLToPath(new URL('../extensions', import.meta.url));
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-external-')),
    extensionDir,
  });
  try {
    expect(app.runtime.listPlugins().find((plugin) => plugin.id === 'example-notes')?.status).toBe(
      'disabled',
    );
    expect((await app.app.request('http://127.0.0.1/api/notes')).status).toBe(404);
    await app.runtime.setEnabled('example-notes', true);
    expect((await app.app.request('http://127.0.0.1/api/notes')).status).toBe(200);
    const entry = app.runtime.listPlugins().find((plugin) => plugin.id === 'example-notes')!.client!.entry;
    expect((await app.app.request('http://127.0.0.1' + entry)).status).toBe(200);
    expect(
      (await app.app.request('http://127.0.0.1' + entry.replace('client.mjs', 'server.mjs'))).status,
    ).toBe(404);
    await app.runtime.setEnabled('example-notes', false);
    expect((await app.app.request('http://127.0.0.1/api/notes')).status).toBe(404);
    expect((await app.app.request('http://127.0.0.1' + entry)).status).toBe(404);
    await app.runtime.setEnabled('example-notes', true);
    expect((await app.app.request('http://127.0.0.1/api/notes')).status).toBe(200);
  } finally {
    await app.stop();
  }
});
