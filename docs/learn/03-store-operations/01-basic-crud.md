# Basic CRUD

The store is the primary data layer of noex-server. You interact with it through **buckets** — named collections of records, similar to database tables. This chapter covers the four fundamental operations: create, read, update, and delete.

## What You'll Learn

- How to get a bucket handle with `client.store.bucket()`
- How to create records with `insert()`
- How to read records with `get()`
- How to update records with `update()`
- How to delete records with `delete()`
- What `RecordMeta` fields the server adds to every record

## Buckets

A bucket is a named collection of records on the server. You access it through the store API:

```typescript
const users = client.store.bucket('users');
```

`bucket()` does not make a network request. It returns a lightweight `BucketAPI` handle that attaches the bucket name to each subsequent operation. Buckets are created implicitly on the server when you first insert a record.

```typescript
// These are the same bucket — no duplication
const a = client.store.bucket('users');
const b = client.store.bucket('users');
```

## RecordMeta

Every record stored in a bucket gets server-generated metadata:

```typescript
interface RecordMeta {
  readonly id: string;         // unique identifier (server-generated)
  readonly _version: number;   // incremented on each update
  readonly _createdAt: number; // Unix timestamp (ms) when inserted
  readonly _updatedAt: number; // Unix timestamp (ms) of last update
}
```

All CRUD operations that return records include these fields alongside your data. For example, if you insert `{ name: 'Alice' }`, the server returns `{ id: 'rec-1', name: 'Alice', _version: 1, _createdAt: 1706745600000, _updatedAt: 1706745600000 }`.

## insert()

Creates a new record in the bucket. The server generates the `id` and metadata fields.

```typescript
const users = client.store.bucket('users');

const alice = await users.insert({ name: 'Alice', role: 'admin' });

console.log(alice.id);          // e.g. 'rec-abc123'
console.log(alice.name);        // 'Alice'
console.log(alice.role);        // 'admin'
console.log(alice._version);    // 1
console.log(alice._createdAt);  // 1706745600000
console.log(alice._updatedAt);  // 1706745600000
```

**Signature:**

```typescript
insert(data: Record<string, unknown>): Promise<Record<string, unknown> & RecordMeta>
```

You provide the data fields. The server returns your data merged with `RecordMeta`.

## get()

Retrieves a single record by its key (typically the `id`). Returns `null` if the record doesn't exist.

```typescript
const users = client.store.bucket('users');

const alice = await users.get('rec-abc123');

if (alice) {
  console.log(alice.name); // 'Alice'
} else {
  console.log('Not found');
}
```

**Signature:**

```typescript
get(key: unknown): Promise<(Record<string, unknown> & RecordMeta) | null>
```

Always check for `null` — the record may have been deleted by another client.

## update()

Updates an existing record. You provide only the fields you want to change — omitted fields retain their current values. The server increments `_version` and updates `_updatedAt`.

```typescript
const users = client.store.bucket('users');

const updated = await users.update('rec-abc123', { role: 'editor' });

console.log(updated.name);       // 'Alice' (unchanged)
console.log(updated.role);       // 'editor' (updated)
console.log(updated._version);   // 2
console.log(updated._updatedAt); // newer timestamp
```

**Signature:**

```typescript
update(key: unknown, data: Record<string, unknown>): Promise<Record<string, unknown> & RecordMeta>
```

The returned record contains the full current state — both changed and unchanged fields.

## delete()

Removes a record from the bucket. Returns `void` — no confirmation payload.

```typescript
const users = client.store.bucket('users');

await users.delete('rec-abc123');

const gone = await users.get('rec-abc123');
console.log(gone); // null
```

**Signature:**

```typescript
delete(key: unknown): Promise<void>
```

## clear()

Removes all records from a bucket:

```typescript
const users = client.store.bucket('users');
await users.clear();
```

Use with caution — this is irreversible.

## Complete Working Example

A full CRUD lifecycle: create, read, update, verify, delete, verify:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const tasks = client.store.bucket('tasks');

  // Create
  const task = await tasks.insert({
    title: 'Write documentation',
    completed: false,
    priority: 1,
  });
  console.log('Created:', task.id, task.title);

  // Read
  const fetched = await tasks.get(task.id);
  console.log('Read:', fetched?.title, 'completed:', fetched?.completed);

  // Update
  const updated = await tasks.update(task.id, { completed: true });
  console.log('Updated:', updated.title, 'completed:', updated.completed);
  console.log('Version:', updated._version); // 2

  // Delete
  await tasks.delete(task.id);
  const gone = await tasks.get(task.id);
  console.log('Deleted:', gone === null); // true

  await client.disconnect();
}

main().catch(console.error);
```

## Error Handling

CRUD operations can throw errors:

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await users.update('nonexistent-id', { name: 'Bob' });
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // e.g. 'NOT_FOUND'
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

## Exercise

Write a script that manages a simple inventory:
1. Create a `products` bucket
2. Insert three products with `name` and `price` fields
3. Update the price of the second product
4. Delete the third product
5. Get the first product and log all its fields including metadata

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const products = client.store.bucket('products');

  // Insert three products
  const laptop = await products.insert({ name: 'Laptop', price: 999 });
  const mouse = await products.insert({ name: 'Mouse', price: 29 });
  const keyboard = await products.insert({ name: 'Keyboard', price: 79 });

  console.log('Created:', laptop.id, mouse.id, keyboard.id);

  // Update second product's price
  const updatedMouse = await products.update(mouse.id, { price: 24.99 });
  console.log('Updated mouse price:', updatedMouse.price); // 24.99

  // Delete third product
  await products.delete(keyboard.id);

  // Get first product with all metadata
  const fetched = await products.get(laptop.id);
  if (fetched) {
    console.log('Product:', {
      id: fetched.id,
      name: fetched.name,
      price: fetched.price,
      _version: fetched._version,
      _createdAt: new Date(fetched._createdAt as number).toISOString(),
      _updatedAt: new Date(fetched._updatedAt as number).toISOString(),
    });
  }

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- Buckets are named record collections accessed via `client.store.bucket('name')`
- `bucket()` is a lazy accessor — no network request, just a handle
- `insert(data)` creates a record and returns it with server-generated `RecordMeta` (`id`, `_version`, `_createdAt`, `_updatedAt`)
- `get(key)` returns a record or `null`
- `update(key, data)` merges partial data into an existing record and increments `_version`
- `delete(key)` removes a record
- `clear()` removes all records from a bucket
- All operations are `async` and throw typed errors (`NoexClientError`, `TimeoutError`, `DisconnectedError`)

---

Next: [Queries](./02-queries.md)
