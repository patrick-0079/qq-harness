import { z } from 'zod';
const probability = z.number().min(0).max(100).multipleOf(0.01);
const channel = z.object({
  enabled: z.boolean().default(true),
  probability: probability.default(100),
});
export const fourReplySchema = z.object({
  private: z.object({ probability: probability.default(100) }).default({ probability: 100 }),
  mention: channel.default({ enabled: true, probability: 100 }),
  keyword: channel.default({ enabled: true, probability: 100 }),
  other: channel.default({ enabled: false, probability: 100 }),
});
export const keywordRuleSchema = z
  .object({
    id: z.string().max(64),
    pattern: z.string().trim().min(1).max(200),
    mode: z.enum(['plain', 'regex']).default('plain'),
    flags: z
      .string()
      .regex(/^[dgimsuvy]*$/)
      .default('i'),
    probability: probability.nullable().default(null),
    enabled: z.boolean().default(true),
    exclude: z.boolean().default(false),
  })
  .superRefine((rule, context) => {
    if (rule.mode !== 'regex') return;
    try {
      new RegExp(rule.pattern, rule.flags);
    } catch {
      context.addIssue({ code: 'custom', message: '正则表达式或标志位无效' });
    }
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(rule.pattern))
      context.addIssue({ code: 'custom', message: '正则存在嵌套重复，请简化' });
  });
export const behaviorSchema = z.object({
  enabled: z.boolean().default(false),
  reply: fourReplySchema.default(() => fourReplySchema.parse({})),
  keywordRules: z.array(keywordRuleSchema).max(50).default([]),
  peakSchedule: z
    .object({
      enabled: z.boolean().default(false),
      weekdays: z.array(z.number().int().min(1).max(7)).default([]),
      peak: z
        .object({
          start: z
            .string()
            .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
            .default('09:00'),
          end: z
            .string()
            .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
            .default('18:00'),
          reply: fourReplySchema.default(() => fourReplySchema.parse({})),
        })
        .default(() => ({
          start: '09:00',
          end: '18:00',
          reply: fourReplySchema.parse({}),
        })),
    })
    .default(() => ({
      enabled: false,
      weekdays: [],
      peak: { start: '09:00', end: '18:00', reply: fourReplySchema.parse({}) },
    })),
  historyCount: z.number().int().min(0).max(2000).default(80),
  markConditionMissRead: z.boolean().default(true),
  maxPendingUnread: z.number().int().min(0).max(10000).default(200),
  promptAnchor: z
    .object({
      enabled: z.boolean().default(true),
      maxExtraRead: z.number().int().min(0).max(200).default(5),
    })
    .default({ enabled: true, maxExtraRead: 5 }),
  chatActive: z
    .object({
      enabled: z.boolean().default(true),
      maxMinutes: z.number().min(0).max(1440).default(10),
      probability: probability.default(100),
    })
    .default({ enabled: true, maxMinutes: 10, probability: 100 }),
  proactive: z.preprocess(
    (input) => {
      const v = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      return {
        ...v,
        idleSeconds: v.idleSeconds ?? Number(v.idleThresholdMs ?? 1800000) / 1000,
        checkEverySeconds: v.checkEverySeconds ?? Number(v.checkIntervalMinMs ?? 1800000) / 1000,
      };
    },
    z.object({
      idleSeconds: z.number().min(1).max(604800).default(1800),
      checkEverySeconds: z.number().min(1).max(604800).default(1800),
      enabled: z.boolean().default(false),
      checkIntervalMinMs: z.number().min(60000).default(1800000),
      checkIntervalMaxMs: z.number().min(60000).default(5400000),
      idleThresholdMs: z.number().min(60000).default(1800000),
      probability: z.number().min(0).max(1).default(0.25),
    }),
  ),
  blockedUsers: z.array(z.string().regex(/^\d+$/)).default([]),
  run: z
    .object({
      silencePolicy: z.enum(['auto', 'require', 'allow']).default('auto'),
      maxNudges: z.number().int().min(0).max(10).default(3),
      retryAttempts: z.number().int().min(0).max(10).default(2),
    })
    .default({ silencePolicy: 'auto', maxNudges: 3, retryAttempts: 2 }),
});
export const toolSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  crossChatSend: z.boolean().default(false),
  categories: z.record(z.string(), z.boolean()).default({}),
  overrides: z.record(z.string(), z.boolean()).default({}),
});
export type ConversationBehavior = z.infer<typeof behaviorSchema>;
export type KeywordRule = z.infer<typeof keywordRuleSchema>;
export interface ToolDescriptor {
  configuredEnabled?: boolean;
  builtinQQ?: boolean;
  id: string;
  name: string;
  owner: string;
  category: string;
  core: boolean;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
  reason: string;
}
export const managementScopeSchema = z.union([
  z.literal('default'),
  z.string().regex(/^(group|private):\d+$/),
]);
