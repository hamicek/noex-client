// ── Main ─────────────────────────────────────────────────────────

export { NoexClient } from './client.js';

// ── Config ───────────────────────────────────────────────────────

export type { ClientOptions, ReconnectOptions } from './config.js';

// ── Types ────────────────────────────────────────────────────────

export type {
  ConnectionState,
  Unsubscribe,
  WelcomeInfo,
  WebSocketLike,
  WebSocketConstructor,
} from './types.js';

// ── Errors ───────────────────────────────────────────────────────

export { NoexClientError, TimeoutError, DisconnectedError } from './errors.js';
