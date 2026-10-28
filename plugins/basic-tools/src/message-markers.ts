import type { MessageSegment, StorageService } from '@qq-harness/domain';

const stripControlNoise = (text: string) =>
  text
    .replace(/⟦[^⟧]*(?:⟧|$)/gu, '')
    .replace(/⟧/gu, '')
    .replace(/〖\s*(?:(?:reply|replay|at)\s*[:：]|@)[^〗]*(?:〗|$)/giu, '');

/** Models sometimes substitute U+3016/3017 for the canonical U+27E6/27E7.
 * Only control-prefixed aliases are reserved; ordinary 〖titles〗 remain text. */
export function messageMarkers(input: string, chatKey: string, storage: Pick<StorageService, 'messages'>) {
  const segments: MessageSegment[] = [];
  let cursor = 0,
    replySeen = false;
  for (const match of input.matchAll(/⟦([^⟦⟧]*)⟧|〖(\s*(?:(?:reply|replay|at)\s*[:：]|@)[^〖〗]*)〗/giu)) {
    const before = stripControlNoise(input.slice(cursor, match.index));
    if (before) segments.push({ type: 'text', data: { text: before } });
    cursor = match.index! + match[0].length;
    const marker = (match[1] ?? match[2])!.trim();
    const command = /^(reply|replay|at)\s*[:：]([\s\S]*)$/iu.exec(marker);
    const name = command?.[1]?.toLowerCase();
    if (name === 'reply' || name === 'replay') {
      if (replySeen) continue;
      replySeen = true;
      const id = command![2]!.trim();
      const quoted = storage.messages(chatKey).find((m) => m.id === id || String(m.localId) === id);
      if (!quoted) throw Error('引用消息不属于当前会话');
      segments.unshift({ type: 'reply', data: { id: quoted.id } });
    } else if (name === 'at' || marker.startsWith('@')) {
      const qq = (name === 'at' ? command![2]! : marker.slice(1)).trim();
      if (!chatKey.startsWith('group:')) throw Error('私聊不能 @ 群成员');
      if (!/^[1-9]\d{0,19}$/.test(qq)) throw Error('@ 标记需要有效 QQ 号');
      segments.push({ type: 'at', data: { qq } });
    }
    // Unknown reserved markers are removed as well; they are never sent as text.
  }
  const tail = stripControlNoise(input.slice(cursor));
  if (tail) segments.push({ type: 'text', data: { text: tail } });
  const text = segments
    .filter((s) => s.type === 'text')
    .map((s) => String(s.data.text))
    .join('');
  if (!text.trim() && !segments.some((s) => s.type === 'at')) throw Error('移除控制标记后消息为空');
  return { text: text || '[提及成员]', segments, targeted: segments.some((s) => s.type !== 'text') };
}
