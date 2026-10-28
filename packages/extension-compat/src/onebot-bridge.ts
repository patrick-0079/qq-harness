import type { OutboundPayload } from '@qq-harness/domain';
import type { LegacyObject } from './types.js';

/** A package's old protocol prototype is private to that package. Observations
 * replay an acknowledged response and can never send the message a second time. */
export function onebotBridge(options: {
  identity: () => { id: string; name?: string };
  query: (action: string, args: LegacyObject) => Promise<unknown>;
  interact: (action: string, args: LegacyObject) => Promise<unknown>;
}) {
  const observed = Symbol('acknowledged outbound');
  class OneBotClient {
    constructor(_settings: LegacyObject = {}) {}
    get selfId() {
      return options.identity().id;
    }
    get selfNickname() {
      return options.identity().name ?? '';
    }
    async call(action: string, args: LegacyObject = {}) {
      if ((this as any)[observed] !== undefined) return (this as any)[observed];
      if (['set_input_status', 'set_msg_emoji_like'].includes(action)) return options.interact(action, args);
      if (/^(get_|can_send_|fetch_custom_face)/.test(action)) return options.query(action, args);
      throw new Error(`旧协议动作 ${action} 尚未接入公开受控服务`);
    }
  }
  return {
    OneBotClient,
    observe: async (value: {
      chatKey: string;
      text: string;
      messageId: string;
      payload?: OutboundPayload;
    }) => {
      if (
        value.payload &&
        ('file' in value.payload ||
          'poke' in value.payload ||
          'profileImage' in value.payload ||
          'typing' in value.payload ||
          'reaction' in value.payload)
      )
        return;
      const [kind, id] = value.chatKey.split(':'),
        receiver = Object.create(OneBotClient.prototype);
      receiver[observed] = { message_id: value.messageId };
      await receiver.call(kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
        [kind === 'group' ? 'group_id' : 'user_id']: id,
        message:
          value.payload && 'segments' in value.payload
            ? value.payload.segments
            : [{ type: 'text', data: { text: value.text } }],
      });
    },
  };
}
