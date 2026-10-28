import { expect, test } from '@playwright/test';

test('SnowLuma 页面由插件提供，默认不启动程序，设置持久化且卸载移除入口', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/snowluma');
  await expect(page.getByRole('heading', { name: 'SnowLuma', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动 SnowLuma', exact: true })).toBeDisabled();
  await expect(page.getByRole('switch', { name: '随插件启用自动启动' })).not.toBeChecked();
  await expect(
    page.getByRole('switch', {
      name: '我已阅读并同意所安装 SnowLuma 版本的 EULA',
    }),
  ).not.toBeChecked();
  await page
    .getByRole('textbox', { name: 'SnowLuma 安装目录', exact: true })
    .fill('D:\\qq-harness-test-only\\not-installed');
  await page.getByRole('button', { name: '保存 SnowLuma 设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 snowluma-runtime', exact: true }).uncheck();
  await expect(page.getByRole('link', { name: 'SnowLuma', exact: true })).toHaveCount(0);
  await page.getByRole('switch', { name: '启用 snowluma-runtime', exact: true }).check();
  await page.getByRole('link', { name: 'SnowLuma', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'SnowLuma 安装目录', exact: true })).toHaveValue(
    'D:\\qq-harness-test-only\\not-installed',
  );
  await page.screenshot({ path: 'test-results/snowluma.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('内部托管和协议勾选可直接启动，启动前自动保存，不发真实运行时请求', async ({ page }) => {
  const order: string[] = [];
  let running = false;
  let settings = {
    mode: 'external',
    directory: 'D:\\mock\\SnowLuma',
    nodePath: '',
    autoStart: false,
    acceptEula: false,
    acceptPrivacy: false,
  };
  await page.route('**/api/snowluma/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/settings')) {
      if (route.request().method() === 'PATCH') {
        settings = route.request().postDataJSON();
        order.push('settings');
      }
      return route.fulfill({ json: settings });
    }
    if (url.endsWith('/logs')) return route.fulfill({ json: { logs: [] } });
    if (url.endsWith('/launch')) {
      order.push('launch');
      running = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        phase: running ? 'running' : 'stopped',
        installed: true,
        owned: running,
        pid: running ? 123 : null,
        webuiReady: running,
        webuiUrl: 'http://127.0.0.1:5099/',
        onebotConnected: false,
        hookAutoLoad: true,
        allowLaunch: true,
        message: '',
      },
    });
  });
  await page.goto('/snowluma');
  await expect(page.getByRole('button', { name: '启动 SnowLuma', exact: true })).toBeDisabled();
  await expect(page.getByText('当前为外部模式。', { exact: false })).toBeVisible();
  await page.getByLabel('运行方式').selectOption('managed');
  await page.getByRole('switch', { name: '我已阅读并同意所安装 SnowLuma 版本的 EULA' }).check();
  await page
    .getByRole('switch', {
      name: '我已阅读并同意所安装 SnowLuma 版本的隐私政策',
    })
    .check();
  await page.getByRole('button', { name: '启动 SnowLuma', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已请求启动');
  expect(order).toEqual(['settings', 'launch']);
  expect(settings).toMatchObject({
    mode: 'managed',
    acceptEula: true,
    acceptPrivacy: true,
  });
});
