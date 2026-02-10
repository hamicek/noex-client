// ── Main ─────────────────────────────────────────────────────────

export { NoexClient } from './client.js';

// ── API ──────────────────────────────────────────────────────────

export { StoreAPI } from './api/store.js';
export { BucketAPI } from './api/bucket.js';

// ── Config ───────────────────────────────────────────────────────

export type { ClientOptions, ReconnectOptions } from './config.js';

// ── Types ────────────────────────────────────────────────────────

export type {
  ConnectionState,
  Unsubscribe,
  WelcomeInfo,
  WebSocketLike,
  WebSocketConstructor,
  StoreRecord,
  PaginatedResult,
} from './types.js';

// ── Errors ───────────────────────────────────────────────────────

export { NoexClientError, TimeoutError, DisconnectedError } from './errors.js';
