import { expect, test } from '@playwright/test';

test('折叠侧栏真实收窄，图标不越界，子菜单在屏幕内且支持键盘和路由', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/settings/runtime');
  await expect(page.getByRole('heading', { name: '运行与调度', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: '工作台导航' });
  await expect(sidebar).toHaveCSS('width', '64px');
  expect(
    await page.locator('.sidebar-link').evaluateAll((links) =>
      links.every((link) => {
        const bounds = link.closest('aside')!.getBoundingClientRect(),
          own = link.getBoundingClientRect();
        return (
          own.left >= bounds.left &&
          own.right <= bounds.right &&
          link.scrollWidth <= link.clientWidth + 1
        );
      }),
    ),
  ).toBe(true);
  await expect(page.locator('.sidebar-text').first()).toBeHidden();
  const settings = page.getByRole('link', { name: '设置', exact: true });
  await settings.focus();
  await settings.press('ArrowRight');
  const flyout = page.getByLabel('设置子菜单');
  await expect(flyout).toBeVisible();
  await expect(flyout.getByRole('link').first()).toBeFocused();
  const bounds = await flyout.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1366);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  await flyout.getByRole('link').first().press('Escape');
  await expect(flyout).toBeHidden();
  await settings.hover();
  await expect(flyout).toBeVisible();
  await flyout.getByRole('link', { name: '容器', exact: true }).click();
  await expect(page.getByRole('heading', { name: '容器', exact: true })).toBeVisible();
  await expect(settings).toHaveClass(/active/);
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '64px');
  await expect(page.getByRole('heading', { name: '容器', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/layout-collapsed.png' });
});

test('长插件名称和服务依赖不挤坏列宽，滚动表头与正文对齐', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/plugins', async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.plugins[0].name = '非常长的配置服务名称用于验证列宽与省略显示不会挤压其他列';
    data.plugins[0].requires = Array.from(
      { length: 8 },
      (_, i) => 'harness.' + 'long-service-'.repeat(5) + i,
    );
    await route.fulfill({ json: data });
  });
  await page.goto('/plugins');
  const table = page.locator('.plugin-table'),
    viewport = page.locator('.data-table-scroll');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  expect(
    await table.evaluate((table) => {
      const head = [...table.querySelectorAll('thead th')],
        body = [...table.querySelectorAll('tbody tr:first-child td')];
      return head.every((cell, i) => {
        const a = cell.getBoundingClientRect(),
          b = body[i]!.getBoundingClientRect();
        return (
          Math.abs(a.x - b.x) < 1 &&
          Math.abs(a.width - b.width) < 1 &&
          cell.scrollWidth <= cell.clientWidth + 1
        );
      });
    }),
  ).toBe(true);
  await expect(table.locator('.plugin-name').first()).toHaveCSS('white-space', 'nowrap');
  await viewport.evaluate((el) => {
    el.scrollTop = 240;
  });
  const header = await table.locator('thead').boundingBox(),
    area = await viewport.boundingBox();
  // Sticky applies to individual cells, not the thead box itself.
  const cell = await table.locator('thead th').first().boundingBox();
  expect(cell!.y).toBeGreaterThanOrEqual(area!.y);
  expect(cell!.y).toBeLessThanOrEqual(area!.y + 2);
  expect(header!.width).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/layout-plugins.png' });
});

for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [1024, 768],
] as const) {
  test(`${width}×${height} 会话填满可用高度，设置表头不重叠，运行区和发送区不被挤出`, async ({
    page,
    request,
  }) => {
    // Other flows intentionally unload this plugin. This case owns its fixture.
    await request.post('/api/plugins/run-inspector/enabled', { data: { enabled: true } });
    await page.setViewportSize({ width, height });
    await page.goto('/chats?chat=group:10001');
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    const policy = page.getByRole('button', { name: '聊天策略', exact: true });
    await policy.click();
    await expect(policy).toHaveAttribute('aria-selected', 'true');
    const detail = await page.locator('.chat-detail').boundingBox(),
      composer = await page.locator('.composer').boundingBox();
    expect(detail!.height).toBeGreaterThan(height - 210);
    expect(detail!.y + detail!.height).toBeLessThanOrEqual(height);
    expect(composer!.height).toBeLessThan(60);
    const content = page.locator('.settings-content'),
      firstHeader = page.locator('.policy-table th').first();
    await expect(firstHeader).toHaveCSS('position', 'static');
    await content.evaluate((el) => {
      el.scrollTop = 500;
    });
    expect((await firstHeader.boundingBox())!.y).toBeLessThan((await content.boundingBox())!.y);
    await expect(page.getByRole('button', { name: '保存会话设置', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '运行记录', exact: true }).click();
    await expect(page.getByRole('tab', { name: '运行记录', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const run = await page.locator('.run-browser').boundingBox(),
      pane = await page.locator('.tab-content').boundingBox();
    expect(run!.height).toBeGreaterThan(200);
    expect(run!.y + run!.height).toBeLessThanOrEqual(pane!.y + pane!.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/layout-runs-${width}.png` });
  });
}

test('小窗口保持独立滚动和暗色布局，主要设置不产生页面横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 800 });
  await page.goto('/settings/runtime');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('combobox', { name: '界面主题' }).selectOption('dark');
  await expect(page.locator('.app-sidebar')).toHaveCSS('background-color', 'rgb(17, 28, 47)');
  await expect(page.getByRole('spinbutton', { name: '对话并发池', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/layout-dark-small.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/chats?chat=group:10001');
  await expect(page.locator('.chat-list')).toBeVisible();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('业务说明aside不继承主侧栏整屏高度，QQ目录设置无需越过空白整页', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/qq-portable');
  const guide = page.locator('.qq-steps');
  await expect(guide.getByRole('heading', { name: '连接只需三步' })).toBeVisible();
  await expect(guide).toHaveCSS('position', 'static');
  expect((await guide.boundingBox())!.height).toBeLessThan(420);
  expect((await page.locator('.qq-directory-panel').boundingBox())!.y).toBeLessThan(650);
  await page.screenshot({ path: 'test-results/layout-qq.png' });
});
