import type { ConfigService, MemoryRepository, StorageService } from '@qq-harness/domain';
import type { MemoryRecord } from '@qq-harness/contracts';
import { factId } from './service.js';
export const MEMORY_MIGRATION_KEY = 'short-initial-v1';
export function migrateMemoryToShort(
  repo: MemoryRepository,
  storage: Pick<StorageService, 'state' | 'setState'>,
  config: Pick<ConfigService, 'effective' | 'get'>,
) {
  if (storage.state('memory-migration', MEMORY_MIGRATION_KEY)) return { converted: 0, alreadyCurrent: true };
  const all = repo.records(),
    groups = new Map<string, MemoryRecord[]>();
  for (const record of all.filter((r) => r.status === 'active' && r.tier !== 'short')) {
    const key = record.factId ?? factId(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const at = Date.now();
  let converted = 0;
  for (const [key, records] of groups) {
    const migrated = all.find((r) => (r.factId ?? factId(r)) === key && r.migratedFrom);
    const ordered = records.sort(
      (a, b) =>
        (b.factVersion ?? 1) - (a.factVersion ?? 1) ||
        (a.tier === 'medium' ? -1 : 1) - (b.tier === 'medium' ? -1 : 1) ||
        b.updatedAt - a.updatedAt,
    );
    const selected = ordered[0]!;
    if (!migrated) {
      const chatKey = selected.chatKey ?? selected.sources[0]?.chatKey;
      const ttl = chatKey
        ? config.effective(chatKey).memory.shortRetentionMs
        : config.get().defaults.memory.shortRetentionMs;
      const version =
        Math.max(...all.filter((r) => (r.factId ?? factId(r)) === key).map((r) => r.factVersion ?? 1)) + 1;
      repo.saveRecord(
        {
          ...selected,
          tier: 'short',
          revision: selected.revision + 1,
          factId: key,
          factVersion: version,
          consolidatedAt: undefined,
          migratedFrom: { tier: selected.tier, revision: selected.revision, at },
          updatedAt: at,
          expiresAt: at + ttl,
        },
        selected.revision,
      );
      converted++;
    }
    for (const other of ordered)
      if (migrated || other.id !== selected.id)
        repo.saveRecord(
          { ...other, status: 'superseded', revision: other.revision + 1, updatedAt: at },
          other.revision,
        );
  }
  storage.setState('memory-migration', MEMORY_MIGRATION_KEY, { at, converted });
  return { converted, alreadyCurrent: false };
}
