import { z } from 'zod';

export const qqPortableSettingsSchema = z.object({
  directory: z.string().max(2000).default(''),
  dataDirectory: z.string().max(2000).default(''),
});
export type QqPortableSettings = z.infer<typeof qqPortableSettingsSchema>;
export interface QqPortableStatus {
  phase: 'unconfigured' | 'ready' | 'starting' | 'running' | 'external' | 'stopping' | 'failed';
  installed: boolean;
  version: string;
  owned: boolean;
  pid: number | null;
  allowLaunch: boolean;
  message: string;
}
