import { expect, test } from '@playwright/test';

test('七分类、导入预览、默认关闭、设置快照与管理器页签联动', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/extensions');
  await expect(page.getByRole('heading', { name: '扩展仓库', exact: true })).toBeVisible();
  for (const name of ['全局插件', '会话插件', '工具', 'MCP', '技能', '知识', '上下文'])
    await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
  await page.getByRole('switch', { name: '启用扩展 ext-tool', exact: true }).uncheck();
  await expect(page.getByRole('tab', { name: '工具', exact: true })).toHaveCount(0);
  await page.getByRole('switch', { name: '启用扩展 ext-tool', exact: true }).check();
  await expect(page.getByRole('tab', { name: '工具', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导入扩展', exact: true }).click();
  await page.getByLabel('扩展 ZIP 或文件').setInputFiles([
    {
      name: 'tool.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          id: 'browser-echo',
          type: 'tool',
          name: '浏览器测试工具',
          settings: { prefix: 'default' },
          configSchema: { prefix: { type: 'string', label: '回复前缀' } },
        }),
      ),
    },
    {
      name: 'index.js',
      mimeType: 'text/javascript',
      buffer: Buffer.from(
        `export function setup(api){api.registerTool({id:'echo',name:'回显',description:'${'长说明也应保持操作按钮横排且完整显示。'.repeat(25)}',parameters:{type:'object',properties:{}},execute:async()=>({content:api.config().prefix})});}`,
      ),
    },
  ]);
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await expect(page.locator('pre')).toContainText('browser-echo');
  await page.getByRole('button', { name: '确认安装', exact: true }).click();
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await expect(page.getByRole('heading', { name: '浏览器测试工具' })).toBeVisible();
  const enabled = page.getByRole('switch', { name: '启用扩展 browser-echo' });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await expect(page.getByRole('heading', { name: /插件与技能提供的工具/ })).toBeVisible();
  await page.getByRole('textbox', { name: '筛选插件工具' }).fill('browser-echo__echo');
  const explain = page.getByRole('button', { name: '调用说明', exact: true });
  const dimensions = await explain.boundingBox();
  expect(dimensions!.width).toBeGreaterThan(70);
  expect(dimensions!.height).toBeLessThan(60);
  await explain.click();
  const toolDetails = page.getByRole('dialog', { name: '回显 · 调用说明' });
  await expect(toolDetails).toBeVisible();
  await toolDetails.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('textbox', { name: '回复前缀' }).fill('global');
  await page.getByRole('button', { name: '保存扩展设置' }).click();
  await expect(
    page.getByRole('dialog', { name: '浏览器测试工具设置', exact: true }),
  ).not.toBeVisible();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '会话扩展', exact: true }).click();
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('textbox', { name: '回复前缀' }).fill('session');
  await page.getByRole('button', { name: '保存扩展设置' }).click();
  await expect(
    page.getByRole('dialog', { name: '浏览器测试工具设置', exact: true }),
  ).not.toBeVisible();
  await page.getByRole('link', { name: '扩展仓库', exact: true }).click();
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '回复前缀' })).toHaveValue('global');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({
    path: 'test-results/extensions.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
