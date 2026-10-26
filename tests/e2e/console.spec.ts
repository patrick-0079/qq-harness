import { expect, test } from '@playwright/test';

test('React 页面插件、完整聊天流程、前后端插件同时停用与加载', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运行总览' })).toBeVisible();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await page.getByRole('textbox', { name: '演示消息' }).fill('浏览器验证消息');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.bubble').filter({ hasText: '演示回复：' })).toBeVisible();
  await page.getByRole('tab', { name: '执行轨迹' }).click();
  await expect(page.getByText('send_message:', { exact: false }).first()).toBeVisible();
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('checkbox', { name: '启用 example-notes', exact: true }).check();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await page.getByRole('tab', { name: '插件便笺' }).click();
  await expect(page.getByText('这条便笺来自安装后的独立插件。', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('checkbox', { name: '启用 example-notes', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '启用 run-inspector', exact: true }).uncheck();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await expect(page.getByRole('tab', { name: '执行轨迹' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '插件便笺' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/console-chats.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('生产构建只共享一份 React 运行时，并提供适配器无关的插件界面', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运行总览' })).toBeVisible();
  const exports = await page.evaluate(async () => {
    const url = '/runtime.js';
    const runtime = await import(url);
    return { react: typeof runtime.React.createElement, sdk: typeof runtime.ClientSDK.defineClientPlugin };
  });
  expect(exports).toEqual({ react: 'function', sdk: 'function' });
  await page.screenshot({ path: 'test-results/console-overview.png', fullPage: true });
});
