import { NoexClientError, TimeoutError } from '../errors.js';
import type { WebSocketTransport } from '../transport/transport.js';

// ── Types ────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  type: string;
}

// ── RequestManager ───────────────────────────────────────────────

export class RequestManager {
  private readonly timeoutMs: number;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;

  constructor(options: { timeoutMs: number }) {
    this.timeoutMs = options.timeoutMs;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  send(transport: WebSocketTransport, type: string, payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`Request ${type} (id=${id}) timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer, type });

      transport.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  /**
   * Handle incoming server message. Returns `true` if the message was
   * a response (result/error) to a pending request, `false` otherwise
   * (push, ping, welcome, system — not our responsibility).
   */
  handleMessage(msg: Record<string, unknown>): boolean {
    const type = msg['type'];

    // Push, ping, welcome, system messages are not request responses
    if (type === 'push' || type === 'ping' || type === 'welcome' || type === 'system') {
      return false;
    }

    const id = msg['id'];
    if (typeof id !== 'number') return false;

    const pending = this.pending.get(id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (type === 'result') {
      pending.resolve(msg['data']);
    } else if (type === 'error') {
      pending.reject(
        new NoexClientError(
          (msg['code'] as string) ?? 'UNKNOWN',
          (msg['message'] as string) ?? 'Unknown server error',
          msg['details'],
        ),
      );
    } else {
      // Unknown response type — reject
      pending.reject(new Error(`Unexpected response type: ${String(type)}`));
    }

    return true;
  }

  rejectAll(reason: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
