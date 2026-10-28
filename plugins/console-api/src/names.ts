import type { AdapterService, StorageService } from '@qq-harness/domain';

/** QQ names survive disconnects; one bounded refresh is shared by concurrent directory requests. */
export function chatNames(
  storage: Pick<StorageService, 'state' | 'setState'>,
  adapter: () => AdapterService | undefined,
) {
  const cached = storage.state('console', 'chat-names');
  const names: Record<string, string> =
    cached && typeof cached === 'object'
      ? Object.fromEntries(
          Object.entries(cached).filter(
            ([key, value]) => /^(group|private):\d+$/.test(key) && typeof value === 'string',
          ),
        )
      : {};
  let refreshedAt = -Infinity;
  let pending: Promise<void> | undefined;
  const refresh = async () => {
    const service = adapter();
    if (!service?.connected() || Date.now() - refreshedAt < 60000) return;
    if (pending) return pending;
    refreshedAt = Date.now();
    pending = (async () => {
      let changed = false;
      const results = await Promise.allSettled([
        service.query('get_group_list', {}, AbortSignal.timeout(2000)),
        service.query('get_friend_list', {}, AbortSignal.timeout(2000)),
      ]);
      for (const [index, result] of results.entries()) {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
        for (const row of result.value as Record<string, unknown>[]) {
          if (!row || typeof row !== 'object') continue;
          const id = String(index === 0 ? row.group_id : row.user_id);
          const name = String(index === 0 ? (row.group_name ?? '') : row.remark || row.nickname || '')
            .trim()
            .slice(0, 160);
          const key = `${index === 0 ? 'group' : 'private'}:${id}`;
          if (!/^\d+$/.test(id) || !name || names[key] === name) continue;
          names[key] = name;
          changed = true;
        }
      }
      if (changed) storage.setState('console', 'chat-names', names);
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  return { refresh, get: (key: string) => names[key] ?? '',list:()=>Object.entries(names).map(([chatKey,name])=>({chatKey,name})) };
}
