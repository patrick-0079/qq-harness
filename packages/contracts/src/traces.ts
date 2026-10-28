export type TraceKind =
  | 'trigger'
  | 'context'
  | 'model.request'
  | 'model.response'
  | 'model.retry'
  | 'tool.call'
  | 'tool.result'
  | 'outbound'
  | 'finish'
  | 'error';
export interface RunTraceEvent {
  id: string;
  sequence: number;
  kind: TraceKind;
  title: string;
  at: number;
  durationMs?: number;
  parentId?: string;
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
  data?: unknown;
}
export interface RunDetail {
  version: 1;
  id: string;
  chatKey: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  expiresAt: number;
  events: RunTraceEvent[];
  error?: string;
}
