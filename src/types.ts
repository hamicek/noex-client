// ── Connection ────────────────────────────────────────────────────

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type Unsubscribe = () => void;

export interface WelcomeInfo {
  readonly version: string;
  readonly serverTime: number;
  readonly requiresAuth: boolean;
}

// ── WebSocket abstraction ────────────────────────────────────────

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

// ── Store ─────────────────────────────────────────────────────────

export type StoreRecord = Record<string, unknown>;

export interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}

export interface PaginatedResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly records: (T & RecordMeta)[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}

// ── Transactions ─────────────────────────────────────────────────

export type TransactionOp =
  | { readonly op: 'get'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'insert'; readonly bucket: string; readonly data: Record<string, unknown> }
  | { readonly op: 'update'; readonly bucket: string; readonly key: unknown; readonly data: Record<string, unknown> }
  | { readonly op: 'delete'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'where'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'findOne'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'count'; readonly bucket: string; readonly filter?: Record<string, unknown> };

export interface TransactionResult {
  readonly results: ReadonlyArray<{ readonly index: number; readonly data: unknown }>;
}

// ── Rules ────────────────────────────────────────────────────────

export interface RulesEvent {
  readonly id: string;
  readonly topic: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly source: string;
}

export interface Fact {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly source: string;
  readonly version: number;
}

// ── Auth ─────────────────────────────────────────────────────────

export interface AuthSession {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly expiresAt?: number;
}

// ── Internal ──────────────────────────────────────────────────────

export type SendFn = (type: string, payload: Record<string, unknown>) => Promise<unknown>;

// ── Protocol ─────────────────────────────────────────────────────

export interface ServerMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}
