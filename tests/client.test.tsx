// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClientHost, ClientHostProvider, Slot, type ClientPlugin } from '@qq-harness/client-sdk';
import type { PluginDto } from '@qq-harness/contracts';
import memoryClient from '../plugins/agent-memory/client.js';
import chatsClient from '../plugins/console-chats/client.js';

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

test('记忆面板声明会话页面依赖，页面关闭后撤销并能恢复', async () => {
  const host = new ClientHost(async (dto) => (dto.id === 'console-chats' ? chatsClient : memoryClient));
  try {
    await host.sync([descriptor('agent-memory'), descriptor('console-chats')]);
    expect(host.listSlot('conversation.detail.tabs').some((item) => item.owner === 'agent-memory')).toBe(
      true,
    );
    await host.sync([descriptor('agent-memory'), descriptor('console-chats', false)]);
    expect(host.listSlot('conversation.detail.tabs')).toEqual([]);
    await host.sync([descriptor('agent-memory'), descriptor('console-chats', true, 2)]);
    expect(host.listSlot('conversation.detail.tabs').some((item) => item.owner === 'agent-memory')).toBe(
      true,
    );
  } finally {
    await host.stop();
  }
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

test('提供者单独换代会重建传递依赖，重建失败时不能留下旧按钮', async () => {
  const starts = { page: 0, middle: 0, leaf: 0 };
  let fail = false;
  const plugins: Record<string, ClientPlugin> = {
    page: {
      id: 'page',
      setup(ctx) {
        starts.page++;
        if (fail) throw new Error('加载失败');
        ctx.defineSlot('audit.slot');
      },
    },
    middle: {
      id: 'middle',
      requires: ['page'],
      setup() {
        starts.middle++;
      },
    },
    leaf: {
      id: 'leaf',
      requires: ['middle'],
      setup(ctx) {
        starts.leaf++;
        ctx.slot('audit.slot', { id: 'action', component: () => <button>操作</button> });
      },
    },
  };
  const host = new ClientHost(async (dto) => plugins[dto.id]!);
  try {
    await host.sync([descriptor('page'), descriptor('middle'), descriptor('leaf')]);
    await host.sync([descriptor('page', true, 2), descriptor('middle'), descriptor('leaf')]);
    expect(starts).toEqual({ page: 2, middle: 2, leaf: 2 });
    expect(host.listSlot('audit.slot')).toHaveLength(1);
    fail = true;
    await host.sync([descriptor('page', true, 3), descriptor('middle'), descriptor('leaf')]);
    expect(host.listSlot('audit.slot')).toEqual([]);
    expect(host.errors.get('leaf')).toContain('依赖');
    fail = false;
    await host.sync([descriptor('page', true, 3), descriptor('middle'), descriptor('leaf')]);
    expect(host.listSlot('audit.slot')).toHaveLength(1);
  } finally {
    await host.stop();
  }
});
