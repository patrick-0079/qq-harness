import { expect, test } from '@playwright/test';
test('扩展表格分页、筛选、批量启停、抽屉焦点及失败保留输入', async ({ page, request }) => {
  page.on('dialog', () => {
    throw new Error('不允许浏览器原生弹窗');
  });
  const ids = Array.from({ length: 25 }, (_, i) => 'browser-table-' + i),
    files = ids.flatMap((id, i) => [
      {
        rel: id + '/tool.json',
        data: Buffer.from(
          JSON.stringify({
            id,
            type: 'tool',
            name: '分页工具 ' + String(i).padStart(2, '0'),
            description: '紧凑表格验收',
            settings: { prefix: 'default' },
            configSchema: { prefix: { type: 'string', label: '前缀' } },
          }),
        ).toString('base64'),
      },
      {
        rel: id + '/index.js',
        data: Buffer.from(
          'export function setup(api){api.registerTool({id:"probe",name:"测试工具",description:"仅用于表格流程验收",parameters:{type:"object",properties:{}},execute:async()=>({content:api.config().prefix})});}',
        ).toString('base64'),
      },
    ]);
  try {
    for (let i = 0; i < ids.length; i++)
      expect(
        (
          await request.post('/api/extensions/import', {
            data: { files: files.slice(i * 2, i * 2 + 2) },
          })
        ).ok(),
      ).toBe(true);
    await page.goto('/extensions');
    await page.getByRole('tab', { name: '工具', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索扩展' }).fill('分页工具');
    const rows = page.locator('.extension-table tbody tr');
    await expect(rows).toHaveCount(20);
    await expect(page.getByText('共 25 项', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: '选择本页扩展', exact: true }).check();
    await page.getByRole('button', { name: '批量启用', exact: true }).click();
    const enable = page.getByRole('dialog', { name: '批量启用扩展' });
    await enable.getByRole('button', { name: '启用所选扩展' }).click();
    await expect(enable).not.toBeVisible();
    await expect
      .poll(() =>
        rows.locator('button[role="switch"][aria-label^="启用扩展"][aria-checked="true"]').count(),
      )
      .toBe(20);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(rows).toHaveCount(5);
    await expect(
      rows.locator('button[role="switch"][aria-label^="启用扩展"][aria-checked="true"]'),
    ).toHaveCount(0);
    await page.getByRole('combobox', { name: '扩展状态筛选' }).selectOption('active');
    await expect(rows).toHaveCount(20);
    await page.getByRole('checkbox', { name: '选择本页扩展', exact: true }).check();
    await page.getByRole('button', { name: '批量停用', exact: true }).click();
    const disable = page.getByRole('dialog', { name: '批量停用扩展' });
    await disable.getByRole('button', { name: '停用所选扩展' }).click();
    await expect(disable).not.toBeVisible();
    await expect(rows).toHaveCount(0);
    await page.getByRole('combobox', { name: '扩展状态筛选' }).selectOption('all');
    await expect(rows).toHaveCount(20);
    await rows.first().getByRole('button', { name: '设置', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '分页工具 00设置' });
    await editor.getByRole('textbox', { name: '前缀', exact: true }).fill('未保存输入');
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: '放弃扩展设置修改' });
    await discard.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor.getByRole('textbox', { name: '前缀', exact: true })).toHaveValue(
      '未保存输入',
    );
    const route = '**/api/extensions/browser-table-0/settings?chat=*';
    await page.route(route, (r) =>
      r.fulfill({ status: 500, json: { error: { message: '模拟保存失败' } } }),
    );
    await editor.getByRole('button', { name: '保存扩展设置' }).click();
    await expect(editor.getByRole('alert')).toContainText('模拟保存失败');
    await expect(editor.getByRole('textbox', { name: '前缀', exact: true })).toHaveValue(
      '未保存输入',
    );
    await page.unroute(route);
    await editor.getByRole('button', { name: '保存扩展设置' }).click();
    await expect(editor).not.toBeVisible();
    await rows.first().getByRole('button', { name: '设置', exact: true }).click();
    await expect(editor.getByRole('textbox', { name: '前缀', exact: true })).toHaveValue(
      '未保存输入',
    );
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.screenshot({
      path: 'test-results/extensions-table.png',
      fullPage: true,
    });
  } finally {
    for (const id of ids) await request.delete('/api/extensions/tool/' + id);
  }
});
