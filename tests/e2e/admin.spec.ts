import { expect, test } from '@playwright/test';
test('亮暗主题和跟随系统实时切换，跨页面与刷新持久化', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('combobox', { name: '界面主题' })).toHaveValue('system');
  await page.getByRole('combobox', { name: '界面主题' }).selectOption('light');
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('combobox', { name: '界面主题' }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByRole('button', { name: '收起会话列表', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.app-sidebar')).toHaveCSS('background-color', 'rgb(17, 28, 47)');
  await page.screenshot({
    path: 'test-results/admin-dark.png',
    fullPage: true,
  });
  await page.getByRole('combobox', { name: '界面主题' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.app-sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({
    path: 'test-results/admin-light.png',
    fullPage: true,
  });
});
test('会话元数据、模型与记忆间隔覆盖持久化，未保存编辑受保护', async ({ page }) => {
  await page.goto('/chats');
  await page.getByRole('button', { name: '＋ 添加会话', exact: true }).click();
  await page.getByRole('textbox', { name: '新会话标识' }).fill('group:77700');
  await page.getByRole('button', { name: '打开会话' }).click();
  page.on('dialog', () => {
    throw new Error('不应出现浏览器原生弹窗');
  });
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话' });
  await rename.getByRole('textbox', { name: '会话名称' }).fill('管理测试会话');
  await expect(rename).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/rename-dialog.png' });
  await rename.getByRole('button', { name: '保存修改' }).click();
  await expect(rename).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '管理测试会话' })).toBeVisible();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型', exact: true }).click();
  await page.getByRole('textbox', { name: '会话主模型' }).fill('fixture-model');
  await page.getByRole('button', { name: '保存会话设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '独立快照' })).toBeVisible();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  await page.getByRole('spinbutton', { name: /^排队超时/ }).fill('45000');
  await page.getByRole('button', { name: '保存会话设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '独立快照' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: /^排队超时/ })).toHaveValue('45000');
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await page.getByRole('switch', { name: '跟随全局记忆整理设置' }).uncheck();
  await page.getByRole('spinbutton', { name: '短期整理间隔（分钟）', exact: true }).fill('45');
  await page.getByRole('button', { name: '保存整理设置' }).click();
  await expect(page.getByRole('status').filter({ hasText: '整理设置已保存' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '会话主模型' })).toHaveValue('fixture-model');
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '短期整理间隔（分钟）', exact: true })).toHaveValue('45');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型', exact: true }).click();
  await page.getByRole('textbox', { name: '会话主模型' }).fill('未保存编辑');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page
    .getByRole('dialog', { name: '离开前放弃修改？' })
    .getByRole('button', { name: '继续编辑' })
    .click();
  await expect(page).toHaveURL(/chats/);
  await expect(page.getByRole('textbox', { name: '会话主模型' })).toHaveValue('未保存编辑');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page
    .getByRole('dialog', { name: '离开前放弃修改？' })
    .getByRole('button', { name: '放弃修改并离开' })
    .click();
  await expect(page).toHaveURL(/settings/);
});

test('重命名 React 弹窗保留失败输入，支持取消和键盘关闭', async ({ page }) => {
  page.on('dialog', () => {
    throw new Error('禁止浏览器原生弹窗');
  });
  await page.goto('/chats?chat=group:77700');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重命名会话' });
  await dialog.getByRole('textbox', { name: '会话名称' }).fill('失败后保留');
  await page.route('**/api/chats/group%3A77700', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: '模拟保存失败' } }),
      });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await expect(dialog.getByRole('alert')).toContainText('模拟保存失败');
  await expect(dialog.getByRole('textbox', { name: '会话名称' })).toHaveValue('失败后保留');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '管理测试会话' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toBeFocused();
});

test('新增会话后立即重命名，写请求必须命中新会话', async ({ page }) => {
  await page.goto('/chats?chat=group:10001');
  await page.getByRole('button', { name: '＋ 添加会话', exact: true }).click();
  await page.getByRole('textbox', { name: '新会话标识' }).fill('group:88887');
  await page.getByRole('button', { name: '打开会话', exact: true }).click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话' });
  await rename.getByRole('textbox', { name: '会话名称' }).fill('新会话切换验收');
  const write = page.waitForRequest(
    (request) => request.method() === 'PATCH' && /\/api\/chats\//.test(request.url()),
  );
  await rename.getByRole('button', { name: '保存修改', exact: true }).click();
  expect(new URL((await write).url()).pathname).toBe('/api/chats/group%3A88887');
  await expect(page.getByRole('heading', { name: '新会话切换验收', exact: true })).toBeVisible();
});
