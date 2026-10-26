import { service, type Disposer, type PluginContext, type RunContext } from '@qq-harness/plugin-sdk';
export * from './containers.js';
import type {
  Archive,
  ChatSettings,
  ChatSummary,
  HarnessConfig,
  IncomingMessage,
  PublicConfig,
  StoredMessage,
  MemoryRecord,
  MemoryRevision,
  MemoryIndexEvent,
  ScratchpadNote,
} from '@qq-harness/contracts';

export interface ConfigService {
  get(): HarnessConfig;
  public(): PublicConfig;
  effective(chatKey: string): ChatSettings;
  patch(patch: unknown): void;
  saveProfile(chatKey: string, patch: unknown): void;
  clearProfile(chatKey: string): void;
}
export const configService = service<ConfigService>('harness.config');
export interface StorageService {
  append(message: IncomingMessage, self?: boolean): StoredMessage;
  messages(chatKey: string): StoredMessage[];
  recent(chatKey: string, limit: number, since: number, senderId?: string): StoredMessage[];
  messagesAfter(chatKey: string, afterLocalId: number, limit: number): StoredMessage[];
  hasSender(chatKey: string, senderId: string): boolean;
  unread(chatKey: string): StoredMessage[];
  markRead(chatKey: string, ids: number[], read?: boolean): void;
  chats(): ChatSummary[];
  archive(archive: Archive): void;
  archives(chatKey?: string): Archive[];
  memory(chatKey: string): string;
  setMemory(chatKey: string, content: string): void;
  state(namespace: string, key: string): unknown;
  setState(namespace: string, key: string, value: unknown): void;
}
export const storageService = service<StorageService>('harness.storage');

// Records are authoritative. Search indexes contain only rebuildable projections.
export interface MemoryRepository {
  records(): MemoryRecord[];
  candidates(chatKey: string, personIds: string[]): MemoryRecord[];
  record(id: string): MemoryRecord | undefined;
  saveRecord(record: MemoryRecord, expectedRevision?: number): MemoryRecord;
  history(id: string): MemoryRevision[];
  notes(chatKey: string): ScratchpadNote[];
  note(id: string): ScratchpadNote | undefined;
  saveNote(note: ScratchpadNote, expectedRevision?: number): ScratchpadNote;
  deleteNote(id: string): void;
  expireNotes(now: number): number;
  cursor(chatKey: string): number;
  setCursor(chatKey: string, localId: number): void;
  indexEvents(after: number, limit: number): MemoryIndexEvent[];
  latestIndexSequence(): number;
  indexCheckpoint(providerId: string): number;
  setIndexCheckpoint(providerId: string, sequence: number): void;
}
export const memoryRepository = service<MemoryRepository>('harness.memory.repository');

export interface IndexableMemory {
  id: string;
  revision: number;
  text: string;
  scope: MemoryRecord['scope'];
  tier: MemoryRecord['tier'];
  chatKey: string | null;
  personId: string | null;
  visibility: MemoryRecord['visibility'];
  sensitive: boolean;
}
export interface MemoryIndex {
  readonly id: string;
  upsert(record: IndexableMemory): Promise<void>;
  remove(id: string, revision: number): Promise<void>;
  search(
    query: string,
    hints: { chatKey: string; personIds: string[]; allowedIds: string[] },
    limit: number,
  ): Promise<{ id: string; relevance: number }[]>;
  rebuild(records: IndexableMemory[]): Promise<void>;
  health(): { ready: boolean; error?: string };
}
export const memoryIndex = service<MemoryIndex>('harness.memory.index');

// A future vector index may depend on this token without changing MemoryService.
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
export const embeddingProvider = service<EmbeddingProvider>('harness.memory.embedding');

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
}
export interface MemoryService {
  search(chatKey: string, query: string, personId?: string, limit?: number): Promise<MemorySearchResult[]>;
  remember(
    input: Omit<MemoryRecord, 'id' | 'revision' | 'createdAt' | 'updatedAt' | 'lastConfirmedAt' | 'status'>,
  ): MemoryRecord;
  update(id: string, patch: Partial<MemoryRecord>, expectedRevision?: number): MemoryRecord;
  remove(id: string, expectedRevision?: number): MemoryRecord;
  list(chatKey: string, personId?: string): MemoryRecord[];
  note(chatKey: string, text: string, sourceIds?: number[], ttlMs?: number): ScratchpadNote;
  updateNote(
    chatKey: string,
    id: string,
    patch: { text?: string; important?: boolean; sourceIds?: number[]; ttlMs?: number },
  ): ScratchpadNote;
  deleteNote(chatKey: string, id: string): void;
  notes(chatKey: string): ScratchpadNote[];
  history(id: string, chatKey: string): MemoryRevision[];
  indexStatus(): { provider: string; ready: boolean; pending: number; error?: string };
}
export const memoryService = service<MemoryService>('harness.memory');
export interface AccessService {
  assert(chatKey: string, senderId?: string): void;
  allowed(chatKey: string, senderId?: string): boolean;
}
export const accessService = service<AccessService>('harness.access');
export interface AdapterService {
  kind: string;
  connected(): boolean;
  subscribe(handler: (message: IncomingMessage) => void): Disposer;
  send(chatKey: string, text: string, signal: AbortSignal): Promise<{ id: string }>;
  sendPayload?(chatKey: string, payload: OutboundPayload, signal: AbortSignal): Promise<{ id: string }>;
  query(action: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  inject?(message: IncomingMessage): void;
  sent?: { chatKey: string; text: string }[];
}
export type MessageSegment = { type: string; data: Record<string, unknown> };
export type OutboundPayload = { segments: MessageSegment[] } | { file: string; name: string };
export const adapterService = service<AdapterService>('harness.adapter');
export interface OutboundService {
  send(run: RunContext, chatKey: string, text: string): Promise<{ id: string; duplicate?: boolean }>;
  sendPayload(
    run: RunContext,
    chatKey: string,
    text: string,
    payload: OutboundPayload,
  ): Promise<{ id: string; duplicate?: boolean }>;
}
export const outboundService = service<OutboundService>('harness.outbound');
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ModelResponse {
  message: ModelMessage;
  usage: { input: number; output: number };
  extraUsage?: Record<string, number>;
}
export interface ModelRequest {
  api: HarnessConfig['model'];
  body: Record<string, unknown>;
  accountId?: string;
}
export interface ModelMiddleware {
  request(input: ModelRequest): Promise<ModelRequest>;
  response(
    result: ModelResponse,
    rawUsage: Record<string, unknown>,
    input: ModelRequest,
  ): Promise<ModelResponse>;
  retry(input: ModelRequest, status: number, errorText: string): Promise<Record<string, unknown> | undefined>;
  feedback(input: ModelRequest, result: { ok: boolean; status: number }): void;
}
export const modelMiddleware = service<ModelMiddleware>('harness.model.middleware');
export interface ModelService {
  complete(messages: ModelMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<ModelResponse>;
}
export const modelService = service<ModelService>('harness.model');
export interface ToolContext {
  run: RunContext;
  chatKey: string;
  settings: ChatSettings;
  finish?: { mode: 'spoken' | 'silent'; reason: string };
  sent: number;
  trace(type: string, text: string): void;
}
export interface ToolDefinition {
  available?(chatKey: string): boolean;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  parse(args: unknown): unknown;
  execute(ctx: ToolContext, args: unknown): Promise<unknown>;
}
export interface ToolService {
  unregister(name: string, owner: PluginContext): void;
  register(ctx: PluginContext, tool: ToolDefinition): void;
  list(chatKey: string): ToolSpec[];
  execute(context: ToolContext, name: string, args: string): Promise<unknown>;
}
export const toolService = service<ToolService>('harness.tools');
export interface ToolPolicy {
  allowed(tool: ToolDefinition, chatKey: string): boolean;
}
export const toolPolicy = service<ToolPolicy>('harness.tools.policy');
export interface ConversationService {
  ingest(message: IncomingMessage): Promise<void>;
  retry(chatKey: string): string;
}
export const conversationService = service<ConversationService>('harness.conversation');
export interface HttpService {
  register(prefix: string, handler: (request: Request) => Response | Promise<Response>): Disposer;
}
export const httpService = service<HttpService>('harness.http');
export interface Reminder {
  id: string;
  chatKey: string;
  text: string;
  dueAt: number;
}
export interface ReminderService {
  list(): Reminder[];
  add(reminder: Omit<Reminder, 'id'>): Reminder;
  remove(id: string): void;
}
export const reminderService = service<ReminderService>('harness.reminders');
