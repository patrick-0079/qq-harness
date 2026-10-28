import type { ChatSettings, IncomingMessage } from '@qq-harness/contracts';
import { behaviorDecision } from './behavior.js';
export function replyDecision(
  settings: ChatSettings,
  message: IncomingMessage,
  activeUntil = 0,
  now = new Date(),
  random = Math.random,
) {
  if (!settings.online) return { trigger: false, reason: 'offline' };
  return behaviorDecision(settings.behavior, message, activeUntil, now, random);
}
