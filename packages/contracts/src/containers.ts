import { z } from 'zod';
export const CONTAINER_WORKSPACE = '/tmp/qq-harness-workspace';

export const containerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  engine: z.enum(['auto', 'podman', 'docker']).default('auto'),
  binaryPath: z.string().max(1000).default(''),
  image: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/)
    .default('docker.io/library/ubuntu:24.04'),
  memoryMb: z.number().int().min(64).max(32768).default(512),
  cpus: z.number().min(0.1).max(32).default(1),
  pids: z.number().int().min(16).max(4096).default(128),
  network: z.enum(['none', 'bridge']).default('none'),
  timeoutMs: z.number().int().min(1000).max(600000).default(30000),
  maxOutputChars: z.number().int().min(1000).max(100000).default(16000),
});
export type ContainerSettings = z.infer<typeof containerSettingsSchema>;
export interface ContainerEngineStatus {
  available: boolean;
  engine?: 'docker' | 'podman';
  binary?: string;
  message: string;
  allowOperations: boolean;
}
export interface ContainerBinding {
  chatKey: string;
  name: string;
  id: string;
  engine: 'docker' | 'podman';
  binary: string;
  image: string;
}
export interface ContainerInfo extends ContainerBinding {
  running: boolean;
  status: string;
}
export const containerExecSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(16000)
    .refine((v) => !v.includes('\0')),
  workdir: z.string().max(1000).default(CONTAINER_WORKSPACE),
  timeoutMs: z.number().int().min(1000).max(600000).optional(),
});
export type ContainerExecInput = z.infer<typeof containerExecSchema>;
export interface ContainerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}
export interface ContainerJob {
  id: string;
  chatKey: string;
  command: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: number;
  endedAt?: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  exitCode?: number;
  error?: string;
}
