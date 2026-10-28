import type { StorageService } from '@qq-harness/domain';
export interface QueuedConversation {
  id: string;
  chatKey: string;
  ids: number[];
  triggerId?: number;
  createdAt: number;
  timeoutMs: number;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'interrupted';
  reason?: string;
}
// Persist intent at the business boundary, keeping the kernel storage agnostic.
// Running jobs can already have sent content: never replay them after a crash.
export function conversationQueue(storage: StorageService) {
  const entries = new Map<string, QueuedConversation>(
    ((storage.state('conversation-queue', 'jobs') ?? []) as QueuedConversation[]).map((e) => [
      e.id,
      e,
    ]),
  );
  const save = () => {
    const values = [...entries.values()];
    const terminal = values.filter((e) => !['queued', 'running'].includes(e.status)).slice(-100);
    entries.clear();
    for (const e of [
      ...terminal,
      ...values.filter((e) => ['queued', 'running'].includes(e.status)),
    ])
      entries.set(e.id, e);
    storage.setState('conversation-queue', 'jobs', [...entries.values()]);
  };
  for (const entry of entries.values())
    if (entry.status === 'running') {
      entry.status = 'interrupted';
      entry.reason = '进程重启，已执行任务不自动重放，请查看发送记录后手动重试';
    }
  save();
  return {
    list: () => structuredClone([...entries.values()]),
    put(entry: QueuedConversation) {
      entries.set(entry.id, entry);
      save();
    },
    update(id: string, status: QueuedConversation['status'], reason?: string) {
      const entry = entries.get(id);
      if (entry) {
        entry.status = status;
        entry.reason = reason;
        save();
      }
    },
  };
}
