import { expect, test } from '@playwright/test';

test('记忆Agent异步维护、层级分开、文档预览、人设与任务状态可见', async ({ page, request }) => {
  await request.post('/api/plugins/agent-memory/enabled', { data: { enabled: true } });
  await page.goto('/chats?chat=group:99882&tab=memory');
  const workspace = page.locator('.memory-workspace');
  await expect(workspace.getByRole('tab', { name: '记忆管理', exact: true })).toBeVisible();
  await expect(workspace.getByText('当前范围暂无短期。')).toBeVisible();
  await workspace.getByRole('textbox', { name: '记忆维护申请', exact: true }).fill('记住：每周五讨论项目');
  await workspace.getByRole('button', { name: '提交维护申请', exact: true }).click();
  await expect(workspace.getByRole('status')).toContainText('申请已受理');
  const table = workspace.locator('.memory-content');
  await expect(table.getByRole('cell', { name: '每周五讨论项目', exact: true })).toBeVisible();
  await table.getByRole('button', { name: '查看／申请修改' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '针对该记忆的修改说明' }).fill('更正：每周六讨论项目');
  await dialog.getByRole('button', { name: '提交修改申请' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(table.getByRole('cell', { name: '每周六讨论项目', exact: true })).toBeVisible();
  await table.getByRole('button', { name: '查看／申请修改' }).click();
  await dialog.locator('summary').filter({ hasText: '来源与版本历史' }).click();
  await expect(dialog.locator('.memory-diff del').filter({ hasText: '每周五讨论项目' })).toBeVisible();
  await expect(dialog.locator('.memory-diff ins').filter({ hasText: '每周六讨论项目' })).toBeVisible();
  await page.screenshot({ path: 'test-results/memory-agent-history.png' });
  await dialog.getByRole('button', { name: '关闭编辑' }).click();
  await workspace.getByRole('tab', { name: '中期文档', exact: true }).click();
  await workspace.getByRole('button', { name: '整理中期文档', exact: true }).click();
  await expect(table.getByRole('cell', { name: '每周六讨论项目', exact: true })).toBeVisible();
  await workspace.getByRole('tab', { name: '长期文档', exact: true }).click();
  await expect(table.getByRole('cell', { name: /人设与自我认知/ })).toBeVisible();
  await workspace.getByRole('tab', { name: '记忆设置', exact: true }).click();
  await expect(
    workspace.getByRole('spinbutton', { name: '短期整理间隔（分钟）', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/memory-agent-settings.png' });
});
