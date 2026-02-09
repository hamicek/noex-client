import type { Unsubscribe, WebSocketConstructor, WebSocketLike } from '../types.js';
import type { TransportState } from './types.js';

// ── Event handler types ──────────────────────────────────────────

interface TransportEventMap {
  open: () => void;
  close: (code: number, reason: string) => void;
  message: (data: string) => void;
  error: (error: Error) => void;
}

// ── Transport options ────────────────────────────────────────────

export interface TransportOptions {
  readonly connectTimeoutMs: number;
  readonly WebSocket: WebSocketConstructor;
  readonly heartbeat: boolean;
}

// ── WebSocketTransport ───────────────────────────────────────────

export class WebSocketTransport {
  private readonly url: string;
  private readonly options: TransportOptions;
  private ws: WebSocketLike | null = null;
  private _state: TransportState = 'idle';
  private listeners = new Map<string, Set<(...args: never[]) => void>>();

  constructor(url: string, options: TransportOptions) {
    this.url = url;
    this.options = options;
  }

  // ── State ────────────────────────────────────────────────────

  get state(): TransportState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  // ── Lifecycle ────────────────────────────────────────────────

  connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') {
      return Promise.resolve();
    }

    this._state = 'connecting';

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.closeSocket();
        this._state = 'disconnected';
        reject(new Error(`Connect timeout after ${this.options.connectTimeoutMs}ms`));
      }, this.options.connectTimeoutMs);

      const ws = new this.options.WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        clearTimeout(timer);
        this._state = 'connected';
        this.emit('open');
        resolve();
      };

      ws.onclose = (event: unknown) => {
        clearTimeout(timer);
        const { code, reason } = parseCloseEvent(event);
        if (this._state === 'connecting') {
          this._state = 'disconnected';
          reject(new Error(`WebSocket closed during connect: ${code} ${reason}`));
        } else {
          this._state = 'disconnected';
          this.emit('close', code, reason);
        }
        this.ws = null;
      };

      ws.onmessage = (event: unknown) => {
        const data = parseMessageEvent(event);
        if (this.options.heartbeat && this.handlePingPong(data)) {
          return;
        }
        this.emit('message', data);
      };

      ws.onerror = (_event: unknown) => {
        this.emit('error', new Error('WebSocket error'));
      };
    });
  }

  disconnect(code: number = 1000, reason: string = 'Client disconnect'): Promise<void> {
    if (this._state === 'disconnected' || this._state === 'idle') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const ws = this.ws;
      if (!ws) {
        this._state = 'disconnected';
        resolve();
        return;
      }

      ws.onclose = (event: unknown) => {
        const { code: c, reason: r } = parseCloseEvent(event);
        this._state = 'disconnected';
        this.ws = null;
        this.emit('close', c, r);
        resolve();
      };

      // If already closed, resolve immediately
      if (ws.readyState === 3 /* CLOSED */) {
        this._state = 'disconnected';
        this.ws = null;
        resolve();
        return;
      }

      ws.close(code, reason);
    });
  }

  // ── Communication ────────────────────────────────────────────

  send(data: string): void {
    if (!this.ws || this._state !== 'connected') {
      throw new Error('Cannot send — transport is not connected');
    }
    this.ws.send(data);
  }

  // ── Events ───────────────────────────────────────────────────

  on<K extends keyof TransportEventMap>(event: K, handler: TransportEventMap[K]): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (...args: never[]) => void);
    return () => {
      set!.delete(handler as (...args: never[]) => void);
    };
  }

  // ── Private ──────────────────────────────────────────────────

  private emit<K extends keyof TransportEventMap>(
    event: K,
    ...args: Parameters<TransportEventMap[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  private handlePingPong(raw: string): boolean {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false;
    }

    if (msg['type'] === 'ping' && typeof msg['timestamp'] === 'number') {
      this.send(JSON.stringify({ type: 'pong', timestamp: msg['timestamp'] }));
      return true;
    }
    return false;
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function parseCloseEvent(event: unknown): { code: number; reason: string } {
  if (event && typeof event === 'object') {
    const e = event as Record<string, unknown>;
    return {
      code: typeof e['code'] === 'number' ? e['code'] : 1006,
      reason: typeof e['reason'] === 'string' ? e['reason'] : '',
    };
  }
  return { code: 1006, reason: '' };
}

function parseMessageEvent(event: unknown): string {
  if (typeof event === 'string') return event;
  if (event && typeof event === 'object') {
    const e = event as Record<string, unknown>;
    if (typeof e['data'] === 'string') return e['data'];
    if (e['data'] instanceof Buffer) return (e['data'] as Buffer).toString('utf-8');
    // Handle ArrayBuffer / Blob-like
    if (e['data'] != null) return String(e['data']);
  }
  return String(event);
}
