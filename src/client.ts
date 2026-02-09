import type { ClientOptions } from './config.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } from './config.js';
import { DisconnectedError } from './errors.js';
import { RequestManager } from './protocol/request-manager.js';
import { WebSocketTransport } from './transport/transport.js';
import type { ConnectionState, Unsubscribe, WelcomeInfo, WebSocketConstructor } from './types.js';

// ── Event map ────────────────────────────────────────────────────

interface ClientEventMap {
  connected: () => void;
  disconnected: (reason: string) => void;
  error: (error: Error) => void;
  welcome: (info: WelcomeInfo) => void;
}

// ── NoexClient ───────────────────────────────────────────────────

export class NoexClient {
  /** @internal Stored for reconnect logic. */
  readonly url: string;
  private readonly options: ClientOptions;
  private readonly transport: WebSocketTransport;
  private readonly requestManager: RequestManager;
  private _state: ConnectionState = 'disconnected';
  private listeners = new Map<string, Set<(...args: never[]) => void>>();
  private intentionalDisconnect = false;

  constructor(url: string, options: ClientOptions = {}) {
    this.url = url;
    this.options = options;

    const WS = resolveWebSocket(options.WebSocket);

    this.transport = new WebSocketTransport(url, {
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      WebSocket: WS,
      heartbeat: options.heartbeat !== false,
    });

    this.requestManager = new RequestManager({
      timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });

    this.setupTransportListeners();
  }

  // ── State ────────────────────────────────────────────────────

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(): Promise<WelcomeInfo> {
    this.intentionalDisconnect = false;
    this._state = 'connecting';

    // Register welcome listener BEFORE connecting — the server sends
    // the welcome message immediately upon WebSocket open.
    const welcomePromise = this.waitForWelcome();

    try {
      await this.transport.connect();
    } catch (err) {
      this._state = 'disconnected';
      throw err;
    }

    let welcome: WelcomeInfo;
    try {
      welcome = await welcomePromise;
    } catch (err) {
      this._state = 'disconnected';
      throw err;
    }

    this._state = 'connected';
    this.emit('connected');
    this.emit('welcome', welcome);

    return welcome;
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.requestManager.rejectAll(new DisconnectedError('Client disconnecting'));
    await this.transport.disconnect();
    this._state = 'disconnected';
  }

  // ── Request sending (internal, will be used by API layers) ──

  /** Send a typed request and wait for the response. */
  request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this._state !== 'connected') {
      throw new DisconnectedError(`Cannot send request — client is ${this._state}`);
    }
    return this.requestManager.send(this.transport, type, payload);
  }

  // ── Events ───────────────────────────────────────────────────

  on<K extends keyof ClientEventMap>(event: K, handler: ClientEventMap[K]): Unsubscribe {
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

  private emit<K extends keyof ClientEventMap>(
    event: K,
    ...args: Parameters<ClientEventMap[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  private setupTransportListeners(): void {
    this.transport.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return; // Ignore malformed JSON
      }
      this.handleMessage(msg);
    });

    this.transport.on('close', (_code, reason) => {
      if (!this.intentionalDisconnect) {
        this.requestManager.rejectAll(
          new DisconnectedError('Connection lost'),
        );
      }
      this._state = 'disconnected';
      this.emit('disconnected', reason);
    });

    this.transport.on('error', (error) => {
      this.emit('error', error);
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Let RequestManager try to correlate as a request response
    if (this.requestManager.handleMessage(msg)) {
      return;
    }

    // Welcome messages are handled by waitForWelcome via its own listener,
    // so we don't need special handling here. Push and system messages
    // will be handled in later iterations (SubscriptionManager, etc.).
  }

  private waitForWelcome(): Promise<WelcomeInfo> {
    return new Promise<WelcomeInfo>((resolve, reject) => {
      const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for welcome message after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = this.transport.on('message', (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }

        if (msg['type'] === 'welcome') {
          clearTimeout(timer);
          unsub();
          resolve({
            version: msg['version'] as string,
            serverTime: msg['serverTime'] as number,
            requiresAuth: msg['requiresAuth'] as boolean,
          });
        }
      });
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function resolveWebSocket(provided?: WebSocketConstructor): WebSocketConstructor {
  if (provided) return provided;
  if (typeof globalThis !== 'undefined' && globalThis.WebSocket) {
    return globalThis.WebSocket as unknown as WebSocketConstructor;
  }
  throw new Error(
    'No WebSocket implementation found. ' +
    'In Node.js, pass the `ws` package via options: new NoexClient(url, { WebSocket: require("ws") })',
  );
}
