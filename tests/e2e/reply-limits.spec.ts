import { expect, test } from '@playwright/test';

test('单会话回复条数上限保存并刷新持久化，默认会话有独立配置入口', async ({ page, request }) => {
  const chat = 'group:991231';
  try {
    await page.goto('/chats?chat=' + chat);
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '聊天策略', exact: true }).click();
    await page.getByRole('spinbutton', { name: '每轮回复消息上限', exact: true }).fill('3');
    await page.getByRole('button', { name: '保存会话设置', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/chats/' + encodeURIComponent(chat) + '/settings')).json())
            .maxReplyMessages,
      )
      .toBe(3);
    await page.reload();
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '聊天策略', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: '每轮回复消息上限', exact: true }),
    ).toHaveValue('3');
    await page.screenshot({ path: 'test-results/reply-limit-settings.png' });
    await page.goto('/chats?chat=default');
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '聊天策略', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: '每轮回复消息上限', exact: true }),
    ).toBeVisible();
  } finally {
    await request.delete('/api/profiles/' + encodeURIComponent(chat));
  }
});

test('小窗口下长会话名和运行元信息不挤压正文，日期筛选与导出仍可用', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await request.post('/api/plugins/run-inspector/enabled', { data: { enabled: true } });
  const chat = 'group:991232';
  await request.patch('/api/profiles/' + encodeURIComponent(chat), {
    data: { online: true, maxReplyMessages: 0, memory: { enabled: false } },
  });
  await request.patch('/api/chats/' + encodeURIComponent(chat), {
    data: { alias: '这是一个较长的会话名称，用于测试运行详情上下空间分配' },
  });
  const response = await request.post('/api/conversation/manual', {
    data: { chatKey: chat, text: '合成布局测试' },
  });
  expect(response.status()).toBe(202);
  const id = (await response.json()).id;
  await page.goto('/chats?chat=' + chat);
  await page.getByRole('tab', { name: '运行记录', exact: true }).click();
  const detail = page.getByRole('region', { name: '运行详情' });
  await expect(detail.getByText(id, { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '导出完整记录', exact: true })).toBeEnabled();
  const timeline = page.locator('.run-detail-inline>.timeline');
  await expect(timeline).toBeVisible();
  await expect(page.locator('.run-settings-snapshot')).not.toHaveAttribute('open');
  const body = await timeline.boundingBox(),
    panel = await page.locator('.run-browser').boundingBox();
  expect(body!.y - panel!.y).toBeLessThan(125);
  expect(panel!.y + panel!.height - body!.y).toBeGreaterThan(panel!.height * 0.6);
  expect((await page.locator('.chat-detail>.section-heading').boundingBox())!.height).toBeLessThan(
    80,
  );
  await page.locator('.run-date-filter>summary').click();
  await expect(page.getByLabel('运行开始日期', { exact: true })).toBeVisible();
  await page.getByLabel('运行开始日期', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: '清除日期', exact: true }).click();
  await expect(page.getByLabel('运行开始日期', { exact: true })).toHaveValue('');
  await page.locator('.run-date-filter>summary').click();
  await page.screenshot({ path: 'test-results/reply-run-workspace.png' });
});
