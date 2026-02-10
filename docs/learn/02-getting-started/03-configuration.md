# Configuration

The SDK provides sensible defaults for everything, but every aspect of the connection can be tuned. This chapter covers all fields in `ClientOptions` and `ReconnectOptions`.

## What You'll Learn

- Every `ClientOptions` field, its type, default, and when to change it
- How `ReconnectOptions` controls exponential backoff
- The backoff formula and how jitter prevents thundering herd
- How to disable reconnection and heartbeat

## ClientOptions

Pass options as the second argument to the `NoexClient` constructor:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-jwt-token' },
  reconnect: true,
  requestTimeoutMs: 10_000,
  connectTimeoutMs: 5_000,
  heartbeat: true,
});
```

### All Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `WebSocket` | `WebSocketConstructor` | `globalThis.WebSocket` | WebSocket constructor. Required in Node.js (pass `ws`). Browsers have it built in. |
| `auth` | `{ token: string }` | — | Token for automatic login. If set and the server requires auth, `auth.login(token)` is called after connect and after every reconnect. |
| `reconnect` | `boolean \| ReconnectOptions` | `true` | `true` enables reconnect with default settings. `false` disables it entirely. Pass a `ReconnectOptions` object for fine-grained control. |
| `requestTimeoutMs` | `number` | `10000` | Maximum time (ms) to wait for a server response to any request. Throws `TimeoutError` if exceeded. |
| `connectTimeoutMs` | `number` | `5000` | Maximum time (ms) for the initial WebSocket connection and welcome message. If exceeded, `connect()` rejects. |
| `heartbeat` | `boolean` | `true` | When `true`, the client automatically responds to server ping messages with pong. Disable only if you handle heartbeats yourself. |

### auth

When `auth.token` is set, the client automatically calls `auth.login(token)` after the welcome message is received — both on initial connect and after every reconnect. This ensures the session is always authenticated without manual intervention.

```typescript
// Auto-login: the SDK handles auth transparently
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
});

const welcome = await client.connect();
// If welcome.requiresAuth is true, auth.login was already called
```

If the server does not require auth (`requiresAuth: false`), the auto-login step is skipped even when a token is provided.

### requestTimeoutMs

Every request (insert, get, subscribe, etc.) starts a timeout timer. If the server doesn't respond within `requestTimeoutMs`, the promise rejects with a `TimeoutError`.

```typescript
import { TimeoutError } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  requestTimeoutMs: 5_000, // 5 seconds instead of default 10
});

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof TimeoutError) {
    console.log('Server took too long');
  }
}
```

Set this lower for latency-sensitive applications or higher for operations that process large datasets.

### connectTimeoutMs

Controls how long `connect()` waits for the WebSocket to open **and** receive the welcome message.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  connectTimeoutMs: 3_000, // fail fast if server is unreachable
});
```

### heartbeat

The server sends periodic ping messages. When `heartbeat` is `true` (default), the SDK responds with pong automatically. If the server doesn't receive a pong within its timeout window, it drops the connection.

```typescript
// Disable if you manage heartbeats externally (uncommon)
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: false,
});
```

## ReconnectOptions

When `reconnect` is `true`, the SDK uses default values. For fine-grained control, pass a `ReconnectOptions` object:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: {
    maxRetries: 20,
    initialDelayMs: 500,
    maxDelayMs: 15_000,
    backoffMultiplier: 2,
    jitterMs: 300,
  },
});
```

### All Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxRetries` | `number` | `Infinity` | Maximum reconnect attempts. After this many failures, the client gives up and enters `'disconnected'` state. |
| `initialDelayMs` | `number` | `1000` | Delay before the first reconnect attempt (ms). |
| `maxDelayMs` | `number` | `30000` | Upper bound for the backoff delay (ms). The delay never exceeds this value. |
| `backoffMultiplier` | `number` | `2` | Multiplier applied to the delay after each failed attempt. |
| `jitterMs` | `number` | `500` | Random jitter added to each delay to prevent multiple clients from reconnecting at the same moment. |

### Backoff Formula

The delay before attempt *n* (0-indexed) is:

```text
delay = min(initialDelayMs × backoffMultiplier^n, maxDelayMs) + random(0, jitterMs)
```

With the defaults:

| Attempt | Base delay | + Jitter (up to) | Effective range |
|---------|-----------|-------------------|-----------------|
| 0 | 1000 ms | 500 ms | 1000–1500 ms |
| 1 | 2000 ms | 500 ms | 2000–2500 ms |
| 2 | 4000 ms | 500 ms | 4000–4500 ms |
| 3 | 8000 ms | 500 ms | 8000–8500 ms |
| 4 | 16000 ms | 500 ms | 16000–16500 ms |
| 5+ | 30000 ms | 500 ms | 30000–30500 ms |

The jitter prevents the **thundering herd problem** — when a server restarts, all clients would reconnect at the exact same intervals without jitter, causing a spike of simultaneous connections.

### Disabling Reconnection

```typescript
// No automatic reconnect — connection loss is permanent
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: false,
});
```

When reconnect is disabled, losing the connection moves the client directly to `'disconnected'` state. You must call `connect()` again manually.

### What Happens After Successful Reconnect

1. Auto-login is performed (if `auth.token` is configured)
2. All active subscriptions are re-established with the server
3. Each subscription callback receives fresh data
4. The `'reconnected'` event is emitted

## Complete Configuration Example

A production-ready configuration with all options:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('wss://api.example.com/ws', {
  WebSocket,

  // Auth: auto-login on connect and reconnect
  auth: { token: process.env.API_TOKEN! },

  // Reconnect: aggressive retry with reasonable limits
  reconnect: {
    maxRetries: 50,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    backoffMultiplier: 1.5,
    jitterMs: 200,
  },

  // Timeouts
  requestTimeoutMs: 15_000,
  connectTimeoutMs: 10_000,

  // Heartbeat: keep alive
  heartbeat: true,
});

client.on('reconnecting', (attempt) => {
  console.log(`Reconnect attempt ${attempt}/50`);
});

client.on('error', (err) => {
  console.error('Client error:', err.message);
});

await client.connect();
```

## Exercise

You have a mobile application where network connections are unreliable. Design a `ReconnectOptions` configuration that:

1. Retries up to 100 times
2. Starts with a 200 ms delay
3. Caps the delay at 60 seconds
4. Uses a multiplier of 1.5 (gentler curve than default)
5. Has 1 second of jitter

Calculate the delay for attempts 0, 1, 2, 5, and 10.

<details>
<summary>Solution</summary>

```typescript
const client = new NoexClient('wss://mobile-api.example.com/ws', {
  reconnect: {
    maxRetries: 100,
    initialDelayMs: 200,
    maxDelayMs: 60_000,
    backoffMultiplier: 1.5,
    jitterMs: 1_000,
  },
});
```

Delay calculation: `min(200 × 1.5^n, 60000) + random(0, 1000)`

| Attempt | Base (200 × 1.5^n) | Capped | + Jitter | Range |
|---------|---------------------|--------|----------|-------|
| 0 | 200 ms | 200 ms | 0–1000 ms | 200–1200 ms |
| 1 | 300 ms | 300 ms | 0–1000 ms | 300–1300 ms |
| 2 | 450 ms | 450 ms | 0–1000 ms | 450–1450 ms |
| 5 | 1519 ms | 1519 ms | 0–1000 ms | 1519–2519 ms |
| 10 | 11533 ms | 11533 ms | 0–1000 ms | 11533–12533 ms |

The gentler 1.5× multiplier means slower growth, which is better for mobile where brief disconnects are common and you want to reconnect quickly.

</details>

## Summary

- `ClientOptions` controls auth, reconnection, timeouts, heartbeat, and the WebSocket constructor
- All options have sensible defaults — you only need to set `WebSocket` in Node.js
- `ReconnectOptions` uses exponential backoff with jitter to prevent thundering herd
- The backoff formula is `min(initialDelayMs × multiplier^n, maxDelayMs) + random(0, jitterMs)`
- Set `reconnect: false` to disable automatic reconnection entirely
- After a successful reconnect, auto-login and subscription recovery happen automatically

---

Next: [Basic CRUD](../03-store-operations/01-basic-crud.md)
