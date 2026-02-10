# Transport

Internal WebSocket transport layer used by `NoexClient`. This document describes the architecture and behavior of the transport subsystem — these classes are **not part of the public API** and cannot be imported directly.

## Architecture Overview

```
NoexClient
 ├─ WebSocketTransport    manages raw WebSocket connection
 ├─ ReconnectStrategy     computes backoff delays
 ├─ RequestManager        correlates request/response pairs
 └─ PushRouter            routes server push messages to subscriptions
```

---

## WebSocketTransport

Low-level WebSocket wrapper with connection lifecycle management, event system, and automatic heartbeat handling.

### Constructor

```typescript
new WebSocketTransport(url: string, options: TransportOptions)
```

**TransportOptions:**

| Name | Type | Description |
|------|------|-------------|
| connectTimeoutMs | `number` | Timeout for the WebSocket `open` event (ms) |
| WebSocket | `WebSocketConstructor` | WebSocket constructor to use |
| heartbeat | `boolean` | Whether to automatically respond to server `ping` messages |

### State

```typescript
get state(): TransportState
get isConnected(): boolean
```

`TransportState` is one of: `'idle'`, `'connecting'`, `'connected'`, `'disconnected'`.

The initial state is `'idle'` (before the first `connect()` call). After a connection closes, the state becomes `'disconnected'`.

### connect()

```typescript
connect(): Promise<void>
```

Opens a new WebSocket connection. The promise resolves when the `open` event fires, or rejects if:
- The connection times out (after `connectTimeoutMs`)
- The WebSocket closes during the handshake

If the transport is already `'connected'` or `'connecting'`, the call resolves immediately (no-op).

### disconnect()

```typescript
disconnect(code?: number, reason?: string): Promise<void>
```

Closes the WebSocket. Defaults to code `1000` and reason `'Client disconnect'`. Resolves when the `close` event fires. No-op if already `'disconnected'` or `'idle'`.

### send()

```typescript
send(data: string): void
```

Sends a string message over the WebSocket. Throws if the transport is not connected.

### on()

```typescript
on<K extends keyof TransportEventMap>(event: K, handler: TransportEventMap[K]): Unsubscribe
```

Registers a transport-level event listener.

**Transport Events:**

| Event | Handler Signature | Description |
|-------|-------------------|-------------|
| `open` | `() => void` | WebSocket connection opened |
| `close` | `(code: number, reason: string) => void` | WebSocket connection closed |
| `message` | `(data: string) => void` | Message received (heartbeat pings are filtered out) |
| `error` | `(error: Error) => void` | WebSocket error occurred |

---

## Heartbeat

When `heartbeat` is enabled (the default), the transport automatically handles the server heartbeat protocol:

1. Server sends `{ "type": "ping", "timestamp": <number> }`.
2. Transport responds with `{ "type": "pong", "timestamp": <same number> }`.
3. The ping message is **not** forwarded to `message` listeners.

This keeps the connection alive and allows the server to detect stale connections. Heartbeat handling is transparent to the rest of the client — no application code is needed.

---

## ReconnectStrategy

Computes backoff delays for the automatic reconnection loop in `NoexClient`.

### Constructor

```typescript
new ReconnectStrategy(options?: ReconnectOptions)
```

All parameters are optional and fall back to defaults from [Configuration](./02-configuration.md#reconnectoptions).

### getDelay()

```typescript
getDelay(attempt: number): number | null
```

Returns the delay in milliseconds before the given attempt, or `null` if `maxRetries` has been reached (signaling the reconnect loop should stop).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| attempt | `number` | Zero-based attempt index |

**Formula:**

```
base  = initialDelayMs * backoffMultiplier ^ attempt
delay = min(base, maxDelayMs) + random(0, jitterMs)
```

**Default progression** (with default configuration):

| Attempt | Base delay | Max capped | + Jitter (0–500 ms) |
|---------|-----------|------------|---------------------|
| 0 | 1 000 ms | 1 000 ms | 1 000 – 1 500 ms |
| 1 | 2 000 ms | 2 000 ms | 2 000 – 2 500 ms |
| 2 | 4 000 ms | 4 000 ms | 4 000 – 4 500 ms |
| 3 | 8 000 ms | 8 000 ms | 8 000 – 8 500 ms |
| 4 | 16 000 ms | 16 000 ms | 16 000 – 16 500 ms |
| 5+ | 32 000+ ms | 30 000 ms | 30 000 – 30 500 ms |

---

## Connection Lifecycle

The full connection lifecycle managed by `NoexClient`:

```
1. client.connect()
   ├─ transport.connect()          — open WebSocket
   ├─ waitForWelcome()             — parse { type: 'welcome', ... }
   ├─ auth.login() (if configured) — automatic authentication
   └─ emit 'connected', 'welcome'

2. Normal operation
   ├─ requestManager.send()        — send typed request, await response
   ├─ pushRouter.handleMessage()   — route server pushes to subscriptions
   └─ transport heartbeat          — auto pong on server ping

3. Connection lost (unexpected close)
   ├─ requestManager.rejectAll()   — reject pending requests
   ├─ state → 'reconnecting'
   └─ reconnect loop:
       ├─ reconnectStrategy.getDelay(attempt)
       ├─ sleep (with abort support)
       ├─ transport.connect() + waitForWelcome()
       ├─ auth.login() (if needed)
       ├─ subscriptionManager.resubscribeAll()
       └─ emit 'connected', 'reconnected', 'welcome'

4. client.disconnect()
   ├─ abort reconnect loop (if running)
   ├─ requestManager.rejectAll()
   ├─ subscriptionManager.clear()
   └─ transport.disconnect(1000)
```

---

## WebSocket Compatibility

The transport accepts any object conforming to the `WebSocketLike` interface — this makes it compatible with both browser-native `WebSocket` and the Node.js `ws` package:

```typescript
interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;
```

In browsers, `globalThis.WebSocket` is detected automatically. In Node.js, pass the `ws` package:

```typescript
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:3000', { WebSocket });
```

---

## See Also

- [NoexClient](./01-noex-client.md) — Client lifecycle and reconnect behavior
- [Configuration](./02-configuration.md) — ReconnectOptions and timeout settings
- [Types](./09-types.md) — WebSocketLike, WebSocketConstructor, ConnectionState
- [Errors](./10-errors.md) — DisconnectedError, TimeoutError
