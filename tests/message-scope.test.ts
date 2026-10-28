import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { assertMessageScope } from '@qq-harness/contracts';
import { createApplication } from '../apps/server/src/app.js';
import { adapterService, mediaService, storageService } from '@qq-harness/domain';
import { fetchForwardRoot } from '../plugins/basic-tools/src/forwards.js';
test('明确的群号、私聊发送者与发送目标必须属于当前会话；协议缺省元信息仍兼容', () => {
  for (const [chat, data, record] of [
    ['group:1', { message_type: 'private', user_id: 2 }, {}],
    ['group:1', { group_id: 3 }, {}],
    ['private:1', { user_id: 2 }, {}],
    ['private:1', { group_id: 3 }, {}],
    ['private:1', { user_id: 8, target_id: 2 }, { self: true, selfId: 8 }],
    ['private:1', { user_id: 8 }, { self: false, selfId: 8 }],
  ] as const)
    expect(() => assertMessageScope(chat, data, record)).toThrow('不属于当前会话');
  for (const [chat, data, record] of [
    ['group:1', { group_id: 1 }, {}],
    ['private:1', { user_id: 1, group_id: 0 }, {}],
    ['private:1', { user_id: 8, target_id: 1 }, { self: true }],
    ['private:1', { user_id: 8 }, { self: true, selfId: 8 }],
    ['private:1', {}, {}],
  ] as const)
    expect(() => assertMessageScope(chat, data, record)).not.toThrow();
});
test('刷新图片及转发遇到错误会话时拒绝，保留原记录且不读取外部转发资源', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-media-scope-')),
    app = await createApplication({
      dataDir: root,
      v2Managers: false,
      extensionHotReload: false,
      initialConfig: { acceptAllSessions: true },
    });
  try {
    const storage = app.runtime.use(storageService),
      adapter = app.runtime.use(adapterService),
      message = storage.append({
        id: '-1',
        chatKey: 'private:1',
        senderId: '1',
        senderName: '当前用户',
        text: '[图片][转发]',
        atMe: false,
        timestamp: Date.now(),
      });
    const query = vi.spyOn(adapter, 'query').mockResolvedValue({
      message_type: 'private',
      user_id: 2,
      message: [
        { type: 'image', data: { url: 'https://foreign.invalid/private.png' } },
        { type: 'forward', data: { id: 'foreign-record' } },
      ],
    });
    await expect(app.runtime.use(mediaService).refresh('private:1', message.localId)).rejects.toThrow(
      '不属于当前会话',
    );
    expect(storage.messages('private:1')[0]?.metadata).toEqual(message.metadata);
    await expect(fetchForwardRoot(adapter, storage, message, new AbortController().signal)).rejects.toThrow(
      '不属于当前会话',
    );
    expect(query.mock.calls.every(([action]) => action === 'get_msg')).toBe(true);
    const own = storage.append(
      {
        id: '-2',
        chatKey: 'private:1',
        senderId: 'self',
        senderName: '自己',
        text: '[图片]',
        atMe: false,
        timestamp: Date.now(),
      },
      true,
    );
    query.mockResolvedValue({
      message_type: 'private',
      user_id: 888,
      message: [{ type: 'image', data: { url: 'https://current.invalid/self.png' } }],
    });
    expect(await app.runtime.use(mediaService).refresh('private:1', own.localId)).toHaveLength(1);
  } finally {
    await app.stop();
    const real = fs.realpathSync(root);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('harness-media-scope-')
    )
      throw new Error('清理越界');
    fs.rmSync(real, { recursive: true, force: true });
  }
});
