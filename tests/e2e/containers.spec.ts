import { expect, test } from '@playwright/test';

test('容器配置、默认操作门禁、页面插件装卸与设置持久化', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/containers');
  await expect(page.getByRole('heading', { name: '容器', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '新容器名称' }).fill('test-pool');
  await expect(page.getByRole('button', { name: '创建容器', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '引擎与默认配置' }).click();
  await expect(page.getByRole('switch', { name: '启用容器功能' })).not.toBeChecked();
  await page.getByRole('combobox', { name: '容器引擎' }).selectOption('podman');
  await page.getByRole('textbox', { name: '容器镜像', exact: true }).fill('local-test:fixture');
  await page.getByRole('button', { name: '保存容器设置' }).click();
  await expect(page.getByRole('status')).toContainText('容器设置已保存');
  await page.getByRole('link', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 container-console', exact: true }).uncheck();
  await expect(page.getByRole('link', { name: '容器', exact: true })).toHaveCount(0);
  await page.getByRole('switch', { name: '启用 container-console', exact: true }).check();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('link', { name: '容器', exact: true }).click();
  await page.getByRole('tab', { name: '引擎与默认配置' }).click();
  await expect(page.getByRole('textbox', { name: '容器镜像', exact: true })).toHaveValue(
    'local-test:fixture',
  );
  await page.screenshot({
    path: 'test-results/containers.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('资源池独立创建入口、发现登记外部容器、多会话绑定与React确认', async ({ page }) => {
  page.on('dialog', () => {
    throw Error('不得出现浏览器原生弹窗');
  });
  let imported = false;
  let bindings = ['group:96002'];
  let saved: unknown;
  const resource = () => ({
    id: 'pool-existing',
    name: 'QQ-agent-script-runtime',
    image: 'fixture:test',
    engine: 'podman',
    binary: 'podman',
    managed: false,
    enabled: true,
    running: true,
    status: 'running',
    chatKeys: bindings,
    bindings: bindings.map((chatKey) => ({
      id: 'pool-existing',
      chatKey,
      username: chatKey.startsWith('group') ? 'g96002' : 'p96001',
      workspace: '/home/test/workspace',
      primary: true,
    })),
  });
  await page.route('**/api/chats', (r) =>
    r.fulfill({
      json: [
        { chatKey: 'group:96002', name: '测试群' },
        { chatKey: 'private:96001', name: '测试好友' },
      ],
    }),
  );
  await page.route('**/api/containers/status', (r) =>
    r.fulfill({
      json: {
        settings: {
          enabled: true,
          engine: 'podman',
          binaryPath: '',
          image: 'fixture:test',
          memoryMb: 512,
          cpus: 1,
          pids: 128,
          network: 'none',
          timeoutMs: 30000,
          maxOutputChars: 16000,
        },
        engine: { available: true, allowOperations: true, imageAvailable: true, message: '测试引擎' },
        containers: imported ? [resource()] : [],
      },
    }),
  );
  await page.route('**/api/containers/discovery', (r) =>
    r.fulfill({
      json: [
        {
          id: 'pool-existing',
          name: 'QQ-agent-script-runtime',
          image: 'fixture:test',
          running: true,
          registered: imported,
        },
      ],
    }),
  );
  await page.route('**/api/containers/inventory/import', (r) => {
    expect(r.request().postDataJSON()).toEqual({ reference: 'pool-existing' });
    imported = true;
    return r.fulfill({ json: resource(), status: 201 });
  });
  await page.route('**/api/containers/inventory/pool-existing/chats', (r) => {
    saved = r.request().postDataJSON();
    bindings = (saved as { chatKeys: string[] }).chatKeys;
    return r.fulfill({ json: resource() });
  });
  await page.goto('/settings/containers');
  await expect(page.getByRole('textbox', { name: '新容器名称' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '容器会话标识' })).toHaveCount(0);
  await page.getByRole('button', { name: '登记已有容器', exact: true }).click();
  const discovery = page.getByRole('dialog', { name: '登记已有容器', exact: true });
  await discovery.getByRole('button', { name: '登记', exact: true }).click();
  await expect(discovery.getByRole('button', { name: '已登记', exact: true })).toBeVisible();
  await discovery.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '管理绑定', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '管理绑定 · QQ-agent-script-runtime' });
  await drawer.getByRole('combobox', { name: '容器绑定会话' }).click();
  await page.getByText('测试好友 · private:96001', { exact: true }).last().click();
  await drawer.getByRole('button', { name: '保存绑定', exact: true }).click();
  await expect.poll(() => saved).toEqual({ chatKeys: ['group:96002', 'private:96001'] });
  await expect(drawer).not.toBeVisible();
  await expect(page.getByText('2 个会话', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消登记', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '停用', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '停用共享容器', exact: true });
  await expect(modal).toContainText('group:96002、private:96001');
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.setViewportSize({ width: 1000, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/container-pool.png', fullPage: true });
});
