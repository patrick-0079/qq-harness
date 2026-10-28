import { expect, test } from '@playwright/test';
test('搜索管理提供方、凭据掩码、React抽屉、刷新持久化及测试结果', async ({ page, request }) => {
  page.on('dialog', () => {
    throw new Error('不允许浏览器原生弹窗');
  });
  await request.patch('/api/web/settings', {
    data: { enabled: true, provider: 'bing', maxResults: 6, providers: [] },
  });
  await page.goto('/settings/search');
  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: '搜索提供方', exact: true }),
  });
  await section.getByRole('button', { name: '添加搜索提供方', exact: true }).click();
  const drawer = page.getByRole('dialog', {
    name: '添加搜索提供方',
    exact: true,
  });
  await drawer.getByLabel('名称', { exact: true }).fill('本地 mock 搜索');
  await drawer.getByLabel('接口地址', { exact: true }).fill('https://search.fixture.invalid');
  await drawer.getByLabel('API Key', { exact: true }).fill('browser-fixture-secret');
  await drawer.getByRole('button', { name: '应用到待保存配置' }).click();
  await expect(drawer).not.toBeVisible();
  const settings = await (await request.get('/api/web/settings')).json();
  expect(settings.providers).toHaveLength(0);
  await section.getByRole('button', { name: '保存搜索设置', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('搜索设置已保存');
  await section.getByLabel('搜索提供方', { exact: true }).selectOption({ label: '本地 mock 搜索' });
  await section.getByRole('button', { name: '保存搜索设置', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('搜索设置已保存');
  const saved = await (await request.get('/api/web/settings')).json();
  expect(saved.providers[0].apiKey).toBe('******');
  expect(JSON.stringify(saved)).not.toContain('browser-fixture-secret');
  await page.reload();
  await expect(section.getByLabel('搜索提供方', { exact: true })).toHaveValue(
    'custom:' + saved.providers[0].id,
  );
  await section.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑搜索提供方' });
  await expect(edit.getByLabel('API Key', { exact: true })).toHaveValue('');
  await edit.getByLabel('名称', { exact: true }).fill('已改名');
  await edit.getByRole('button', { name: '应用到待保存配置' }).click();
  await section.getByRole('button', { name: '保存搜索设置', exact: true }).click();
  await page.route('**/api/web/test', (route) =>
    route.fulfill({
      json: {
        runId: 'mock-search-run',
        result: {
          results: [
            {
              title: '浏览器搜索测试结果',
              url: 'https://fixture.invalid',
              snippet: '测试摘要',
            },
          ],
        },
      },
    }),
  );
  await section.getByRole('button', { name: '发送搜索测试请求' }).click();
  await expect(section.getByRole('link', { name: '浏览器搜索测试结果' })).toBeVisible();
  await section.getByRole('button', { name: '删除', exact: true }).click();
  const confirm = page.getByRole('dialog', {
    name: '删除搜索提供方',
    exact: true,
  });
  await confirm.getByRole('button', { name: '确认', exact: true }).click();
  await section.getByRole('button', { name: '保存搜索设置', exact: true }).click();
  await expect(section.getByText('暂无自定义提供方', { exact: true })).toBeVisible();
  expect((await (await request.get('/api/web/settings')).json()).provider).toBe('bing');
});
