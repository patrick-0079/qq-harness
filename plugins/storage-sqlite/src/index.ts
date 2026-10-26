import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema, incomingSchema, type Archive, type StoredMessage } from '@qq-harness/contracts';
import { storageService, type StorageService } from '@qq-harness/domain';
import { memoryRepository } from '@qq-harness/domain';
import { sqliteMemoryRepository } from './memory.js';

interface MessageRow {
  id: number;
  payload: string;
  self: number;
  read: number;
}
export function openSqliteStorage(
  file: string,
  publish: (type: string, payload: unknown) => void = () => {},
) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
  );
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (version > 2) {
    db.close();
    throw new Error('数据库由更新版本创建，拒绝降级写入');
  }
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_key TEXT NOT NULL, source_id TEXT NOT NULL,
      self INTEGER NOT NULL CHECK(self IN (0,1)), read INTEGER NOT NULL CHECK(read IN (0,1)),
      timestamp INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
      UNIQUE(chat_key, source_id, self)
    );
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_key, id);
    CREATE INDEX IF NOT EXISTS messages_unread ON messages(chat_key, read, self, id);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))
    );
    CREATE INDEX IF NOT EXISTS runs_chat_time ON runs(chat_key, started_at DESC);
    CREATE TABLE IF NOT EXISTS memory (chat_key TEXT PRIMARY KEY, content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, tier TEXT NOT NULL, chat_key TEXT,
      person_id TEXT, status TEXT NOT NULL, updated_at INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK(json_valid(payload))
    );
    CREATE INDEX IF NOT EXISTS memory_records_scope ON memory_records(scope,chat_key,person_id,status);
    CREATE TABLE IF NOT EXISTS memory_revisions (
      record_id TEXT NOT NULL, revision INTEGER NOT NULL, changed_at INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(record_id,revision)
    );
    CREATE TABLE IF NOT EXISTS memory_notes (
      id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))
    );
    CREATE INDEX IF NOT EXISTS memory_notes_chat ON memory_notes(chat_key,expires_at);
    CREATE TABLE IF NOT EXISTS memory_cursors (chat_key TEXT PRIMARY KEY, local_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_index_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL,
      revision INTEGER NOT NULL, operation TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_index_checkpoints (
      provider_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_state (
      namespace TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
      PRIMARY KEY(namespace, key)
    );
    PRAGMA user_version=2;
    COMMIT;`);
  const decode = (row: unknown): StoredMessage => {
    const record = row as MessageRow;
    return {
      ...incomingSchema.parse(JSON.parse(record.payload)),
      localId: Number(record.id),
      self: Boolean(record.self),
      read: Boolean(record.read),
    };
  };
  const append = db.prepare(
    'INSERT OR IGNORE INTO messages(chat_key,source_id,self,read,timestamp,payload) VALUES(?,?,?,?,?,?)',
  );
  const find = db.prepare('SELECT * FROM messages WHERE chat_key=? AND source_id=? AND self=?');
  const list = db.prepare('SELECT * FROM messages WHERE chat_key=? ORDER BY id');
  const recent = db.prepare(
    `SELECT * FROM messages WHERE chat_key=? AND timestamp>=? AND (? IS NULL OR json_extract(payload,'$.senderId')=?)
     ORDER BY id DESC LIMIT ?`,
  );
  const after = db.prepare('SELECT * FROM messages WHERE chat_key=? AND id>? AND self=0 ORDER BY id LIMIT ?');
  const hasSender = db.prepare(
    "SELECT 1 AS found FROM messages WHERE chat_key=? AND json_extract(payload,'$.senderId')=? AND self=0 LIMIT 1",
  );
  const unread = db.prepare('SELECT * FROM messages WHERE chat_key=? AND read=0 AND self=0 ORDER BY id');
  const markRead = db.prepare('UPDATE messages SET read=? WHERE chat_key=? AND id=?');
  let closed = false;
  const assert = () => {
    if (closed) throw new Error('SQLite 存储已关闭');
  };
  const store: StorageService = {
    append: (raw, self = false) => {
      assert();
      const message = incomingSchema.parse(raw);
      const result = append.run(
        message.chatKey,
        message.id,
        self ? 1 : 0,
        self ? 1 : 0,
        message.timestamp,
        JSON.stringify(message),
      );
      if (result.changes) publish('messages.changed', { chatKey: message.chatKey });
      return decode(find.get(message.chatKey, message.id, self ? 1 : 0));
    },
    messages: (key) => {
      assert();
      return list.all(chatKeySchema.parse(key)).map(decode);
    },
    recent: (key, limit, since, senderId) => {
      assert();
      return recent
        .all(chatKeySchema.parse(key), since, senderId ?? null, senderId ?? null, limit)
        .reverse()
        .map(decode);
    },
    messagesAfter: (key, afterLocalId, limit) => {
      assert();
      return after.all(chatKeySchema.parse(key), afterLocalId, limit).map(decode);
    },
    hasSender: (key, senderId) => {
      assert();
      return !!hasSender.get(chatKeySchema.parse(key), senderId);
    },
    unread: (key) => {
      assert();
      return unread.all(chatKeySchema.parse(key)).map(decode);
    },
    markRead: (key, ids, read = true) => {
      assert();
      chatKeySchema.parse(key);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const id of ids) markRead.run(read ? 1 : 0, key, id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      publish('messages.changed', { chatKey: key });
    },
    chats: () => {
      assert();
      return db
        .prepare(
          `SELECT chat_key AS chatKey, COUNT(*) AS messages,
        SUM(CASE WHEN read=0 THEN 1 ELSE 0 END) AS unread,
        (SELECT json_extract(last.payload, '$.text') FROM messages last WHERE last.chat_key=m.chat_key ORDER BY id DESC LIMIT 1) AS lastText
        FROM messages m GROUP BY chat_key ORDER BY MAX(id) DESC`,
        )
        .all() as unknown as ReturnType<StorageService['chats']>;
    },
    archive: (archive) => {
      assert();
      db.prepare(
        'INSERT INTO runs(id,chat_key,started_at,ended_at,status,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at,status=excluded.status,payload=excluded.payload',
      ).run(
        archive.id,
        chatKeySchema.parse(archive.chatKey),
        archive.startedAt,
        archive.endedAt,
        archive.status,
        JSON.stringify(archive),
      );
      publish('archives.changed', { chatKey: archive.chatKey });
    },
    archives: (chatKey) => {
      assert();
      const rows = chatKey
        ? db
            .prepare('SELECT payload FROM runs WHERE chat_key=? ORDER BY started_at DESC')
            .all(chatKeySchema.parse(chatKey))
        : db.prepare('SELECT payload FROM runs ORDER BY started_at DESC').all();
      return rows.map((row) => JSON.parse(String(row.payload)) as Archive);
    },
    memory: (key) => {
      assert();
      return String(
        db.prepare('SELECT content FROM memory WHERE chat_key=?').get(chatKeySchema.parse(key))?.content ??
          '',
      );
    },
    setMemory: (key, content) => {
      assert();
      db.prepare(
        'INSERT INTO memory(chat_key,content) VALUES(?,?) ON CONFLICT(chat_key) DO UPDATE SET content=excluded.content',
      ).run(chatKeySchema.parse(key), content);
    },
    state: (namespace, key) => {
      assert();
      const row = db
        .prepare('SELECT payload FROM plugin_state WHERE namespace=? AND key=?')
        .get(namespace, key);
      return row ? (JSON.parse(String(row.payload)) as unknown) : null;
    },
    setState: (namespace, key, value) => {
      assert();
      db.prepare(
        'INSERT INTO plugin_state(namespace,key,payload) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET payload=excluded.payload',
      ).run(namespace, key, JSON.stringify(value));
    },
  };
  return {
    store,
    memory: sqliteMemoryRepository(db),
    close: () => {
      if (!closed) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close();
        closed = true;
      }
    },
    integrity: () => String(db.prepare('PRAGMA integrity_check').get()?.integrity_check),
  };
}
export function storageSqlite(dataDir: string) {
  return definePlugin({
    id: 'storage-sqlite',
    name: 'SQLite 消息、运行与插件状态',
    setup(ctx) {
      const storage = openSqliteStorage(path.join(dataDir, 'harness.sqlite'), (type, payload) =>
        ctx.host.publish(type, payload),
      );
      ctx.effect(storage.close);
      ctx.provide(storageService, storage.store);
      ctx.provide(memoryRepository, storage.memory);
    },
  });
}
