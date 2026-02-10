import type { ReconnectOptions } from '../config.js';
import { DEFAULT_RECONNECT } from '../config.js';

export class ReconnectStrategy {
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly jitterMs: number;

  constructor(options?: ReconnectOptions) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_RECONNECT.maxRetries;
    this.initialDelayMs = options?.initialDelayMs ?? DEFAULT_RECONNECT.initialDelayMs;
    this.maxDelayMs = options?.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs;
    this.backoffMultiplier = options?.backoffMultiplier ?? DEFAULT_RECONNECT.backoffMultiplier;
    this.jitterMs = options?.jitterMs ?? DEFAULT_RECONNECT.jitterMs;
  }

  getDelay(attempt: number): number | null {
    if (attempt >= this.maxRetries) return null;

    const base = this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt);
    const capped = Math.min(base, this.maxDelayMs);
    const jitter = Math.random() * this.jitterMs;

    return capped + jitter;
  }
}
