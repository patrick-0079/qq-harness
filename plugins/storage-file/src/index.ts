import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema, incomingSchema, type Archive, type StoredMessage } from '@qq-harness/contracts';
import { storageService, memoryRepository } from '@qq-harness/domain';
import { fileMemoryRepository } from './memory.js';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from '@qq-harness/files';

export function storageFile(dataDir: string) {
  return definePlugin({
    id: 'storage-file',
    name: 'JSONL 消息与 gzip 运行档案',
    setup(ctx) {
      const cache = new Map<string, StoredMessage[]>();
      const known = new Set<string>();
      const dir = path.join(dataDir, 'messages');
      fs.mkdirSync(dir, { recursive: true });
      const filename = (key: string) => path.join(dir, chatKeySchema.parse(key).replace(':', '_') + '.jsonl');
      for (const file of fs.readdirSync(dir)) {
        const match = /^(group|private)_([0-9]+)\.jsonl$/.exec(file);
        if (match) known.add(`${match[1]}:${match[2]}`);
      }
      const messages = (key: string): StoredMessage[] => {
        if (cache.has(key)) return cache.get(key)!;
        let list: StoredMessage[] = [];
        for (const raw of readJsonl(filename(key))) {
          const event = raw as { t: string; message?: StoredMessage; ids?: number[]; read?: boolean };
          if (event.t === 'm' && event.message) list.push(event.message);
          if (event.t === 'read') {
            const ids = new Set(event.ids);
            list = list.map((message) =>
              ids.has(message.localId) ? { ...message, read: event.read !== false } : message,
            );
          }
        }
        cache.set(key, list);
        return list;
      };
      const archiveDir = path.join(dataDir, 'sessions', 'archive');
      fs.mkdirSync(archiveDir, { recursive: true });
      ctx.provide(storageService, {
        append: (input, self = false) => {
          ctx.assertActive();
          const value = incomingSchema.parse(input);
          const list = messages(value.chatKey);
          const duplicate = list.find((message) => message.id === value.id && message.self === self);
          if (duplicate) return structuredClone(duplicate);
          const message: StoredMessage = {
            ...value,
            localId: (list.at(-1)?.localId ?? 0) + 1,
            self,
            read: self,
          };
          appendJsonl(filename(value.chatKey), { t: 'm', message });
          list.push(message);
          known.add(value.chatKey);
          ctx.host.publish('messages.changed', { chatKey: value.chatKey });
          return structuredClone(message);
        },
        messages: (key) => structuredClone(messages(key)),
        recent: (key, limit, since, senderId) =>
          structuredClone(
            messages(key)
              .filter((message) => message.timestamp >= since && (!senderId || message.senderId === senderId))
              .slice(-limit),
          ),
        messagesAfter: (key, afterLocalId, limit) =>
          structuredClone(
            messages(key)
              .filter((message) => !message.self && message.localId > afterLocalId)
              .slice(0, limit),
          ),
        hasSender: (key, senderId) =>
          messages(key).some((message) => !message.self && message.senderId === senderId),
        unread: (key) => structuredClone(messages(key).filter((message) => !message.read && !message.self)),
        markRead: (key, ids, read = true) => {
          ctx.assertActive();
          appendJsonl(filename(key), { t: 'read', ids, read });
          const selected = new Set(ids);
          cache.set(
            key,
            messages(key).map((message) => (selected.has(message.localId) ? { ...message, read } : message)),
          );
          ctx.host.publish('messages.changed', { chatKey: key });
        },
        chats: () =>
          [...known].map((chatKey) => {
            const list = messages(chatKey);
            return {
              chatKey,
              messages: list.length,
              unread: list.filter((message) => !message.read).length,
              lastText: list.at(-1)?.text ?? '',
            };
          }),
        archive: (archive) => {
          ctx.assertActive();
          if (!/^[a-zA-Z0-9_-]+$/.test(archive.id)) throw new Error('非法运行档案 ID');
          const file = path.join(archiveDir, archive.id + '.json.gz');
          const temp = file + '.' + process.pid + '.tmp';
          fs.writeFileSync(temp, gzipSync(JSON.stringify(archive)));
          fs.renameSync(temp, file);
          appendJsonl(path.join(dataDir, 'sessions', 'index.jsonl'), {
            id: archive.id,
            chatKey: archive.chatKey,
            startedAt: archive.startedAt,
            endedAt: archive.endedAt,
            status: archive.status,
          });
          ctx.host.publish('archives.changed', { chatKey: archive.chatKey });
        },
        archives: (chatKey) =>
          fs
            .readdirSync(archiveDir)
            .filter((file) => file.endsWith('.json.gz'))
            .map(
              (file) =>
                JSON.parse(
                  gunzipSync(fs.readFileSync(path.join(archiveDir, file))).toString('utf8'),
                ) as Archive,
            )
            .filter((value) => !chatKey || value.chatKey === chatKey)
            .sort((a, b) => b.startedAt - a.startedAt),
        memory: (key) =>
          String(
            readJson(path.join(dataDir, 'memory', chatKeySchema.parse(key).replace(':', '_') + '.json'), ''),
          ),
        setMemory: (key, content) => {
          ctx.assertActive();
          writeJsonAtomic(
            path.join(dataDir, 'memory', chatKeySchema.parse(key).replace(':', '_') + '.json'),
            content,
          );
        },
        state: (namespace, key) =>
          readJson(
            path.join(
              dataDir,
              'plugin-state',
              encodeURIComponent(namespace),
              encodeURIComponent(key) + '.json',
            ),
            null,
          ),
        setState: (namespace, key, value) => {
          ctx.assertActive();
          writeJsonAtomic(
            path.join(
              dataDir,
              'plugin-state',
              encodeURIComponent(namespace),
              encodeURIComponent(key) + '.json',
            ),
            value,
          );
        },
      });
      ctx.provide(memoryRepository, fileMemoryRepository(dataDir));
    },
  });
}
