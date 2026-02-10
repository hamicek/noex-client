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

export interface PaginatedResult {
  readonly records: StoreRecord[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}

// ── Internal ──────────────────────────────────────────────────────

export type SendFn = (type: string, payload: Record<string, unknown>) => Promise<unknown>;

// ── Protocol ─────────────────────────────────────────────────────

export interface ServerMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}
