import { expect, test, vi } from 'vitest';
import type { AdapterService, StorageService } from '@qq-harness/domain';
import { chatNames } from '../plugins/console-api/src/names.js';
import { chatInitial, compareChatNames } from '@qq-harness/contracts';

test('QQ 名称合并好友备注，刷新合并并发，断线和重启保留缓存', async () => {
  const state = new Map<string, unknown>();
  const storage = {
    state: (ns: string, key: string) => state.get(ns + key),
    setState: (ns: string, key: string, value: unknown) => state.set(ns + key, structuredClone(value)),
  } satisfies Pick<StorageService, 'state' | 'setState'>;
  let connected = true;
  const query = vi.fn(async (action: string) =>
    action === 'get_group_list'
      ? [{ group_id: 1, group_name: '项目交流群' }]
      : [{ user_id: 2, remark: '好友备注', nickname: '原始昵称' }],
  );
  const adapter = { connected: () => connected, query } as unknown as AdapterService;
  const names = chatNames(storage, () => adapter);
  await Promise.all([names.refresh(), names.refresh()]);
  expect(query).toHaveBeenCalledTimes(2);
  expect(names.get('group:1')).toBe('项目交流群');
  expect(names.get('private:2')).toBe('好友备注');
  connected = false;
  const restored = chatNames(storage, () => adapter);
  await restored.refresh();
  expect(restored.get('group:1')).toBe('项目交流群');
  expect(query).toHaveBeenCalledTimes(2);
});

test('中文名称按拼音首字母排序，英文及其他字符分组', () => {
  expect(chatInitial('张三')).toBe('Z');
  expect(chatInitial('北京群')).toBe('B');
  expect(chatInitial('Alice')).toBe('A');
  expect(chatInitial('123')).toBe('#');
  expect(['张三', '北京群', 'Alice'].sort(compareChatNames)).toEqual(['Alice', '北京群', '张三']);
});
