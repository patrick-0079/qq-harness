/** Protocol replies may omit chat metadata; retain a recorded reference in that
 * case, but never accept explicit metadata pointing at a different conversation. */
export function assertMessageScope(
  chatKey: string,
  payload: Record<string, any>,
  record: { self?: boolean; selfId?: unknown } = {},
) {
  const [kind, peer] = chatKey.split(':');
  if (kind === 'group') {
    if (payload.message_type === 'private' || (payload.group_id != null && String(payload.group_id) !== peer))
      throw new Error('消息不属于当前会话');
    return;
  }
  if (payload.message_type === 'group' || (payload.group_id && String(payload.group_id) !== '0'))
    throw new Error('消息不属于当前会话');
  const sender = payload.user_id ?? payload.sender?.user_id,
    target = payload.target_id ?? payload.peer_id;
  if (record.self && target != null && String(target) !== peer) throw new Error('消息不属于当前会话');
  if (sender != null && String(sender) !== peer) {
    const owned =
      record.self &&
      (String(sender) === String(record.selfId ?? '') || (target != null && String(target) === peer));
    if (!owned) throw new Error('消息不属于当前会话');
  }
}
