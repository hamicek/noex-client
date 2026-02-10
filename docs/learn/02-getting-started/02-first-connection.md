# First Connection

This chapter walks through your first connection to a noex-server. You'll learn how to create a client, connect, inspect the welcome message, listen for lifecycle events, and disconnect cleanly.

## What You'll Learn

- How to create a `NoexClient` instance and call `connect()`
- What the server welcome message contains
- How to listen for lifecycle events (`connected`, `disconnected`, `error`)
- How to disconnect gracefully

## Creating a Client

The `NoexClient` constructor takes a WebSocket URL and an optional configuration object. It does **not** open a connection — that happens when you call `connect()`.

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

// Create the client (no connection yet)
const client = new NoexClient('ws://localhost:8080', { WebSocket });

console.log(client.state);       // 'disconnected'
console.log(client.isConnected); // false
```

The two-step pattern (construct, then connect) gives you a window to register event listeners before the connection opens.

## Connecting

`connect()` opens the WebSocket, waits for the server's welcome message, and returns a `WelcomeInfo` object:

```typescript
const welcome = await client.connect();

console.log(welcome.version);      // e.g. '1.0.0'
console.log(welcome.serverTime);   // e.g. 1706745600000 (Unix ms)
console.log(welcome.requiresAuth); // true or false

console.log(client.state);         // 'connected'
console.log(client.isConnected);   // true
```

If the connection fails or the welcome message doesn't arrive within `connectTimeoutMs` (default: 5000 ms), the promise rejects.

### What Happens During `connect()`

```text
  Client                                    Server
    │                                         │
    │  WebSocket open ───────────────────────►│
    │                                         │
    │◄─────────────────── welcome message ────│
    │  { version, serverTime, requiresAuth }  │
    │                                         │
    │  (auto-login if auth.token is set)      │
    │  auth.login(token) ───────────────────►│
    │◄─────────────── session response ───────│
    │                                         │
    │  connect() resolves with WelcomeInfo    │
```

If `auth.token` is set in client options and the server reports `requiresAuth: true`, the SDK automatically sends an `auth.login` request before resolving `connect()`.

## Lifecycle Events

Register event listeners before calling `connect()` to capture every state transition:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });

// Register listeners before connecting
client.on('connected', () => {
  console.log('Connected!');
});

client.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
});

client.on('error', (error) => {
  console.error('Error:', error.message);
});

client.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`);
});

client.on('reconnected', () => {
  console.log('Reconnected! Subscriptions restored.');
});

client.on('welcome', (info) => {
  console.log('Server version:', info.version);
});

// Now connect
await client.connect();
```

### Unsubscribing from Events

`client.on()` returns a synchronous unsubscribe function:

```typescript
const off = client.on('error', (err) => {
  console.error(err);
});

// Later: stop listening
off();
```

This follows the same pattern as store subscriptions — every `on()` or `subscribe()` returns a cleanup function.

## Disconnecting

`disconnect()` gracefully closes the connection:

```typescript
await client.disconnect();

console.log(client.state);       // 'disconnected'
console.log(client.isConnected); // false
```

When you call `disconnect()`:

1. The reconnect loop is stopped (if active)
2. All pending requests are rejected with `DisconnectedError`
3. All subscriptions are cleared
4. The WebSocket is closed with code `1000` (normal closure)
5. The `'disconnected'` event is emitted

### Cleanup Pattern

A typical application lifecycle:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });

// Handle process shutdown
process.on('SIGINT', async () => {
  await client.disconnect();
  process.exit(0);
});

await client.connect();

// ... use the client ...
```

## Connection State

You can inspect the current state at any time:

```typescript
client.state;       // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
client.isConnected; // shorthand for client.state === 'connected'
```

Operations like `bucket.insert()` or `store.subscribe()` require the client to be in the `'connected'` state. If you call them while disconnected or reconnecting, they throw `DisconnectedError`.

## Complete Working Example

A full script that connects, prints the welcome info, does a simple operation, and disconnects:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });

  client.on('connected', () => console.log('Connected'));
  client.on('disconnected', (reason) => console.log('Disconnected:', reason));
  client.on('error', (err) => console.error('Error:', err.message));

  const welcome = await client.connect();
  console.log(`Server v${welcome.version}, time: ${new Date(welcome.serverTime).toISOString()}`);
  console.log(`Auth required: ${welcome.requiresAuth}`);

  // Quick test: insert and retrieve a record
  const items = client.store.bucket('items');
  const item = await items.insert({ name: 'test' });
  console.log('Created:', item.id);

  const fetched = await items.get(item.id);
  console.log('Fetched:', fetched?.name);

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Creates a `NoexClient` and registers all six lifecycle event listeners
2. Connects to the server
3. Logs the server version and whether auth is required
4. Disconnects after 3 seconds

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });

  client.on('connected', () => console.log('[event] connected'));
  client.on('disconnected', (reason) => console.log('[event] disconnected:', reason));
  client.on('reconnecting', (attempt) => console.log('[event] reconnecting:', attempt));
  client.on('reconnected', () => console.log('[event] reconnected'));
  client.on('error', (err) => console.log('[event] error:', err.message));
  client.on('welcome', (info) => console.log('[event] welcome:', info.version));

  const welcome = await client.connect();
  console.log(`Server: v${welcome.version}`);
  console.log(`Auth required: ${welcome.requiresAuth}`);

  setTimeout(async () => {
    await client.disconnect();
    console.log('Done');
  }, 3_000);
}

main().catch(console.error);
```

You should see the `connected` and `welcome` events fire immediately after `connect()`, then after 3 seconds, the `disconnected` event fires.

</details>

## Summary

- `new NoexClient(url, options)` creates a client without connecting — call `connect()` separately
- `connect()` opens the WebSocket, waits for the welcome message, and optionally auto-logs in
- The welcome message tells you the server `version`, `serverTime`, and `requiresAuth`
- Register lifecycle listeners with `client.on()` before connecting to catch every transition
- `disconnect()` stops reconnection, rejects pending requests, clears subscriptions, and closes the socket
- Check `client.state` or `client.isConnected` to inspect the current connection state

---

Next: [Configuration](./03-configuration.md)
