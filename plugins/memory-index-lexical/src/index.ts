import { definePlugin } from '@qq-harness/plugin-sdk';
import { memoryIndex, type IndexableMemory } from '@qq-harness/domain';

function terms(text: string): string[] {
  const result = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9]+|[\p{Script=Han}]+/gu)) {
    const word = match[0];
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      for (let size = 1; size <= 3; size++)
        for (let index = 0; index + size <= word.length; index++) result.add(word.slice(index, index + size));
    } else result.add(word);
  }
  return [...result];
}

export const memoryIndexLexical = definePlugin({
  id: 'memory-index-lexical',
  name: '可替换的本地记忆检索索引',
  setup(ctx) {
    const entries = new Map<string, IndexableMemory>();
    const versions = new Map<string, number>();
    let ready = false;
    ctx.provide(memoryIndex, {
      id: 'lexical-v1',
      upsert: async (record) => {
        ctx.assertActive();
        if ((versions.get(record.id) ?? 0) > record.revision) return;
        entries.set(record.id, structuredClone(record));
        versions.set(record.id, record.revision);
      },
      remove: async (id, revision) => {
        ctx.assertActive();
        if ((versions.get(id) ?? 0) <= revision) {
          entries.delete(id);
          versions.set(id, revision);
        }
      },
      search: async (query, hints, limit) => {
        ctx.assertActive();
        const tokens = terms(query);
        const people = new Set(hints.personIds);
        const allowed = new Set(hints.allowedIds);
        return [...entries.values()]
          .filter((record) => {
            if (!allowed.has(record.id)) return false;
            if (record.scope === 'chat') return record.chatKey === hints.chatKey;
            if (record.scope === 'chat_person')
              return record.chatKey === hints.chatKey && !!record.personId && people.has(record.personId);
            return !!record.personId && people.has(record.personId);
          })
          .map((record) => {
            const haystack = record.text.toLowerCase();
            const matched = tokens.filter((token) => haystack.includes(token)).length;
            return {
              id: record.id,
              relevance: tokens.length
                ? matched / tokens.length
                : Number(haystack.includes(query.toLowerCase())),
            };
          })
          .filter((item) => item.relevance > 0)
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, limit);
      },
      rebuild: async (records) => {
        ctx.assertActive();
        entries.clear();
        versions.clear();
        for (const record of records) {
          entries.set(record.id, structuredClone(record));
          versions.set(record.id, record.revision);
        }
        ready = true;
      },
      health: () => ({ ready }),
    });
    ctx.effect(() => {
      entries.clear();
      versions.clear();
      ready = false;
    });
  },
});
