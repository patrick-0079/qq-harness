import { expect, test } from 'vitest';
import { behaviorSchema, chatSettingsSchema, incomingSchema } from '@qq-harness/contracts';
import { behaviorDecision, isPeakWindow, settleActive } from '../plugins/conversation/src/behavior.js';
import { replyDecision } from '../plugins/conversation/src/policy.js';
const message = incomingSchema.parse({
  id: 'm',
  chatKey: 'group:1',
  senderId: '2',
  text: '你好 天气',
  atMe: false,
});
test('四类独立概率、关键词最高概率和正则标志位，概率未中保留未读', () => {
  const settings = behaviorSchema.parse({
    enabled: true,
    reply: {
      private: { probability: 24.1 },
      mention: { probability: 0 },
      keyword: { probability: 10 },
      other: { enabled: false },
    },
    keywordRules: [
      { id: 'a', pattern: '天气', probability: 20 },
      { id: 'b', pattern: '天.', mode: 'regex', flags: 'g', probability: 80 },
    ],
  });
  for (let n = 0; n < 2; n++)
    expect(behaviorDecision(settings, message, 0, new Date(), () => 0.79)).toMatchObject({
      trigger: true,
      ruleId: 'b',
      probability: 80,
    });
  expect(behaviorDecision(settings, message, 0, new Date(), () => 0.9)).toMatchObject({
    trigger: false,
    keepUnread: true,
  });
  expect(behaviorDecision(settings, { ...message, atMe: true }, 0, new Date(), () => 0)).toMatchObject({
    trigger: false,
    reason: 'mention',
  });
  expect(
    behaviorDecision(settings, { ...message, chatKey: 'private:1' }, 0, new Date(), () => 0.25),
  ).toMatchObject({ trigger: false, reason: 'private' });
  expect(behaviorDecision(settings, { ...message, text: '无关键词' }, 0, new Date(), () => 0)).toMatchObject({
    trigger: false,
    keepUnread: false,
    reason: 'condition-miss',
  });
});
test('跨午夜以开始日判星期，空星期为每天，私聊不受高峰覆盖', () => {
  const settings = behaviorSchema.parse({
    enabled: true,
    reply: { private: { probability: 20 } },
    peakSchedule: {
      enabled: true,
      weekdays: [1],
      peak: { start: '22:00', end: '06:00', reply: { mention: { probability: 0 } } },
    },
  });
  const at = new Date(2026, 9, 27, 2, 0);
  expect(isPeakWindow(settings.peakSchedule, at)).toBe(true);
  expect(behaviorDecision(settings, { ...message, atMe: true }, 0, at, () => 0)).toMatchObject({
    trigger: false,
    reason: 'peak-mention',
  });
  expect(behaviorDecision(settings, { ...message, chatKey: 'private:1' }, 0, at, () => 0.1)).toMatchObject({
    trigger: true,
    probability: 20,
  });
  expect(isPeakWindow({ ...settings.peakSchedule, weekdays: [] }, at)).toBe(true);
  expect(isPeakWindow(settings.peakSchedule, new Date(2026, 9, 27, 6, 0))).toBe(false);
});
test('活跃期开关由 finish 控制，保持不续期，超时或关闭立即失效', () => {
  const settings = chatSettingsSchema.parse({
    behavior: {
      enabled: true,
      chatActive: { enabled: true, maxMinutes: 10 },
      reply: { other: { enabled: false } },
    },
  });
  const start = 1000000,
    until = settleActive(0, true, settings.behavior.chatActive, start);
  expect(until).toBe(start + 600000);
  expect(settleActive(until, true, settings.behavior.chatActive, start + 500000)).toBe(until);
  expect(settleActive(until, false, settings.behavior.chatActive, start)).toBe(0);
  expect(replyDecision(settings, message, until, new Date(start + 1), () => 0.99)).toMatchObject({
    trigger: true,
    reason: 'active',
  });
  expect(replyDecision(settings, message, until, new Date(until), () => 0)).toMatchObject({
    trigger: false,
    reason: 'condition-miss',
  });
});
