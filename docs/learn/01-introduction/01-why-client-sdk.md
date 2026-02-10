# Why a Client SDK?

You can talk to a noex-server over a plain WebSocket. Open a connection, send JSON, parse JSON, done. It works — until it doesn't. The moment you need request/response correlation, reconnection, subscription management, or type safety, you're writing an SDK anyway. This chapter explains why the built-in SDK exists and what problems it solves.

## What You'll Learn

- Why hand-rolling WebSocket messages becomes a maintenance trap
- What a raw WebSocket conversation with noex-server actually looks like
- How the SDK eliminates boilerplate and enforces correctness
- The three-layer architecture that makes this possible

## The Problem: Raw WebSocket Communication

### Manual Message Framing

noex-server uses a JSON protocol over WebSocket. Every message you send must include a `type`, a unique `id` for correlation, and a `payload`. The server responds with the same `id` so you can match requests to responses. Here's what a simple "insert a record" operation looks like without the SDK:

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  // Wait for welcome message first
  // ...then send a request
  ws.send(JSON.stringify({
    id: crypto.randomUUID(),
    type: 'store.insert',
    payload: { bucket: 'users', data: { name: 'Alice' } },
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === 'welcome') {
    console.log('Connected to server', msg.payload.version);
  } else if (msg.type === 'response') {
    // Which request does this belong to?
    // You need a Map<id, callback> to correlate.
  } else if (msg.type === 'push') {
    // A subscription update — route to the right handler
  } else if (msg.type === 'ping') {
    // Must respond with pong or the server drops you
    ws.send(JSON.stringify({ type: 'pong' }));
  }
});
```

This is just one insert. Every operation needs the same boilerplate: generate an ID, serialize, send, wait, correlate, parse, handle errors, handle timeouts.

### No Correlation Out of the Box

WebSocket is a bidirectional stream. When you send three requests at once, you get three responses — but in what order? You need a pending request registry:

```typescript
const pending = new Map<string, {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function sendRequest(type: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Request timeout'));
    }, 10_000);

    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, type, payload }));
  });
}

// In your message handler:
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'response' && pending.has(msg.id)) {
    const { resolve, reject, timer } = pending.get(msg.id)!;
    clearTimeout(timer);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.payload);
  }
});
```

You just wrote 25 lines of infrastructure for something the SDK does internally.

### Reconnection Is Your Problem

When the network drops, your WebSocket closes. Now you need:

1. Detect the close event and decide whether to reconnect
2. Implement exponential backoff so you don't hammer the server
3. Re-establish the connection and re-authenticate
4. Re-subscribe to every active subscription
5. Deliver fresh data to every subscription callback

```text
┌───────────────────────────────────────────────────────────┐
│              What You Must Implement Yourself              │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  1. Timeout tracking         per-request setTimeout       │
│  2. Request correlation      Map<id, Promise>             │
│  3. Push routing             route by subscriptionId      │
│  4. Heartbeat                respond to server pings      │
│  5. Reconnect loop           backoff + jitter + retry     │
│  6. Re-auth on reconnect     re-send auth.login           │
│  7. Re-subscribe             re-register all subs         │
│  8. Error normalization      parse server error codes     │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

Each of these is a source of subtle bugs. Miss the heartbeat? Server drops you. Forget to re-subscribe? Silent data loss. Wrong timeout? Cascading failures.

### The Consequences

| Concern | Raw WebSocket | With SDK |
|---------|---------------|----------|
| **Message framing** | You serialize/parse every message | Handled internally |
| **Request/response correlation** | Build your own Map + timeout | `await bucket.insert(data)` |
| **Subscription routing** | Parse push, match ID, call handler | `store.subscribe(q, callback)` |
| **Heartbeat** | Listen for ping, send pong | Automatic |
| **Reconnect** | Backoff loop + resubscribe + reauth | Built-in, configurable |
| **Type safety** | None (raw JSON) | `BucketAPI<T>` generics |
| **Error handling** | Parse error codes yourself | Typed `NoexClientError` hierarchy |
| **Timeout control** | Manual `setTimeout` per request | `requestTimeoutMs` option |

## The Solution: Three Layers of Abstraction

The SDK organizes all of this into three layers:

```text
┌───────────────────────────────────────────────────────────┐
│                        API Layer                          │
│  store.bucket('users').insert({ name: 'Alice' })         │
│  rules.emit('user.created', { userId: '123' })           │
│  auth.login('jwt-token')                                 │
├───────────────────────────────────────────────────────────┤
│                     Protocol Layer                        │
│  Message framing (JSON { id, type, payload })             │
│  Request/response correlation (pending Map)               │
│  Push routing (subscriptionId → callback)                 │
│  Timeout enforcement (requestTimeoutMs)                   │
├───────────────────────────────────────────────────────────┤
│                    Transport Layer                        │
│  WebSocket connection management                          │
│  Reconnect with exponential backoff + jitter              │
│  Heartbeat (automatic pong)                               │
│  Connection state machine                                 │
└───────────────────────────────────────────────────────────┘
```

You interact with the **API layer**. The protocol and transport layers are invisible but do all the heavy lifting. When you call `bucket.insert(data)`, the SDK:

1. Serializes the request with a unique ID
2. Sends it over the WebSocket
3. Starts a timeout timer
4. Waits for the correlated response
5. Parses the response, rejects on error, resolves on success
6. Returns the typed result

All in a single `await`.

## Complete Working Example

Here's the same "insert a user" operation — raw WebSocket vs SDK:

**Raw WebSocket (30+ lines):**

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
const pending = new Map<string, { resolve: Function; reject: Function }>();

ws.on('open', () => {
  ws.once('message', (raw) => {
    const welcome = JSON.parse(raw.toString());
    if (welcome.type !== 'welcome') throw new Error('Expected welcome');

    const id = crypto.randomUUID();
    pending.set(id, {
      resolve: (data: unknown) => console.log('Created:', data),
      reject: (err: Error) => console.error('Failed:', err),
    });
    ws.send(JSON.stringify({
      id,
      type: 'store.insert',
      payload: { bucket: 'users', data: { name: 'Alice' } },
    }));
  });
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'response' && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)!;
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.payload);
  }
});
```

**With the SDK (6 lines):**

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const users = client.store.bucket('users');
const alice = await users.insert({ name: 'Alice' });
console.log('Created:', alice);

await client.disconnect();
```

Same result. The SDK version is correct by construction — it handles correlation, timeouts, error parsing, and cleanup automatically.

## Exercise

You have the following raw WebSocket code that fetches a user and updates their name. Rewrite it using the SDK.

```typescript
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  // skip welcome handling for brevity
  const getId = crypto.randomUUID();
  ws.send(JSON.stringify({
    id: getId,
    type: 'store.get',
    payload: { bucket: 'users', key: 'user-1' },
  }));
  // then in the message handler, find the response,
  // parse it, and send an update request...
});
```

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const users = client.store.bucket('users');
const user = await users.get('user-1');

if (user) {
  const updated = await users.update('user-1', { name: 'Bob' });
  console.log('Updated:', updated);
}

await client.disconnect();
```

Three lines of business logic instead of nested callbacks with manual JSON serialization. The SDK handles correlation, error checking, and type inference.

</details>

## Summary

- Raw WebSocket communication with noex-server requires manual message framing, request correlation, push routing, heartbeat handling, reconnection, and error parsing
- Each concern is a source of subtle bugs — missed heartbeats, lost subscriptions, race conditions
- The SDK wraps all of this into a three-layer architecture: transport (connection), protocol (framing + correlation), and API (typed operations)
- You get `await`-based operations, automatic reconnection, and TypeScript type safety for free

---

Next: [Key Concepts](./02-key-concepts.md)
