# Subscribing to Queries

The noex-server supports **reactive queries** — named queries defined on the server that automatically re-evaluate when underlying data changes. The client subscribes to these queries and receives push updates in real time. This chapter covers the `store.subscribe()` method, how initial data is delivered, and how push updates arrive.

## What You'll Learn

- How reactive queries work on the server side
- How to subscribe with `store.subscribe(query, callback)`
- How initial data is delivered to the callback
- How push updates arrive when data changes
- The subscription lifecycle from subscribe to push

## How Reactive Queries Work

Reactive queries are defined on the **server** — the client only references them by name. Here's the flow:

```
                            Server
                         ┌──────────────────────────────┐
Client                   │                              │
┌──────────┐  subscribe  │  ┌─────────────────────┐     │
│  store.   │──────────>│  │ Evaluate query      │     │
│ subscribe │            │  │ Return initial data │     │
│ ('query') │<──────────│  └─────────────────────┘     │
└──────────┘   result    │                              │
                         │  ... data changes ...        │
┌──────────┐   push      │  ┌─────────────────────┐     │
│ callback  │<──────────│  │ Re-evaluate query   │     │
│ (data)    │            │  │ Push if result ≠    │     │
└──────────┘             │  └─────────────────────┘     │
                         └──────────────────────────────┘
```

Key points:
- The server defines queries (e.g. "return all users", "count active sessions")
- The client subscribes by **name** — it doesn't send the query logic
- The server pushes updates **only** when the query result actually changes
- If a mutation doesn't affect the query result, no push is sent

## store.subscribe()

The basic form takes a query name and a callback:

```typescript
const unsubscribe = await client.store.subscribe('all-users', (data) => {
  console.log('Users:', data);
});
```

**Signature:**

```typescript
subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| query | `string` | Name of the server-side query |
| callback | `(data: unknown) => void` | Called with initial data and on every push |

Returns `Promise<Unsubscribe>` — a synchronous function `() => void` that stops the subscription.

## Initial Data Delivery

When you call `subscribe()`, the server evaluates the query immediately and returns the current result. The callback is invoked **synchronously** with this data **before** the promise resolves:

```typescript
const received: unknown[] = [];

const unsub = await client.store.subscribe('all-users', (data) => {
  received.push(data);
});

// By this point, the callback has already been called once
console.log(received.length); // 1
console.log(received[0]);     // [] (empty array if no users exist)
```

This guarantee means that after `await subscribe()`, your callback always has the current state. You don't need a separate "fetch initial data" step.

## Push Updates

After the initial delivery, the server monitors the underlying data. When a mutation (insert, update, delete) causes the query result to change, the server sends a push message and your callback is called again:

```typescript
const snapshots: unknown[] = [];

await client.store.subscribe('all-users', (data) => {
  snapshots.push(data);
});

// snapshots[0] = [] (initial: no users)

await client.store.bucket('users').insert({ name: 'Alice' });
// After the server processes this, the query re-evaluates.
// snapshots[1] = [{ id: '...', name: 'Alice', ... }]

await client.store.bucket('users').insert({ name: 'Bob' });
// snapshots[2] = [{ id: '...', name: 'Alice', ... }, { id: '...', name: 'Bob', ... }]
```

Each push delivers the **complete** query result — not a diff. Your callback always receives the full current state.

### Pushes Are Selective

The server only pushes when the query result **actually changes**. If you subscribe to a filtered query and a mutation doesn't affect the filter, no push arrives:

```typescript
// Server defines 'users-by-role' query that filters by role parameter
await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
  console.log('Admins:', data);
});

// This insert creates a 'user' role — the admin query result doesn't change
// → no push arrives
await client.store.bucket('users').insert({ name: 'Regular', role: 'user' });

// This insert creates an 'admin' role — the admin query result changes
// → push arrives with the updated list
await client.store.bucket('users').insert({ name: 'AdminUser', role: 'admin' });
```

## Scalar Queries

Queries don't have to return arrays. A count query returns a number:

```typescript
await client.store.subscribe('user-count', (data) => {
  console.log('Total users:', data); // data is a number
});

// Initial: 0
// After insert: 1
// After another insert: 2
```

The callback receives whatever the server-side query returns — arrays, objects, numbers, or any other JSON value.

## Complete Working Example

A live user list that stays in sync with the server:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Subscribe to the 'all-users' query defined on the server
  const unsub = await client.store.subscribe('all-users', (data) => {
    const users = data as Array<{ name: string; role: string }>;
    console.log(`[${new Date().toISOString()}] ${users.length} users:`);
    for (const user of users) {
      console.log(`  - ${user.name} (${user.role})`);
    }
  });

  // Simulate mutations — each triggers a push update
  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'editor' });

  // Wait to see push updates arrive
  await new Promise((r) => setTimeout(r, 500));

  // Clean up
  unsub();
  await client.disconnect();
}

main().catch(console.error);
```

Output:

```
[2025-01-15T10:00:00.000Z] 0 users:
[2025-01-15T10:00:00.050Z] 1 users:
  - Alice (admin)
[2025-01-15T10:00:00.100Z] 2 users:
  - Alice (admin)
  - Bob (editor)
```

## Error Handling

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await client.store.subscribe('nonexistent-query', (data) => {
    // ...
  });
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // e.g. 'QUERY_NOT_FOUND'
    console.log(err.message); // human-readable description
  }
  if (err instanceof TimeoutError) {
    console.log('Server did not respond in time');
  }
  if (err instanceof DisconnectedError) {
    console.log('Not connected to server');
  }
}
```

If your callback throws during the **initial** data delivery, the subscription is automatically cleaned up and the error propagates to the caller:

```typescript
try {
  await client.store.subscribe('all-users', (data) => {
    throw new Error('processing failed');
  });
} catch (err) {
  // err.message === 'processing failed'
  // Subscription has been cleaned up — no leak
}
```

If the callback throws during a **push** update, the error is logged to `console.error` but the subscription stays active. The client does not crash.

## Exercise

Write a script that:
1. Subscribes to an `all-users` query
2. Collects every snapshot the callback receives into an array
3. Inserts two users
4. Waits briefly for push updates
5. Logs the total number of snapshots received and the final snapshot

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const snapshots: unknown[] = [];

  const unsub = await client.store.subscribe('all-users', (data) => {
    snapshots.push(data);
  });

  // Insert two users
  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'editor' });

  // Wait for push updates
  await new Promise((r) => setTimeout(r, 500));

  console.log('Total snapshots:', snapshots.length); // 3
  console.log('Initial:', snapshots[0]);              // []
  console.log('Final:', snapshots[snapshots.length - 1]);

  unsub();
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- Reactive queries are defined on the server — the client subscribes by name
- `store.subscribe(query, callback)` returns `Promise<Unsubscribe>`
- The callback receives **initial data synchronously** before the promise resolves
- Push updates deliver the **complete** query result, not diffs
- The server only pushes when the query result actually changes
- Scalar queries (count, aggregations) work the same way — callback receives the value directly
- Callback errors during initial delivery clean up the subscription automatically
- Callback errors during push updates are logged but don't break the subscription

---

Next: [Parameterized Queries](./02-parameterized-queries.md)
