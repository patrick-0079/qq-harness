import {
  assertMessageScope,
  messageSegments,
  type StoredMessage,
  type MessageSegment,
} from '@qq-harness/contracts';
import type { AdapterService, StorageService } from '@qq-harness/domain';
const obj = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
export const forwardId = (data: unknown): string => {
  const d = obj(data);
  return String(d.id ?? d.res_id ?? d.forward_id ?? d.data_id ?? '').trim();
};
export const forwardNodes = (value: unknown): unknown[] => {
  const data = obj(value);
  return Array.isArray(value)
    ? value
    : Array.isArray(data.messages)
      ? data.messages
      : Array.isArray(data.data?.messages)
        ? data.data.messages
        : [];
};
export function recordedSegments(message: StoredMessage): MessageSegment[] {
  const meta = message.metadata ?? {};
  return messageSegments(
    meta.segments ?? obj(meta.outbound).segments ?? meta.raw_message ?? meta.message ?? message.text,
  );
}
/** Stored IDs are hints; SnowLuma resource IDs expire and must be refreshed via
 * get_msg. A negative local message hash must never be treated as a resource ID. */
export async function fetchForwardRoot(
  adapter: AdapterService,
  storage: StorageService,
  root: StoredMessage,
  signal: AbortSignal,
): Promise<{ nodes: unknown[]; recordId: string }> {
  const reasons: string[] = [],
    tried = new Set<string>();
  const fetchId = async (id: string) => {
    if (!id || tried.has(id)) return;
    tried.add(id);
    try {
      const nodes = forwardNodes(await adapter.query('get_forward_msg', { id }, signal));
      if (nodes.length) return { nodes, recordId: id };
      reasons.push('资源记录为空');
    } catch (error) {
      signal.throwIfAborted();
      reasons.push(`资源读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const seen = new Set<string>();
  let mid = root.id,
    stored: StoredMessage | undefined = root;
  for (let hop = 0; hop < 5 && mid && !seen.has(mid); hop++) {
    seen.add(mid);
    let parts = stored ? recordedSegments(stored) : [];
    const hint = forwardId(parts.find((s) => s.type === 'forward')?.data);
    const fast = await fetchId(hint);
    if (fast) return fast;
    try {
      const fresh = obj(
        await adapter.query('get_msg', { message_id: /^-?\d+$/.test(mid) ? Number(mid) : mid }, signal),
      );
      assertMessageScope(root.chatKey, fresh, {
        self: stored?.self,
        selfId: stored?.metadata?.selfId ?? root.metadata?.selfId ?? adapter.identity?.().id,
      });
      const actual = messageSegments(fresh.message ?? fresh.raw_message);
      const id = forwardId(actual.find((s) => s.type === 'forward')?.data),
        result = await fetchId(id);
      if (result) return result;
      if (actual.length) parts = actual;
    } catch (error) {
      signal.throwIfAborted();
      if (String(error).includes('不属于当前会话')) throw error;
      reasons.push('原消息刷新失败');
    }
    const reply = parts.find((s) => s.type === 'reply');
    const next = String(reply?.data.id ?? '');
    if (!next) break;
    mid = next;
    stored = storage.messages(root.chatKey).find((m) => m.id === mid);
  }
  // Older NapCat versions accept a positive QQ message ID directly. SnowLuma
  // treats negative hashes as resource IDs and returns misleading empty payloads.
  if (/^\d+$/.test(root.id) && Number(root.id) > 0) {
    try {
      const nodes = forwardNodes(
        await adapter.query('get_forward_msg', { message_id: Number(root.id) }, signal),
      );
      if (nodes.length) return { nodes, recordId: `message:${root.id}` };
    } catch (error) {
      signal.throwIfAborted();
      reasons.push('按消息编号展开失败');
    }
  }
  throw new Error(
    `找不到可展开的聊天记录${reasons.length ? `（${[...new Set(reasons)].join('；')}）` : ''}，可尝试 refresh=true 刷新原消息`,
  );
}
