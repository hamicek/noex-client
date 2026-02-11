# Heartbeat

WebSocket connections can silently die — a network switch resets, a firewall drops an idle connection, or the remote peer crashes without sending a close frame. The heartbeat mechanism detects these dead connections so the SDK can trigger a reconnect instead of waiting indefinitely.

## What You'll Learn

- How the ping/pong heartbeat protocol works
- Why heartbeat is enabled by default
- How to disable heartbeat when not needed
- How dead connection detection triggers reconnect

## How It Works

The heartbeat protocol is simple:

1. The **server** periodically sends a `ping` message with a timestamp
2. The **client** automatically responds with a `pong` carrying the same timestamp
3. If the server stops receiving pongs, it closes the connection
4. If the client stops receiving pings, the TCP connection eventually times out or the server closes it — either way, the `close` event triggers the reconnect loop

```
Server                          Client
  │                               │
  │──── { type: "ping",  ────────►│
  │      timestamp: 1234 }        │
  │                               │
  │◄─── { type: "pong",  ────────│
  │      timestamp: 1234 }        │
  │                               │
  │          ... interval ...      │
  │                               │
  │──── { type: "ping",  ────────►│
  │      timestamp: 5678 }        │
  │                               │
  │◄─── { type: "pong",  ────────│
  │      timestamp: 5678 }        │
```

## Enabled by Default

Heartbeat is **on** unless you explicitly disable it:

```typescript
// Heartbeat enabled (default)
const client = new NoexClient('ws://localhost:8080', { WebSocket });

// Heartbeat explicitly enabled (same as default)
const client2 = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: true,
});

// Heartbeat disabled
const client3 = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: false,
});
```

## What the Client Does

The client's heartbeat handling is minimal and automatic:

1. When a message arrives with `{ type: "ping", timestamp: <number> }`, the transport intercepts it
2. The transport immediately sends back `{ type: "pong", timestamp: <same number> }`
3. The ping message is **not** forwarded to the protocol layer — your code never sees it

```typescript
// You don't need to handle pings. This is fully automatic.
// There's no 'ping' event or callback to implement.
const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();
// Pongs are sent automatically in the background.
```

## When Heartbeat Fails

If the connection silently dies (no close frame from the peer), the sequence is:

```
1. Server sends ping → packet is lost (connection dead)
2. Server waits for pong → no response
3. Server detects dead connection → closes the WebSocket
4. Client receives the close event (or TCP timeout)
5. Client enters 'reconnecting' state
6. Automatic reconnect loop begins
```

Without heartbeat, the client would never know the connection is dead — it would sit idle, thinking it's still connected, while all future requests would hang until they time out individually.

## When to Disable Heartbeat

Disable heartbeat only if:

- The server does not support the ping/pong protocol
- You're debugging and the ping/pong traffic is noisy
- You have a custom keep-alive mechanism at a different layer

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: false,
  // Without heartbeat, dead connections are only detected when:
  // 1. You try to send a request and it fails
  // 2. The OS TCP stack times out (can take minutes)
});
```

## Heartbeat vs WebSocket-Level Ping/Pong

The noex heartbeat is an **application-level** protocol — it uses regular WebSocket text messages (`{ type: "ping" }`), not the WebSocket protocol's built-in ping/pong frames. This design works across all WebSocket implementations, including browsers that don't expose protocol-level ping/pong.

| Feature | noex heartbeat | WebSocket ping/pong frames |
|---------|---------------|---------------------------|
| Message type | JSON text message | Protocol control frame |
| Browser support | Yes (regular messages) | No (browsers don't expose frames) |
| Server support | Any noex-server | Requires WebSocket library support |
| Payload | `{ type, timestamp }` | Binary payload (opaque) |

## Complete Working Example

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    heartbeat: true, // default — shown for clarity
    reconnect: {
      maxRetries: Infinity,
      initialDelayMs: 1_000,
    },
  });

  client.on('connected', () => {
    console.log('Connected — heartbeat active');
  });

  client.on('reconnecting', (attempt) => {
    // This fires when the connection drops, including
    // dead connections detected via heartbeat timeout
    console.log(`Reconnecting (attempt ${attempt})...`);
  });

  client.on('reconnected', () => {
    console.log('Reconnected');
  });

  await client.connect();
  console.log('Listening... (Ctrl+C to stop)');
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Creates two clients — one with heartbeat enabled and one with it disabled
2. Connects both to the same server
3. Subscribes to a query on both clients to verify they're working
4. Disconnects the clients cleanly and verifies both return to `disconnected` state

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const url = 'ws://localhost:8080';

  // Client with heartbeat (default)
  const clientA = new NoexClient(url, {
    WebSocket,
    heartbeat: true,
    reconnect: false,
  });

  // Client without heartbeat
  const clientB = new NoexClient(url, {
    WebSocket,
    heartbeat: false,
    reconnect: false,
  });

  await clientA.connect();
  console.log(`Client A: state=${clientA.state}, heartbeat=on`);

  await clientB.connect();
  console.log(`Client B: state=${clientB.state}, heartbeat=off`);

  // Both should be functional
  const usersA = await clientA.store.bucket('users').all();
  const usersB = await clientB.store.bucket('users').all();
  console.log(`Client A sees ${usersA.length} users`);
  console.log(`Client B sees ${usersB.length} users`);

  // Disconnect both
  await clientA.disconnect();
  await clientB.disconnect();

  console.log(`Client A: state=${clientA.state}`); // 'disconnected'
  console.log(`Client B: state=${clientB.state}`); // 'disconnected'
}

main().catch(console.error);
```

</details>

## Summary

- The server sends `{ type: "ping", timestamp }` periodically
- The client automatically responds with `{ type: "pong", timestamp }` — no code needed
- Heartbeat is enabled by default (`heartbeat: true`)
- It detects dead connections that would otherwise go unnoticed
- Dead connections trigger the standard reconnect loop
- Disable with `heartbeat: false` only if the server doesn't support it
- The noex heartbeat is application-level JSON (not WebSocket protocol ping/pong), so it works in browsers

---

Next: [Error Types](../09-error-handling/01-error-types.md)
