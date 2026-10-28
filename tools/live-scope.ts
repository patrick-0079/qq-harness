/** Manual verification must receive its authorized targets at launch time.
 * Never commit deployment identities or silently fall back to example accounts. */
export function liveScope(env: NodeJS.ProcessEnv = process.env) {
  const privateId = env.HARNESS_LIVE_PRIVATE_ID;
  const groupId = env.HARNESS_LIVE_GROUP_ID;
  if (!privateId || !groupId || !/^\d{5,12}$/.test(privateId) || !/^\d{5,12}$/.test(groupId)) {
    throw new Error('人工联调需要显式配置 HARNESS_LIVE_PRIVATE_ID 和 HARNESS_LIVE_GROUP_ID');
  }
  const allowedChats = [`private:${privateId}`, `group:${groupId}`] as const;
  return { privateId, groupId, allowedChats };
}
