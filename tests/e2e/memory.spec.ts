import { expect, test } from '@playwright/test';

test('记忆插件按需加载界面并管理会话记忆与暂存', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await page.getByRole('textbox', { name: '新会话标识' }).fill('group:99881');
  await page.getByRole('button', { name: '打开会话' }).click();
  await page.getByRole('tab', { name: '记忆与暂存' }).click();
  await expect(page.getByText('当前范围暂无记忆。')).toBeVisible();
  await page.getByRole('textbox', { name: '事实键' }).fill('meeting-rule');
  await page.getByRole('textbox', { name: '新记忆内容' }).fill('每周五讨论项目');
  await page.getByRole('button', { name: '添加记忆' }).click();
  await expect(page.getByRole('textbox', { name: '记忆内容' })).toHaveValue('每周五讨论项目');
  await page.getByRole('textbox', { name: '暂存内容' }).fill('下次讨论预算');
  await page.getByRole('button', { name: '添加暂存' }).click();
  await expect(page.getByText('下次讨论预算', { exact: true })).toBeVisible();
  await page
    .locator('article')
    .filter({ hasText: '下次讨论预算' })
    .getByRole('button', { name: '删除' })
    .click();
  await expect(page.getByText('下次讨论预算', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('checkbox', { name: '启用 agent-memory', exact: true }).uncheck();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await expect(page.getByRole('tab', { name: '记忆与暂存' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
