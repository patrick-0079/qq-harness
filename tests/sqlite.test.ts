import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { openSqliteStorage } from '@qq-harness/storage-sqlite';
import { importLegacy } from '@qq-harness/legacy-import';

test('SQLite 幂等写入、会话隔离、状态持久化和完整性', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sqlite-')), 'harness.sqlite');
  const db = openSqliteStorage(file);
  const message = {
    id: 'same-id',
    chatKey: 'group:1',
    senderId: '1',
    senderName: '',
    text: '正文',
    atMe: true,
    timestamp: Date.now(),
  };
  const first = db.store.append(message);
  db.store.append(message);
  db.store.append({ ...message, chatKey: 'group:2' });
  db.store.markRead('group:2', [first.localId]);
  expect(db.store.unread('group:1')).toHaveLength(1);
  db.store.markRead('group:1', [first.localId]);
  expect(db.store.messages('group:1')).toHaveLength(1);
  db.store.setMemory('group:1', '独立记忆');
  db.store.setState('plugin', 'key', { saved: true });
  db.close();
  const next = openSqliteStorage(file);
  expect(next.store.unread('group:1')).toHaveLength(0);
  expect(next.store.memory('group:1')).toBe('独立记忆');
  expect(next.store.memory('group:2')).toBe('');
  expect(next.store.state('plugin', 'key')).toEqual({ saved: true });
  expect(next.integrity()).toBe('ok');
  next.close();
});
test('旧快照与增量按 seq 回放，编辑/撤回/已读与媒体元数据导入保持一致', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-import-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'messages'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'messages/group_1.json'),
    JSON.stringify({
      seq: 2,
      messages: [
        { id: 1, mid: 99, text: '旧文本', ts: 1, senderId: '1', media: [{ kind: 'image' }], read: false },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(source, 'messages/group_1.jsonl'),
    [
      { seq: 1, t: 'clear' },
      { seq: 3, t: 'edit', id: 1, text: '编辑后' },
      { seq: 4, t: 'read', all: true },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n',
  );
  const before = fs.readFileSync(path.join(source, 'messages/group_1.jsonl'));
  expect(importLegacy(source).messages).toBe(1);
  const db = openSqliteStorage(path.join(root, 'target.sqlite'));
  importLegacy(source, db.store);
  importLegacy(source, db.store);
  const message = db.store.messages('group:1')[0]!;
  expect(message.text).toBe('编辑后');
  expect(message.read).toBe(true);
  expect(message.metadata?.media).toEqual([{ kind: 'image' }]);
  expect(db.store.messages('group:1')).toHaveLength(1);
  expect(fs.readFileSync(path.join(source, 'messages/group_1.jsonl'))).toEqual(before);
  db.close();
});
