import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  configService,
  storageService,
  conversationService,
  accessService,
} from '@qq-harness/domain';
export interface TopicClock {
  lastId: number;
  nextAt: number;
  idle: number;
  every: number;
}
export function nextTopicCheck(
  previous: TopicClock | undefined,
  last: { localId: number; timestamp: number },
  idle: number,
  every: number,
  now: number,
) {
  const state =
    previous &&
    previous.lastId === last.localId &&
    previous.idle === idle &&
    previous.every === every
      ? previous
      : {
          lastId: last.localId,
          nextAt: last.timestamp + idle * 1000,
          idle,
          every,
        };
  if (now < state.nextAt) return { due: false, state };
  return { due: true, state: { ...state, nextAt: now + every * 1000 } };
}
export const conversationProactive = definePlugin({
  id: 'conversation-proactive',
  name: '主动话题',
  client: { entry: 'builtin:conversation-proactive' },
  requires: [configService.id, storageService.id, conversationService.id, accessService.id],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      conversation = ctx.use(conversationService),
      access = ctx.use(accessService);
    const tick = () => {
      const cfg = config.get();
      if (cfg.paused || ctx.signal.aborted) return;
      for (const chatKey of new Set([
        ...cfg.admissions,
        ...Object.keys(cfg.profiles),
        ...storage.chats().map((c) => c.chatKey),
      ])) {
        const settings = config.effective(chatKey),
          p = settings.behavior.proactive;
        if (
          !p.enabled ||
          !settings.online ||
          settings.plugins[ctx.id] === false ||
          !access.allowed(chatKey)
        )
          continue;
        const last = storage.queryMessages
          ? storage.queryMessages([chatKey], { page: 1, pageSize: 1 }).items[0]
          : storage.messages(chatKey).at(-1);
        if (!last) continue;
        const previous = storage.state(ctx.id, chatKey) as TopicClock | undefined;
        const result = nextTopicCheck(
          previous,
          last,
          p.idleSeconds,
          p.checkEverySeconds,
          Date.now(),
        );
        if (previous !== result.state) storage.setState(ctx.id, chatKey, result.state);
        if (!result.due) continue;
        const roll = Math.random(),
          passed = roll < p.probability;
        let runId: string | undefined, error: string | undefined;
        if (passed)
          try {
            runId = conversation.wake(chatKey, {
              signal: ctx.signal,
              reason: 'proactive',
              text: '会话达到冷场阈值，本次概率判定通过。结合最近聊天自然寻找话题；没有合适内容可静默结束。',
            });
          } catch (e) {
            error = String(e);
          }
        storage.setState(ctx.id, chatKey + ':last', {
          at: Date.now(),
          roll,
          probability: p.probability,
          passed,
          runId,
          error,
          nextAt: result.state.nextAt,
        });
      }
    };
    const timer = setInterval(tick, 1000);
    ctx.effect(() => clearInterval(timer));
  },
});
