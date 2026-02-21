import { AuditAPI } from './api/audit.js';
import { AuthAPI } from './api/auth.js';
import { IdentityAPI } from './api/identity.js';
import { LogicAPI } from './api/logic.js';
import { ProceduresAPI } from './api/procedures.js';
import { RulesAPI } from './api/rules.js';
import { StoreAPI } from './api/store.js';
import type { ClientOptions } from './config.js';
import { DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } from './config.js';
import { DisconnectedError } from './errors.js';
import { PushRouter } from './protocol/push-router.js';
import { RequestManager } from './protocol/request-manager.js';
import { SubscriptionManager } from './subscription/subscription-manager.js';
import { ReconnectStrategy } from './transport/reconnect.js';
import { WebSocketTransport } from './transport/transport.js';
import type { ConnectionState, Unsubscribe, WelcomeInfo, WebSocketConstructor } from './types.js';

// ── Event map ────────────────────────────────────────────────────

interface ClientEventMap {
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number) => void;
  reconnected: () => void;
  error: (error: Error) => void;
  welcome: (info: WelcomeInfo) => void;
  session_revoked: (reason: string) => void;
}

// ── Non-retryable close codes ────────────────────────────────────
// Server-sent close codes that indicate a permanent rejection.
// Reconnecting would just result in the same close, so we skip it.

const NON_RETRYABLE_CLOSE_CODES = new Set([
  1003, // Unsupported Data (binary frame rejection)
  4002, // session_revoked
  4003, // too_many_connections
]);

// ── NoexClient ───────────────────────────────────────────────────

export class NoexClient {
  /** @internal Stored for reconnect logic. */
  readonly url: string;
  readonly store: StoreAPI;
  readonly rules: RulesAPI;
  readonly logic: LogicAPI;
  readonly auth: AuthAPI;
  readonly audit: AuditAPI;
  readonly procedures: ProceduresAPI;
  readonly identity: IdentityAPI;
  private readonly options: ClientOptions;
  private readonly transport: WebSocketTransport;
  private readonly requestManager: RequestManager;
  private readonly subscriptionManager: SubscriptionManager;
  private readonly pushRouter: PushRouter;
  private readonly reconnectStrategy: ReconnectStrategy | null;
  private _state: ConnectionState = 'disconnected';
  private listeners = new Map<string, Set<(...args: never[]) => void>>();
  private intentionalDisconnect = false;
  private reconnecting = false;
  private reconnectAbort: (() => void) | null = null;
  /** Session token saved after credential-based login, used for reconnect. */
  private _sessionToken: string | null = null;

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

    this.subscriptionManager = new SubscriptionManager();

    this.pushRouter = new PushRouter(
      (subscriptionId, _channel, data) => this.subscriptionManager.handlePush(subscriptionId, data),
    );

    this.reconnectStrategy = this.createReconnectStrategy();

    this.store = new StoreAPI(this.request.bind(this), this.subscriptionManager);
    this.rules = new RulesAPI(this.request.bind(this), this.subscriptionManager);
    this.logic = new LogicAPI(this.request.bind(this), this.subscriptionManager);
    this.auth = new AuthAPI(this.request.bind(this));
    this.audit = new AuditAPI(this.request.bind(this));
    this.procedures = new ProceduresAPI(this.request.bind(this));
    this.identity = new IdentityAPI(this.request.bind(this));

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

    let welcome: WelcomeInfo;
    try {
      welcome = await this.performConnect();
    } catch (err) {
      this._state = 'disconnected';
      throw err;
    }

    this._state = 'connected';

    if (welcome.requiresAuth) {
      await this.autoLogin();
    }

    this.emit('connected');
    this.emit('welcome', welcome);

    return welcome;
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.reconnectAbort?.();
    this.reconnectAbort = null;
    this.requestManager.rejectAll(new DisconnectedError('Client disconnecting'));
    this.subscriptionManager.clear();
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

    this.transport.on('close', (code, reason) => {
      if (!this.intentionalDisconnect) {
        this.requestManager.rejectAll(
          new DisconnectedError('Connection lost'),
        );
      }

      if (NON_RETRYABLE_CLOSE_CODES.has(code)) {
        this._state = 'disconnected';
        this.emit('disconnected', reason);
        return;
      }

      if (!this.intentionalDisconnect && this.reconnectStrategy !== null && !this.reconnecting) {
        // Start automatic reconnect loop
        this.reconnecting = true;
        this.handleReconnect().catch(() => {
          // Safety net — all error handling is inside handleReconnect
          this._state = 'disconnected';
          this.reconnecting = false;
        });
      } else if (!this.reconnecting) {
        // No reconnect — final disconnected state
        this._state = 'disconnected';
        this.emit('disconnected', reason);
      }
      // If this.reconnecting === true, the loop is already running.
      // rejectAll above ensures pending requests from the failed attempt are cleaned up.
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

    // Route push messages to subscription callbacks
    if (this.pushRouter.handleMessage(msg)) {
      return;
    }

    // Welcome messages are handled by waitForWelcome via its own listener.

    // Handle system messages
    if (msg['type'] === 'system') {
      this.handleSystemMessage(msg);
    }
  }

  private handleSystemMessage(msg: Record<string, unknown>): void {
    if (msg['event'] === 'session_revoked') {
      const reason = typeof msg['reason'] === 'string'
        ? msg['reason']
        : 'Session revoked by administrator';
      this.intentionalDisconnect = true;
      this.emit('session_revoked', reason);
    }
  }

  private async performConnect(): Promise<WelcomeInfo> {
    const welcomePromise = this.waitForWelcome();
    try {
      await this.transport.connect();
    } catch (err) {
      // Suppress unhandled rejection from the orphaned welcome timeout
      welcomePromise.catch(() => {});
      throw err;
    }
    return welcomePromise;
  }

  // ── Auto-login ──────────────────────────────────────────────

  private async autoLogin(): Promise<void> {
    // 1. If we have a saved session token from a previous credential login, try it first
    if (this._sessionToken !== null) {
      try {
        await this.auth.login(this._sessionToken);
        return;
      } catch {
        // Session expired or invalid — fall through to credential login
        this._sessionToken = null;
      }
    }

    // 2. Static token from options (legacy external auth)
    if (this.options.auth?.token) {
      await this.auth.login(this.options.auth.token);
      return;
    }

    // 3. Credential-based login (built-in identity)
    if (this.options.auth?.credentials) {
      const { username, password } = this.options.auth.credentials;
      const result = await this.identity.login(username, password);
      this._sessionToken = result.token;
    }
  }

  // ── Reconnect ────────────────────────────────────────────────

  private async handleReconnect(): Promise<void> {
    this._state = 'reconnecting';
    let attempt = 0;

    while (!this.intentionalDisconnect) {
      const delay = this.reconnectStrategy!.getDelay(attempt);
      if (delay === null) {
        // Max retries exhausted
        this._state = 'disconnected';
        this.reconnecting = false;
        this.emit('disconnected', 'Max reconnect attempts reached');
        this.emit('error', new Error('Max reconnect attempts reached'));
        return;
      }

      this.emit('reconnecting', attempt + 1);
      await this.sleepWithAbort(delay);

      if (this.intentionalDisconnect) break;

      try {
        const welcome = await this.performConnect();
        if (this.intentionalDisconnect) break;

        this._state = 'connected';

        // Re-authenticate if the server requires auth
        if (welcome.requiresAuth) {
          await this.autoLogin();
        }
        if (this.intentionalDisconnect) break;

        // Restore all active subscriptions
        await this.subscriptionManager.resubscribeAll(this.request.bind(this));
        if (this.intentionalDisconnect) break;

        this.emit('connected');
        this.emit('reconnected');
        this.emit('welcome', welcome);
        this.reconnecting = false;
        return;
      } catch {
        // Connection attempt or setup failed — retry
        this._state = 'reconnecting';
        attempt++;
      }
    }

    // Reached here because intentionalDisconnect was set
    this._state = 'disconnected';
    this.reconnecting = false;
  }

  private sleepWithAbort(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ms);
      this.reconnectAbort = () => {
        clearTimeout(timer);
        resolve();
      };
    });
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

  private createReconnectStrategy(): ReconnectStrategy | null {
    if (this.options.reconnect === false) return null;
    const opts = typeof this.options.reconnect === 'object' ? this.options.reconnect : undefined;
    return new ReconnectStrategy(opts);
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
