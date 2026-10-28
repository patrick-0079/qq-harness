import { z } from 'zod';

export const memoryScopeSchema = z.enum(['chat_person', 'chat', 'person']);
export const memoryTierSchema = z.enum(['short', 'medium', 'long']);
export const memoryVisibilitySchema = z.enum(['chat_only', 'cross_chat']);
export const memorySourceSchema = z
  .object({
    chatKey: z.string(),
    localId: z.number().int().positive().optional(),
    noteId: z.string().uuid().optional(),
    noteRevision: z.number().int().positive().optional(),
    senderId: z.string().optional(),
  })
  .refine(
    (v) => (v.localId !== undefined) !== (v.noteId !== undefined) && (!v.noteId || !!v.noteRevision),
    '来源必须是消息或笔记修订',
  );
export const memoryRecordSchema = z.object({
  id: z.string().uuid(),
  scope: memoryScopeSchema,
  tier: memoryTierSchema,
  chatKey: z.string().nullable(),
  personId: z.string().nullable(),
  personName: z.string().max(100).optional(),
  key: z.string().min(1).max(160),
  text: z.string().min(1).max(100000),
  document: z
    .object({
      title: z.string().min(1).max(160),
      topic: z.string().min(1).max(160),
      role: z.enum(['knowledge', 'persona']).default('knowledge'),
      personaEpoch: z.string().optional(),
    })
    .optional(),
  visibility: memoryVisibilitySchema,
  sensitive: z.boolean(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  pinned: z.boolean(),
  sources: z.array(memorySourceSchema).max(500),
  origin: z.enum(['automatic', 'agent', 'admin', 'scratchpad', 'migration']),
  legacyOrigins: z
    .array(
      z.object({ file: z.string().max(500), sourceId: z.string().max(300), sha256: z.string().length(64) }),
    )
    .optional(),
  status: z.enum(['active', 'superseded', 'deleted']),
  revision: z.number().int().positive(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastConfirmedAt: z.number().int(),
  expiresAt: z.number().int().nullable(),
  factId: z.string().optional(),
  factVersion: z.number().int().positive().optional(),
  consolidatedAt: z.number().int().optional(),
  migratedFrom: z
    .object({ tier: memoryTierSchema, revision: z.number().int().positive(), at: z.number().int() })
    .optional(),
  derivedFrom: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() })).optional(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryTier = z.infer<typeof memoryTierSchema>;

export const scratchpadNoteSchema = z.object({
  id: z.string().uuid(),
  chatKey: z.string(),
  text: z.string().min(1).max(10000),
  important: z.boolean(),
  promotion: z.enum(['none', 'pending', 'done', 'failed']),
  sourceIds: z.array(z.number().int().positive()).max(30),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  expiresAt: z.number().int(),
  revision: z.number().int().positive(),
  status: z.enum(['active', 'deleted', 'expired']).optional(),
  consolidatedAt: z.number().int().optional(),
});
export type ScratchpadNote = z.infer<typeof scratchpadNoteSchema>;

export interface MemoryRevision {
  record: MemoryRecord;
  changedAt: number;
}
export interface MemoryIndexEvent {
  sequence: number;
  recordId: string;
  revision: number;
  operation: 'upsert' | 'remove';
}

const interval = z
  .number()
  .int()
  .min(1000)
  .max(31 * 86400000);
const retention = z
  .number()
  .int()
  .min(60000)
  .max(3650 * 86400000);
export const memoryScheduleOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    shortIntervalMs: interval.optional(),
    mediumIntervalMs: interval.optional(),
    longIntervalMs: interval.optional(),
    shortRetentionMs: retention.optional(),
    mediumRetentionMs: retention.optional(),
  })
  .strict();
export const memoryScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  shortIntervalMs: interval.default(30 * 60000),
  mediumIntervalMs: interval.default(2 * 3600000),
  longIntervalMs: interval.default(6 * 3600000),
  shortRetentionMs: retention.default(86400000),
  mediumRetentionMs: retention.default(30 * 86400000),
});
export type MemorySchedule = z.infer<typeof memoryScheduleSchema>;
export interface MemoryDraft {
  id: string;
  chatKey: string;
  recordId: string;
  expectedRevision: number;
  patch: Partial<MemoryRecord>;
  status: 'pending' | 'published' | 'cancelled' | 'conflict';
  revision: number;
  createdAt: number;
  publishedAt?: number;
  error?: string;
}
export interface MemoryStageStatus {
  nextAt: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  error?: string;
}
export interface MemoryConsolidationStatus {
  settings: MemorySchedule;
  stages: Record<MemoryTier, MemoryStageStatus>;
  activeRunId?: string;
}

export const memoryRequestInputSchema = z.object({
  chatKey: z.string().regex(/^(group|private):\d+$/),
  instruction: z.string().trim().min(1).max(20000),
  tier: z.enum(['short', 'medium', 'long', 'scratchpad']).optional(),
  sourceIds: z.array(z.number().int().positive()).max(100).default([]),
  targetIds: z.array(z.string().uuid()).max(50).default([]),
  origin: z.enum(['user', 'conversation', 'schedule', 'compatibility']).default('user'),
  idempotencyKey: z.string().max(240).optional(),
});
export type MemoryRequestInput = z.input<typeof memoryRequestInputSchema>;
export interface MemoryRequest {
  id: string;
  runId?: string;
  chatKey: string;
  instruction: string;
  tier?: 'short' | 'medium' | 'long' | 'scratchpad';
  sourceIds: number[];
  targetIds: string[];
  origin: 'user' | 'conversation' | 'schedule' | 'compatibility';
  idempotencyKey?: string;
  status: 'queued' | 'running' | 'needs_clarification' | 'completed' | 'failed' | 'cancelled';
  summary?: string;
  error?: string;
  changes: { id: string; action: string; before?: string; after?: string }[];
  createdAt: number;
  updatedAt: number;
}
export interface MemoryAgentService {
  request(input: MemoryRequestInput): MemoryRequest;
  requests(chatKey: string): MemoryRequest[];
  clarify(chatKey: string, id: string, instruction: string): MemoryRequest;
  read(chatKey: string, id: string): MemoryRecord | ScratchpadNote | undefined;
  list(chatKey: string, tier?: 'short' | 'medium' | 'long'): MemoryRecord[];
  persona(chatKey: string, seed?: string): string;
  status(chatKey: string): MemoryConsolidationStatus;
}
