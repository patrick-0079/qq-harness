import { createHash } from 'node:crypto';
import type { ChatSettings, StoredMessage } from '@qq-harness/contracts';
import type { StorageService, AccessService } from '@qq-harness/domain';
import type { ModelMessage } from '@qq-harness/domain';
export function withReplyBudget(messages: ModelMessage[], limit: number, used: number): ModelMessage[] {
  const strip = (text: string) => text.replace(/\n?【本轮回复消息上限】[\s\S]*?【额度结束】/g, '');
  const directive = `\n【本轮回复消息上限】\n本次回复最多发送 ${limit} 条信息，已发送或结果待确认 ${used} 条，剩余最多 ${Math.max(0, limit - used)} 条。额度跨全部发送工具、数组元素及多次调用合计，拆分出的实际消息也计数。请先组织内容；额度用完后禁止继续发送或重试，使用 finish 结束。每条消息可独立包含 ⟦reply:消息ID⟧ 和多个 ⟦at:QQ号⟧；每条仅首个引用生效。\n【额度结束】`;
  const result = messages.map((message) =>
    message.role !== 'system'
      ? message
      : {
          ...message,
          content:
            typeof message.content === 'string'
              ? strip(message.content)
              : Array.isArray(message.content)
                ? message.content.map((part) =>
                    part.type === 'text' ? { ...part, text: strip(part.text ?? '') } : part,
                  )
                : message.content,
        },
  );
  const index = result.findIndex((message) => message.role === 'system');
  if (index < 0) result.unshift({ role: 'system', content: directive });
  else {
    const system = result[index]!;
    result[index] = {
      ...system,
      content:
        typeof system.content === 'string'
          ? system.content + directive
          : [...(system.content ?? []), { type: 'text', text: directive }],
    };
  }
  return result;
}
export function withTriggerFocus(messages: ModelMessage[], focus: StoredMessage): ModelMessage[] {
  const strip = (text: string) => text.replace(/\n?【本轮触发定位】[\s\S]*?【定位结束】/g, '');
  const output = messages.map((message) =>
    message.role !== 'system'
      ? message
      : {
          ...message,
          content:
            typeof message.content === 'string'
              ? strip(message.content)
              : Array.isArray(message.content)
                ? message.content.map((part) =>
                    part.type === 'text'
                      ? {
                          ...part,
                          text: strip(typeof part.text === 'string' ? part.text : ''),
                        }
                      : part,
                  )
                : message.content,
        },
  );
  const directive = `\n【本轮触发定位】\n实际启动本轮的是消息 #${focus.id}，请着重回应它，@、拍一拍和关键词触发均适用。其他聊天消息用于理解上下文。\n触发消息摘录（最多4000字）：${focus.senderName || focus.senderId}：${focus.text.slice(0, 4000)}\n【定位结束】`;
  const index = output.findIndex((message) => message.role === 'system');
  if (index < 0) output.unshift({ role: 'system', content: directive });
  else {
    const system = output[index]!;
    output[index] = {
      ...system,
      content:
        typeof system.content === 'string'
          ? system.content + directive
          : [...(Array.isArray(system.content) ? system.content : []), { type: 'text', text: directive }],
    };
  }
  return output;
}
export const formatMessages = (rows: StoredMessage[]) =>
  rows
    .map(
      (m) =>
        `#${m.id} [localId=${m.localId}] ${m.senderName || m.senderId} (${m.senderId})${m.self ? ' [自己]' : ''}: ${m.text}`,
    )
    .join('\n');
export function conversationContext(
  storage: StorageService,
  access: AccessService,
  chatKey: string,
  triggers: StoredMessage[],
  settings: ChatSettings,
  privacy: unknown,
  includeUnreadHistory = false,
) {
  const unread = new Set(triggers.map((m) => m.localId));
  const count = settings.behavior.historyCount;
  const read = storage
    .messages(chatKey)
    .filter(
      (m) =>
        !unread.has(m.localId) &&
        (includeUnreadHistory || m.read || m.self) &&
        (m.self || access.allowed(chatKey, m.senderId)),
    );
  const history = count > 0 ? read.slice(-count) : [];
  const anchor = settings.behavior.promptAnchor;
  const signature = createHash('sha256')
    .update(
      JSON.stringify({
        count,
        privacy,
        blocked: settings.behavior.blockedUsers,
        includeUnreadHistory,
      }),
    )
    .digest('hex');
  const previous = storage.state('prompt-anchor', chatKey) as
    { signature?: string; ids?: number[]; text?: string; extra?: number } | undefined;
  let prefix = formatMessages(history),
    ids = history.map((m) => m.localId),
    extra = 0;
  if (
    anchor.enabled &&
    previous?.signature === signature &&
    previous.ids?.length &&
    typeof previous.text === 'string'
  ) {
    const oldIds = new Set(previous.ids),
      last = previous.ids.at(-1)!;
    const retained = previous.ids.every((id) => read.some((m) => m.localId === id));
    const added = read.filter((m) => m.localId > last && !oldIds.has(m.localId));
    if (retained && (previous.extra ?? 0) + added.length <= anchor.maxExtraRead) {
      prefix = previous.text + (added.length ? '\n' + formatMessages(added) : '');
      ids = [...previous.ids, ...added.map((m) => m.localId)];
      extra = (previous.extra ?? 0) + added.length;
    }
  }
  if (anchor.enabled)
    storage.setState('prompt-anchor', chatKey, {
      signature,
      ids,
      text: prefix,
      extra,
    });
  return `${prefix ? `${includeUnreadHistory ? '【最近聊天参考（含未读，用于找话题，不表示需要逐条补回复）】' : '【已读信息】'}\n${prefix}\n\n` : ''}【未读信息】\n${formatMessages(triggers)}`;
}
