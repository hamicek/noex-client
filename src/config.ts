import type { WebSocketConstructor } from './types.js';

// ── Reconnect options ────────────────────────────────────────────

export interface ReconnectOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly jitterMs?: number;
}

// ── Client options ───────────────────────────────────────────────

export interface ClientOptions {
  readonly auth?: {
    /** Session token for auto-login (legacy external auth or identity session token). */
    readonly token?: string;
    /** Username/password credentials for built-in identity auto-login. */
    readonly credentials?: {
      readonly username: string;
      readonly password: string;
    };
  };
  readonly reconnect?: boolean | ReconnectOptions;
  readonly requestTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly WebSocket?: WebSocketConstructor;
  readonly heartbeat?: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export const DEFAULT_RECONNECT: Required<ReconnectOptions> = {
  maxRetries: Infinity,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterMs: 500,
};
