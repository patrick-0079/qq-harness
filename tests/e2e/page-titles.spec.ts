import { expect, test } from '@playwright/test';

test('所有页面移除内容区重复标题，615×524保留顶部标题与功能操作', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 615, height: 524 });
  const routes = [
    ['/', '运行总览', '.metrics'],
    ['/chats?chat=group:10001', '会话', '.chat-layout'],
    ['/plugins', '插件', '[aria-label="搜索插件"]'],
    ['/prompts', '提示词管理', '[aria-label="搜索目录"]'],
    ['/tools', '内置工具', '[aria-label="搜索内置工具"]'],
    ['/extensions', '扩展仓库', '.extension-navigation'],
    ['/settings/runtime', '运行与调度', '.settings-page form'],
    ['/settings/model', '模型接入', '.settings-page form'],
    ['/settings/access', '会话准入', '.settings-page form'],
    ['/settings/search', '联网搜索', '.settings-page form'],
    ['/settings/containers', '容器', '.container-console .ant-tabs'],
    ['/snowluma', 'SnowLuma', '.snowluma-page .panel'],
    ['/qq-portable', '便携 QQ', '.qq-summary'],
  ];
  for (const [path, title, ready] of routes)
    await test.step(title!, async () => {
      await page.goto(path!);
      await expect(page.locator(ready!).first()).toBeVisible();
      await expect(
        page.locator('.console-header').getByRole('heading', { name: title, level: 1, exact: true }),
      ).toBeVisible();
      await expect(page.locator('.page-heading, .page h1')).toHaveCount(0);
      const header = (await page.locator('.console-header').boundingBox())!;
      const content = (await page.locator('.page > :visible').first().boundingBox())!;
      expect(content.y - header.y - header.height).toBeLessThanOrEqual(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  await page.goto('/extensions');
  await expect(page.getByRole('button', { name: '导入扩展', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重载扩展', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /系统下线|系统上线/ })).toBeVisible();
  await page.goto('/chats?chat=group:10001');
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '展开会话列表', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/no-page-title-chats-615.png' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'test-results/no-page-title-chats-desktop.png' });
});
