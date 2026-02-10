# Configuration

Client configuration options and their default values. Configuration is passed as the second argument to the `NoexClient` constructor.

## Import

```typescript
import type { ClientOptions, ReconnectOptions } from '@anthropic/noex-client';
```

---

## ClientOptions

```typescript
interface ClientOptions {
  readonly auth?: {
    readonly token: string;
  };
  readonly reconnect?: boolean | ReconnectOptions;
  readonly requestTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly WebSocket?: WebSocketConstructor;
  readonly heartbeat?: boolean;
}
```

**Fields:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| auth | `{ token: string }` | — | Auto-login credentials. If set and the server requires auth, `auth.login(token)` is called automatically after connection |
| reconnect | `boolean \| ReconnectOptions` | `true` | Automatic reconnection. `true` uses defaults, `false` disables, or pass `ReconnectOptions` for fine-tuning |
| requestTimeoutMs | `number` | `10000` | Timeout for individual requests (ms). A `TimeoutError` is thrown if the server does not respond within this window |
| connectTimeoutMs | `number` | `5000` | Timeout for the initial WebSocket connection and welcome message (ms) |
| WebSocket | `WebSocketConstructor` | `globalThis.WebSocket` | Custom WebSocket constructor. Required in Node.js — pass `ws` package |
| heartbeat | `boolean` | `true` | Automatic heartbeat (pong) responses. Set to `false` to disable |

**Example:**

```typescript
import { NoexClient } from '@anthropic/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:3000', {
  auth: { token: 'my-secret-token' },
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 500,
  },
  requestTimeoutMs: 15_000,
  connectTimeoutMs: 8_000,
  WebSocket,
});
```

---

## ReconnectOptions

```typescript
interface ReconnectOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly jitterMs?: number;
}
```

Fine-grained control over the exponential backoff reconnection strategy.

**Fields:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| maxRetries | `number` | `Infinity` | Maximum number of reconnect attempts before giving up |
| initialDelayMs | `number` | `1000` | Delay before the first reconnect attempt (ms) |
| maxDelayMs | `number` | `30000` | Upper bound for the backoff delay (ms) |
| backoffMultiplier | `number` | `2` | Multiplier applied to the delay after each failed attempt |
| jitterMs | `number` | `500` | Random jitter added to each delay to prevent thundering herd (ms) |

The effective delay for attempt `n` is:

```
delay = min(initialDelayMs * backoffMultiplier^n, maxDelayMs) + random(0, jitterMs)
```

**Example:**

```typescript
const client = new NoexClient('ws://localhost:3000', {
  reconnect: {
    maxRetries: 20,
    initialDelayMs: 500,
    maxDelayMs: 60_000,
    backoffMultiplier: 1.5,
    jitterMs: 200,
  },
});
```

---

## Default Values

Summary of all default values defined in the client:

| Constant | Value | Used by |
|----------|-------|---------|
| `DEFAULT_REQUEST_TIMEOUT_MS` | `10000` | `ClientOptions.requestTimeoutMs` |
| `DEFAULT_CONNECT_TIMEOUT_MS` | `5000` | `ClientOptions.connectTimeoutMs` |
| `DEFAULT_RECONNECT.maxRetries` | `Infinity` | `ReconnectOptions.maxRetries` |
| `DEFAULT_RECONNECT.initialDelayMs` | `1000` | `ReconnectOptions.initialDelayMs` |
| `DEFAULT_RECONNECT.maxDelayMs` | `30000` | `ReconnectOptions.maxDelayMs` |
| `DEFAULT_RECONNECT.backoffMultiplier` | `2` | `ReconnectOptions.backoffMultiplier` |
| `DEFAULT_RECONNECT.jitterMs` | `500` | `ReconnectOptions.jitterMs` |

---

## See Also

- [NoexClient](./01-noex-client.md) — Client constructor and lifecycle
- [Transport](./08-transport.md) — WebSocket transport and reconnection details
- [Errors](./10-errors.md) — TimeoutError and DisconnectedError
- [Types](./09-types.md) — WebSocketConstructor and WebSocketLike
