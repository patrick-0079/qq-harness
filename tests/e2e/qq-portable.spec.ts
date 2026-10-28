import { expect, test } from '@playwright/test';

test('便携 QQ 页面默认禁止真实启动，设置保存后可随插件卸载恢复', async ({ page }) => {
  await page.goto('/qq-portable');
  await expect(page.getByRole('heading', { name: '便携 QQ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动便携 QQ', exact: true })).toBeDisabled();
  await page
    .getByRole('textbox', { name: '便携 QQ 程序目录' })
    .fill('D:\\test-only\\portable-not-installed');
  await page
    .getByRole('textbox', { name: '便携 QQ 数据目录' })
    .fill('D:\\test-only\\portable-profile');
  await page.getByRole('button', { name: '保存便携 QQ 设置' }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 qq-portable', exact: true }).uncheck();
  await expect(page.getByRole('link', { name: '便携 QQ', exact: true })).toHaveCount(0);
  await page.getByRole('switch', { name: '启用 qq-portable', exact: true }).check();
  await page.getByRole('link', { name: '便携 QQ', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '便携 QQ 程序目录' })).toHaveValue(
    'D:\\test-only\\portable-not-installed',
  );
});

test('修改目录后启动会先保存，原生启动失败明确显示且不误报成功', async ({ page }) => {
  const order: string[] = [];
  let failed = false;
  let settings = {
    directory: 'D:\\mock\\QQ',
    dataDirectory: 'D:\\mock\\profile',
  };
  await page.route('**/api/qq-portable/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/settings')) {
      if (route.request().method() === 'PATCH') {
        settings = route.request().postDataJSON();
        order.push('settings');
      }
      return route.fulfill({ json: settings });
    }
    if (url.endsWith('/launch')) {
      order.push('launch');
      failed = true;
      return route.fulfill({
        status: 409,
        json: { error: { message: 'QQ 启动器提前退出（0x80000003）' } },
      });
    }
    return route.fulfill({
      json: {
        phase: failed ? 'failed' : 'ready',
        installed: true,
        version: '9.9.36-53644',
        owned: false,
        pid: null,
        allowLaunch: true,
        message: failed ? 'QQ 启动器提前退出（0x80000003）' : '',
      },
    });
  });
  await page.goto('/qq-portable');
  await page.getByRole('textbox', { name: '便携 QQ 数据目录' }).fill('D:\\mock\\new-profile');
  await page.getByRole('button', { name: '启动便携 QQ', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('0x80000003');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(order).toEqual(['settings', 'launch']);
  expect(settings.dataDirectory).toBe('D:\\mock\\new-profile');
});
