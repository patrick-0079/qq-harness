import { z } from 'zod';

export const presenceSchema = z.object({
  state: z.enum(['online', 'offline']).default('online'),
  revision: z.number().int().nonnegative().default(0),
  changedAt: z.number().default(0),
  source: z.string().default('startup'),
  actor: z.string().default('system'),
  reason: z.string().max(500).default(''),
});
export type SystemPresence = z.infer<typeof presenceSchema>;
export const presenceChangeSchema = z
  .object({
    state: z.enum(['online', 'offline']),
    reason: z.string().max(500).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    requestId: z.string().min(1).max(200),
  })
  .strict();
export const operationsSettingsSchema = z.object({
  privateEnabled: z.boolean().default(false),
  allowedIds: z.array(z.string().regex(/^[1-9]\d{4,19}$/)).default([]),
  opencodeGoKey: z.string().default(''),
  deepseekKey: z.string().default(''),
  glmKey: z.string().default(''),
  glmRegion: z.enum(['cn', 'global']).default('cn'),
  mimoCookie: z.string().default(''),
  timeoutMs: z.number().int().min(5000).max(60000).default(25000),
});
export type OperationsSettings = z.infer<typeof operationsSettingsSchema>;
export interface OperationLog {
  id: string;
  at: number;
  source: string;
  actor: string;
  action: string;
  status: 'ok' | 'failed' | 'skipped';
  message: string;
}
