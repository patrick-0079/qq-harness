import { z } from 'zod';

export const snowlumaSettingsSchema = z.object({
  mode: z.enum(['external', 'managed']).default('external'),
  directory: z.string().max(2000).default(''),
  nodePath: z.string().max(2000).default(''),
  autoStart: z.boolean().default(false),
  acceptEula: z.boolean().default(false),
  acceptPrivacy: z.boolean().default(false),
});
export type SnowlumaSettings = z.infer<typeof snowlumaSettingsSchema>;
export interface SnowlumaLog {
  at: number;
  stream: 'stdout' | 'stderr' | 'host';
  text: string;
}
export interface SnowlumaStatus {
  phase: 'unconfigured' | 'stopped' | 'external' | 'starting' | 'running' | 'stopping' | 'failed';
  installed: boolean;
  owned: boolean;
  pid: number | null;
  webuiReady: boolean;
  webuiUrl: string;
  onebotConnected: boolean;
  hookAutoLoad: boolean | null;
  allowLaunch: boolean;
  message: string;
}
