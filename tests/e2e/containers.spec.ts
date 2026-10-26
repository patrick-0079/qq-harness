import { expect, test } from '@playwright/test';

test('容器配置、默认操作门禁、页面插件装卸与设置持久化', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/containers');
  await expect(page.getByRole('heading', { name: '容器', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '启用容器功能' })).not.toBeChecked();
  await page.getByRole('textbox', { name: '容器会话标识' }).fill('group:123');
  await expect(page.getByRole('button', { name: '创建会话容器' })).toBeDisabled();
  await page.getByRole('combobox', { name: '容器引擎' }).selectOption('podman');
  await page.getByRole('textbox', { name: '容器镜像', exact: true }).fill('local-test:fixture');
  await page.getByRole('button', { name: '保存容器设置' }).click();
  await expect(page.getByRole('status')).toContainText('容器设置已保存');
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('checkbox', { name: '启用 container-console', exact: true }).uncheck();
  await expect(page.getByRole('link', { name: '容器', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '启用 container-console', exact: true }).check();
  await page.getByRole('link', { name: '容器', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '容器镜像', exact: true })).toHaveValue(
    'local-test:fixture',
  );
  await page.screenshot({ path: 'test-results/containers.png', fullPage: true });
  expect(errors).toEqual([]);
});
