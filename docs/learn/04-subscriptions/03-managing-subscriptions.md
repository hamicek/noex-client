# Managing Subscriptions

Every subscription consumes resources — memory on the client, a tracked query on the server, and a channel for push messages. This chapter covers how to properly unsubscribe, common cleanup patterns, and what happens to subscriptions during reconnect and disconnect.

## What You'll Learn

- How the `Unsubscribe` function works
- The difference between the returned function and `store.unsubscribe()`
- Cleanup patterns for different application contexts
- How subscriptions behave during reconnect and disconnect
- How to avoid resource leaks

## The Unsubscribe Function

`store.subscribe()` returns a function that stops the subscription:

```typescript
const unsubscribe = await client.store.subscribe('all-users', (data) => {
  renderUsers(data);
});

// Later, when you no longer need updates:
unsubscribe();
```

Key properties of the unsubscribe function:

| Property | Value |
|----------|-------|
| Return type | `() => void` |
| Synchronous? | Yes — no `await` needed |
| Waits for server? | No — fire-and-forget |
| Safe to call twice? | Yes — second call is a no-op |

Under the hood, calling `unsubscribe()`:
1. Removes the subscription from the client's internal `SubscriptionManager`
2. Sends a `store.unsubscribe` request to the server (fire-and-forget, errors are silently ignored)

After calling `unsubscribe()`, no further push updates will reach the callback — even if the server hasn't processed the unsubscribe request yet.

## store.unsubscribe() — The Explicit Method

There's also an explicit `store.unsubscribe()` method that works with the server-assigned subscription ID:

```typescript
store.unsubscribe(subscriptionId: string): Promise<void>
```

Unlike the returned function, this method **awaits** the server response. It's an advanced API — in most cases, the returned unsubscribe function is simpler and sufficient.

## Verifying Unsubscribe Works

After unsubscribing, no more pushes arrive:

```typescript
const received: unknown[] = [];

const unsub = await client.store.subscribe('all-users', (data) => {
  received.push(data);
});

// Initial data delivered
console.log(received.length); // 1

// Stop the subscription
unsub();

// This insert won't trigger a push to our callback
await client.store.bucket('users').insert({ name: 'Ghost' });
await new Promise((r) => setTimeout(r, 200));

console.log(received.length); // Still 1
```

## Cleanup Patterns

### Pattern: Single Subscription

Store the unsubscribe function and call it when done:

```typescript
let unsub: (() => void) | null = null;

async function startWatching() {
  unsub = await client.store.subscribe('all-users', (data) => {
    renderUsers(data);
  });
}

function stopWatching() {
  unsub?.();
  unsub = null;
}
```

### Pattern: Multiple Subscriptions

Collect all unsubscribe functions and call them together:

```typescript
const unsubscribes: Array<() => void> = [];

async function setup() {
  unsubscribes.push(
    await client.store.subscribe('all-users', renderUsers),
  );
  unsubscribes.push(
    await client.store.subscribe('user-count', renderCount),
  );
  unsubscribes.push(
    await client.store.subscribe('users-by-role', { role: 'admin' }, renderAdmins),
  );
}

function teardown() {
  for (const unsub of unsubscribes) {
    unsub();
  }
  unsubscribes.length = 0;
}
```

### Pattern: AbortController Integration

Use `AbortController` to coordinate subscription cleanup with other cancellable work:

```typescript
const controller = new AbortController();

async function start() {
  const unsub = await client.store.subscribe('all-users', (data) => {
    renderUsers(data);
  });

  // Clean up when abort signal fires
  controller.signal.addEventListener('abort', () => {
    unsub();
  });
}

// Cancel everything
controller.abort();
```

## Independent Subscriptions

Unsubscribing from one subscription does not affect others:

```typescript
const unsubUsers = await client.store.subscribe('all-users', renderUsers);
const unsubCount = await client.store.subscribe('user-count', renderCount);

// Stop watching users — count subscription continues
unsubUsers();

// Count still receives pushes
await client.store.bucket('users').insert({ name: 'New' });
// renderCount is called with the updated count
```

## Disconnect Behavior

When you call `client.disconnect()`, all subscriptions are cleared immediately:

```typescript
await client.store.subscribe('all-users', renderUsers);
await client.store.subscribe('user-count', renderCount);

// Both subscriptions are gone — no server-side unsubscribe requests needed
// (the server cleans up when the WebSocket closes)
await client.disconnect();
```

You don't need to manually unsubscribe before disconnecting. However, if you're going to **reconnect** later, subscriptions are preserved and restored (see below).

## Reconnect Behavior

When the client reconnects automatically after a connection loss, all active subscriptions are **restored**:

1. The client re-sends the original subscribe request for each active subscription
2. The server assigns new subscription IDs
3. Each callback receives fresh data (the current query result)
4. The existing unsubscribe functions continue to work with the new IDs

```typescript
const unsub = await client.store.subscribe('all-users', (data) => {
  // Called on initial subscribe
  // Called again after reconnect with fresh data
  renderUsers(data);
});

// Later, even after a reconnect, this still works:
unsub();
```

If a subscription fails to restore during reconnect (e.g. the query was removed from the server), it's silently dropped and logged to `console.error`.

## Complete Working Example

A managed subscription lifecycle with setup and teardown:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

class Dashboard {
  private unsubscribes: Array<() => void> = [];
  private client: NoexClient;

  constructor(url: string) {
    this.client = new NoexClient(url, { WebSocket });
  }

  async start() {
    await this.client.connect();

    this.unsubscribes.push(
      await this.client.store.subscribe('all-users', (data) => {
        const users = data as Array<{ name: string }>;
        console.log(`Users: ${users.length}`);
      }),
    );

    this.unsubscribes.push(
      await this.client.store.subscribe(
        'users-by-role',
        { role: 'admin' },
        (data) => {
          const admins = data as Array<{ name: string }>;
          console.log(`Admins: ${admins.length}`);
        },
      ),
    );

    console.log('Dashboard started');
  }

  async stop() {
    // Unsubscribe from all queries
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes.length = 0;

    await this.client.disconnect();
    console.log('Dashboard stopped');
  }
}

async function main() {
  const dashboard = new Dashboard('ws://localhost:8080');
  await dashboard.start();

  // Run for a while...
  await new Promise((r) => setTimeout(r, 5000));

  await dashboard.stop();
}

main().catch(console.error);
```

## Exercise

Write a function `watchBucket` that:
1. Takes a client, a query name, and a log prefix
2. Subscribes to the query and logs `${prefix}: ${data}` on each callback
3. Returns an object `{ unsub: () => void, count: () => number }` where `count()` returns how many times the callback was invoked

<details>
<summary>Solution</summary>

```typescript
async function watchBucket(
  client: NoexClient,
  query: string,
  prefix: string,
): Promise<{ unsub: () => void; count: () => number }> {
  let callCount = 0;

  const unsub = await client.store.subscribe(query, (data) => {
    callCount++;
    console.log(`${prefix}:`, data);
  });

  return {
    unsub,
    count: () => callCount,
  };
}

// Usage:
const users = await watchBucket(client, 'all-users', 'Users');
const count = await watchBucket(client, 'user-count', 'Count');

await client.store.bucket('users').insert({ name: 'Alice' });
await new Promise((r) => setTimeout(r, 500));

console.log('Users callback invocations:', users.count()); // 2 (initial + push)
console.log('Count callback invocations:', count.count()); // 2 (initial + push)

users.unsub();
count.unsub();
```

</details>

## Summary

- `subscribe()` returns `() => void` — a synchronous, fire-and-forget unsubscribe function
- The returned function is safe to call multiple times
- `store.unsubscribe(id)` is an advanced alternative that awaits server confirmation
- Unsubscribing one subscription does not affect others
- Collect unsubscribe functions in an array for batch cleanup
- `client.disconnect()` clears all subscriptions automatically
- On reconnect, active subscriptions are restored with the same query and params
- Always unsubscribe when you no longer need updates to avoid resource leaks

---

Next: [Atomic Operations](../05-transactions/01-atomic-operations.md)
