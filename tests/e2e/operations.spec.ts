import { expect, test } from '@playwright/test';

test('运维首屏、各子页面、设置脱敏和独立失败提示', async ({ page, request }) => {
  const previous = await (await request.get('/api/operations/settings')).json();
  try {
    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: '运维控制台', exact: true })).toBeVisible();
    await expect(page.locator('.operations-page')).toContainText('记忆 Agent：可用');
    await page.getByRole('button', { name: '资源占用', exact: true }).click();
    await expect(page.locator('.operations-page')).toContainText('后端内存');
    await page.getByRole('button', { name: '用量与余额', exact: true }).click();
    await expect(page.getByRole('cell', { name: '近七天', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查询已配置渠道', exact: true }).click();
    await expect(page.locator('.operations-page')).toContainText('未配置');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('运维 QQ 白名单').fill('12345678');
    await page.getByLabel('DeepSeek 密钥', { exact: true }).fill('test-only-secret');
    await page.getByRole('button', { name: '保存运维设置', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible();
    expect(JSON.stringify(await (await request.get('/api/config')).json())).not.toContain('test-only-secret');
    await expect(page.getByLabel('DeepSeek 密钥', { exact: true })).toHaveValue('******');
    await page.getByRole('button', { name: '操作记录', exact: true }).click();
    await expect(page.locator('.operations-page')).toContainText('运维设置已更新');
    await page.route('**/api/operations/resources', (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'TEST', message: '模拟采样失败' } }),
      }),
    );
    await page.getByRole('button', { name: '资源占用', exact: true }).click();
    await page.getByRole('button', { name: '重新采样', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('模拟采样失败');
    await page.getByRole('button', { name: '状态与诊断', exact: true }).click();
    await expect(page.locator('.operations-page')).toContainText('记忆 Agent：可用');
    await page.setViewportSize({ width: 615, height: 524 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/operations-615.png' });
  } finally {
    await request.patch('/api/operations/settings', { data: previous });
  }
});
