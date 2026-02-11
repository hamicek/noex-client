# Testing Patterns

With the test environment in place, this chapter covers how to test the four pillars of a real-time application: subscriptions, reconnect recovery, authentication, and edge cases. Each section shows the exact patterns used in the noex-client test suite — patterns that have been proven reliable against timing issues and race conditions.

## What You'll Learn

- How to test subscription initial data and push notifications
- How to test reconnect with server restart and subscription recovery
- How to test authentication flows (login, auto-login, permissions)
- How to test edge cases: concurrent operations, callback errors, rapid subscribe/unsubscribe

## Testing Subscriptions

Subscription tests verify two things: **initial data delivery** (synchronous, arrives before `subscribe()` resolves) and **push notifications** (asynchronous, arrive after a mutation triggers a query re-evaluation).

### Setting Up Queries

Queries must be defined on the server-side store before subscribing:

```typescript
beforeEach(async () => {
  ctx = await startTestServer({
    buckets: [
      { name: 'users', schema: { name: { type: 'string', required: true } } },
    ],
  });

  ctx.store.defineQuery('all-users', async (qCtx) => {
    return qCtx.bucket('users').all();
  });

  ctx.store.defineQuery('user-count', async (qCtx) => {
    return qCtx.bucket('users').count();
  });

  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();
});
```

### Testing Initial Data

The callback is invoked with initial data before `subscribe()` resolves:

```typescript
it('delivers existing records as initial data', async () => {
  await client.store.bucket('users').insert({ name: 'Alice' });

  const received: unknown[] = [];
  await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  const users = received[0] as Record<string, unknown>[];
  expect(users).toHaveLength(1);
  expect(users[0]!['name']).toBe('Alice');
});

it('delivers scalar initial data (count query)', async () => {
  await client.store.bucket('users').insert({ name: 'A' });
  await client.store.bucket('users').insert({ name: 'B' });

  const received: unknown[] = [];
  await client.store.subscribe('user-count', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  expect(received[0]).toBe(2);
});
```

### Testing Push Notifications

The three-step pattern for push testing: **mutate** → **settle** → **waitFor**:

```typescript
it('calls callback when record is inserted', async () => {
  const received: unknown[] = [];
  await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1); // initial: []

  await client.store.bucket('users').insert({ name: 'Bob' });
  await ctx.store.settle();                    // 1. Server re-evaluates queries
  await waitFor(() => received.length >= 2);   // 2. Client receives push

  const users = received[1] as Record<string, unknown>[];
  expect(users).toHaveLength(1);
  expect(users[0]!['name']).toBe('Bob');
});
```

```
  mutate          settle()         waitFor()         assert
    │                │                 │                │
    ▼                ▼                 ▼                ▼
 insert()  →  queries re-eval  →  push arrives  →  check data
              (server-side)      (client-side)
```

### Testing Smart Push (No Spurious Updates)

Subscriptions only push when the query result **actually changes**:

```typescript
it('only pushes when query result actually changes', async () => {
  const received: unknown[] = [];
  await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  expect(received[0]).toEqual([]);

  // Insert a regular user — filtered query result unchanged
  await client.store.bucket('users').insert({ name: 'Regular', role: 'user' });
  await ctx.store.settle();

  // Small delay to verify no push arrives
  await new Promise((r) => setTimeout(r, 100));
  expect(received).toHaveLength(1); // Still 1 — no spurious push

  // Insert an admin — query result changes
  await client.store.bucket('users').insert({ name: 'AdminUser', role: 'admin' });
  await ctx.store.settle();
  await waitFor(() => received.length >= 2);

  const admins = received[1] as Record<string, unknown>[];
  expect(admins).toHaveLength(1);
  expect(admins[0]!['name']).toBe('AdminUser');
});
```

### Testing Unsubscribe

The `subscribe()` return value is a synchronous unsubscribe function:

```typescript
it('stops push notifications after unsubscribe', async () => {
  const received: unknown[] = [];
  const unsub = await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);

  unsub(); // Synchronous — no await needed

  await client.store.bucket('users').insert({ name: 'Ghost' });
  await ctx.store.settle();

  // Wait a bit to confirm no push arrives
  await new Promise((r) => setTimeout(r, 200));
  expect(received).toHaveLength(1); // No new data
});
```

## Testing Reconnect

Reconnect tests need manual server management. The pattern: start a server, connect, stop the server, restart it on the same port, verify the client recovers.

### Basic Reconnect

```typescript
const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 0,
  maxRetries: 20,
} as const;

it('reconnects after server restart', async () => {
  await setup(); // Creates store + server
  const port = server!.port;

  client = new NoexClient(`ws://127.0.0.1:${port}`, {
    WebSocket: WebSocket as never,
    reconnect: FAST_RECONNECT,
    connectTimeoutMs: 2_000,
  });
  await client.connect();

  // Set up the listener BEFORE stopping the server
  const reconnectedPromise = waitForEvent(client, 'reconnected');

  // Stop server → triggers disconnect
  await server!.stop();

  // Client should enter reconnecting state
  await waitFor(() => client!.state === 'reconnecting');

  // Start new server on the same port
  server = await NoexServer.start({
    store: store!,
    port,
    host: '127.0.0.1',
  });

  await reconnectedPromise;
  expect(client.isConnected).toBe(true);
  expect(client.state).toBe('connected');
});
```

### Testing Max Retries Exhaustion

```typescript
it('gives up after max retries and emits disconnected', async () => {
  await setup();
  const port = server!.port;

  client = new NoexClient(`ws://127.0.0.1:${port}`, {
    WebSocket: WebSocket as never,
    reconnect: {
      initialDelayMs: 10,
      maxDelayMs: 10,
      jitterMs: 0,
      maxRetries: 3,
    },
    connectTimeoutMs: 100,
  });

  await client.connect();

  const errors: Error[] = [];
  client.on('error', (err) => errors.push(err));

  const disconnectedPromise = waitForEvent<string>(client, 'disconnected');

  // Stop server permanently — don't restart
  await server!.stop();

  const reason = await disconnectedPromise;
  expect(client.state).toBe('disconnected');
  expect(reason).toContain('Max reconnect');
  expect(errors.find((e) => e.message.includes('Max reconnect'))).toBeDefined();
});
```

### Testing Subscription Recovery

After reconnect, the SDK automatically resubscribes to all active subscriptions:

```typescript
it('restores store subscriptions after reconnect', async () => {
  await setup();
  const port = server!.port;

  client = createClient(port);
  await client.connect();

  await client.store.bucket('users').insert({ name: 'Alice' });

  const received: unknown[] = [];
  await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  const initial = received[0] as Record<string, unknown>[];
  expect(initial).toHaveLength(1);

  // Restart server
  const reconnectedPromise = waitForEvent(client, 'reconnected');
  await restartServer();
  await reconnectedPromise;

  // Resubscribe should have delivered current data
  await waitFor(() => received.length >= 2);

  const resubData = received[received.length - 1] as Record<string, unknown>[];
  expect(resubData).toHaveLength(1);
  expect(resubData[0]!['name']).toBe('Alice');
});
```

### Testing Push After Reconnect

Verify that push notifications continue working after a reconnect:

```typescript
it('receives push notifications after reconnect', async () => {
  await setup();
  const port = server!.port;

  client = createClient(port);
  await client.connect();

  const received: unknown[] = [];
  await client.store.subscribe('user-count', (data) => {
    received.push(data);
  });

  expect(received[0]).toBe(0);

  const reconnectedPromise = waitForEvent(client, 'reconnected');
  await restartServer();
  await reconnectedPromise;

  // Insert after reconnect — should trigger push via resubscribed subscription
  await client.store.bucket('users').insert({ name: 'Bob' });
  await store!.settle();
  await waitFor(() => received.some((v) => v === 1));

  expect(received[received.length - 1]).toBe(1);
});
```

## Testing Authentication

Auth tests use a custom `AuthConfig` that maps tokens to sessions:

### Auth Fixture

```typescript
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';

const userSession: AuthSession = { userId: 'user-1', roles: ['user'] };
const adminSession: AuthSession = { userId: 'admin-1', roles: ['admin'] };

function createAuth(): AuthConfig {
  return {
    validate: async (token) => {
      if (token === 'valid-user') return userSession;
      if (token === 'valid-admin') return adminSession;
      return null;
    },
  };
}
```

### Testing Login and Session

```typescript
it('should login with valid token', async () => {
  ctx = await startTestServer({ auth: createAuth() });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();

  const session = await client.auth.login('valid-user');
  expect(session.userId).toBe('user-1');
  expect(session.roles).toEqual(['user']);
});

it('should reject login with invalid token', async () => {
  ctx = await startTestServer({ auth: createAuth() });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();

  await expect(client.auth.login('bad-token')).rejects.toThrow(NoexClientError);

  try {
    await client.auth.login('bad-token');
  } catch (err) {
    expect((err as NoexClientError).code).toBe('UNAUTHORIZED');
  }
});
```

### Testing Auto-Login

When `auth.token` is set in `ClientOptions`, the SDK logs in automatically after connect (and after reconnect):

```typescript
it('should auto-login when token is provided', async () => {
  ctx = await startTestServer({ auth: createAuth() });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
    auth: { token: 'valid-user' },
  });

  const welcome = await client.connect();
  expect(welcome.requiresAuth).toBe(true);

  // Already authenticated — no explicit login needed
  const session = await client.auth.whoami();
  expect(session).not.toBeNull();
  expect(session!.userId).toBe('user-1');
});
```

### Testing Permission Enforcement

```typescript
it('should enforce permissions', async () => {
  ctx = await startTestServer({
    auth: createAuth({
      permissions: {
        check: (session, _operation, _resource) => {
          return session.roles.includes('admin');
        },
      },
    }),
    buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
  });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();

  // User without admin role — denied
  await client.auth.login('valid-user');
  await expect(
    client.store.bucket('items').insert({ value: 1 }),
  ).rejects.toThrow(NoexClientError);

  // Re-login as admin — allowed
  await client.auth.login('valid-admin');
  const record = await client.store.bucket('items').insert({ value: 2 });
  expect(record['value']).toBe(2);
});
```

## Testing Edge Cases

### Concurrent Operations

Verify that the SDK correctly correlates responses when many requests are in flight:

```typescript
it('should handle 50 concurrent inserts without losing correlation', async () => {
  const bucket = client.store.bucket('items');
  const promises = Array.from({ length: 50 }, (_, i) =>
    bucket.insert({ value: i }),
  );

  const results = await Promise.all(promises);

  expect(results).toHaveLength(50);
  const values = results.map((r) => r['value'] as number).sort((a, b) => a - b);
  expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i));
});
```

### Callback Error Resilience

Errors in subscription callbacks during push updates are logged but don't break the subscription or the client:

```typescript
it('callback errors do not crash the client', async () => {
  let callCount = 0;

  await client.store.subscribe('all-users', (data) => {
    callCount++;
    if (callCount === 2) {
      throw new Error('callback boom'); // Throws on first push
    }
  });

  await client.store.bucket('users').insert({ name: 'Survivor' });
  await ctx.store.settle();
  await waitFor(() => callCount >= 2);

  // Client is still functional after callback error
  expect(client.isConnected).toBe(true);

  // Can still make requests
  const all = await client.store.bucket('users').all();
  expect(all).toHaveLength(1);
});
```

However, errors during **initial data delivery** reject the `subscribe()` promise:

```typescript
it('rejects subscribe when initial data callback throws', async () => {
  await expect(
    client.store.subscribe('user-count', () => {
      throw new Error('initial boom');
    }),
  ).rejects.toThrow('initial boom');

  // Client remains functional
  expect(client.isConnected).toBe(true);
});
```

### Rapid Subscribe/Unsubscribe Churn

Tests that rapid subscribe/unsubscribe cycles don't leak resources:

```typescript
it('should handle rapid subscribe/unsubscribe churn', async () => {
  for (let i = 0; i < 10; i++) {
    const unsub = await client.store.subscribe('all-users', () => {});
    unsub();
  }

  // Client should be clean and functional
  expect(client.isConnected).toBe(true);

  const alice = await client.store.bucket('users').insert({ name: 'Alice' });
  expect(alice['name']).toBe('Alice');
});
```

### Multiple Connect/Disconnect Cycles

A single client instance can be reconnected after intentional disconnect:

```typescript
it('should handle multiple connect/disconnect cycles', async () => {
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });

  for (let i = 0; i < 5; i++) {
    await client.connect();
    expect(client.isConnected).toBe(true);
    await client.disconnect();
    expect(client.state).toBe('disconnected');
  }
});
```

### Requests During Reconnecting State

Requests sent while the client is reconnecting are rejected immediately:

```typescript
it('should throw DisconnectedError when client is reconnecting', async () => {
  // ... setup with reconnect enabled ...

  // Kill the server to trigger reconnect
  await server.stop();
  await waitFor(() => client!.state === 'reconnecting');

  // Attempt to send request while reconnecting
  await expect(
    client!.store.bucket('items').all(),
  ).rejects.toThrow(DisconnectedError);

  // Verify the error has the correct code
  try {
    await client!.store.bucket('items').all();
  } catch (err) {
    expect(err).toBeInstanceOf(DisconnectedError);
    expect((err as DisconnectedError).code).toBe('DISCONNECTED');
  }
});
```

## Test Organization Summary

```
tests/
├── integration/
│   ├── helpers/
│   │   └── test-server.ts        # Server helper
│   ├── connection.test.ts        # Connect, disconnect, events
│   ├── store-crud.test.ts        # Insert, get, update, delete, queries
│   ├── store-subscriptions.test.ts  # Subscribe, push, unsubscribe
│   ├── store-transactions.test.ts   # Atomic multi-op transactions
│   ├── reconnect.test.ts         # Reconnect, recovery, max retries
│   ├── auth.test.ts              # Login, logout, auto-login, permissions
│   ├── rules.test.ts             # Events, facts, rules subscriptions
│   ├── typed-bucket.test.ts      # Generic BucketAPI<T>
│   └── edge-cases.test.ts        # Concurrent ops, callback errors, churn
└── unit/
    ├── transport/
    │   ├── transport.test.ts     # WebSocket state machine
    │   └── reconnect.test.ts     # Backoff strategy
    ├── protocol/
    │   ├── request-manager.test.ts  # Request/response correlation
    │   └── push-router.test.ts      # Push message routing
    └── subscription/
        └── subscription-manager.test.ts  # Subscription lifecycle
```

## Complete Working Example

A test that covers the full lifecycle — connect, subscribe, mutate, receive push, reconnect, verify recovery:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';

function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) { clearInterval(interval); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(interval); reject(new Error('waitFor timed out')); }
    }, 5);
  });
}

function waitForEvent(client: NoexClient, event: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error(`${event} timed out`)); }, timeoutMs);
    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer); unsub(); resolve(args[0]);
    });
  });
}

describe('Full Lifecycle Test', () => {
  let store: Store;
  let server: NoexServer;
  let client: NoexClient;

  afterEach(async () => {
    try { await client?.disconnect(); } catch {}
    if (server?.isRunning) await server.stop();
    await store?.stop();
  });

  it('should survive a full connect → subscribe → mutate → reconnect cycle', async () => {
    // 1. Setup
    store = await Store.start({ name: 'lifecycle-test' });
    await store.defineBucket('tasks', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        title: { type: 'string', required: true },
      },
    });
    store.defineQuery('all-tasks', async (qCtx) => qCtx.bucket('tasks').all());

    server = await NoexServer.start({ store, port: 0, host: '127.0.0.1' });
    const port = server.port;

    client = new NoexClient(`ws://127.0.0.1:${port}`, {
      WebSocket: WebSocket as never,
      reconnect: { initialDelayMs: 50, maxDelayMs: 200, jitterMs: 0, maxRetries: 20 },
    });

    // 2. Connect
    await client.connect();
    expect(client.isConnected).toBe(true);

    // 3. Subscribe
    const received: unknown[] = [];
    await client.store.subscribe('all-tasks', (data) => {
      received.push(data);
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);

    // 4. Mutate and verify push
    await client.store.bucket('tasks').insert({ title: 'Buy milk' });
    await store.settle();
    await waitFor(() => received.length >= 2);

    const tasks = received[1] as Record<string, unknown>[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!['title']).toBe('Buy milk');

    // 5. Reconnect
    const reconnected = waitForEvent(client, 'reconnected');
    await server.stop();
    server = await NoexServer.start({ store, port, host: '127.0.0.1' });
    await reconnected;

    // 6. Verify subscription recovery
    await waitFor(() => received.length >= 3);

    // 7. Verify push works after reconnect
    await client.store.bucket('tasks').insert({ title: 'Walk the dog' });
    await store.settle();
    await waitFor(() => {
      const last = received[received.length - 1] as Record<string, unknown>[];
      return Array.isArray(last) && last.length === 2;
    });

    const final = received[received.length - 1] as Record<string, unknown>[];
    expect(final).toHaveLength(2);
  });
});
```

## Exercise

Write a test file that verifies **subscription independence**:

1. Create two subscriptions to the same query (`all-users`)
2. Insert a record and verify both callbacks receive the push
3. Unsubscribe the first subscription
4. Insert another record and verify only the second callback receives the push
5. Verify that the first callback's `received` array hasn't grown

<details>
<summary>Solution</summary>

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) { clearInterval(interval); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(interval); reject(new Error('timed out')); }
    }, 5);
  });
}

describe('Subscription Independence', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
    ctx.store.defineQuery('all-users', async (qCtx) => qCtx.bucket('users').all());

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx.stop();
  });

  it('unsubscribing one does not affect others', async () => {
    const received1: unknown[] = [];
    const received2: unknown[] = [];

    const unsub1 = await client.store.subscribe('all-users', (data) => {
      received1.push(data);
    });
    await client.store.subscribe('all-users', (data) => {
      received2.push(data);
    });

    // Both receive initial data
    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);

    // Insert — both receive push
    await client.store.bucket('users').insert({ name: 'Alice' });
    await ctx.store.settle();
    await waitFor(() => received1.length >= 2 && received2.length >= 2);
    expect(received1).toHaveLength(2);
    expect(received2).toHaveLength(2);

    // Unsubscribe first
    unsub1();

    // Insert again — only second receives
    await client.store.bucket('users').insert({ name: 'Bob' });
    await ctx.store.settle();
    await waitFor(() => received2.length >= 3);

    expect(received1).toHaveLength(2); // No new data
    expect(received2).toHaveLength(3); // Still receiving
  });
});
```

</details>

## Summary

- **Subscription tests** follow the pattern: subscribe → mutate → `settle()` → `waitFor()` → assert
- **Push-only-on-change** — verify no spurious pushes arrive with a short delay after irrelevant mutations
- **Reconnect tests** use `FAST_RECONNECT` options, manual server management, and `waitForEvent`
- **Subscription recovery** is automatic — after reconnect, the SDK resubscribes and delivers fresh data
- **Auth tests** use a custom `validate` function that maps known tokens to sessions
- **Auto-login** is tested by passing `auth: { token }` in `ClientOptions` and checking `whoami()` after connect
- **Concurrent operations** — use `Promise.all` and verify all responses are correctly correlated
- **Callback errors** during push don't crash the client; during initial data they reject `subscribe()`
- **Rapid churn** — subscribe/unsubscribe in a tight loop should not leak resources
- Organize tests by feature: connection, CRUD, subscriptions, reconnect, auth, transactions, edge cases

---

Next: [Todo App](../11-projects/01-todo-app.md)
