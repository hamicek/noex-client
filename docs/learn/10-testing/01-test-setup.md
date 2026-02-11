# Test Setup

Integration tests for a real-time WebSocket SDK require a running server, dynamic port allocation, and careful cleanup. This chapter shows how to set up a test environment that is fast, isolated, and deterministic — using Vitest as the test runner and a helper that starts a real noex-server on a random port for each test.

## What You'll Learn

- How to configure Vitest for noex-client integration tests
- How to create a `startTestServer()` helper for test isolation
- The standard `beforeEach`/`afterEach` lifecycle pattern
- Why `reconnect: false` is the right default for most tests
- How to handle async timing with `waitFor()` and `store.settle()`

## Vitest Configuration

noex-client uses Vitest with explicit imports (no globals) and a 10-second timeout:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
```

| Field | Value | Why |
|-------|-------|-----|
| `globals` | `false` | Forces explicit `import { describe, it, expect } from 'vitest'` — no hidden magic |
| `environment` | `'node'` | Tests run in Node.js, not jsdom |
| `testTimeout` | `10_000` | WebSocket handshakes and reconnect tests need more than the default 5s |

Install the test dependencies:

```bash
npm install -D vitest ws @types/ws @hamicek/noex-server @hamicek/noex-store
```

## The Test Server Helper

The key to reliable integration tests is a helper that starts a real server on a random port (`port: 0`). This avoids port conflicts when running tests in parallel:

```typescript
// tests/integration/helpers/test-server.ts
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthConfig } from '@hamicek/noex-server';
import type { RuleEngine } from '@hamicek/noex-rules';

export interface TestServerContext {
  server: NoexServer;
  store: Store;
  rules?: RuleEngine;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

let storeCounter = 0;

export async function startTestServer(
  options?: {
    port?: number;
    buckets?: Array<{ name: string; schema: Record<string, unknown> }>;
    rules?: RuleEngine;
    auth?: AuthConfig;
  },
): Promise<TestServerContext> {
  const store = await Store.start({ name: `client-test-${++storeCounter}` });

  if (options?.buckets) {
    for (const b of options.buckets) {
      await store.defineBucket(b.name, {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          ...b.schema,
        },
      });
    }
  }

  const server = await NoexServer.start({
    store,
    rules: options?.rules,
    auth: options?.auth,
    port: options?.port ?? 0,
    host: '127.0.0.1',
  });

  const port = server.port;
  const url = `ws://127.0.0.1:${port}`;

  return {
    server,
    store,
    rules: options?.rules,
    url,
    port,
    async stop() {
      if (server.isRunning) {
        await server.stop();
      }
      await store.stop();
    },
  };
}
```

Key design decisions:

- **`port: 0`** — the OS assigns a free port, eliminating conflicts
- **`host: '127.0.0.1'`** — binds to localhost only, fast and secure
- **Unique store names** — the counter prevents collisions between concurrent tests
- **`stop()` checks `isRunning`** — safe to call even if the server was already stopped (e.g. in reconnect tests)

## Standard Test Lifecycle

Every integration test file follows the same structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Feature X', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client?.isConnected) {
      await client.disconnect();
    }
    await ctx.stop();
  });

  it('should do something', async () => {
    const bucket = client.store.bucket('users');
    const record = await bucket.insert({ name: 'Alice' });
    expect(record['name']).toBe('Alice');
  });
});
```

Three critical details:

1. **`WebSocket: WebSocket as never`** — passes the `ws` library's WebSocket class to the client. The `as never` cast is needed because `ws` and the browser WebSocket have slightly different type signatures, but they are compatible at runtime.

2. **`reconnect: false`** — disables automatic reconnect. Without this, a server shutdown in `afterEach` would trigger reconnect attempts that race with the next test's server startup, causing flaky failures.

3. **`afterEach` always cleans up** — disconnects the client first, then stops the server. Order matters: disconnecting the client first avoids a reconnect loop triggered by the server shutdown.

## Async Timing: waitFor() and store.settle()

Real-time systems are inherently asynchronous. Two helpers make timing reliable:

### waitFor() — Poll Until a Condition Is True

```typescript
function waitFor(
  fn: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 5);
  });
}
```

Use `waitFor` when waiting for push messages to arrive:

```typescript
const received: unknown[] = [];
await client.store.subscribe('all-users', (data) => {
  received.push(data);
});

// received.length === 1 (initial data already arrived)

await client.store.bucket('users').insert({ name: 'Bob' });
await ctx.store.settle();
await waitFor(() => received.length >= 2);

// Now safe to assert on received[1]
```

### store.settle() — Wait for Server-Side Query Evaluation

After a mutation (insert, update, delete), the server re-evaluates all affected queries asynchronously. `store.settle()` waits until all pending evaluations complete:

```
Client                    Server
  │                         │
  ├── insert({ name }) ──►  │
  │                         ├── store mutation
  │  ◄── { id, name } ─────┤
  │                         ├── re-evaluate queries (async!)
  │                         │   └── settle() waits here
  │                         ├── push notification
  │  ◄── push data ─────────┤
  │                         │
```

Without `settle()`, the push notification might not have been sent yet when you check `received.length`. With `settle()`, the server guarantees all query evaluations are done before returning.

**The pattern:** always call `ctx.store.settle()` after a mutation, then `waitFor()` on the client side:

```typescript
await client.store.bucket('users').insert({ name: 'Bob' });
await ctx.store.settle();  // Server: all queries re-evaluated
await waitFor(() => received.length >= 2);  // Client: push arrived
```

### waitForEvent() — Wait for a Lifecycle Event

For reconnect tests, you often need to wait for a specific event:

```typescript
function waitForEvent<T = void>(
  client: NoexClient,
  event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'error' | 'welcome',
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer);
      unsub();
      resolve(args[0] as T);
    });
  });
}
```

Usage:

```typescript
const reconnectedPromise = waitForEvent(client, 'reconnected');

// ... restart the server ...

await reconnectedPromise; // Resolves when the client reconnects
```

## Reconnect Test Setup

Reconnect tests need a different setup because they must control the server lifecycle independently. Instead of `startTestServer`, they create the store and server manually:

```typescript
const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 0,
  maxRetries: 20,
} as const;

let store: Store;
let server: NoexServer;

async function setup() {
  store = await Store.start({ name: `reconnect-test-${Date.now()}` });
  await store.defineBucket('users', {
    key: 'id',
    schema: {
      id: { type: 'string', generated: 'uuid' },
      name: { type: 'string', required: true },
    },
  });

  server = await NoexServer.start({
    store,
    port: 0,
    host: '127.0.0.1',
  });
}

async function restartServer() {
  const port = server.port;
  await server.stop();

  server = await NoexServer.start({
    store,  // Same store — data persists across restarts
    port,   // Same port — client can reconnect
    host: '127.0.0.1',
  });
}
```

Key differences from the standard setup:

- **`FAST_RECONNECT`** — low delays and zero jitter so tests finish quickly
- **`restartServer()`** reuses the same `store` and `port` — the client reconnects to the same address and sees the same data
- **Store outlives the server** — only `server.stop()` is called, not `store.stop()`

## Complete Working Example

A minimal test file that verifies CRUD operations:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError, DisconnectedError } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Users CRUD', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
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

  it('should insert and retrieve a user', async () => {
    const bucket = client.store.bucket('users');

    const inserted = await bucket.insert({ name: 'Alice' });
    expect(inserted['name']).toBe('Alice');
    expect(typeof inserted['id']).toBe('string');

    const found = await bucket.get(inserted['id']);
    expect(found).not.toBeNull();
    expect(found!['name']).toBe('Alice');
  });

  it('should reject requests after disconnect', async () => {
    await client.disconnect();

    // request() throws synchronously when not connected
    expect(() => {
      client.request('store.all', { bucket: 'users' });
    }).toThrow(DisconnectedError);
  });

  it('should return server errors as NoexClientError', async () => {
    try {
      await client.store.bucket('nonexistent').all();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NoexClientError);
      expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
    }
  });
});
```

## Exercise

Create a test file that:
1. Starts a test server with two buckets: `users` (name: string) and `logs` (action: string)
2. Tests that inserting into one bucket doesn't affect the other
3. Tests that requesting from a nonexistent bucket returns a `NoexClientError` with code `'BUCKET_NOT_DEFINED'`
4. Properly cleans up in `afterEach`

<details>
<summary>Solution</summary>

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Multi-Bucket Isolation', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
        { name: 'logs', schema: { action: { type: 'string', required: true } } },
      ],
    });
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

  it('should keep buckets isolated', async () => {
    const users = client.store.bucket('users');
    const logs = client.store.bucket('logs');

    await users.insert({ name: 'Alice' });
    await logs.insert({ action: 'user_created' });

    const allUsers = await users.all();
    const allLogs = await logs.all();

    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]!['name']).toBe('Alice');
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0]!['action']).toBe('user_created');
  });

  it('should reject requests to nonexistent bucket', async () => {
    try {
      await client.store.bucket('nonexistent').all();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NoexClientError);
      expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
    }
  });
});
```

</details>

## Summary

- Use **Vitest** with `globals: false`, `environment: 'node'`, and `testTimeout: 10_000`
- The **`startTestServer()`** helper creates an isolated server on a random port (`port: 0`)
- Always **disable reconnect** in standard tests: `reconnect: false`
- Clean up in `afterEach`: disconnect the client first, then stop the server
- Use **`ctx.store.settle()`** after mutations to wait for server-side query re-evaluation
- Use **`waitFor(fn)`** to poll until client-side conditions are met (e.g. push arrival)
- Use **`waitForEvent(client, event)`** to wait for lifecycle events in reconnect tests
- Reconnect tests use **`FAST_RECONNECT`** options and manual server management for control

---

Next: [Testing Patterns](./02-testing-patterns.md)
