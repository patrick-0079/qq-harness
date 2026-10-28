/** Only instruction material is upgraded. Never apply this to chat archives or
 * user message contents; package source literals and manifest prompts are safe
 * migration boundaries where the host owns the tool contract. */
export function normalizeLegacyInstructions(input: string): string {
  let text = input
    .replace(
      /(?:同一批(?:消息|回复)|只)[^。\n]{0,30}首条[^。\n]{0,50}(?:引用|@)[^。\n]*[。]?/g,
      '每条消息可以独立使用 ⟦reply:消息ID⟧ 和 ⟦at:QQ号⟧。',
    )
    .replace(/messages\s*传单个字符串/g, 'messages 传仅含一个字符串的数组')
    .replace(/（summary\s*写[\s\S]*?即可）/g, '（mode 设为 spoken 即可）')
    .replace(/finish\(\{\s*summary\s*:[\s\S]*?\}\)/g, 'finish({mode:"spoken"})')
    .replace(
      /send_message\(\{\s*["']?text["']?\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\}\)/g,
      'send_message({messages:[$1]})',
    );
  if (/send_message|messages\s*传单个字符串/.test(input))
    text = text
      .replace(/严禁传数组/g, '数组只保留这一项')
      .replace(/(["']?messages["']?\s*:)\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(?=\s*[,}])/g, '$1[$2]');
  return text;
}

/** Old packages keep their API while the native tool only advertises string markers. */
export function normalizeLegacySend(name: string, value: unknown): unknown {
  if (name !== 'send_message' || !value || typeof value !== 'object') return value;
  const input = value as Record<string, any>;
  if (
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    !input.messages.every((m: unknown) => typeof m === 'string')
  )
    return value;
  const { replyToMessageId, atUserId, ...rest } = input;
  const prefix = `${replyToMessageId !== undefined ? `⟦reply:${replyToMessageId}⟧` : ''}${atUserId !== undefined ? `⟦at:${atUserId}⟧` : ''}`;
  return { ...rest, messages: [prefix + rest.messages[0], ...rest.messages.slice(1)] };
}
export function legacySendView(name: string, value: any) {
  if (name !== 'send_message' || !Array.isArray(value?.messages)) return value;
  const text = value.messages.join('\n');
  const reply = /⟦(?:reply|replay):([^⟧]+)⟧/.exec(text)?.[1];
  const at = /⟦at:(\d+)⟧/.exec(text)?.[1];
  return { ...value, ...(reply ? { replyToMessageId: reply } : {}), ...(at ? { atUserId: at } : {}) };
}
