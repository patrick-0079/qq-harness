import { expect, test } from '@playwright/test';

test('首次打开慢接口显示加载并自动出现数据，失败后可在原页面重试', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/tools?scope=default', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto('/tools');
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: '正在加载工具' })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'send_message' })).toBeVisible();
  expect(requests).toBeLessThanOrEqual(2);
  await page.unroute('**/api/tools?scope=default');
  let fail = true;
  await page.route('**/api/tools?scope=default', async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: '临时不可用' } }),
      });
    else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '重试加载工具', exact: true })).toBeVisible();
  await expect(page.getByText('临时不可用', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重试加载工具', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'send_message' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试加载工具', exact: true })).toHaveCount(0);
});

test('内置提示词只读可复制，操作留有间距，导入使用样式化文件按钮', async ({ page }) => {
  await page.route('**/api/catalogs', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.prompts = [
      { id: 'builtin-compatible', name: '内置提示词验证', text: '不可修改的原始模板', readOnly: true },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto('/prompts');
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: '内置提示词验证' });
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
  await expect(row.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  const boxes = await row.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const r = button.getBoundingClientRect();
      return { x: r.x, right: r.right, y: r.y, bottom: r.bottom };
    }),
  );
  for (let i = 1; i < boxes.length; i++)
    expect(boxes[i]!.x - boxes[i - 1]!.right >= 4 || boxes[i]!.y - boxes[i - 1]!.bottom >= 4).toBe(true);
  await row.getByRole('button', { name: '复制为自定义', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '目录名称' })).toHaveValue('内置提示词验证（副本）');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/extensions');
  await page.getByRole('button', { name: '导入扩展', exact: true }).click();
  await expect(page.locator('input[type=file]')).toHaveCount(2);
  for (const input of await page.locator('input[type=file]').all()) await expect(input).toBeHidden();
  await expect(page.getByRole('button', { name: /选择.*文件/ }).first()).toBeVisible();
});

test('936×524会话可收起列表并展开运行区，刷新保留会话列表状态', async ({ page }) => {
  await page.setViewportSize({ width: 936, height: 524 });
  await page.goto('/chats');
  const detail = page.locator('.chat-detail');
  const before = (await detail.boundingBox())!.width;
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await expect(page.locator('.chat-list')).toBeHidden();
  const after = (await detail.boundingBox())!.width;
  expect(after - before).toBeGreaterThan(180);
  await page.reload();
  await expect(page.getByRole('button', { name: '展开会话列表', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开查看', exact: true }).click();
  const bounds = (await page.locator('.records-expanded').boundingBox())!;
  expect(bounds.width).toBeGreaterThan(850);
  expect(bounds.height).toBeGreaterThan(420);
  await page.screenshot({ path: 'test-results/chat-records-expanded-936.png' });
  await page.getByRole('button', { name: '退出展开', exact: true }).click();
  await expect(page.locator('.records-expanded')).toHaveCount(0);
});
