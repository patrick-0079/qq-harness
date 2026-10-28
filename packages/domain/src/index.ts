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
  MemoryDraft,
  MemoryConsolidationStatus,
  MemoryTier,
} from '@qq-harness/contracts';

export interface ConfigService {
  initialOperations?(): unknown;
  get(): HarnessConfig;
  public(): PublicConfig;
  effective(chatKey: string): ChatSettings;
  patch(patch: unknown): void;
  saveProfile(chatKey: string, patch: unknown): void;
  clearProfile(chatKey: string): void;
  restoreProfile(chatKey: string, section: string): void;
  saveMemorySchedule(chatKey: string | undefined, patch: unknown | null): void;
}
export const configService = service<ConfigService>('harness.config');
export interface SystemControlService {
  get(): import('@qq-harness/contracts').SystemPresence;
  change(input: unknown, source: string, actor: string): import('@qq-harness/contracts').SystemPresence;
  assertBusiness(): void;
  authorized(message: IncomingMessage): boolean;
  issue(message: IncomingMessage): string;
  grantReply(run: RunContext, ticket: string, text: string): Disposer;
  isReply(run: RunContext, chatKey: string, text: string, payload?: unknown): boolean;
  replyId(id: string, chatKey: string, text: string): boolean;
  bindSignal(run: RunContext, signal: AbortSignal): Disposer;
  controlSignal(signal: AbortSignal | undefined, chatKey: string): boolean;
  historical(chatKey: string, localId: number): boolean;
  log(entry: Omit<import('@qq-harness/contracts').OperationLog, 'id' | 'at'>): void;
  logs(): import('@qq-harness/contracts').OperationLog[];
}
export const systemControlService = service<SystemControlService>('harness.system-control');
export const operationsIngressService = service<{ handle(message: IncomingMessage): Promise<void> }>(
  'harness.operations.ingress',
);
export interface StorageService {
  queryMessages?(
    chatKeys: string[],
    query: {
      page: number;
      pageSize: number;
      query?: string;
      senderId?: string;
      from?: number;
      to?: number;
    },
  ): import('@qq-harness/contracts').PageResult<StoredMessage>;
  queryArchives?(
    chatKeys: string[] | undefined,
    query: {
      page: number;
      pageSize: number;
      query?: string;
      status?: string;
      from?: number;
      to?: number;
    },
  ): import('@qq-harness/contracts').PageResult<Archive>;
  messageMetrics?(chatKeys: string[]): {
    received: number;
    sent: number;
    triggered: number | null;
    daily: { day: string; received: number; sent: number }[];
  };
  append(message: IncomingMessage, self?: boolean): StoredMessage;
  updateMessage?(
    chatKey: string,
    localId: number,
    patch: { text?: string; metadata?: Record<string, unknown> },
  ): StoredMessage;
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
export interface TraceService {
  start(id: string, chatKey: string): void;
  record(
    id: string,
    kind: import('@qq-harness/contracts').TraceKind,
    title: string,
    data?: unknown,
    details?: Partial<import('@qq-harness/contracts').RunTraceEvent>,
  ): string;
  end(id: string, status: string): void;
  get(id: string): import('@qq-harness/contracts').RunDetail | undefined;
}
export const traceService = service<TraceService>('harness.traces');
export interface MediaService {
  refresh(
    chatKey: string,
    localId: number,
    signal?: AbortSignal,
  ): Promise<import('@qq-harness/contracts').MessageMediaRef[]>;
  video(
    chatKey: string,
    localId: number,
    frames: number | undefined,
    signal?: AbortSignal,
  ): Promise<import('@qq-harness/contracts').ContentPart[]>;
  references(chatKey: string, localId: number): import('@qq-harness/contracts').MessageMediaRef[];
  image(
    chatKey: string,
    localId: number,
    index: number,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mime: string }>;
  fetchImage(
    reference: string,
    signal?: AbortSignal,
    options?: { browseLocked?: boolean; maxBytes?: number },
  ): Promise<{ bytes: Uint8Array; mime: string }>;
}
export const mediaService = service<MediaService>('harness.media');
export interface VideoFramesService {
  available(chatKey: string, signal: AbortSignal): Promise<boolean>;
  extract(
    chatKey: string,
    input: { filePath: string; count: number; durationSec?: number },
    signal: AbortSignal,
  ): Promise<{ frames: string[]; times?: number[]; error?: string }>;
}
export const videoFramesService = service<VideoFramesService>('harness.video-frames');
export interface WebService {
  search(query: string, signal: AbortSignal): Promise<unknown>;
  fetch(url: string, signal: AbortSignal, browseLocked?: boolean): Promise<unknown>;
  images(query: string, limit: number, signal: AbortSignal): Promise<unknown>;
}
export const webService = service<WebService>('harness.web');
export interface HttpProxySettings {
  url: string;
  mode: 'always' | 'fallback';
  username?: string;
  password?: string;
  bypass: string[];
  directTimeoutMs: number;
  webFetch?: boolean;
}
export const networkProxyService = service<{
  get(chatKey?: string): HttpProxySettings | undefined;
}>('harness.network.proxy');
export interface RenderSurface {
  load(html: string): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  resize(width: number, height: number): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface HtmlRenderer {
  create(
    options: { width: number; height: number; background?: string },
    signal?: AbortSignal,
  ): Promise<RenderSurface>;
  status(): { pages: number; browser: boolean };
}
export const htmlRendererService = service<HtmlRenderer>('harness.html-renderer');

// Records are authoritative. Search indexes contain only rebuildable projections.
export interface MemoryRepository {
  transaction<T>(write: () => T): T;
  control(): unknown;
  saveControl(value: unknown): void;
  records(): MemoryRecord[];
  candidates(chatKey: string, personIds: string[]): MemoryRecord[];
  record(id: string): MemoryRecord | undefined;
  saveRecord(record: MemoryRecord, expectedRevision?: number): MemoryRecord;
  history(id: string): MemoryRevision[];
  notes(chatKey: string, includeArchived?: boolean): ScratchpadNote[];
  note(id: string): ScratchpadNote | undefined;
  noteHistory(id: string): ScratchpadNote[];
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
  update(id: string, patch: Partial<MemoryRecord>, expectedRevision?: number): MemoryDraft;
  publish(id: string, patch: Partial<MemoryRecord>, expectedRevision?: number): MemoryRecord;
  drafts(chatKey: string): MemoryDraft[];
  cancelDraft(chatKey: string, id: string): void;
  publishDrafts(chatKey: string): void;
  factCurrent(record: MemoryRecord): boolean;
  consolidation(chatKey: string): MemoryConsolidationStatus;
  /** Returns a durable memory request ID; query memoryAgentService for completion. */
  consolidate(chatKey: string, tier?: MemoryTier): string;
  remove(id: string, expectedRevision?: number): MemoryRecord;
  list(chatKey: string, personId?: string): MemoryRecord[];
  listHistory(chatKey: string): MemoryRecord[];
  note(chatKey: string, text: string, sourceIds?: number[], ttlMs?: number): ScratchpadNote;
  updateNote(
    chatKey: string,
    id: string,
    patch: {
      text?: string;
      important?: boolean;
      sourceIds?: number[];
      ttlMs?: number;
    },
  ): ScratchpadNote;
  deleteNote(chatKey: string, id: string): void;
  notes(chatKey: string, includeArchived?: boolean): ScratchpadNote[];
  noteHistory(chatKey: string, id: string): ScratchpadNote[];
  history(id: string, chatKey: string): MemoryRevision[];
  indexStatus(): {
    provider: string;
    ready: boolean;
    pending: number;
    error?: string;
  };
}
export const memoryService = service<MemoryService>('harness.memory');
export const memoryAgentService =
  service<import('@qq-harness/contracts').MemoryAgentService>('harness.memory.agent');
export interface MemberImpression {
  id: string;
  userId: string;
  target: string;
  content: string;
  tier: MemoryTier;
  revision: number;
}
export interface MemberMemoryService {
  query(chatKey: string, userId?: string): MemberImpression[];
  append(
    chatKey: string,
    input: { userId: string; target?: string; content: string },
  ): MemoryRecord | import('@qq-harness/contracts').MemoryRequest;
  remove(
    chatKey: string,
    selector: { userId?: string; target?: string; content?: string },
  ): number | import('@qq-harness/contracts').MemoryRequest;
}
export const memberMemoryService = service<MemberMemoryService>('harness.memory.members');
export interface AccessService {
  withinBoundary?(chatKey: string, senderId?: string): boolean;
  assert(chatKey: string, senderId?: string): void;
  allowed(chatKey: string, senderId?: string): boolean;
}
export const accessService = service<AccessService>('harness.access');
export interface AdapterService {
  kind: string;
  identity?(): { id: string; name?: string };
  connected(): boolean;
  subscribe(handler: (message: IncomingMessage) => void): Disposer;
  subscribeEvents?(handler: (event: Record<string, unknown>) => void): Disposer;
  injectEvent?(event: Record<string, unknown>): void;
  send(chatKey: string, text: string, signal: AbortSignal): Promise<{ id: string }>;
  sendPayload?(chatKey: string, payload: OutboundPayload, signal: AbortSignal): Promise<{ id: string }>;
  query(action: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  inject?(message: IncomingMessage): void;
  sent?: { chatKey: string; text: string }[];
}
export type MessageSegment = { type: string; data: Record<string, unknown> };
export function replySegments(
  storage: Pick<StorageService, 'messages'>,
  chatKey: string,
  args: { replyToMessageId?: string; atUserId?: string },
): MessageSegment[] {
  if (args.replyToMessageId && args.atUserId) throw new Error('引用与 @ 请二选一');
  if (args.atUserId && !chatKey.startsWith('group:')) throw new Error('私聊不能 @ 群成员');
  const reply =
    args.replyToMessageId &&
    storage
      .messages(chatKey)
      .find((m) => m.id === args.replyToMessageId || String(m.localId) === args.replyToMessageId);
  if (args.replyToMessageId && !reply) throw new Error('引用消息不属于当前会话');
  return [
    ...(reply ? [{ type: 'reply', data: { id: reply.id } }] : []),
    ...(args.atUserId ? [{ type: 'at', data: { qq: args.atUserId } }] : []),
  ];
}
export const imageContent = (
  bytes: Uint8Array,
  mime: string,
): import('@qq-harness/contracts').ContentPart => ({
  type: 'image_url',
  image_url: {
    url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
  },
});
export type OutboundPayload =
  | { segments: MessageSegment[] }
  | { file: string; name: string }
  | { poke: string }
  | { profileImage: string }
  | { typing: { eventType: 1 | 3 } }
  | { reaction: { messageId: string; emojiId: string; set: boolean } };
export function isChatDelivery(payload?: OutboundPayload) {
  return !payload || !('profileImage' in payload || 'typing' in payload || 'reaction' in payload);
}
export const adapterService = service<AdapterService>('harness.adapter');
export interface OutboundResult {
  id: string;
  duplicate?: boolean;
  warning?: string;
  ids?: string[];
  sentCount?: number;
  failedParts?: { index: number; text: string; error: string }[];
}
export interface OutboundService {
  openReplyBudget?(
    run: RunContext,
    limit: number,
  ): { limit: number; used(): number; exceeded(): boolean; release(): void };
  send(run: RunContext, chatKey: string, text: string): Promise<OutboundResult>;
  sendPayload(
    run: RunContext,
    chatKey: string,
    text: string,
    payload: OutboundPayload,
  ): Promise<OutboundResult>;
}
export const outboundService = service<OutboundService>('harness.outbound');
export interface StickerService {
  list(query?: string, limit?: number): unknown;
  find(id: string): Promise<Record<string, any> | undefined>;
  note(id: string, patch: unknown): unknown;
  refresh(): Promise<unknown>;
  entries(): readonly Record<string, any>[];
  localPath(reference: string): string | null;
}
export const stickerService = service<StickerService>('harness.stickers');
export interface OutboundAttempt {
  effect?: 'chat' | 'account' | 'typing' | 'reaction';
  id: string;
  hash: string;
  chatKey: string;
  at: number;
  status: 'pending' | 'delivered' | 'failed' | 'unknown';
  messageId?: string;
  error?: string;
}
export function hasOutboundEffect(
  storage: Pick<StorageService, 'state' | 'messages'>,
  runId: string,
  chatKey: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(runId) || seen.size >= 100) return true;
  seen.add(runId);
  const attempts = storage.state('outbound-attempts', runId),
    children = storage.state('outbound-children', runId);
  return (
    (attempts != null && !Array.isArray(attempts)) ||
    (Array.isArray(attempts) &&
      attempts.some(
        (a: OutboundAttempt) => a.status !== 'failed' && !['typing', 'reaction'].includes(a.effect ?? 'chat'),
      )) ||
    storage.messages(chatKey).some((m) => m.self && m.metadata?.outboundRunId === runId) ||
    (Array.isArray(children) &&
      children.some((child) => hasOutboundEffect(storage, String(child.runId), String(child.chatKey), seen)))
  );
}
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | import('@qq-harness/contracts').ContentPart[] | null;
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
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
export interface ModelResponse {
  finishReason?: string;
  rawUsage?: Record<string, unknown>;
  billing?: {
    providerId: string;
    model: string;
    cost: number | null;
    currency: string;
  };
  message: ModelMessage;
  usage: { input: number; output: number };
  extraUsage?: Record<string, number>;
}
export interface ModelRequest {
  api: HarnessConfig['model'];
  body: Record<string, unknown>;
  accountId?: string;
  context?: {
    chatKey?: string;
    runId?: string;
    auxiliary?: boolean;
    endpointOverride?: boolean;
    thinkingMode?: string;
    [key: string]: unknown;
  };
}
export interface ModelOptions {
  chatKey: string;
  runId?: string;
  round?: number;
  purpose?: 'memory' | 'auxiliary';
  temperature?: number;
  maxTokens?: number;
  toolChoice?: unknown;
  overrides?: Partial<HarnessConfig['model']>;
  thinkingMode?: 'off' | 'auto' | 'on';
  context?: Record<string, unknown>;
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
  complete(
    messages: ModelMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
    options?: ModelOptions,
  ): Promise<ModelResponse>;
}
export const modelService = service<ModelService>('harness.model');
// 只有提供 model.http.headers 扩展点的模型适配器才能声明此能力。
export const modelHttpService = service<{ ready: true }>('harness.model.http');
export interface ToolContext {
  stopRequested?: boolean;
  run: RunContext;
  chatKey: string;
  settings: ChatSettings;
  finish?: {
    mode: 'spoken' | 'silent';
    reason: string;
    activeTopic?: boolean;
    unverified?: boolean;
  };
  finishCorrections?: number;
  sent: number;
  trace(type: string, text: string): void;
}
export interface ToolDefinition {
  hiddenFromModel?: boolean;
  defaultEnabled?: boolean;
  builtinQQ?: boolean;
  displayName?: string;
  category?: string;
  core?: boolean;
  available?(chatKey: string): boolean;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  parse(args: unknown): unknown;
  execute(ctx: ToolContext, args: unknown): Promise<unknown>;
}
export interface ToolService {
  catalog?(chatKey: string): import('@qq-harness/contracts').ToolDescriptor[];
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
  force(chatKey: string, text?: string, signal?: AbortSignal): string;
  queue(): {
    id: string;
    chatKey: string;
    createdAt: number;
    status: string;
    reason?: string;
  }[];
  ingest(message: IncomingMessage): Promise<void>;
  retry(chatKey: string, retryOf?: string): string;
  wake(chatKey: string, options?: { reason?: string; text?: string; signal?: AbortSignal }): string;
  resumePending?(): number;
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
