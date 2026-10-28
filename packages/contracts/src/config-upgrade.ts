type Value = Record<string, any>;
/** Old settings are translated at the configuration boundary, never at trigger time. */
export function upgradeChatBehavior(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const v = structuredClone(input) as Value;
  if (v.behavior?.enabled === true) return v;
  if (v.replyPolicy?.enabled) {
    const p = v.replyPolicy;
    const channels = (g: Value) => ({
      mention: { enabled: true, probability: (g.mention ?? 1) * 100 },
      keyword: { enabled: true, probability: (g.keyword ?? 1) * 100 },
      other: { enabled: true, probability: (g.normal ?? 0) * 100 },
    });
    v.behavior = {
      ...v.behavior,
      reply: { ...channels(p.group ?? {}), private: { probability: (p.privateProbability ?? 1) * 100 } },
      chatActive: { enabled: true, maxMinutes: (p.activeMs ?? 120000) / 60000, probability: 100 },
    };
    if (p.peak) {
      const time = (n: number) =>
        `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
      v.behavior.peakSchedule = {
        enabled: p.peak.enabled,
        weekdays: (p.peak.days ?? []).map((d: number) => d || 7),
        peak: {
          start: time(p.peak.startMinute ?? 1080),
          end: time(p.peak.endMinute ?? 1380),
          reply: channels(p.peak.group ?? {}),
        },
      };
    }
  } else if (!v.behavior || v.trigger !== undefined || v.keywords !== undefined) {
    v.behavior = {
      ...v.behavior,
      reply: { ...v.behavior?.reply, other: { enabled: v.trigger === 'all', probability: 100 } },
    };
  }
  v.behavior = { ...v.behavior, enabled: true };
  if (!v.behavior.keywordRules?.length && Array.isArray(v.keywords))
    v.behavior.keywordRules = v.keywords.map((pattern: string, i: number) => ({
      id: `legacy-${i}`,
      pattern,
      mode: 'plain',
      probability: null,
    }));
  return v;
}
