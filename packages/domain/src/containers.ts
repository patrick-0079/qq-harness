import { service } from '@qq-harness/plugin-sdk';
import type {
  ContainerSettings,
  ContainerEngineStatus,
  ContainerBinding,
  ContainerInfo,
  ContainerExecInput,
  ContainerExecResult,
  ContainerJob,
  DiscoveredContainer,
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
  createResource(input?: { name?: string; image?: string }, signal?: AbortSignal): Promise<ContainerInfo>;
  discover(signal?: AbortSignal): Promise<DiscoveredContainer[]>;
  registerExisting(reference: string, signal?: AbortSignal): Promise<ContainerInfo>;
  setBindings(chatKey: string, containerIds: string[], primary?: string): Promise<ContainerBinding[]>;
  assignResource(containerId: string, chatKeys: string[]): Promise<ContainerInfo>;
  bind(chatKey: string, containerId: string): Promise<ContainerInfo>;
  unbind(chatKey: string, containerId?: string): Promise<void>;
  removeExisting(containerId: string): Promise<void>;
  inspect(chatKey: string, signal?: AbortSignal, containerId?: string): Promise<ContainerInfo>;
  start(chatKey: string, signal?: AbortSignal, containerId?: string): Promise<ContainerInfo>;
  stop(chatKey: string, signal?: AbortSignal, containerId?: string): Promise<void>;
  startResource(containerId: string, signal?: AbortSignal): Promise<ContainerInfo>;
  stopResource(containerId: string): Promise<void>;
  workspace(chatKey: string, containerId?: string): string;
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
    containerId?: string,
  ): Promise<ContainerExecResult>;
}
export interface ContainerSessionService {
  available(chatKey: string): boolean;
  command(
    chatKey: string,
    argv: string[],
    signal?: AbortSignal,
    stdin?: string,
    containerId?: string,
  ): Promise<ContainerExecResult>;
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
