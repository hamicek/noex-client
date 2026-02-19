# @hamicek/noex-client

TypeScript client SDK for [@hamicek/noex-server](https://github.com/hamicek/noex-server). Works in the browser (native WebSocket) and Node.js (`ws`).

## Features

- **Store CRUD** with typed bucket API and cursor pagination
- **Reactive subscriptions** — subscribe to server-side queries, receive push updates via callbacks
- **Transactions** — atomic multi-bucket operations
- **Rules engine proxy** — emit events, manage facts, subscribe to rule matches
- **Token-based auth** with automatic login on connect and reconnect
- **Automatic reconnect** with exponential backoff, jitter, and subscription recovery
- **Heartbeat** — automatic pong responses to server ping
- **Type-safe generics** — `BucketAPI<T>` for fully typed records
- **Zero runtime dependencies** — ESM only, <5 kB gzip target

## Installation

```bash
npm install @hamicek/noex-client
```

Requires Node.js >= 20. No peer dependencies. For Node.js usage, install `ws` separately.

## Quick Start

```typescript
import { NoexClient } from '@hamicek/noex-client';

// Use wss:// in production (see Production section below)
const client = new NoexClient('ws://localhost:8080');
await client.connect();

// Store CRUD
const users = client.store.bucket('users');
const alice = await users.insert({ name: 'Alice' });
const all = await users.all();

// Reactive subscription
const unsub = await client.store.subscribe('all-users', (data) => {
  console.log('Updated:', data);
});

// Rules
await client.rules.emit('user.created', { userId: alice.id });

// Cleanup
unsub();
await client.disconnect();
```

### Node.js

In Node.js there is no built-in `WebSocket`. Pass the `ws` package via options:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();
```

### Auth and Reconnect

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-jwt-token' },
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 500,
    maxDelayMs: 15_000,
  },
  requestTimeoutMs: 5_000,
});

client.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`);
});

client.on('reconnected', () => {
  console.log('Reconnected! Subscriptions restored.');
});

await client.connect();
```

When `auth.token` is set and the server requires authentication, the client automatically sends `auth.login` after connecting and after every reconnect.

---

## API

### NoexClient

#### `new NoexClient(url, options?)`

Creates a client instance. Does not open a connection — call `connect()` to start.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  auth: { token: 'jwt' },
  reconnect: true,
  requestTimeoutMs: 10_000,
  connectTimeoutMs: 5_000,
  WebSocket,
  heartbeat: true,
});
```

#### `client.connect(): Promise<WelcomeInfo>`

Opens the WebSocket connection and waits for the server welcome message. If `auth.token` is configured and the server requires authentication, login is performed automatically.

```typescript
const welcome = await client.connect();
// { version: '1.0.0', serverTime: 1706745600000, requiresAuth: true }
```

#### `client.disconnect(): Promise<void>`

Gracefully closes the connection. Rejects all pending requests, clears subscriptions, and stops any reconnect loop.

#### `client.state: ConnectionState`

Current connection state: `'connecting'` | `'connected'` | `'reconnecting'` | `'disconnected'`.

#### `client.isConnected: boolean`

Shorthand for `client.state === 'connected'`.

#### `client.on(event, handler): Unsubscribe`

Subscribe to client lifecycle events. Returns an unsubscribe function.

| Event | Handler signature | Description |
|-------|-------------------|-------------|
| `'connected'` | `() => void` | Connection established (initial or reconnect) |
| `'disconnected'` | `(reason: string) => void` | Connection lost or closed |
| `'reconnecting'` | `(attempt: number) => void` | Reconnect attempt starting |
| `'reconnected'` | `() => void` | Successfully reconnected |
| `'error'` | `(error: Error) => void` | Transport or reconnect error |
| `'welcome'` | `(info: WelcomeInfo) => void` | Welcome message received from server |

---

### ClientOptions

```typescript
interface ClientOptions {
  auth?: { token: string };
  reconnect?: boolean | ReconnectOptions;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  WebSocket?: WebSocketConstructor;
  heartbeat?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auth.token` | `string` | — | Token for automatic login after connect |
| `reconnect` | `boolean \| ReconnectOptions` | `true` | Enable automatic reconnect with exponential backoff |
| `requestTimeoutMs` | `number` | `10000` | Timeout for individual request/response round-trips |
| `connectTimeoutMs` | `number` | `5000` | Timeout for WebSocket connection and welcome message |
| `WebSocket` | `WebSocketConstructor` | `globalThis.WebSocket` | WebSocket implementation (pass `ws` in Node.js) |
| `heartbeat` | `boolean` | `true` | Automatically respond to server ping messages |

#### ReconnectOptions

```typescript
interface ReconnectOptions {
  maxRetries?: number;       // default: Infinity
  initialDelayMs?: number;   // default: 1000
  maxDelayMs?: number;       // default: 30000
  backoffMultiplier?: number; // default: 2
  jitterMs?: number;         // default: 500
}
```

---

### StoreAPI

Access via `client.store`.

#### `store.bucket(name): BucketAPI`

Returns a `BucketAPI` handle for the named bucket. Does not make a request — the bucket handle is a thin wrapper that attaches the bucket name to each operation.

```typescript
const users = client.store.bucket('users');
```

For type-safe usage with generics:

```typescript
interface User {
  id: string;
  name: string;
  role: string;
}

const users = client.store.bucket<User>('users');
const alice = await users.insert({ name: 'Alice', role: 'admin' });
// alice: User & RecordMeta — fully typed
```

#### `store.subscribe(query, callback): Promise<Unsubscribe>`

#### `store.subscribe(query, params, callback): Promise<Unsubscribe>`

Subscribe to a reactive server-side query. The callback receives the initial data immediately and is called again whenever the query result changes on the server.

```typescript
const unsub = await client.store.subscribe('all-users', (users) => {
  console.log('Users:', users);
});

// With parameters
const unsub = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (admins) => console.log('Admins:', admins),
);

// Unsubscribe
unsub();
```

Subscriptions survive reconnect — after a successful reconnect the client automatically resubscribes and delivers fresh data to the callback.

#### `store.unsubscribe(subscriptionId): Promise<void>`

Cancel a subscription by its server-assigned ID.

#### `store.transaction(operations): Promise<TransactionResult>`

Execute multiple store operations atomically.

```typescript
const result = await client.store.transaction([
  { op: 'get', bucket: 'users', key: 'user-1' },
  { op: 'update', bucket: 'users', key: 'user-1', data: { credits: 400 } },
  { op: 'insert', bucket: 'logs', data: { action: 'credit_update' } },
]);
// result.results: [{ index: 0, data: ... }, { index: 1, data: ... }, ...]
```

Supported ops: `get`, `insert`, `update`, `delete`, `where`, `findOne`, `count`.

#### `store.buckets(): Promise<BucketsInfo>`

List all defined buckets and their count.

#### `store.stats(): Promise<StoreStats>`

Retrieve store statistics (records, indexes, queries, persistence, TTL).

---

### BucketAPI

Access via `client.store.bucket(name)`.

#### CRUD

| Method | Returns |
|--------|---------|
| `insert(data)` | `Promise<T & RecordMeta>` |
| `get(key)` | `Promise<(T & RecordMeta) \| null>` |
| `update(key, data)` | `Promise<T & RecordMeta>` |
| `delete(key)` | `Promise<void>` |

#### Queries

| Method | Returns |
|--------|---------|
| `all()` | `Promise<(T & RecordMeta)[]>` |
| `where(filter)` | `Promise<(T & RecordMeta)[]>` |
| `findOne(filter)` | `Promise<(T & RecordMeta) \| null>` |
| `count(filter?)` | `Promise<number>` |
| `first(n)` | `Promise<(T & RecordMeta)[]>` |
| `last(n)` | `Promise<(T & RecordMeta)[]>` |
| `paginate({ limit, after? })` | `Promise<PaginatedResult<T>>` |

#### Aggregation

| Method | Returns |
|--------|---------|
| `sum(field, filter?)` | `Promise<number>` |
| `avg(field, filter?)` | `Promise<number>` |
| `min(field, filter?)` | `Promise<number \| null>` |
| `max(field, filter?)` | `Promise<number \| null>` |

#### Bulk

| Method | Description |
|--------|-------------|
| `clear()` | Remove all records from the bucket |

---

### RulesAPI

Access via `client.rules`. Available only when the server has a rules engine configured.

#### Events

```typescript
const event = await client.rules.emit('user.created', { userId: '123' });
// event: RulesEvent { id, topic, data, timestamp, source, ... }

// With correlation/causation IDs
const event = await client.rules.emit(
  'order.completed',
  { orderId: '456' },
  'correlation-id',
  'causation-id',
);
```

#### Facts

```typescript
await client.rules.setFact('user:1:status', 'active');
const status = await client.rules.getFact('user:1:status');
const deleted = await client.rules.deleteFact('user:1:status');
const facts = await client.rules.queryFacts('user:*:status');
const all = await client.rules.getAllFacts();
```

#### Subscriptions

Subscribe to real-time rule events by topic pattern:

```typescript
const unsub = await client.rules.subscribe('user.*', (event, topic) => {
  console.log(`${topic}:`, event);
});

unsub();
```

#### Stats

```typescript
const stats = await client.rules.stats();
```

---

### AuthAPI

Access via `client.auth`.

```typescript
const session = await client.auth.login('jwt-token');
// session: { userId, roles, metadata?, expiresAt? }

const current = await client.auth.whoami();
await client.auth.logout();
```

When `auth.token` is set in `ClientOptions`, login is performed automatically after connect and after each reconnect.

---

## Error Handling

All errors from the server are propagated as `NoexClientError` with a machine-readable `code`:

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await client.store.bucket('users').insert({ name: '' });
} catch (err) {
  if (err instanceof NoexClientError) {
    switch (err.code) {
      case 'VALIDATION_ERROR': break;
      case 'UNAUTHORIZED': break;
      case 'NOT_FOUND': break;
      case 'RATE_LIMITED': break;
    }
  }
}
```

| Error class | Code | Description |
|-------------|------|-------------|
| `NoexClientError` | *(server code)* | Base class for all server errors |
| `TimeoutError` | `TIMEOUT` | Request did not receive a response within `requestTimeoutMs` |
| `DisconnectedError` | `DISCONNECTED` | Attempted to send while not connected, or connection was lost |

Pending requests at the time of a disconnect are rejected with `DisconnectedError`. They are **not** retried automatically — the server does not persist request state across connections and automatic retry of non-idempotent operations (insert, emit) could cause duplicates.

---

## Reconnect Behavior

Reconnect is enabled by default. When the connection drops unexpectedly:

1. All pending requests are rejected with `DisconnectedError`
2. The client enters `'reconnecting'` state and emits `reconnecting` events
3. Exponential backoff with jitter determines the delay between attempts
4. On successful reconnect:
   - Auto-login is performed (if configured)
   - All active subscriptions are restored with fresh data
   - `'reconnected'` event is emitted
5. If max retries are exhausted, the client enters `'disconnected'` state

Calling `disconnect()` at any point stops the reconnect loop immediately.

---

## Production

### TLS / WSS

The noex-server itself listens on plain `ws://`. In production, terminate TLS at a reverse proxy (nginx, Caddy, etc.) and connect with `wss://`:

```typescript
const client = new NoexClient('wss://api.example.com');
await client.connect();
```

No client-side configuration is needed beyond changing the URL scheme — the underlying WebSocket implementation handles TLS transparently.

See the [noex-server Production Considerations](https://github.com/hamicek/noex-server#production-considerations) for a reverse proxy configuration example.

---

## License

MIT
