import { z } from 'zod';

export const memoryScopeSchema = z.enum(['chat_person', 'chat', 'person']);
export const memoryTierSchema = z.enum(['medium', 'long']);
export const memoryVisibilitySchema = z.enum(['chat_only', 'cross_chat']);
export const memorySourceSchema = z.object({
  chatKey: z.string(),
  localId: z.number().int().positive(),
  senderId: z.string().optional(),
});
export const memoryRecordSchema = z.object({
  id: z.string().uuid(),
  scope: memoryScopeSchema,
  tier: memoryTierSchema,
  chatKey: z.string().nullable(),
  personId: z.string().nullable(),
  key: z.string().min(1).max(160),
  text: z.string().min(1).max(4000),
  visibility: memoryVisibilitySchema,
  sensitive: z.boolean(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  pinned: z.boolean(),
  sources: z.array(memorySourceSchema).max(30),
  origin: z.enum(['automatic', 'agent', 'admin', 'scratchpad']),
  status: z.enum(['active', 'superseded', 'deleted']),
  revision: z.number().int().positive(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastConfirmedAt: z.number().int(),
  expiresAt: z.number().int().nullable(),
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
