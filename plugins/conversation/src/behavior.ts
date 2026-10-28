import type { ConversationBehavior, IncomingMessage } from '@qq-harness/contracts';

export function isPeakWindow(settings: ConversationBehavior['peakSchedule'], at: Date) {
  if (!settings.enabled) return false;
  const minute = (text: string) => {
    const [h, m] = text.split(':').map(Number);
    return h! * 60 + m!;
  };
  const start = minute(settings.peak.start),
    end = minute(settings.peak.end),
    now = at.getHours() * 60 + at.getMinutes();
  if (start === end) return false;
  if (start < end ? now < start || now >= end : now < start && now >= end) return false;
  const day = new Date(at.getTime());
  if (start > end && now < end) day.setDate(day.getDate() - 1);
  return !settings.weekdays.length || settings.weekdays.includes(day.getDay() || 7);
}
export function behaviorDecision(
  settings: ConversationBehavior,
  message: IncomingMessage,
  activeUntil: number,
  at: Date,
  random: () => number,
) {
  const chance = (probability: number, reason: string) => ({
    trigger: random() < probability / 100,
    reason,
    keepUnread: true,
    probability,
  });
  if (settings.chatActive.enabled && settings.chatActive.maxMinutes > 0 && at.getTime() < activeUntil)
    return { trigger: true, reason: 'active', keepUnread: true, probability: 100 };
  if (message.chatKey.startsWith('private:')) return chance(settings.reply.private.probability, 'private');
  const peak = isPeakWindow(settings.peakSchedule, at),
    reply = peak ? settings.peakSchedule.peak.reply : settings.reply;
  const label = (name: string) => `${peak ? 'peak-' : ''}${name}`;
  if (reply.mention.enabled && (message.atMe || message.metadata?.poke === true))
    return chance(reply.mention.probability, label('mention'));
  if (reply.keyword.enabled) {
    const text = message.text.slice(0, 2000),
      matches = settings.keywordRules.filter((rule) => {
        if (!rule.enabled) return false;
        if (rule.mode === 'plain') return text.toLowerCase().includes(rule.pattern.toLowerCase());
        try {
          return new RegExp(rule.pattern, rule.flags).test(text);
        } catch {
          return false;
        }
      });
    if (matches.some((r) => r.exclude))
      return {
        trigger: false,
        reason: 'keyword-excluded',
        keepUnread: !settings.markConditionMissRead,
      };
    const matched = matches
      .filter((r) => !r.exclude)
      .sort(
        (a, b) => (b.probability ?? reply.keyword.probability) - (a.probability ?? reply.keyword.probability),
      )[0];
    if (matched)
      return {
        ...chance(matched.probability ?? reply.keyword.probability, label('keyword')),
        ruleId: matched.id,
      };
  }
  if (reply.other.enabled) return chance(reply.other.probability, label('other'));
  return {
    trigger: false,
    reason: 'condition-miss',
    keepUnread: !settings.markConditionMissRead,
  };
}

export function settleActive(
  previous: number,
  requested: boolean | undefined,
  settings: ConversationBehavior['chatActive'],
  now = Date.now(),
) {
  if (!settings.enabled || settings.maxMinutes <= 0 || requested === false) return 0;
  if (requested === true) return previous > now ? previous : now + settings.maxMinutes * 60000;
  return previous > now ? previous : 0;
}
