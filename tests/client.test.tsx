// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClientHost, ClientHostProvider, Slot, type ClientPlugin } from '@qq-harness/client-sdk';
import type { PluginDto } from '@qq-harness/contracts';

const descriptor = (id: string, enabled = true, generation = 1): PluginDto => ({
  id,
  name: id,
  version: '1',
  generation,
  enabled,
  status: enabled ? 'active' : 'disabled',
  requires: [],
  client: { entry: 'builtin:' + id },
});
test('页面、按钮与子页面来自插件注册，依赖撤销和重新激活完整清理', async () => {
  let cleanups = 0;
  const plugins: Record<string, ClientPlugin> = {
    page: {
      id: 'page',
      setup(ctx) {
        ctx.defineSlot('chat.tabs');
        ctx.page({ id: 'chat', title: '聊天', path: '/chat', component: () => <div /> });
      },
    },
    addon: {
      id: 'addon',
      requires: ['page'],
      setup(ctx) {
        ctx.slot('chat.tabs', { id: 'tab', component: () => <button>插件按钮</button> });
        ctx.effect(() => {
          cleanups++;
        });
      },
    },
  };
  const host = new ClientHost(async (dto) => plugins[dto.id]!);
  await host.sync([descriptor('page'), descriptor('addon')]);
  expect(host.listPages()).toHaveLength(1);
  expect(host.listSlot('chat.tabs')).toHaveLength(1);
  const view = render(
    <ClientHostProvider value={host}>
      <Slot point="chat.tabs" />
    </ClientHostProvider>,
  );
  expect(screen.getByText('插件按钮')).toBeTruthy();
  view.unmount();
  await host.sync([descriptor('page', false), descriptor('addon')]);
  expect(host.listPages()).toHaveLength(0);
  expect(host.listSlot('chat.tabs')).toHaveLength(0);
  expect(cleanups).toBe(1);
  await host.sync([descriptor('page', true, 2), descriptor('addon', true, 2)]);
  expect(host.listSlot('chat.tabs')).toHaveLength(1);
  await host.stop();
  expect(cleanups).toBe(2);
  cleanup();
});
