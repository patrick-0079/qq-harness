import { expect, test } from '@playwright/test';

test('SnowLuma 页面由插件提供，默认不启动程序，设置持久化且卸载移除入口', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/snowluma');
  await expect(page.getByRole('heading', { name: 'SnowLuma', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动 SnowLuma', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '随插件启用自动启动' })).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: '我已阅读并同意所安装 SnowLuma 版本的 EULA' }),
  ).not.toBeChecked();
  await page
    .getByRole('textbox', { name: 'SnowLuma 安装目录', exact: true })
    .fill('D:\\qq-harness-test-only\\not-installed');
  await page.getByRole('button', { name: '保存 SnowLuma 设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('checkbox', { name: '启用 snowluma-runtime', exact: true }).uncheck();
  await expect(page.getByRole('link', { name: 'SnowLuma', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '启用 snowluma-runtime', exact: true }).check();
  await page.getByRole('link', { name: 'SnowLuma', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'SnowLuma 安装目录', exact: true })).toHaveValue(
    'D:\\qq-harness-test-only\\not-installed',
  );
  await page.screenshot({ path: 'test-results/snowluma.png', fullPage: true });
  expect(errors).toEqual([]);
});
