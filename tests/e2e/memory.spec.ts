import { expect, test } from '@playwright/test';

test('记忆插件按需加载界面并管理会话记忆与暂存', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await page.getByRole('button', { name: '＋ 添加会话', exact: true }).click();
  await page.getByRole('textbox', { name: '新会话标识' }).fill('group:99881');
  await page.getByRole('button', { name: '打开会话' }).click();
  await page.getByRole('tab', { name: '记忆', exact: true }).click();
  const workspace = page.locator('.memory-workspace');
  await expect(workspace.getByText('当前范围暂无短期。')).toBeVisible();
  await workspace.getByRole('textbox', { name: '记忆维护申请', exact: true }).fill('记录：每周五讨论项目');
  await workspace.getByRole('button', { name: '提交维护申请', exact: true }).click();
  await expect(
    workspace.locator('.memory-content').getByRole('cell', { name: '每周五讨论项目', exact: true }),
  ).toBeVisible();
  await workspace.getByRole('tab', { name: '草稿本', exact: true }).click();
  await workspace.getByRole('textbox', { name: '记忆维护申请', exact: true }).fill('暂存：下次讨论预算');
  await workspace.getByRole('button', { name: '提交维护申请', exact: true }).click();
  await expect(
    workspace.locator('.memory-content').getByRole('cell', { name: '下次讨论预算', exact: true }),
  ).toBeVisible();
  await workspace.locator('.memory-content').getByRole('button', { name: '查看／申请修改' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '申请遗忘' }).click();
  await expect(
    workspace.locator('.memory-content').getByRole('cell', { name: '下次讨论预算', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'test-results/memory-agent-scratchpad.png' });
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 agent-memory', exact: true }).uncheck();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await expect(page.getByRole('tab', { name: '记忆', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await request.post('/api/plugins/agent-memory/enabled', { data: { enabled: true } });
});
