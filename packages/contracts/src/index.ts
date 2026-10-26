import { z } from 'zod';
export * from './containers.js';
export { snowlumaSettingsSchema } from './snowluma.js';
export {
  memoryScopeSchema,
  memoryTierSchema,
  memoryVisibilitySchema,
  memorySourceSchema,
  memoryRecordSchema,
  scratchpadNoteSchema,
} from './memory.js';
export type {
  MemoryRecord,
  MemorySource,
  MemoryScope,
  MemoryTier,
  ScratchpadNote,
  MemoryRevision,
  MemoryIndexEvent,
} from './memory.js';
export type { SnowlumaSettings, SnowlumaStatus, SnowlumaLog } from './snowluma.js';
export type {
  ExtensionDto,
  ExtensionTabDto,
  ExtensionField,
  ExtensionContributionDto,
  ExtensionPayload,
} from './extensions.js';

export const chatKeySchema = z.string().regex(/^(group|private):[0-9]+$/);
export const incomingSchema = z.object({
  id: z.string().min(1).max(160),
  chatKey: chatKeySchema,
  senderId: z.string().min(1).max(80),
  senderName: z.string().max(100).default(''),
  text: z.string().max(100000),
  atMe: z.boolean().default(false),
  timestamp: z.number().default(() => Date.now()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type IncomingMessage = z.infer<typeof incomingSchema>;
export const modelHttpHeadersSchema = z.object({
  url: z.url(),
  model: z.string(),
  headers: z.record(z.string(), z.string()),
});
export type ModelHttpHeaders = z.infer<typeof modelHttpHeadersSchema>;
export const modelMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
  reasoning_content: z.string().optional(),
});
export type StoredMessage = IncomingMessage & { localId: number; self: boolean; read: boolean };
export const chatSettingsSchema = z.object({
  online: z.boolean().default(true),
  trigger: z.enum(['mention', 'all', 'keyword']).default('mention'),
  keywords: z.array(z.string().min(1)).default([]),
  wakeDelayMs: z.number().int().min(0).max(60000).default(150),
  drainDelayMs: z.number().int().min(0).max(60000).default(150),
  runTimeoutMs: z.number().int().min(100).max(3600000).default(120000),
  maxRounds: z.number().int().min(1).max(40).default(12),
  persona: z.string().max(20000).default('你是群聊中的助手。使用工具发送消息，完成后调用 finish。'),
  scratchpadMaxDays: z.number().int().min(1).max(90).default(7),
  plugins: z.record(z.string(), z.boolean()).default({}),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
export const modelSettingsSchema = z.object({
  baseUrl: z.url().default('https://api.openai.com/v1'),
  model: z.string().default(''),
  apiKey: z.string().default(''),
  timeoutMs: z.number().int().min(100).max(3600000).default(180000),
  retries: z.number().int().min(0).max(5).default(2),
});
export const configSchema = z.object({
  version: z.literal(1).default(1),
  acceptAllSessions: z.boolean().default(false),
  admissions: z.array(chatKeySchema).default([]),
  deniedChats: z.array(chatKeySchema).default([]),
  deniedUsers: z.array(z.string()).default([]),
  defaults: chatSettingsSchema.default(() => chatSettingsSchema.parse({})),
  profiles: z.record(chatKeySchema, chatSettingsSchema).default({}),
  plugins: z.record(z.string(), z.boolean()).default({}),
  model: modelSettingsSchema.default(() => modelSettingsSchema.parse({})),
  onebot: z
    .object({
      wsUrl: z.url().default('ws://127.0.0.1:3001'),
      httpUrl: z.url().default('http://127.0.0.1:3000'),
      accessToken: z.string().default(''),
      httpAccessToken: z.string().default(''),
    })
    .default(() => ({
      wsUrl: 'ws://127.0.0.1:3001',
      httpUrl: 'http://127.0.0.1:3000',
      accessToken: '',
      httpAccessToken: '',
    })),
  send: z
    .object({
      minIntervalMs: z.number().int().min(0).default(1000),
      dedupeMs: z.number().int().min(0).default(15000),
      perMinute: z.number().int().min(1).default(20),
    })
    .default(() => ({ minIntervalMs: 1000, dedupeMs: 15000, perMinute: 20 })),
});
export type HarnessConfig = z.infer<typeof configSchema>;
export interface PublicConfig extends Omit<HarnessConfig, 'model' | 'onebot'> {
  model: Omit<HarnessConfig['model'], 'apiKey'> & { hasApiKey: boolean };
  onebot: Omit<HarnessConfig['onebot'], 'accessToken' | 'httpAccessToken'> & {
    hasAccessToken: boolean;
    hasHttpAccessToken: boolean;
  };
}
export interface ChatSummary {
  chatKey: string;
  messages: number;
  unread: number;
  lastText: string;
}
export interface Archive {
  id: string;
  chatKey: string;
  startedAt: number;
  endedAt: number;
  status: string;
  sent: number;
  reason?: string;
  trace: { type: string; text: string; timestamp: number }[];
  usage: { input: number; output: number; extra?: Record<string, number> };
  legacy?: unknown;
}
export interface PluginDto {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  status: string;
  generation: number;
  requires: string[];
  error?: string;
  client?: { entry: string; css?: string[] };
}
export interface RunDto {
  id: string;
  mode: string;
  partitionKey: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}
export interface StatusDto {
  revision: number;
  plugins: PluginDto[];
  runs: RunDto[];
  adapter: { kind: string; connected: boolean };
  demo: boolean;
}
export interface ApiError {
  error: { code: string; message: string };
}
