import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService } from '@qq-harness/extension-compat';
import { configService as configToken } from '@qq-harness/domain';
import { messageMarkers } from '../plugins/basic-tools/src/message-markers.js';
import { sendMessageInput } from '../plugins/basic-tools/src/messaging.js';
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop();
});
const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-management-revision-'));

test('通用配置不能去掉内置提示词的只读标记后再删除', async () => {
  const item = { id: 'builtin-template', name: '内置模板', text: '原始正文', readOnly: true };
  const app = await boot({ initialConfig: { prompts: [item] } });
  const cfg = app.runtime.use(configToken);
  expect(() => cfg.patch({ prompts: [{ ...item, readOnly: false }] })).toThrow('只读');
  expect(() => cfg.patch({ prompts: [] })).toThrow('只读');
  expect(cfg.get().prompts).toEqual([item]);
});
async function boot(options: Partial<Parameters<typeof createApplication>[0]> = {}) {
  const app = await createApplication({
    dataDir: directory(),
    v2Managers: false,
    extensionHotReload: false,
    ...options,
  });
  apps.push(app);
  return app;
}

test('字符串数组协议支持任意消息引用并@多人，后续引用和未知标记不泄漏', () => {
  const storage = {
    messages: () => [
      { id: 'first', localId: 1 },
      { id: 'second', localId: 2 },
    ],
  } as any;
  const parsed = messageMarkers(
    '开头⟦reply:first⟧⟦at:22⟧中间⟦at:33⟧⟦reply:second⟧⟦内部标记⟧结尾 #标题#',
    'group:1',
    storage,
  );
  expect(parsed.text).toBe('开头中间结尾 #标题#');
  expect(parsed.segments.filter((s) => s.type === 'reply')).toEqual([
    { type: 'reply', data: { id: 'first' } },
  ]);
  expect(parsed.segments.filter((s) => s.type === 'at').map((s) => s.data.qq)).toEqual(['22', '33']);
  expect(() => messageMarkers('⟦reply:foreign⟧正文', 'group:1', storage)).toThrow('当前会话');
  expect(() => messageMarkers('⟦at:22⟧正文', 'private:1', storage)).toThrow('私聊');
  expect(() => messageMarkers('⟦内部⟧', 'group:1', storage)).toThrow('消息为空');
  for (const value of [
    { messages: [{ text: '对象不允许' }] },
    { messages: '文字' },
    { messages: ['x'], atUserId: '22' },
  ])
    expect(sendMessageInput.safeParse(value).success).toBe(false);
});

test('模型替换成〖〗的控制标记转换为引用与提及，普通中文括号保持原样', () => {
  const storage = { messages: () => [{ id: '-123456', localId: 71 }] } as any;
  const parsed = messageMarkers(
    '〖reply:-123456〗〖at:22〗正文⟦reply:ignored⟧〖@33〗〖说明〗 #标题#',
    'group:1',
    storage,
  );
  expect(parsed.text).toBe('正文〖说明〗 #标题#');
  expect(parsed.segments).toEqual([
    { type: 'reply', data: { id: '-123456' } },
    { type: 'at', data: { qq: '22' } },
    { type: 'text', data: { text: '正文' } },
    { type: 'at', data: { qq: '33' } },
    { type: 'text', data: { text: '〖说明〗 #标题#' } },
  ]);
  expect(messageMarkers('⟦reply:-123456⟧正文〖reply:ignored〗', 'group:1', storage).text).toBe('正文');
  expect(messageMarkers('〖 RePlAy ： 71 〗正文', 'group:1', storage).segments[0]).toEqual({
    type: 'reply',
    data: { id: '-123456' },
  });
});

test('相似括号标记沿用引用归属、私聊提及和空消息校验，不漏出未闭合控制标记', () => {
  const storage = { messages: () => [{ id: '-123456', localId: 71 }] } as any;
  expect(() => messageMarkers('〖reply:foreign〗正文', 'group:1', storage)).toThrow('当前会话');
  expect(() => messageMarkers('〖at:22〗正文', 'private:1', storage)).toThrow('私聊');
  expect(() => messageMarkers('〖at:invalid〗正文', 'group:1', storage)).toThrow('有效 QQ');
  expect(() => messageMarkers('〖reply:-123456〗', 'group:1', storage)).toThrow('消息为空');
  expect(messageMarkers('正文〖reply:-123456', 'group:1', storage).text).toBe('正文');
  expect(messageMarkers('正文⟦未闭合', 'group:1', storage).text).toBe('正文');
});

test('旧的不限配置一次迁移为5，已有正整数保留，之后设置不限不会再次迁移', async () => {
  const dataDir = directory();
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({
      defaults: { maxReplyMessages: 0 },
      profiles: { 'group:1': { maxReplyMessages: 0 }, 'group:2': { maxReplyMessages: 3 } },
    }),
  );
  const first = await boot({ dataDir });
  const cfg = first.runtime.use(configToken);
  expect(cfg.effective('group:1').maxReplyMessages).toBe(5);
  expect(cfg.effective('group:2').maxReplyMessages).toBe(3);
  expect(cfg.effective('group:3').maxReplyMessages).toBe(5);
  expect(fs.existsSync(path.join(dataDir, 'config.json.before-management-v1'))).toBe(true);
  cfg.patch({ defaults: { maxReplyMessages: 0 } });
  await first.stop();
  const second = await boot({ dataDir });
  expect(second.runtime.use(configToken).effective('group:3').maxReplyMessages).toBe(0);
});

test('内置提示词在目录和通用配置接口均只读，可复制成自定义项', async () => {
  const item = { id: 'builtin-compatible', name: '内置', text: '内置正文' };
  const app = await boot({ initialConfig: { prompts: [item] } });
  const write = (route: string, body: unknown) =>
    app.app.request('http://127.0.0.1' + route, {
      method: route === '/api/config' ? 'PATCH' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  expect((await write('/api/catalogs/prompts', { items: [] })).status).toBe(409);
  expect((await write('/api/catalogs/prompts', { items: [{ ...item, text: '改写' }] })).status).toBe(409);
  expect((await write('/api/config', { prompts: [] })).status).toBe(409);
  expect(
    (
      await write('/api/catalogs/prompts', {
        items: [item, { ...item, id: 'custom', name: '副本', text: '自定义正文' }],
      })
    ).status,
  ).toBe(200);
  const result = (await (await app.app.request('http://127.0.0.1/api/catalogs')).json()) as any;
  expect(result.prompts.find((p: any) => p.id === item.id).readOnly).toBe(true);
});

test('会话级插件即使安装在plugins目录也可卸载，迁移目录索引不使其重启复活', async () => {
  const dataDir = directory(),
    root = path.join(dataDir, 'extensions'),
    packageDir = path.join(root, 'plugins/cross-memory');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'plugin.json'),
    JSON.stringify({ id: 'cross-memory', name: '仿生记忆', type: 'plugin', scope: 'session' }),
  );
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'export function setup() {}');
  fs.writeFileSync(
    path.join(root, 'installed-catalog.json'),
    JSON.stringify({ items: [{ id: 'cross-memory', name: '仿生记忆', type: 'plugin', scope: 'session' }] }),
  );
  const app = await boot({ dataDir, v2ExtensionDir: root });
  const response = await app.app.request('http://127.0.0.1/api/extensions/chat-plugin/cross-memory', {
    method: 'DELETE',
  });
  expect(response.status, await response.text()).toBe(200);
  expect(fs.existsSync(packageDir)).toBe(false);
  expect(
    app.runtime
      .use(extensionService)
      .list()
      .some((r) => r.id === 'cross-memory'),
  ).toBe(false);
  await app.stop();
  const second = await boot({ dataDir, v2ExtensionDir: root });
  expect(
    second.runtime
      .use(extensionService)
      .list()
      .some((r) => r.id === 'cross-memory'),
  ).toBe(false);
});
