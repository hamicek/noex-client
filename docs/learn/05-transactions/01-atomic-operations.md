# Atomic Operations

Individual store operations (`insert`, `update`, `delete`) execute independently. If you need multiple operations to succeed or fail as a unit, use **transactions**. A transaction sends an array of operations to the server, which executes them atomically — either all succeed or none are applied.

## What You'll Learn

- Why atomic operations matter in multi-client environments
- How to compose a transaction with `store.transaction()`
- All seven supported operation types
- How results are indexed by operation position
- Error handling for failed transactions

## The Problem: Non-Atomic Sequences

Without transactions, sequential operations can leave data in an inconsistent state if one fails:

```typescript
// Danger: if the second operation fails, credits are
// deducted but no log entry exists
await users.update(userId, { credits: newBalance });
await logs.insert({ action: 'purchase', userId, amount });
// ↑ What if this fails? Credits already deducted.
```

In a multi-client environment, another client might read the data between the two operations and see an inconsistent state.

## store.transaction()

`store.transaction()` sends an array of operations to the server for atomic execution:

```typescript
const result = await client.store.transaction([
  { op: 'update', bucket: 'users', key: userId, data: { credits: newBalance } },
  { op: 'insert', bucket: 'logs', data: { action: 'purchase', userId, amount } },
]);
```

**Signature:**

```typescript
transaction(operations: TransactionOp[]): Promise<TransactionResult>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| operations | `TransactionOp[]` | Array of operations to execute atomically |

Returns `Promise<TransactionResult>` — contains results indexed by operation position.

## TransactionOp Types

Seven operation types are supported, mirroring the individual `BucketAPI` methods:

### get

Read a single record by key.

```typescript
{ op: 'get', bucket: 'users', key: 'user-1' }
// Result: the record, or null if not found
```

### insert

Create a new record.

```typescript
{ op: 'insert', bucket: 'users', data: { name: 'Alice', credits: 100 } }
// Result: the created record with RecordMeta
```

### update

Update an existing record.

```typescript
{ op: 'update', bucket: 'users', key: 'user-1', data: { credits: 200 } }
// Result: the updated record with RecordMeta
```

### delete

Remove a record.

```typescript
{ op: 'delete', bucket: 'users', key: 'user-1' }
// Result: { deleted: true }
```

### where

Find records matching a filter.

```typescript
{ op: 'where', bucket: 'users', filter: { role: 'admin' } }
// Result: array of matching records
```

### findOne

Find the first record matching a filter.

```typescript
{ op: 'findOne', bucket: 'users', filter: { name: 'Alice' } }
// Result: the record, or null if not found
```

### count

Count records, optionally with a filter.

```typescript
{ op: 'count', bucket: 'users' }
// Result: number

{ op: 'count', bucket: 'users', filter: { role: 'admin' } }
// Result: number
```

## Type Definition

The full `TransactionOp` union type:

```typescript
type TransactionOp =
  | { op: 'get'; bucket: string; key: unknown }
  | { op: 'insert'; bucket: string; data: Record<string, unknown> }
  | { op: 'update'; bucket: string; key: unknown; data: Record<string, unknown> }
  | { op: 'delete'; bucket: string; key: unknown }
  | { op: 'where'; bucket: string; filter: Record<string, unknown> }
  | { op: 'findOne'; bucket: string; filter: Record<string, unknown> }
  | { op: 'count'; bucket: string; filter?: Record<string, unknown> };
```

## TransactionResult

The result contains an array of results, each indexed by the position of the corresponding operation:

```typescript
interface TransactionResult {
  readonly results: ReadonlyArray<{
    readonly index: number;
    readonly data: unknown;
  }>;
}
```

Results are ordered by `index` (0-based), matching the order of operations in the input array:

```typescript
const result = await client.store.transaction([
  { op: 'insert', bucket: 'users', data: { name: 'Alice' } },  // index 0
  { op: 'insert', bucket: 'users', data: { name: 'Bob' } },    // index 1
  { op: 'count', bucket: 'users' },                              // index 2
]);

const alice = result.results[0].data; // Alice record
const bob = result.results[1].data;   // Bob record
const count = result.results[2].data; // 2

console.log(result.results[0].index); // 0
console.log(result.results[1].index); // 1
console.log(result.results[2].index); // 2
```

## Mixing Read and Write Operations

Transactions can combine reads and writes. Operations execute in order, so later operations see the effects of earlier ones:

```typescript
const bob = await client.store.bucket('users').insert({ name: 'Bob', credits: 200 });

const result = await client.store.transaction([
  // Read current state
  { op: 'get', bucket: 'users', key: bob.id },
  // Modify
  { op: 'update', bucket: 'users', key: bob.id, data: { credits: 500 } },
  // Log the action
  { op: 'insert', bucket: 'logs', data: { action: 'credit_update', userId: bob.id } },
]);

const before = result.results[0].data as Record<string, unknown>;
console.log(before['credits']); // 200

const after = result.results[1].data as Record<string, unknown>;
console.log(after['credits']); // 500
```

## Error Handling

Transactions fail as a whole. If any operation is invalid, the entire transaction is rejected:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

// Empty operations array
try {
  await client.store.transaction([]);
} catch (err) {
  // Rejected — at least one operation is required
}

// Invalid data (missing required field)
try {
  await client.store.transaction([
    { op: 'insert', bucket: 'users', data: {} },
  ]);
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // validation error code
    console.log(err.message); // description of what went wrong
  }
}

// Non-existent bucket
try {
  await client.store.transaction([
    { op: 'insert', bucket: 'nonexistent', data: { name: 'test' } },
  ]);
} catch (err) {
  // Rejected — bucket doesn't exist
}
```

## Complete Working Example

Transfer credits between two users atomically:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { TransactionOp } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const users = client.store.bucket('users');

  // Set up initial data
  const alice = await users.insert({ name: 'Alice', credits: 1000 });
  const bob = await users.insert({ name: 'Bob', credits: 500 });

  const transferAmount = 200;

  // Atomic transfer: deduct from Alice, credit to Bob, log the transfer
  const ops: TransactionOp[] = [
    {
      op: 'update',
      bucket: 'users',
      key: alice.id,
      data: { credits: (alice['credits'] as number) - transferAmount },
    },
    {
      op: 'update',
      bucket: 'users',
      key: bob.id,
      data: { credits: (bob['credits'] as number) + transferAmount },
    },
    {
      op: 'insert',
      bucket: 'logs',
      data: {
        action: 'transfer',
        from: alice.id,
        to: bob.id,
        amount: transferAmount,
      },
    },
  ];

  const result = await client.store.transaction(ops);

  const updatedAlice = result.results[0].data as Record<string, unknown>;
  const updatedBob = result.results[1].data as Record<string, unknown>;

  console.log(`Alice credits: ${updatedAlice['credits']}`); // 800
  console.log(`Bob credits: ${updatedBob['credits']}`);     // 700

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Inserts three products into a `products` bucket
2. In a single transaction: deletes the first product, updates the second product's price, and counts the remaining products
3. Verifies the count result equals 2

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const products = client.store.bucket('products');
  const p1 = await products.insert({ name: 'Widget', price: 10 });
  const p2 = await products.insert({ name: 'Gadget', price: 25 });
  const p3 = await products.insert({ name: 'Doohickey', price: 15 });

  const result = await client.store.transaction([
    { op: 'delete', bucket: 'products', key: p1.id },
    { op: 'update', bucket: 'products', key: p2.id, data: { price: 30 } },
    { op: 'count', bucket: 'products' },
  ]);

  const deleteResult = result.results[0].data;
  console.log('Deleted:', deleteResult); // { deleted: true }

  const updated = result.results[1].data as Record<string, unknown>;
  console.log('Updated price:', updated['price']); // 30

  const count = result.results[2].data;
  console.log('Remaining products:', count); // 2

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `store.transaction(operations)` executes an array of operations atomically
- Seven operation types: `get`, `insert`, `update`, `delete`, `where`, `findOne`, `count`
- All-or-nothing: either every operation succeeds or the entire transaction fails
- Results are indexed by operation position in `result.results[i].data`
- Operations execute in order — later operations see effects of earlier ones
- Empty operations array is rejected
- Import `TransactionOp` for type-safe operation construction

---

Next: [Transaction Patterns](./02-patterns.md)
