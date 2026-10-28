import { expect, test } from '@playwright/test';
test('全局上下线覆盖所有页面，上线跳过积压并显示新消息运行', async ({ page, request }) => {
  const chatKey = 'group:707070';
  await request.delete('/api/pause');
  await request.patch('/api/config', {
    data: {
      acceptAllSessions: true,
      defaults: { wakeDelayMs: 0 },
      send: { minIntervalMs: 0, dedupeMs: 0 },
      chatMeta: { [chatKey]: { alias: '上下线测试会话' } },
    },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '系统下线', exact: true }).click();
    await expect(page.getByRole('button', { name: '系统上线', exact: true })).toBeEnabled();
    await request.post('/api/demo/messages', { data: { chatKey, text: '跳过的积压' } });
    await page.goto('/chats');
    await page.getByRole('button', { name: '系统上线', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '历史积压已跳过' })).toBeVisible();
    const records = async () =>
      (await (await request.get('/api/archives')).json()).filter((r: any) => r.chatKey === chatKey);
    expect(await records()).toHaveLength(0);
    await expect(page.getByRole('button', { name: '恢复并处理积压', exact: true })).toHaveCount(0);
    await request.post('/api/demo/messages', { data: { chatKey, text: '上线后的新消息' } });
    await expect.poll(async () => (await records()).length).toBe(1);
    await page.goto('/');
    await expect(page.getByRole('cell').filter({ hasText: '上下线测试会话' }).first()).toBeVisible();
  } finally {
    await request.delete('/api/pause');
  }
});
