import { z } from 'zod';
export interface ConversationQueueDto {
  id: string;
  chatKey: string;
  createdAt: number;
  status: string;
  reason?: string;
}
const probability = z.number().min(0).max(1);
const channels = z.object({
  mention: probability.default(1),
  keyword: probability.default(1),
  normal: probability.default(0),
});
export const replyPolicySchema = z.object({
  enabled: z.boolean().default(false),
  privateProbability: probability.default(1),
  group: channels.default(() => channels.parse({})),
  activeMs: z.number().int().min(0).max(86400000).default(120000),
  activeProbability: probability.default(0.2),
  peak: z
    .object({
      enabled: z.boolean().default(false),
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      startMinute: z.number().int().min(0).max(1439).default(1080),
      endMinute: z.number().int().min(0).max(1439).default(1380),
      group: channels.default(() => channels.parse({})),
    })
    .default(() => ({
      enabled: false,
      days: [1, 2, 3, 4, 5],
      startMinute: 1080,
      endMinute: 1380,
      group: channels.parse({}),
    })),
});
export const modelSelectionSchema = z.object({
  providerId: z.string().default(''),
  model: z.string().default(''),
  fallbacks: z
    .array(z.object({ providerId: z.string(), model: z.string().min(1) }))
    .max(10)
    .default([]),
  timeoutMs: z.number().int().min(100).max(3600000).default(180000),
  temperature: z.number().min(0).max(2).nullable().default(null),
  thinkingBudget: z.number().int().min(0).max(200000).default(0),
  thinkingMode: z.enum(['auto', 'off', 'on']).default('auto'),
  thinkingEffort: z.enum(['', 'low', 'medium', 'high', 'xhigh', 'max']).default(''),
});
export const catalogTextSchema = z.object({
  readOnly: z.boolean().optional(),
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  text: z.string().max(100000),
});
export const providerSchema = z.object({
  currency: z.string().min(1).max(12).default('USD'),
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  baseUrl: z.url(),
  apiKey: z.string().default(''),
  models: z.array(z.string()).default([]),
  priceInputPerM: z.number().nonnegative().nullable().default(null),
  priceOutputPerM: z.number().nonnegative().nullable().default(null),
});
export type CatalogText = z.infer<typeof catalogTextSchema>;
export type ModelProvider = z.infer<typeof providerSchema>;
export type PublicProvider = Omit<ModelProvider, 'apiKey'> & { hasApiKey: boolean };
export interface ChatDirectoryEntry {
  chatKey: string;
  alias: string;
  name: string;
  displayName: string;
  pinnedAt: number;
  configured: boolean;
  admitted: boolean;
  allowed: boolean;
  denied: boolean;
  online: boolean;
  messages: number;
  unread: number;
  lastText: string;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
