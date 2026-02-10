# Key Concepts

Before writing any code, this chapter builds a mental model of how the SDK is structured. You'll understand the layered architecture, connection lifecycle, and the vocabulary used throughout the rest of the guide.

## What You'll Learn

- How the three layers (transport, protocol, API) divide responsibility
- What each connection state means and when transitions happen
- How requests, responses, and push messages flow through the system
- The glossary of terms used in every subsequent chapter

## Architecture: Three Layers

The SDK is organized into three layers, each with a single responsibility:

```text
┌─────────────────────────────────────────────────────────────┐
│                        Your Code                            │
│                                                             │
│  const users = client.store.bucket<User>('users');          │
│  const alice = await users.insert({ name: 'Alice' });      │
│  const unsub = await client.store.subscribe('q', cb);       │
│  await client.rules.emit('user.created', { id: alice.id }); │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      API Layer                              │
│                                                             │
│  StoreAPI   →  bucket(), subscribe(), transaction()         │
│  BucketAPI  →  insert(), get(), update(), delete(), ...     │
│  RulesAPI   →  emit(), setFact(), getFact(), subscribe()    │
│  AuthAPI    →  login(), logout(), whoami()                  │
│                                                             │
│  Translates method calls into protocol messages.            │
│  Returns typed results.                                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Protocol Layer                            │
│                                                             │
│  Every outgoing message: { id, type, payload }              │
│  Every incoming response matched by id                      │
│  Push messages routed by subscriptionId                     │
│  Timeout enforcement per request                            │
│                                                             │
│  Handles the wire format so the API layer doesn't have to.  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Transport Layer                           │
│                                                             │
│  WebSocket open / close / send / receive                    │
│  Reconnect with exponential backoff + jitter                │
│  Heartbeat (automatic pong response to server ping)         │
│  Connection state machine                                   │
│                                                             │
│  Manages the physical connection so the protocol layer      │
│  never deals with reconnects or raw bytes.                  │
└─────────────────────────────────────────────────────────────┘
```

### API Layer

This is what you interact with. The `NoexClient` exposes three namespaces:

| Namespace | Access | Purpose |
|-----------|--------|---------|
| `client.store` | `StoreAPI` | Bucket CRUD, queries, subscriptions, transactions |
| `client.rules` | `RulesAPI` | Event emission, fact management, rule subscriptions |
| `client.auth` | `AuthAPI` | Token-based login, session management |

Each method on these objects translates into a protocol message, sends it, waits for the response, and returns a typed result. You never construct raw JSON yourself.

### Protocol Layer

The protocol layer handles the wire format. noex-server uses a simple JSON protocol over WebSocket:

**Outgoing request:**
```json
{ "id": "abc-123", "type": "store.insert", "payload": { "bucket": "users", "data": { "name": "Alice" } } }
```

**Incoming response:**
```json
{ "id": "abc-123", "type": "response", "payload": { "id": "rec-1", "name": "Alice", "_version": 1, "_createdAt": 1706745600000, "_updatedAt": 1706745600000 } }
```

**Incoming push (subscription update):**
```json
{ "type": "push", "channel": "subscription", "subscriptionId": "sub-1", "payload": [...] }
```

The protocol layer maintains a `Map<id, Promise>` for pending requests and routes push messages to the correct subscription callback by `subscriptionId`.

### Transport Layer

The transport layer manages the WebSocket connection itself:

- Opens and closes the connection
- Implements reconnection with configurable backoff
- Responds to server heartbeat pings automatically
- Tracks the connection state machine

## Connection Lifecycle

The client has four possible states:

```text
                    connect()
  disconnected ──────────────────► connecting
       ▲                               │
       │                          success / timeout
       │                               │
       │   disconnect()            ┌───▼───────┐
       ├───────────────────────────┤ connected  │
       │                           └───┬───────┘
       │                        connection lost
       │                               │
       │     max retries           ┌───▼──────────┐
       ├───────────────────────────┤ reconnecting  │
       │                           └───┬──────────┘
       │                          reconnect success
       │                               │
       │                           ┌───▼───────┐
       └───────────────────────────┤ connected  │
                                   └───────────┘
```

| State | Meaning |
|-------|---------|
| `disconnected` | Initial state. No connection. All requests will throw `DisconnectedError`. |
| `connecting` | `connect()` was called. WebSocket is opening and waiting for the server welcome message. |
| `connected` | Connection is live. Requests are sent and responses are received. |
| `reconnecting` | Connection was lost unexpectedly. The client is attempting to reconnect with exponential backoff. Requests throw `DisconnectedError`. |

### Events

The client emits events at each state transition:

| Event | When | Handler |
|-------|------|---------|
| `connected` | WebSocket opened and welcome received | `() => void` |
| `disconnected` | Connection closed (after all retries exhausted, or `disconnect()` called) | `(reason: string) => void` |
| `reconnecting` | Before each reconnect attempt | `(attempt: number) => void` |
| `reconnected` | Successfully reconnected (subscriptions already restored) | `() => void` |
| `error` | Transport error or max retries exhausted | `(error: Error) => void` |
| `welcome` | Server welcome message received | `(info: WelcomeInfo) => void` |

You subscribe to events using `client.on()`, which returns an unsubscribe function:

```typescript
const off = client.on('reconnecting', (attempt) => {
  console.log(`Reconnect attempt ${attempt}...`);
});

// Later: stop listening
off();
```

## Message Flow

Here's how a single `bucket.insert()` call flows through the layers:

```text
  Your Code                API Layer              Protocol Layer         Transport Layer
     │                        │                        │                       │
     │  users.insert(data)    │                        │                       │
     │───────────────────────►│                        │                       │
     │                        │  request('store.insert',│                       │
     │                        │    { bucket, data })    │                       │
     │                        │───────────────────────►│                       │
     │                        │                        │  generate id          │
     │                        │                        │  JSON.stringify()     │
     │                        │                        │  start timeout        │
     │                        │                        │  ws.send(json)        │
     │                        │                        │──────────────────────►│
     │                        │                        │                       │
     │                        │                        │     (server processes) │
     │                        │                        │                       │
     │                        │                        │  ws.onmessage(json)   │
     │                        │                        │◄──────────────────────│
     │                        │                        │  match id → resolve   │
     │                        │  typed result          │  clear timeout        │
     │                        │◄───────────────────────│                       │
     │  T & RecordMeta        │                        │                       │
     │◄───────────────────────│                        │                       │
```

For **push messages** (subscription updates), the flow is different — there's no request. The server sends a push, the protocol layer matches it by `subscriptionId`, and invokes the registered callback directly.

## Glossary

| Term | Definition |
|------|------------|
| **Bucket** | A named collection of records on the server (like a database table). Accessed via `client.store.bucket('name')`. |
| **RecordMeta** | Server-generated metadata added to every record: `id`, `_version`, `_createdAt`, `_updatedAt`. |
| **Subscription** | A live connection to a server-side query. When the query result changes, the server pushes the new data to the client. |
| **Push** | A server-initiated message delivering subscription updates or rule events. Not a response to a request. |
| **Welcome** | The first message the server sends after a WebSocket connection opens. Contains `version`, `serverTime`, and `requiresAuth`. |
| **Heartbeat** | Periodic ping/pong exchange between server and client. The server sends a ping; the SDK responds with pong automatically. Detects dead connections. |
| **Reconnect** | Automatic re-establishment of a dropped connection with exponential backoff and jitter. Active subscriptions are restored after reconnection. |
| **Transaction** | An atomic batch of store operations. All operations succeed or all fail — no partial results. |
| **Unsubscribe** | A synchronous `() => void` function returned by `subscribe()`. Calling it stops receiving push updates and notifies the server. |
| **WelcomeInfo** | The typed object returned by `connect()`: `{ version: string, serverTime: number, requiresAuth: boolean }`. |
| **ConnectionState** | One of four values: `'disconnected'`, `'connecting'`, `'connected'`, `'reconnecting'`. |

## Exercise

Draw the message flow (as a list of steps) for the following scenario:

1. The client calls `client.store.subscribe('all-users', callback)`
2. A second client inserts a new user into the `users` bucket
3. The server pushes the updated query result to the first client

<details>
<summary>Solution</summary>

**Step 1: Subscribe request**

1. API layer translates `store.subscribe('all-users', callback)` into a `store.subscribe` request
2. Protocol layer generates a unique `id`, serializes `{ id, type: 'store.subscribe', payload: { query: 'all-users' } }`
3. Transport layer sends the JSON over WebSocket
4. Server processes the subscription, returns a response with `subscriptionId` and initial data
5. Protocol layer matches the response by `id`, registers the callback under `subscriptionId`
6. Callback is invoked with the initial data
7. The `Promise<Unsubscribe>` resolves

**Step 2: Another client inserts a record**

8. The second client sends an insert request to the server
9. The server processes the insert and detects that the `all-users` query result has changed

**Step 3: Push update**

10. Server sends a push message: `{ type: 'push', channel: 'subscription', subscriptionId: 'sub-1', payload: [...] }`
11. Transport layer receives the WebSocket message
12. Protocol layer routes the push by `subscriptionId` to the registered callback
13. Callback is invoked with the updated data

The key insight: pushes bypass the request/response cycle entirely. They arrive asynchronously and are routed by `subscriptionId`, not by a request `id`.

</details>

## Summary

- The SDK has three layers: **transport** (WebSocket + reconnect), **protocol** (framing + correlation), and **API** (typed methods)
- The connection lifecycle has four states: `disconnected` → `connecting` → `connected` → `reconnecting`
- Each state transition emits an event you can listen to with `client.on()`
- Requests flow down through the layers; responses and pushes flow back up
- Push messages (subscriptions) bypass request/response — they're routed by `subscriptionId`
- The glossary covers the key terms: bucket, subscription, push, welcome, heartbeat, reconnect, transaction

---

Next: [Installation](../02-getting-started/01-installation.md)
