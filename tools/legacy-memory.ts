import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chatKeySchema, type MemoryRecord, type HarnessConfig } from '@qq-harness/contracts';
import type { MemoryRepository } from '@qq-harness/domain';
import { factId } from '../plugins/agent-memory/src/service.js';
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const uuid = (value: string) => {
  const h = sha(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const chat = (key: string) => {
  const m = /^(group|private)[_:](\d+)$/.exec(key);
  return m ? `${m[1]}:${m[2]}` : undefined;
};
const split = (text: string) => {
  const out: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
};
export function scanLegacyMemory(sourceRoot: string, config: HarnessConfig) {
  const root = fs.realpathSync(sourceRoot),
    data = path.join(root, 'data'),
    files: { file: string; sha256: string }[] = [],
    records = new Map<string, MemoryRecord>(),
    meta: HarnessConfig['chatMeta'] = {};
  let inputs = 0,
    duplicates = 0,
    unsupported = 0,
    archivedExcluded = 0;
  const read = (file: string) => {
    const real = fs.realpathSync(file),
      rel = path.relative(root, real);
    if (path.isAbsolute(rel) || rel.startsWith('..' + path.sep)) throw new Error('旧数据来源路径越界');
    const bytes = fs.readFileSync(real),
      hash = sha(bytes);
    files.push({ file: rel.replaceAll('\\', '/'), sha256: hash });
    try {
      return {
        value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as unknown,
        origin: { file: rel.replaceAll('\\', '/'), sha256: hash },
      };
    } catch {
      throw new Error('旧记忆 JSON 无法解析；未写入目标');
    }
  };
  const add = (
    key: string,
    person: unknown,
    name: unknown,
    content: unknown,
    origin: { file: string; sha256: string },
    sourceId: string,
    created?: unknown,
    certainty?: unknown,
  ) => {
    const chatKey = chat(key),
      raw = str(content).trim();
    if (!chatKey || !raw) {
      unsupported++;
      return;
    }
    inputs++;
    const id = str(person),
      personId = /^\d+$/.test(id) ? id : null,
      subject = str(name).trim();
    const digest = sha(JSON.stringify([chatKey, personId, raw]));
    const display = subject ? `${subject}：${raw}` : raw;
    split(display).forEach((text, i) => {
      const recordId = uuid(`legacy-memory:${digest}:${i}`),
        old = records.get(recordId),
        provenance = { ...origin, sourceId: sourceId.slice(0, 300) };
      if (old) {
        old.legacyOrigins?.push(provenance);
        duplicates++;
        return;
      }
      const now = Date.now(),
        time = Number(created),
        key = `legacy-import:${digest.slice(0, 32)}:${i + 1}`;
      const scope = personId ? 'chat_person' : 'chat';
      records.set(recordId, {
        id: recordId,
        scope,
        tier: 'short',
        chatKey,
        personId,
        key,
        text,
        visibility: 'chat_only',
        sensitive: true,
        confidence: certainty === 'inferred' ? 0.5 : 0.75,
        importance: 0.6,
        pinned: false,
        sources: [],
        legacyOrigins: [provenance],
        origin: 'migration',
        status: 'active',
        revision: 1,
        createdAt: Number.isFinite(time) && time > 0 ? time : now,
        updatedAt: now,
        lastConfirmedAt: Number.isFinite(time) && time > 0 ? time : now,
        expiresAt:
          now +
          (config.memoryOverrides[chatKey]?.shortRetentionMs ?? config.defaults.memory.shortRetentionMs),
        factId: factId({ scope, chatKey, personId, key }),
        factVersion: 1,
      });
    });
  };
  const memoryDir = path.join(data, 'memory');
  if (fs.existsSync(memoryDir))
    for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      const key = chat(entry.name.replace(/\.json$/, ''));
      if (!key) continue;
      const children = entry.isDirectory()
        ? fs
            .readdirSync(path.join(memoryDir, entry.name))
            .filter((name) => name.endsWith('.json') && name !== '_meta.json')
            .map((name) => path.join(memoryDir, entry.name, name))
        : [path.join(memoryDir, entry.name)];
      for (const file of children) {
        const { value, origin } = read(file),
          member = obj(value);
        if (Array.isArray(member.impressions))
          arr(member.impressions).forEach((v, i) => {
            const item = obj(v);
            add(key, member.userId, member.name, item.content, origin, `impression:${i}`, item.createdAt);
          });
        else if (Array.isArray(member.memberImpression))
          arr(member.memberImpression).forEach((v, i) => {
            const item = obj(v);
            add(
              key,
              /^\d+$/.test(str(item.target)) ? item.target : null,
              item.target,
              item.content,
              origin,
              `impression:${i}`,
              item.createdAt,
            );
          });
        else unsupported++;
      }
    }
  const plusDir = path.join(data, 'memory-plus');
  if (fs.existsSync(plusDir))
    for (const entry of fs.readdirSync(plusDir).filter((name) => name.endsWith('.json'))) {
      const { value, origin } = read(path.join(plusDir, entry)),
        plus = obj(value);
      archivedExcluded += arr(plus.archive).length;
      for (const [key, v] of Object.entries(obj(plus.chats))) {
        const group = obj(v);
        for (const [person, rawMember] of Object.entries(obj(group.members))) {
          const member = obj(rawMember);
          for (const field of ['short', 'labels'])
            arr(member[field]).forEach((v, i) => {
              const item = obj(v);
              add(
                key,
                person,
                member.name,
                typeof v === 'string' ? v : (item.content ?? item.text ?? item.label),
                origin,
                str(item.id) || `${person}/${field}/${i}`,
                item.createdAt,
              );
            });
        }
        arr(group.questions).forEach((v, i) => {
          const item = obj(v);
          add(
            key,
            null,
            null,
            typeof v === 'string' ? v : (item.content ?? item.question ?? item.text),
            origin,
            str(item.id) || `question:${i}`,
            item.createdAt,
          );
        });
      }
    }
  const sqlite = path.join(data, 'long-memory', 'memory.sqlite');
  if (fs.existsSync(sqlite)) {
    const bytes = fs.readFileSync(sqlite),
      origin = { file: 'data/long-memory/memory.sqlite', sha256: sha(bytes) };
    files.push(origin);
    const db = new DatabaseSync(sqlite, { readOnly: true });
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memories'").get())
        for (const row of db.prepare('SELECT * FROM memories').all()) {
          if (row.status !== 'active') {
            archivedExcluded++;
            continue;
          }
          add(
            str(row.scope),
            row.subject,
            null,
            row.content,
            origin,
            str(row.id),
            row.created,
            row.certainty,
          );
        }
    } finally {
      db.close();
    }
  }
  const admissions = path.join(data, 'chat-admissions.json');
  const metadata = (key: string, v: unknown) => {
    if (!chatKeySchema.safeParse(key).success) return;
    const p = obj(v);
    meta[key] = {
      alias: str(p.alias || p.name).slice(0, 160),
      pinnedAt: Math.max(0, Number(p.pinnedAt) || 0),
      createdAt: Number(p.createdAt) || Date.now(),
    };
  };
  if (fs.existsSync(admissions)) {
    const { value } = read(admissions);
    for (const [key, v] of Object.entries(obj(value))) metadata(key, v);
  }
  const profiles = path.join(data, 'chat-configs');
  if (fs.existsSync(profiles))
    for (const name of fs.readdirSync(profiles).filter((name) => /^(group|private)_\d+\.json$/.test(name))) {
      const { value } = read(path.join(profiles, name));
      metadata(chat(name.replace(/\.json$/, ''))!, value);
    }
  return {
    records: [...records.values()],
    chatMeta: meta,
    files,
    summary: {
      files: files.length,
      inputs,
      records: records.size,
      duplicates,
      unsupported,
      archivedExcluded,
      namedChats: Object.values(meta).filter((m) => m.alias).length,
    },
  };
}
export function importLegacyMemory(plan: ReturnType<typeof scanLegacyMemory>, repo: MemoryRepository) {
  let imported = 0,
    existing = 0;
  for (const record of plan.records) {
    if (repo.record(record.id)) {
      existing++;
      continue;
    }
    repo.saveRecord(record, 0);
    imported++;
  }
  return { imported, existing };
}
