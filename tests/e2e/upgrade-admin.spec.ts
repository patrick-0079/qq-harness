import { expect, test } from '@playwright/test';

test('功能二级菜单、并发设置、侧栏折叠持久化，以及集中人设管理和会话Markdown预览', async ({
  page,
  request,
}) => {
  page.on('dialog', () => {
    throw Error('禁止浏览器原生弹窗');
  });
  await page.goto('/settings/runtime');
  await expect
    .poll(() =>
      page
        .locator('aside nav .nav-label')
        .evaluateAll((els) =>
          els.every((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1),
        ),
    )
    .toBe(true);
  await page.getByRole('spinbutton', { name: '对话并发池', exact: true }).fill('3');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  expect((await (await request.get('/api/config')).json()).execution.concurrency).toBe(3);
  await expect(page.getByRole('link', { name: '容器', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.locator('.shell')).toHaveClass(/nav-collapsed/);
  await page.reload();
  await expect(page.locator('.shell')).toHaveClass(/nav-collapsed/);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.getByRole('link', { name: '提示词管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '提示词管理', exact: true })).toBeVisible();
  await page.getByText('默认人设 · 只读', { exact: true }).click();
  await expect(page.locator('.readonly-persona textarea')).toHaveCount(0);
  await page.getByRole('button', { name: '新增目录项', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '目录编辑' });
  await editor.getByRole('textbox', { name: '目录 ID' }).fill('browser-md-persona');
  await editor.getByRole('textbox', { name: '目录名称' }).fill('浏览器人设');
  await editor.getByRole('textbox', { name: '目录内容' }).fill('# Markdown 人设\n\n**粗体规则**');
  await editor.getByRole('button', { name: '保存目录项' }).click();
  await expect(editor).not.toBeVisible();
  await page.goto('/chats?chat=private:96001');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '人设与提示词', exact: true }).click();
  await page.getByRole('combobox', { name: '人设目录' }).selectOption('browser-md-persona');
  await expect(page.getByRole('heading', { name: 'Markdown 人设' })).toBeVisible();
  await expect(page.locator('.markdown-preview strong').filter({ hasText: '粗体规则' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '会话人设文本' })).toHaveCount(0);
  await page.getByRole('button', { name: '保存会话设置', exact: true }).click();
  await page.screenshot({
    path: 'test-results/upgrade-persona-preview.png',
    fullPage: true,
  });
});

test('私聊和群聊只显示相关概率，单一触发逻辑持久化，主动话题使用秒', async ({ page, request }) => {
  await request.patch('/api/profiles/private%3A96001', {
    data: { behavior: { enabled: false } },
  });
  await request.patch('/api/profiles/group%3A96002', {
    data: {
      behavior: {
        enabled: true,
        reply: { other: { enabled: true, probability: 30 } },
      },
    },
  });
  await page.goto('/chats?chat=private:96001');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '私聊概率', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: '任意消息概率', exact: true })).toHaveCount(0);
  await expect(page.getByText('峰谷时段', { exact: true })).toHaveCount(0);
  await page.goto('/chats?chat=group:96002');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '私聊概率', exact: true })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: '任意消息概率', exact: true }).fill('31.25');
  await expect(page.getByRole('switch', { name: '启用完整会话策略' })).toHaveCount(0);
  await page.getByRole('button', { name: '保存会话设置', exact: true }).click();
  await expect
    .poll(async () => {
      const cfg = await (await request.get('/api/chats/group%3A96002/settings')).json();
      return [cfg.behavior.enabled, cfg.behavior.reply.other.probability];
    })
    .toEqual([true, 31.25]);
  await page.getByRole('button', { name: '主动话题', exact: true }).click();
  await page.getByRole('spinbutton', { name: '冷场秒数' }).fill('42');
  await page.getByRole('spinbutton', { name: '主动检查间隔秒数' }).fill('9');
  await page.getByRole('button', { name: '保存主动话题' }).click();
  await expect
    .poll(async () => {
      const cfg = await (await request.get('/api/chats/group%3A96002/settings')).json();
      return [cfg.behavior.proactive.idleSeconds, cfg.behavior.proactive.checkEverySeconds];
    })
    .toEqual([42, 9]);
  await page.screenshot({
    path: 'test-results/upgrade-proactive.png',
    fullPage: true,
  });
});

test('会话容器只有选择入口，不创建容器，选择提交已有容器ID', async ({ page }) => {
  let assigned = false,
    created = 0;
  let payload: unknown;
  await page.route('**/api/containers/status', (route) =>
    route.fulfill({
      json: {
        settings: {
          enabled: true,
          engine: 'podman',
          image: 'fixture:test',
          binaryPath: '',
          memoryMb: 512,
          cpus: 1,
          pids: 128,
          network: 'none',
          timeoutMs: 30000,
          maxOutputChars: 16000,
        },
        engine: {
          available: true,
          allowOperations: true,
          imageAvailable: true,
          message: '测试引擎',
        },
        containers: [
          {
            id: 'existing-only',
            name: '已有容器A',
            managed: true,
            chatKeys: assigned ? ['group:96000', 'group:96002'] : ['group:96000'],
            bindings: assigned
              ? [
                  {
                    id: 'existing-only',
                    chatKey: 'group:96002',
                    username: 'g96002',
                    workspace: '/home/g96002/workspace',
                    primary: true,
                  },
                ]
              : [],
            engine: 'podman',
            binary: 'podman',
            image: 'fixture:test',
            running: true,
            status: 'running',
          },
        ],
      },
    }),
  );
  await page.route('**/api/containers/bindings/group%3A96002', (route) => {
    payload = route.request().postDataJSON();
    assigned = true;
    return route.fulfill({ json: { id: 'existing-only' } });
  });
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/containers/inventory')) created++;
  });
  await page.goto('/chats?chat=group:96002');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '容器', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建会话容器' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '选择已有容器' }).click();
  await page.getByText('已有容器A · 1 个会话', { exact: true }).last().click();
  await page.getByRole('button', { name: '保存会话容器' }).click();
  await expect
    .poll(() => payload)
    .toEqual({ containerIds: ['existing-only'], primaryContainerId: 'existing-only' });
  expect(created).toBe(0);
  await page.screenshot({
    path: 'test-results/upgrade-container-selection.png',
    fullPage: true,
  });
});

test('强制触发实际提交一轮，运行左右分栏可复制ID；消息存档可实时查看未读', async ({
  page,
  request,
  context,
}) => {
  await request.post('/api/plugins/run-inspector/enabled', {
    data: { enabled: true },
  });
  await request.patch('/api/profiles/group%3A96004', {
    data: {
      behavior: {
        enabled: true,
        reply: { other: { enabled: true, probability: 0 } },
      },
    },
  });
  await request.post('/api/demo/messages', {
    data: { chatKey: 'group:96004', text: '保留的最新未读消息', atMe: false },
  });
  await page.goto('/chats?chat=group:96004');
  await page.getByRole('tab', { name: '消息存档', exact: true }).click();
  await page.getByRole('switch', { name: '只看未读消息' }).check();
  await expect(page.locator('.bubble').filter({ hasText: '保留的最新未读消息' })).toBeVisible();
  await expect(page.locator('.bubble .unread-badge')).toBeVisible();
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/api/conversation/manual') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '手动触发', exact: true }).click();
  const id = (await (await sent).json()).id;
  expect(id).toBeTruthy();
  await page.getByRole('tab', { name: '运行记录', exact: true }).click();
  const detail = page.getByRole('region', { name: '运行详情' });
  await expect(detail.getByText(id, { exact: true })).toBeVisible();
  await expect(page.locator('.run-list')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '运行详情' })).toHaveCount(0);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await detail.getByRole('button', { name: '复制对话ID' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  await page.screenshot({
    path: 'test-results/upgrade-run-split.png',
    fullPage: true,
  });
});

test('导入按显式类型自动识别并显示可读预览，不需要选择安装类型', async ({ page, request }) => {
  try {
    await page.goto('/extensions');
    await page.getByRole('button', { name: '导入扩展', exact: true }).click();
    await page.getByLabel('扩展 ZIP 或文件').setInputFiles([
      {
        name: 'extension.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            id: 'browser-typed',
            type: 'tool',
            name: '声明类型工具',
          }),
        ),
      },
      {
        name: 'index.js',
        mimeType: 'text/javascript',
        buffer: Buffer.from('export function setup(){}'),
      },
    ]);
    await page.getByRole('button', { name: '预览导入' }).click();
    const importer = page.locator('.extension-importer');
    await expect(importer.getByText('识别类型', { exact: true })).toBeVisible();
    await expect(importer.getByText('工具包', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '安装位置' })).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/upgrade-import.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: '确认安装' }).click();
    await expect(importer).not.toBeVisible();
  } finally {
    await request.delete('/api/extensions/tool/browser-typed');
  }
});
