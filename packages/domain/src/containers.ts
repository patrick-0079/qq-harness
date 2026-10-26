import { service } from '@qq-harness/plugin-sdk';
import type {
  ContainerSettings,
  ContainerEngineStatus,
  ContainerBinding,
  ContainerInfo,
  ContainerExecInput,
  ContainerExecResult,
  ContainerJob,
} from '@qq-harness/contracts';

export interface ContainerRuntimeService {
  canOperate(): boolean;
  settings(): ContainerSettings;
  configure(patch: unknown): ContainerSettings;
  status(signal?: AbortSignal): Promise<ContainerEngineStatus>;
  bindings(): ContainerBinding[];
  has(chatKey: string): boolean;
  list(signal?: AbortSignal): Promise<ContainerInfo[]>;
  create(chatKey: string, signal?: AbortSignal): Promise<ContainerInfo>;
  inspect(chatKey: string, signal?: AbortSignal): Promise<ContainerInfo>;
  start(chatKey: string, signal?: AbortSignal): Promise<ContainerInfo>;
  stop(chatKey: string, signal?: AbortSignal): Promise<void>;
  remove(chatKey: string, signal?: AbortSignal): Promise<void>;
  execute(
    chatKey: string,
    input: ContainerExecInput,
    signal?: AbortSignal,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ): Promise<ContainerExecResult>;
  command(
    chatKey: string,
    argv: string[],
    signal?: AbortSignal,
    stdin?: string,
  ): Promise<ContainerExecResult>;
}
export interface ContainerSessionService {
  available(chatKey: string): boolean;
  execute(
    chatKey: string,
    input: ContainerExecInput,
    signal?: AbortSignal,
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ): Promise<ContainerExecResult>;
}
export interface ContainerJobsService {
  start(chatKey: string, input: ContainerExecInput): ContainerJob;
  list(chatKey: string): ContainerJob[];
  get(chatKey: string, id: string): ContainerJob;
  cancel(chatKey: string, id: string): Promise<ContainerJob>;
}
export const containerRuntimeService = service<ContainerRuntimeService>('harness.container.runtime');
export const containerSessionService = service<ContainerSessionService>('harness.container.session');
export const containerJobsService = service<ContainerJobsService>('harness.container.jobs');
