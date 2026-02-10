# NoexClient

Main entry point for connecting to a noex-server instance. Manages the WebSocket connection, automatic reconnection, and exposes the `store`, `rules`, and `auth` API namespaces.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';
```

---

## Constructor

```typescript
new NoexClient(url: string, options?: ClientOptions)
```

Creates a new client instance. Does **not** connect automatically — call `connect()` to establish the connection.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | `string` | yes | WebSocket server URL (e.g. `'ws://localhost:3000'`) |
| options | `ClientOptions` | no | Client configuration — see [Configuration](./02-configuration.md) |

If no `WebSocket` constructor is available on `globalThis` (e.g. in Node.js), you must pass one via `options.WebSocket`. Otherwise a runtime error is thrown.

**Example:**

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:3000', {
  auth: { token: 'secret' },
  WebSocket,
});
```

---

## Properties

| Name | Type | Description |
|------|------|-------------|
| url | `string` | Server URL passed to the constructor (readonly) |
| store | `StoreAPI` | Store operations — buckets, queries, subscriptions, transactions |
| rules | `RulesAPI` | Rules engine operations — events, facts, subscriptions |
| auth | `AuthAPI` | Authentication operations — login, logout, whoami |
| state | `ConnectionState` | Current connection state (readonly getter) |
| isConnected | `boolean` | `true` when `state === 'connected'` (readonly getter) |

---

## Lifecycle

### connect()

```typescript
connect(): Promise<WelcomeInfo>
```

Opens the WebSocket connection and waits for the server's welcome message. If `options.auth.token` is set and the server requires authentication, `auth.login(token)` is called automatically before the promise resolves.

**Returns:** `Promise<WelcomeInfo>` — server welcome payload

**Throws:**
- `Error` if the connection times out (governed by `connectTimeoutMs`, default 5 000 ms)
- `Error` if the WebSocket closes during the handshake

**Example:**

```typescript
const welcome = await client.connect();
console.log(welcome.version);     // server version
console.log(welcome.serverTime);  // server timestamp (ms)
console.log(welcome.requiresAuth); // whether auth is required
```

---

### disconnect()

```typescript
disconnect(): Promise<void>
```

Gracefully closes the connection. Cancels any in-flight reconnect loop, rejects all pending requests with `DisconnectedError`, clears all subscriptions, and closes the underlying WebSocket (code `1000`).

**Example:**

```typescript
await client.disconnect();
console.log(client.state); // 'disconnected'
```

---

## Events

### on()

```typescript
on<K extends keyof ClientEventMap>(event: K, handler: ClientEventMap[K]): Unsubscribe
```

Registers an event listener. Returns an unsubscribe function.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| event | `string` | yes | Event name — see table below |
| handler | `function` | yes | Callback matching the event signature |

**Returns:** `Unsubscribe` (`() => void`) — call to remove the listener

**Event Map:**

| Event | Handler Signature | Description |
|-------|-------------------|-------------|
| `connected` | `() => void` | Fired after a successful connection (initial or reconnect) |
| `disconnected` | `(reason: string) => void` | Fired when the connection is lost and no reconnect will follow |
| `reconnecting` | `(attempt: number) => void` | Fired before each reconnect attempt (`attempt` starts at 1) |
| `reconnected` | `() => void` | Fired after a successful reconnect (subscriptions already restored) |
| `error` | `(error: Error) => void` | Fired on transport errors or when max reconnect attempts are exhausted |
| `welcome` | `(info: WelcomeInfo) => void` | Fired when the server welcome message is received |

**Example:**

```typescript
const unsub = client.on('reconnecting', (attempt) => {
  console.log(`Reconnect attempt #${attempt}`);
});

client.on('error', (err) => {
  console.error('Client error:', err.message);
});

// Later — remove the listener
unsub();
```

---

## Connection State Machine

```
                  connect()
disconnected ──────────────► connecting
     ▲                           │
     │                      success / fail
     │                           │
     │  disconnect()         ┌───▼───┐
     ├───────────────────────┤connected│
     │                       └───┬───┘
     │                   connection lost
     │                           │
     │   max retries         ┌───▼────────┐
     ├───────────────────────┤reconnecting │
     │                       └─────────────┘
```

Possible `ConnectionState` values: `'connecting'`, `'connected'`, `'reconnecting'`, `'disconnected'`.

---

## Reconnect Behavior

Automatic reconnection is **enabled by default** (set `reconnect: false` to disable). When the connection drops unexpectedly:

1. State transitions to `'reconnecting'` and `reconnecting` event fires.
2. The client waits for a backoff delay computed by `ReconnectStrategy` (exponential backoff with jitter — see [Configuration](./02-configuration.md#reconnectoptions)).
3. A new WebSocket connection is attempted.
4. On success:
   - If `options.auth.token` is set and the server requires auth, the client re-authenticates automatically.
   - All active subscriptions are restored via the server (`resubscribeAll`). Store subscriptions receive fresh initial data; rules subscriptions are re-registered.
   - `connected`, `reconnected`, and `welcome` events fire.
5. On failure: `attempt` increments and the loop continues from step 1.
6. If `maxRetries` is reached, state transitions to `'disconnected'` and both `disconnected` and `error` events fire.

Calling `disconnect()` at any point cancels the reconnect loop immediately.

---

## See Also

- [Configuration](./02-configuration.md) — ClientOptions, ReconnectOptions, default values
- [Store API](./03-store-api.md) — `client.store` methods
- [Rules API](./06-rules-api.md) — `client.rules` methods
- [Auth API](./07-auth-api.md) — `client.auth` methods
- [Transport](./08-transport.md) — WebSocket transport internals and heartbeat
- [Types](./09-types.md) — ConnectionState, WelcomeInfo, Unsubscribe
- [Errors](./10-errors.md) — DisconnectedError, TimeoutError
