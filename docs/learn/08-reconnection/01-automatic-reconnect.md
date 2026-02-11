# Automatic Reconnect

Network connections drop — servers restart, WiFi reconnects, load balancers rotate. The SDK handles all of this automatically with exponential backoff, jitter, and configurable retry limits. You configure the strategy once and the SDK takes care of re-establishing the connection transparently.

## What You'll Learn

- How to enable and configure automatic reconnect with `ReconnectOptions`
- How exponential backoff with jitter prevents thundering herd
- Which lifecycle events fire during reconnection
- What happens to pending requests when the connection drops
- How to disable reconnect or stop it programmatically

## Reconnect Is Enabled by Default

When you create a `NoexClient`, reconnect is **on** by default with sensible defaults:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

// Reconnect is enabled with defaults — no extra configuration needed
const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();
// If the connection drops, the SDK will reconnect automatically.
```

You can explicitly disable it:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: false, // No automatic reconnect
});
```

## ReconnectOptions

Pass an object to `reconnect` for fine-grained control:

```typescript
interface ReconnectOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly jitterMs?: number;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxRetries` | `number` | `Infinity` | Maximum number of reconnect attempts. `Infinity` means never give up. |
| `initialDelayMs` | `number` | `1000` | Delay before the first reconnect attempt (ms). |
| `maxDelayMs` | `number` | `30000` | Upper bound for the backoff delay (ms). |
| `backoffMultiplier` | `number` | `2` | Multiplier applied on each successive attempt. |
| `jitterMs` | `number` | `500` | Random jitter added to each delay to avoid thundering herd (ms). |

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 500,
    maxDelayMs: 15_000,
    backoffMultiplier: 2,
    jitterMs: 300,
  },
});
```

## Exponential Backoff with Jitter

The delay before each reconnect attempt is computed as:

```
delay = min(initialDelayMs × backoffMultiplier ^ attempt, maxDelayMs) + random() × jitterMs
```

With defaults (`initialDelayMs=1000`, `backoffMultiplier=2`, `maxDelayMs=30000`, `jitterMs=500`):

```
Attempt 0:  min(1000 × 2⁰, 30000) + jitter  =  1000 + [0..500)  ≈  1.0–1.5s
Attempt 1:  min(1000 × 2¹, 30000) + jitter  =  2000 + [0..500)  ≈  2.0–2.5s
Attempt 2:  min(1000 × 2², 30000) + jitter  =  4000 + [0..500)  ≈  4.0–4.5s
Attempt 3:  min(1000 × 2³, 30000) + jitter  =  8000 + [0..500)  ≈  8.0–8.5s
Attempt 4:  min(1000 × 2⁴, 30000) + jitter  = 16000 + [0..500)  ≈ 16.0–16.5s
Attempt 5:  min(1000 × 2⁵, 30000) + jitter  = 30000 + [0..500)  ≈ 30.0–30.5s  (capped)
Attempt 6+: 30000 + [0..500)  ≈ 30.0–30.5s  (stays capped)
```

**Why jitter?** When a server restarts, all connected clients detect the disconnect at roughly the same time. Without jitter, they'd all reconnect simultaneously, overloading the server. Random jitter spreads the reconnection attempts over time.

## Connection States

The client cycles through four states during its lifecycle:

```
                  connect()
  disconnected ──────────────► connecting
       ▲                            │
       │                            │ success
       │                            ▼
       │    disconnect()        connected
       │◄────────────────────────────│
       │                            │ connection lost
       │         maxRetries         ▼
       │◄──────── exhausted ── reconnecting ─┐
                                    ▲        │ attempt failed
                                    └────────┘
```

Check the current state at any time:

```typescript
console.log(client.state);       // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
console.log(client.isConnected); // true only when state === 'connected'
```

## Lifecycle Events

The SDK emits events at each stage of the reconnect cycle:

| Event | Payload | When |
|-------|---------|------|
| `reconnecting` | `attempt: number` | Before each reconnect attempt (1-indexed) |
| `reconnected` | — | Reconnect succeeded — connection restored |
| `connected` | — | Emitted alongside `reconnected` after a successful reconnect |
| `welcome` | `WelcomeInfo` | Server welcome message received after reconnect |
| `disconnected` | `reason: string` | All retries exhausted or reconnect disabled |
| `error` | `Error` | `maxRetries` exhausted (carries `'Max reconnect attempts reached'`) |

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: { maxRetries: 5, initialDelayMs: 500 },
});

client.on('reconnecting', (attempt) => {
  console.log(`Reconnect attempt ${attempt}...`);
});

client.on('reconnected', () => {
  console.log('Connection restored');
});

client.on('disconnected', (reason) => {
  console.log(`Permanently disconnected: ${reason}`);
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});

await client.connect();
```

## Reconnect Sequence

When the connection drops unexpectedly, the following sequence runs internally:

```
1. Connection lost
   ├─ State → 'reconnecting'
   └─ All pending requests rejected with DisconnectedError
2. Wait (exponential backoff + jitter)
3. Attempt WebSocket connection
4. Wait for server welcome message
5. If auth.token configured and server requires auth:
   └─ Call auth.login(token) automatically
6. Restore all active subscriptions (resubscribeAll)
7. State → 'connected'
8. Emit 'connected', 'reconnected', 'welcome'
9. Done — client is fully operational
```

If step 3–6 fails, the client increments the attempt counter and goes back to step 2. If `maxRetries` is exhausted, the client moves to `disconnected` state and emits `disconnected` + `error`.

## Pending Requests Are Rejected Immediately

When the connection drops, **all in-flight requests are rejected** with a `DisconnectedError`. This happens before any reconnect attempt starts:

```typescript
import { DisconnectedError } from '@hamicek/noex-client';

try {
  // If the connection drops while this request is pending...
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    // err.code === 'DISCONNECTED'
    // err.message === 'Connection lost'
    console.log('Request failed because connection was lost');
  }
}
```

Requests sent while the client is in `reconnecting` state also throw `DisconnectedError` synchronously:

```typescript
if (client.state === 'reconnecting') {
  // This will throw immediately — no waiting
  await client.store.bucket('users').all();
  // DisconnectedError: Cannot send request — client is reconnecting
}
```

## Stopping Reconnect Programmatically

Call `disconnect()` at any time to stop the reconnect loop:

```typescript
client.on('reconnecting', (attempt) => {
  if (attempt > 3) {
    console.log('Giving up manually');
    client.disconnect(); // Stops the reconnect loop
  }
});
```

`disconnect()` sets an internal flag that breaks the reconnect loop immediately. The client transitions to `disconnected` state. No further reconnect attempts are made.

## Complete Working Example

A service that monitors the reconnect lifecycle:

```typescript
import { NoexClient, DisconnectedError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    reconnect: {
      maxRetries: 20,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      backoffMultiplier: 2,
      jitterMs: 500,
    },
  });

  // Track connection lifecycle
  client.on('connected', () => {
    console.log(`[${new Date().toISOString()}] Connected`);
  });

  client.on('reconnecting', (attempt) => {
    console.log(`[${new Date().toISOString()}] Reconnecting (attempt ${attempt})...`);
  });

  client.on('reconnected', () => {
    console.log(`[${new Date().toISOString()}] Reconnected successfully`);
  });

  client.on('disconnected', (reason) => {
    console.log(`[${new Date().toISOString()}] Disconnected: ${reason}`);
    process.exit(1);
  });

  client.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
  });

  await client.connect();
  console.log('Connected. Performing operations...');

  // Safe request wrapper that handles disconnection
  async function safeInsert(name: string) {
    try {
      return await client.store.bucket('users').insert({ name });
    } catch (err) {
      if (err instanceof DisconnectedError) {
        console.log(`Insert of "${name}" failed — not connected`);
        return null;
      }
      throw err;
    }
  }

  await safeInsert('Alice');
  console.log('Listening... (Ctrl+C to stop)');
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Creates a client with `maxRetries: 5` and fast backoff (`initialDelayMs: 200`, `jitterMs: 0`)
2. Connects to a server
3. Logs every `reconnecting` event with the attempt number and computed delay
4. Logs when reconnect succeeds or when all retries are exhausted
5. Verifies that `client.state` matches the expected state at each step

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    reconnect: {
      maxRetries: 5,
      initialDelayMs: 200,
      maxDelayMs: 5_000,
      backoffMultiplier: 2,
      jitterMs: 0,
    },
  });

  let lastReconnectTime = 0;

  client.on('reconnecting', (attempt) => {
    const now = Date.now();
    const elapsed = lastReconnectTime ? now - lastReconnectTime : 0;
    lastReconnectTime = now;
    console.log(
      `Attempt ${attempt} | state: ${client.state} | ${elapsed}ms since last attempt`,
    );
    // State should be 'reconnecting'
    console.assert(client.state === 'reconnecting');
  });

  client.on('reconnected', () => {
    console.log('Reconnected!');
    console.assert(client.state === 'connected');
    console.assert(client.isConnected === true);
  });

  client.on('disconnected', (reason) => {
    console.log(`Disconnected: ${reason}`);
    console.assert(client.state === 'disconnected');
    console.assert(client.isConnected === false);
  });

  const welcome = await client.connect();
  console.log(`Connected to server v${welcome.version}`);
  console.assert(client.state === 'connected');

  // Keep the process alive — when the server goes down,
  // you'll see the reconnect attempts logged above
  console.log('Waiting for disconnect... (kill the server to test)');
}

main().catch(console.error);
```

</details>

## Summary

- Automatic reconnect is **enabled by default** with `Infinity` retries
- Disable with `reconnect: false` or customize with `ReconnectOptions`
- Delay formula: `min(initial × multiplier ^ attempt, max) + random() × jitter`
- Jitter prevents thundering herd when many clients reconnect simultaneously
- Events: `reconnecting(attempt)` → `reconnected` / `disconnected(reason)`
- Pending requests are rejected immediately with `DisconnectedError` on connection loss
- Requests sent during `reconnecting` state also throw `DisconnectedError`
- Call `disconnect()` at any time to abort the reconnect loop
- After successful reconnect, the SDK re-authenticates (if configured) and restores subscriptions

---

Next: [Subscription Recovery](./02-subscription-recovery.md)
