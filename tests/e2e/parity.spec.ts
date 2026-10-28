import { expect, test } from '@playwright/test';
test('右侧 A–Z 滚动定位保留列表与置顶，搜索名称，QQ 联系人选择与 React 重命名', async ({ page, request }) => {
  page.on('dialog', () => {
    throw new Error('不能出现浏览器原生弹窗');
  });
  const chatMeta: Record<string, unknown> = {};
  for (let i = 0; i < 26; i++)
    for (let j = 0; j < 3; j++)
      chatMeta[`group:${880000 + i * 10 + j}`] = {
        alias: String.fromCharCode(65 + i) + ' 会话 ' + j,
        pinnedAt: i === 25 && j === 2 ? 1 : 0,
        createdAt: Date.now(),
      };
  await request.patch('/api/config', { data: { chatMeta } });
  await page.goto('/chats?chat=group:880000');
  const index = page.getByRole('navigation', { name: '按首字母快速定位会话' });
  await expect(index).toBeVisible();
  await expect.poll(() => page.locator('.directory-row').count()).toBeGreaterThan(75);
  const before = await page.locator('.directory-row').count();
  await index.getByRole('button', { name: '跳到 Z 开头的会话', exact: true }).click();
  await expect
    .poll(() => page.locator('.directory-scroll').evaluate((e) => e.scrollTop))
    .toBeGreaterThan(100);
  expect(await page.locator('.directory-row').count()).toBe(before);
  const bounds = await index.boundingBox(),
    list = await page.locator('.directory-scroll').boundingBox();
  expect(bounds!.x).toBeGreaterThan(list!.x + list!.width - 2);
  await page.getByRole('textbox', { name: '搜索会话' }).fill('Z 会话');
  await expect(page.locator('.directory-row')).toHaveCount(3);
  await page.getByRole('textbox', { name: '搜索会话' }).fill('');
  await page.getByRole('button', { name: '＋ 添加会话', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '添加会话' });
  await expect(picker.getByRole('textbox', { name: '搜索群或好友' })).toBeVisible();
  await picker.getByRole('textbox', { name: '新会话标识' }).fill('group:889999');
  await picker.getByRole('button', { name: '打开会话', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话' });
  await rename.getByRole('textbox', { name: '会话名称' }).fill('浏览器验收会话');
  await rename.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('heading', { name: '浏览器验收会话' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/parity-directory.png',
    fullPage: true,
  });
});
test('消息图片多图预览与错误重试、完整模型及工具调用详情、设置入口和概率精度', async ({ page, request }) => {
  await request.post('/api/plugins/run-inspector/enabled', {
    data: { enabled: true },
  });
  await request.post('/api/plugins/agent-memory/enabled', {
    data: { enabled: true },
  });
  await request.patch('/api/config', { data: { acceptAllSessions: true } });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
  await request.post('/api/demo/messages', {
    data: {
      chatKey: 'group:889999',
      text: '浏览器图片验收',
      metadata: {
        segments: [
          { type: 'image', data: { file: 'base64://' + png } },
          { type: 'image', data: { file: 'base64://' + png } },
        ],
      },
    },
  });
  await page.goto('/chats?chat=group:889999');
  await page.getByRole('tab', { name: '消息存档', exact: true }).click();
  await page
    .getByRole('button', { name: /查看图片/ })
    .first()
    .click();
  const preview = page.getByRole('dialog', { name: '图片预览' });
  await expect(preview.getByRole('img', { name: '消息图片 1' })).toBeVisible();
  await preview.getByRole('button', { name: '下一张' }).click();
  await expect(preview.getByRole('img', { name: '消息图片 2' })).toBeVisible();
  await preview.getByRole('button', { name: '放大', exact: true }).click();
  await preview.getByRole('button', { name: '原尺寸', exact: true }).click();
  await page.screenshot({ path: 'test-results/parity-image-preview.png' });
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  await page.getByRole('tab', { name: '运行记录', exact: true }).click();
  await page
    .getByRole('button', { name: /^查看记录 / })
    .first()
    .click();
  const detail = page.getByRole('region', { name: '运行详情' });
  await detail.getByRole('tab', { name: '模型上下文', exact: true }).click();
  await expect(detail.getByText('第 1 轮上下文', { exact: true })).toBeVisible();
  await detail.locator('summary').first().click();
  await expect(detail.getByText('SYSTEM', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/parity-run-context.png' });
  await detail.getByRole('tab', { name: '工具调用', exact: true }).click();
  await detail.getByText('send_message', { exact: true }).first().click();
  await expect(detail.getByText('调用参数', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('执行结果 · 完成', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/parity-tool-details.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  await expect(page.getByRole('switch', { name: '启用完整会话策略' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'other启用', exact: true }).check();
  await page.getByRole('spinbutton', { name: '任意消息概率', exact: true }).fill('24.1');
  await page.getByRole('button', { name: '保存会话设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '独立快照' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/parity-chat-policy.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '工具与技能', exact: true }).click();
  await expect(page.getByRole('heading', { name: '内置工具', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索内置工具' }).fill('read_forward');
  await expect(page.getByRole('cell', { name: 'read_forward', exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '会话扩展', exact: true }).click();
  await expect(page.getByText('Invalid string', { exact: false })).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '聊天策略', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '任意消息概率', exact: true })).toHaveValue('24.1');
});
