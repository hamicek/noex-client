# Parameterized Queries

Many reactive queries need dynamic input — filter by role, search by category, scope to a specific user. Instead of defining a separate query for every possible filter value, server-side queries accept **parameters**. The client passes these parameters at subscribe time.

## What You'll Learn

- How to subscribe with parameters using `store.subscribe(query, params, callback)`
- How parameters flow from client to server
- Typical use cases for parameterized queries
- How the same query name can serve different subscribers with different params

## The Three-Argument Form

The parameterized overload adds a `params` object between the query name and callback:

```typescript
subscribe(
  query: string,
  params: Record<string, unknown>,
  callback: (data: unknown) => void,
): Promise<Unsubscribe>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| query | `string` | Name of the server-side query |
| params | `Record<string, unknown>` | Key-value pairs passed to the query function |
| callback | `(data: unknown) => void` | Called with initial data and on every push |

## Basic Usage

Suppose the server defines a `users-by-role` query that filters users by their `role` field:

```typescript
// Subscribe to admins only
const unsub = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (data) => {
    const admins = data as Array<{ name: string; role: string }>;
    console.log('Admins:', admins.map((u) => u.name));
  },
);
```

The `{ role: 'admin' }` object is sent to the server, which uses it to evaluate the query. The callback receives only matching records.

## How Parameters Flow

```
Client                              Server
┌──────────────────┐                ┌────────────────────────────────────────┐
│ store.subscribe(  │   request     │ defineQuery('users-by-role',           │
│   'users-by-role',│──────────────>│   async (ctx, params) => {             │
│   { role:'admin'},│               │     return ctx.bucket('users')         │
│   callback        │               │       .where({ role: params.role });   │
│ )                 │               │   }                                    │
└──────────────────┘                │ )                                      │
                                    └────────────────────────────────────────┘
```

The `params` object is included in the subscribe request payload. The server-side query function receives it as its second argument and uses it to filter, sort, or transform the data.

## Multiple Subscribers, Same Query

Different clients (or the same client) can subscribe to the same query with different parameters. Each subscription is independent:

```typescript
// Subscription A: admins
const unsubAdmins = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (data) => {
    console.log('Admins:', data);
  },
);

// Subscription B: editors
const unsubEditors = await client.store.subscribe(
  'users-by-role',
  { role: 'editor' },
  (data) => {
    console.log('Editors:', data);
  },
);

// Insert an admin — only subscription A gets a push
await client.store.bucket('users').insert({ name: 'Alice', role: 'admin' });

// Insert an editor — only subscription B gets a push
await client.store.bucket('users').insert({ name: 'Bob', role: 'editor' });
```

Each subscription tracks its own result independently. A push is sent only when *that particular subscription's* query result changes.

## Complex Parameters

Parameters can contain any JSON-serializable values:

```typescript
// Multiple filter criteria
await client.store.subscribe(
  'filtered-products',
  { category: 'electronics', minPrice: 100, inStock: true },
  (data) => {
    console.log('Products:', data);
  },
);

// Pagination-style parameters
await client.store.subscribe(
  'recent-orders',
  { userId: 'user-42', limit: 10 },
  (data) => {
    console.log('Recent orders:', data);
  },
);
```

The structure of `params` depends entirely on what the server-side query expects. The client simply passes the object through.

## Comparing With and Without Params

| Scenario | Approach |
|----------|----------|
| All records in a bucket | `subscribe('all-users', callback)` |
| Records matching a condition | `subscribe('users-by-role', { role: 'admin' }, callback)` |
| A computed value (count, sum) | `subscribe('user-count', callback)` |
| A scoped computed value | `subscribe('user-count-by-role', { role: 'admin' }, callback)` |

## Reconnect Behavior

When the client reconnects after a connection loss, parameterized subscriptions are restored automatically with the **same parameters** that were originally provided. The server re-evaluates the query and delivers fresh data to your callback:

```typescript
const unsub = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (data) => {
    // Called on initial subscribe, on every push,
    // and again after reconnect with fresh data
    renderAdminList(data);
  },
);
```

You don't need to handle reconnect recovery manually — the subscription manager stores the original query name and params and replays them.

## Complete Working Example

A dashboard that tracks multiple user groups in real time:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const unsubscribes: Array<() => void> = [];

  // Track admins
  const unsubAdmins = await client.store.subscribe(
    'users-by-role',
    { role: 'admin' },
    (data) => {
      const admins = data as Array<{ name: string }>;
      console.log(`Admins (${admins.length}):`, admins.map((u) => u.name));
    },
  );
  unsubscribes.push(unsubAdmins);

  // Track editors
  const unsubEditors = await client.store.subscribe(
    'users-by-role',
    { role: 'editor' },
    (data) => {
      const editors = data as Array<{ name: string }>;
      console.log(`Editors (${editors.length}):`, editors.map((u) => u.name));
    },
  );
  unsubscribes.push(unsubEditors);

  // Track total count
  const unsubCount = await client.store.subscribe(
    'user-count',
    (data) => {
      console.log('Total users:', data);
    },
  );
  unsubscribes.push(unsubCount);

  // Simulate activity
  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'editor' });
  await users.insert({ name: 'Carol', role: 'admin' });

  await new Promise((r) => setTimeout(r, 500));

  // Clean up all subscriptions
  for (const unsub of unsubscribes) {
    unsub();
  }
  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Subscribes to `users-by-role` with `{ role: 'admin' }` and collects snapshots
2. Subscribes to `users-by-role` with `{ role: 'viewer' }` and collects snapshots
3. Inserts one admin and one viewer
4. Waits briefly, then verifies that each subscription only received pushes relevant to its filter

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const adminSnapshots: unknown[] = [];
  const viewerSnapshots: unknown[] = [];

  const unsubAdmin = await client.store.subscribe(
    'users-by-role',
    { role: 'admin' },
    (data) => { adminSnapshots.push(data); },
  );

  const unsubViewer = await client.store.subscribe(
    'users-by-role',
    { role: 'viewer' },
    (data) => { viewerSnapshots.push(data); },
  );

  // Both have initial data (empty arrays)
  console.log('Admin initial:', adminSnapshots[0]);   // []
  console.log('Viewer initial:', viewerSnapshots[0]); // []

  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'viewer' });

  await new Promise((r) => setTimeout(r, 500));

  // Admin subscription: initial [] + push with [Alice]
  console.log('Admin snapshots:', adminSnapshots.length);  // 2
  // Viewer subscription: initial [] + push with [Bob]
  console.log('Viewer snapshots:', viewerSnapshots.length); // 2

  unsubAdmin();
  unsubViewer();
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- Use `store.subscribe(query, params, callback)` to pass dynamic parameters to server-side queries
- Parameters are a `Record<string, unknown>` — any JSON-serializable key-value pairs
- The server-side query receives params as its second argument
- Multiple subscriptions with different params to the same query are independent
- Each subscription only receives pushes when its own result changes
- Parameters are preserved across reconnect — resubscription uses the original params automatically

---

Next: [Managing Subscriptions](./03-managing-subscriptions.md)
