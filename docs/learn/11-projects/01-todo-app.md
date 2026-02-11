# Todo App

Build a real-time todo application where changes made by one client appear instantly on all connected clients. This project combines store CRUD operations with reactive subscriptions — the two most fundamental noex-client features.

## What You'll Learn

- Setting up a noex-server with a typed bucket and reactive queries
- Performing CRUD operations through the client SDK
- Subscribing to queries for live todo list updates
- Multi-client synchronization through push notifications
- Proper cleanup with unsubscribe and disconnect

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     noex-server                          │
│                                                          │
│  Bucket: todos                Queries                    │
│  ┌─────────────────────┐      ┌────────────────────┐    │
│  │ id: string (uuid)   │      │ all-todos           │    │
│  │ title: string        │      │ active-todos        │    │
│  │ completed: boolean   │      │ completed-count     │    │
│  └─────────────────────┘      └────────────────────┘    │
│                                                          │
│          push ↓              push ↓                      │
│  ┌──────────────┐      ┌──────────────┐                 │
│  │   Client A   │      │   Client B   │                 │
│  │   mutates    │      │   subscribes │                 │
│  │   todos      │      │   receives   │                 │
│  │              │      │   live list  │                 │
│  └──────────────┘      └──────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

When Client A inserts, updates, or deletes a todo, the server re-evaluates all active queries. Client B (and any other subscriber) receives a push with the updated result — no polling required.

## Part 1: Server Setup

The server defines the `todos` bucket, three reactive queries, and starts listening:

```typescript
// server.ts
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';

async function main() {
  const store = await Store.start({ name: 'todo-app' });

  await store.defineBucket('todos', {
    key: 'id',
    schema: {
      id:        { type: 'string', generated: 'uuid' },
      title:     { type: 'string', required: true },
      completed: { type: 'boolean', default: false },
    },
  });

  // All todos, ordered by creation time
  store.defineQuery('all-todos', async (ctx) => {
    return ctx.bucket('todos').all();
  });

  // Only incomplete todos
  store.defineQuery('active-todos', async (ctx) => {
    return ctx.bucket('todos').where({ completed: false });
  });

  // Scalar: how many are done
  store.defineQuery('completed-count', async (ctx) => {
    return ctx.bucket('todos').count({ completed: true });
  });

  const server = await NoexServer.start({ store, port: 8080 });
  console.log(`Todo server listening on ws://localhost:${server.port}`);
}

main();
```

## Part 2: Client — CRUD Operations

Connect and manage todos through the SDK:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const todos = client.store.bucket('todos');

// Create
const buyMilk = await todos.insert({ title: 'Buy milk' });
console.log(buyMilk.id);        // "a1b2c3..."
console.log(buyMilk.completed); // false (default)

const walkDog = await todos.insert({ title: 'Walk the dog' });

// Read
const all = await todos.all();
console.log(all.length); // 2

const found = await todos.findOne({ title: 'Buy milk' });
console.log(found?.id === buyMilk.id); // true

// Update — mark as completed
const updated = await todos.update(buyMilk.id, { completed: true });
console.log(updated.completed); // true

// Delete
await todos.delete(walkDog.id);

// Count
const remaining = await todos.count({ completed: false });
console.log(remaining); // 0
```

Every method returns the full record including `RecordMeta` fields (`id`, `_version`, `_createdAt`, `_updatedAt`).

## Part 3: Reactive Subscriptions

Subscriptions turn a one-shot query into a live data stream. The callback fires once with the current result (initial data) and again whenever the result changes:

```typescript
const snapshots: unknown[] = [];

const unsubAll = await client.store.subscribe('all-todos', (data) => {
  snapshots.push(data);
  console.log('Todo list:', data);
});

// snapshots[0] = [] (initial: no todos)

await todos.insert({ title: 'Buy milk' });
// Server re-evaluates → push arrives
// snapshots[1] = [{ id: "...", title: "Buy milk", completed: false, ... }]

await todos.insert({ title: 'Walk the dog' });
// snapshots[2] = [{ ... "Buy milk" ... }, { ... "Walk the dog" ... }]
```

### Scalar Subscriptions

The `completed-count` query returns a number, not an array:

```typescript
let completedCount = 0;

const unsubCount = await client.store.subscribe('completed-count', (data) => {
  completedCount = data as number;
  console.log(`Completed: ${completedCount}`);
});

// completedCount = 0

await todos.update(buyMilk.id, { completed: true });
// completedCount = 1
```

### Filtered Subscriptions

The `active-todos` subscription only pushes when the filtered result changes:

```typescript
const activeSnapshots: unknown[] = [];

await client.store.subscribe('active-todos', (data) => {
  activeSnapshots.push(data);
});

// activeSnapshots[0] = [{ ... "Walk the dog" ... }] (Buy milk is completed)

await todos.insert({ title: 'Read a book' });
// activeSnapshots[1] = [{ ... "Walk the dog" ... }, { ... "Read a book" ... }]
```

## Part 4: Multi-Client Synchronization

The power of reactive subscriptions shows when multiple clients connect. One client mutates data; all others receive updates automatically.

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

// Client A — the writer
const clientA = new NoexClient('ws://localhost:8080', { WebSocket });
await clientA.connect();

// Client B — the reader
const clientB = new NoexClient('ws://localhost:8080', { WebSocket });
await clientB.connect();

// Client B subscribes to all-todos
const liveTodos: unknown[] = [];
const unsub = await clientB.store.subscribe('all-todos', (data) => {
  liveTodos.push(data);
});

// liveTodos[0] = [] (initial)

// Client A inserts a todo
await clientA.store.bucket('todos').insert({ title: 'Buy milk' });

// Client B's callback fires with the updated list
// liveTodos[1] = [{ id: "...", title: "Buy milk", ... }]

// Client A completes it
const all = await clientA.store.bucket('todos').all();
await clientA.store.bucket('todos').update(all[0]!.id, { completed: true });

// Client B receives the update
// liveTodos[2] = [{ id: "...", title: "Buy milk", completed: true, ... }]

// Cleanup
unsub();
await clientA.disconnect();
await clientB.disconnect();
```

```
  Client A                   Server                    Client B
    │                          │                          │
    │  insert("Buy milk")     │                          │
    ├─────────────────────────►│                          │
    │                          │  re-evaluate queries     │
    │                          │  result changed → push   │
    │                          ├─────────────────────────►│
    │                          │                  callback(data)
    │                          │                          │
    │  update(id, completed)  │                          │
    ├─────────────────────────►│                          │
    │                          │  re-evaluate queries     │
    │                          │  result changed → push   │
    │                          ├─────────────────────────►│
    │                          │                  callback(data)
```

## Complete Working Example

A full Node.js script that sets up the server, connects two clients, and demonstrates real-time synchronization:

```typescript
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  // ── Server ─────────────────────────────────────────────────────
  const store = await Store.start({ name: 'todo-demo' });

  await store.defineBucket('todos', {
    key: 'id',
    schema: {
      id:        { type: 'string', generated: 'uuid' },
      title:     { type: 'string', required: true },
      completed: { type: 'boolean', default: false },
    },
  });

  store.defineQuery('all-todos', async (ctx) => ctx.bucket('todos').all());
  store.defineQuery('completed-count', async (ctx) => {
    return ctx.bucket('todos').count({ completed: true });
  });

  const server = await NoexServer.start({ store, port: 0, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${server.port}`;

  // ── Clients ────────────────────────────────────────────────────
  const writer = new NoexClient(url, { WebSocket: WebSocket as never });
  const viewer = new NoexClient(url, { WebSocket: WebSocket as never });
  await writer.connect();
  await viewer.connect();

  // Viewer subscribes
  const todoList: unknown[] = [];
  let completed = 0;

  const unsubTodos = await viewer.store.subscribe('all-todos', (data) => {
    todoList.length = 0;
    (data as unknown[]).forEach((t) => todoList.push(t));
    console.log(`Todos (${todoList.length}):`);
    for (const t of todoList) {
      const todo = t as Record<string, unknown>;
      const mark = todo['completed'] ? 'x' : ' ';
      console.log(`  [${mark}] ${todo['title']}`);
    }
  });

  const unsubCount = await viewer.store.subscribe('completed-count', (data) => {
    completed = data as number;
    console.log(`Completed: ${completed}`);
  });

  // Writer adds todos
  const milk = await writer.store.bucket('todos').insert({ title: 'Buy milk' });
  await store.settle(); // Wait for query re-evaluation

  const dog = await writer.store.bucket('todos').insert({ title: 'Walk the dog' });
  await store.settle();

  // Writer completes one
  await writer.store.bucket('todos').update(milk.id, { completed: true });
  await store.settle();

  // Writer deletes one
  await writer.store.bucket('todos').delete(dog.id);
  await store.settle();

  // ── Cleanup ────────────────────────────────────────────────────
  unsubTodos();
  unsubCount();
  await writer.disconnect();
  await viewer.disconnect();
  await server.stop();
  await store.stop();

  console.log('Done.');
}

main();
```

## Exercise

Build an enhanced todo app with the following features:

1. Add a `priority` field to todos (`'low' | 'medium' | 'high'`)
2. Define a server query `high-priority-active` that returns only incomplete high-priority todos
3. Subscribe to both `all-todos` and `high-priority-active` from a single client
4. Insert three todos: one low priority, one medium, one high priority
5. Verify that the `high-priority-active` subscription only shows the high-priority todo
6. Complete the high-priority todo and verify the filtered subscription now returns an empty array

<details>
<summary>Solution</summary>

**Server additions:**

```typescript
await store.defineBucket('todos', {
  key: 'id',
  schema: {
    id:        { type: 'string', generated: 'uuid' },
    title:     { type: 'string', required: true },
    completed: { type: 'boolean', default: false },
    priority:  { type: 'string', default: 'medium' },
  },
});

store.defineQuery('high-priority-active', async (ctx) => {
  return ctx.bucket('todos').where({ completed: false, priority: 'high' });
});
```

**Client code:**

```typescript
const client = new NoexClient(url, { WebSocket: WebSocket as never });
await client.connect();
const todos = client.store.bucket('todos');

const allResults: unknown[] = [];
const highResults: unknown[] = [];

await client.store.subscribe('all-todos', (data) => {
  allResults.push(data);
});

await client.store.subscribe('high-priority-active', (data) => {
  highResults.push(data);
});

// Initial: both empty
// allResults[0] = [], highResults[0] = []

await todos.insert({ title: 'Clean desk', priority: 'low' });
await todos.insert({ title: 'Email boss', priority: 'medium' });
const urgent = await todos.insert({ title: 'Fix production bug', priority: 'high' });

// allResults contains 3 todos
// highResults contains only [{ title: 'Fix production bug', ... }]

await todos.update(urgent.id, { completed: true });

// highResults now has an empty array — the only high-priority todo is completed
```

</details>

## Summary

- **Bucket operations** — `insert`, `get`, `update`, `delete`, `all`, `where`, `findOne`, `count` provide full CRUD and query capabilities
- **Reactive subscriptions** — `store.subscribe(query, callback)` delivers initial data synchronously and push updates on every change
- **Scalar queries** — subscriptions work with any return type (arrays, numbers, objects)
- **Filtered queries** — push notifications are selective; only subscriptions whose result actually changed receive updates
- **Multi-client sync** — mutations from one connection trigger pushes to all other connections with active subscriptions
- **Cleanup** — call the `unsubscribe` function (synchronous) and `disconnect()` to release resources

---

Next: [Realtime Dashboard](./02-realtime-dashboard.md)
