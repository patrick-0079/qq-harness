import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readJson, readJsonl } from '@qq-harness/files';
import type { StorageService } from '@qq-harness/domain';
import type { Archive } from '@qq-harness/contracts';

type Raw = Record<string, unknown>;
function replay(base: Raw, events: unknown[]) {
  let messages = (Array.isArray(base.messages) ? base.messages : []) as Raw[];
  let seq = Number(base.seq ?? 0);
  for (const raw of events) {
    const event = raw as Raw;
    if (Number(event.seq ?? 0) <= seq && event.seq) continue;
    const ids = new Set(((event.ids as unknown[]) ?? []).map(Number));
    if (event.t === 'm') {
      const message = event.m as Raw;
      if (message && !messages.some((value) => value.id === message.id)) messages.push(message);
    } else if (event.t === 'read' || event.t === 'unread')
      messages = messages.map((message) =>
        event.all || ids.has(Number(message.id)) ? { ...message, read: event.t === 'read' } : message,
      );
    else if (event.t === 'recall')
      messages = messages.map((message) =>
        String(message.mid) === String(event.mid) ? { ...message, recalled: true, read: true } : message,
      );
    else if (event.t === 'edit')
      messages = messages.map((message) =>
        Number(message.id) === Number(event.id)
          ? {
              ...message,
              ...(event.text !== undefined ? { text: event.text } : {}),
              ...(event.media !== undefined ? { media: event.media } : {}),
            }
          : message,
      );
    else if (event.t === 'del') messages = messages.filter((message) => !ids.has(Number(message.id)));
    else if (event.t === 'trim')
      messages = messages.filter((message) => Number(message.id) >= Number(event.minId));
    else if (event.t === 'clear') messages = [];
    seq = Math.max(seq, Number(event.seq ?? 0));
  }
  return messages;
}
export function importLegacy(source: string, target?: StorageService) {
  const stats = { chats: 0, messages: 0, archives: 0, memoryFiles: 0 };
  const messagesDir = path.join(source, 'messages');
  const files = fs.existsSync(messagesDir) ? fs.readdirSync(messagesDir) : [];
  const chats = new Set(
    files
      .map((file) => /^(group|private)_([0-9]+)\.jsonl?$/.exec(file))
      .filter((value) => value !== null)
      .map((match) => `${match![1]}:${match![2]}`),
  );
  for (const chatKey of chats) {
    const base = path.join(messagesDir, chatKey.replace(':', '_'));
    const messages = replay(readJson(base + '.json', {}) as Raw, readJsonl(base + '.jsonl'));
    stats.chats++;
    for (const message of messages) {
      const value = target?.append(
        {
          id: String(message.mid ?? `legacy-${message.id}`),
          chatKey,
          senderId: String(message.senderId ?? 'unknown'),
          senderName: String(message.senderName ?? ''),
          text: String(message.text ?? ''),
          atMe: Boolean(message.atMe),
          timestamp: Number(message.ts ?? 0),
          metadata: message,
        },
        Boolean(message.self),
      );
      if (value && message.read) target?.markRead(chatKey, [value.localId]);
      stats.messages++;
    }
  }
  const sessionDirs = [path.join(source, 'sessions'), path.join(source, 'sessions', 'archive')];
  const seen = new Set<string>();
  for (const dir of sessionDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.json(?:\.gz)?$/.test(file)) continue;
      const full = path.join(dir, file);
      const raw = (
        file.endsWith('.gz')
          ? JSON.parse(gunzipSync(fs.readFileSync(full)).toString('utf8'))
          : readJson(full, {})
      ) as Raw;
      if (!raw.id || !/^(group|private):[0-9]+$/.test(String(raw.chatKey)) || seen.has(String(raw.id)))
        continue;
      seen.add(String(raw.id));
      const usage = raw.usage as Raw | undefined;
      const archive: Archive = {
        id: String(raw.id),
        chatKey: String(raw.chatKey),
        startedAt: Number(raw.startedAt ?? raw.createdAt ?? 0),
        endedAt: Number(raw.endedAt ?? 0),
        status: String(raw.status ?? 'legacy'),
        sent: Array.isArray(raw.sent) ? raw.sent.length : 0,
        trace: [],
        usage: { input: Number(usage?.promptTokens ?? 0), output: Number(usage?.completionTokens ?? 0) },
        legacy: raw,
      };
      target?.archive(archive);
      stats.archives++;
    }
  }
  const memoryDir = path.join(source, 'memory');
  if (fs.existsSync(memoryDir))
    for (const name of fs.readdirSync(memoryDir)) {
      const match = /^(group|private)_([0-9]+)(?:\.json)?$/.exec(name);
      if (!match) continue;
      const chatKey = `${match[1]}:${match[2]}`,
        full = path.join(memoryDir, name);
      const values = fs.statSync(full).isDirectory()
        ? fs
            .readdirSync(full)
            .filter((file) => file.endsWith('.json'))
            .map((file) => readJson(path.join(full, file), {}))
        : [readJson(full, {})];
      for (let index = 0; index < values.length; index++)
        target?.setState('legacy-memory', `${chatKey}/${index}`, values[index]);
      if (values.length) target?.setMemory(chatKey, values.map((value) => JSON.stringify(value)).join('\n'));
      stats.memoryFiles += values.length;
    }
  return stats;
}
