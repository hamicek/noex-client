# Transaction Patterns

The previous chapter covered the mechanics of `store.transaction()`. This chapter shows practical patterns for applying transactions to real-world scenarios — cross-bucket operations, read-modify-write sequences, and robust error handling.

## What You'll Learn

- Cross-bucket transactions for data that spans multiple collections
- Read-modify-write pattern for safe concurrent updates
- Bulk initialization with transaction guarantees
- Error handling strategies for transaction failures
- When to use transactions vs individual operations

## Cross-Bucket Operations

Transactions can span multiple buckets. This is essential when a logical operation involves data in different collections:

### User Creation with Audit Log

```typescript
import type { TransactionOp } from '@hamicek/noex-client';

async function createUserWithLog(
  client: NoexClient,
  name: string,
  role: string,
) {
  const result = await client.store.transaction([
    { op: 'insert', bucket: 'users', data: { name, role } },
    { op: 'insert', bucket: 'audit', data: { action: 'user_created', name, timestamp: Date.now() } },
  ]);

  const user = result.results[0].data as Record<string, unknown>;
  return user;
}
```

Both records are created atomically — if the audit log insert fails, the user isn't created either.

### Order Placement

```typescript
async function placeOrder(
  client: NoexClient,
  userId: string,
  items: Array<{ productId: string; quantity: number }>,
  total: number,
) {
  const ops: TransactionOp[] = [
    {
      op: 'insert',
      bucket: 'orders',
      data: { userId, items, total, status: 'pending' },
    },
    {
      op: 'insert',
      bucket: 'logs',
      data: { action: 'order_placed', userId, total },
    },
  ];

  const result = await client.store.transaction(ops);
  return result.results[0].data;
}
```

## Read-Modify-Write

When you need to read the current state, compute a new value, and write it back, transactions guarantee that no other client modifies the data between your read and write:

### Credit Transfer

```typescript
async function transferCredits(
  client: NoexClient,
  fromId: string,
  toId: string,
  amount: number,
) {
  // Step 1: Read current balances
  const readResult = await client.store.transaction([
    { op: 'get', bucket: 'users', key: fromId },
    { op: 'get', bucket: 'users', key: toId },
  ]);

  const sender = readResult.results[0].data as Record<string, unknown> | null;
  const receiver = readResult.results[1].data as Record<string, unknown> | null;

  if (!sender || !receiver) {
    throw new Error('User not found');
  }

  const senderBalance = sender['credits'] as number;
  if (senderBalance < amount) {
    throw new Error('Insufficient credits');
  }

  // Step 2: Apply the transfer atomically
  const writeResult = await client.store.transaction([
    { op: 'update', bucket: 'users', key: fromId, data: { credits: senderBalance - amount } },
    { op: 'update', bucket: 'users', key: toId, data: { credits: (receiver['credits'] as number) + amount } },
    { op: 'insert', bucket: 'transfers', data: { from: fromId, to: toId, amount, timestamp: Date.now() } },
  ]);

  return {
    sender: writeResult.results[0].data,
    receiver: writeResult.results[1].data,
    transfer: writeResult.results[2].data,
  };
}
```

### Inventory Decrement

```typescript
async function decrementStock(
  client: NoexClient,
  productId: string,
  quantity: number,
) {
  // Read current stock
  const readResult = await client.store.transaction([
    { op: 'get', bucket: 'products', key: productId },
  ]);

  const product = readResult.results[0].data as Record<string, unknown> | null;
  if (!product) throw new Error('Product not found');

  const currentStock = product['stock'] as number;
  if (currentStock < quantity) throw new Error('Out of stock');

  // Decrement atomically
  return client.store.transaction([
    { op: 'update', bucket: 'products', key: productId, data: { stock: currentStock - quantity } },
  ]);
}
```

## Bulk Initialization

Transactions are useful for setting up initial data that must be consistent:

```typescript
async function seedDatabase(client: NoexClient) {
  const ops: TransactionOp[] = [
    { op: 'insert', bucket: 'config', data: { key: 'version', value: '1.0.0' } },
    { op: 'insert', bucket: 'config', data: { key: 'maxUsers', value: 100 } },
    { op: 'insert', bucket: 'users', data: { name: 'Admin', role: 'admin' } },
    { op: 'insert', bucket: 'logs', data: { action: 'database_seeded', timestamp: Date.now() } },
  ];

  return client.store.transaction(ops);
}
```

All four records are created together or not at all.

## Query Within Transactions

Use `where`, `findOne`, and `count` operations alongside writes to read contextual data atomically:

```typescript
async function archiveCompletedTasks(client: NoexClient) {
  // Find completed tasks
  const result = await client.store.transaction([
    { op: 'where', bucket: 'tasks', filter: { status: 'completed' } },
    { op: 'count', bucket: 'tasks', filter: { status: 'completed' } },
  ]);

  const completed = result.results[0].data as Array<Record<string, unknown>>;
  const count = result.results[1].data as number;

  console.log(`Found ${count} completed tasks to archive`);

  if (completed.length === 0) return;

  // Archive each completed task
  const archiveOps: TransactionOp[] = completed.flatMap((task) => [
    { op: 'insert', bucket: 'archive', data: { ...task, archivedAt: Date.now() } } as TransactionOp,
    { op: 'delete', bucket: 'tasks', key: task['id'] } as TransactionOp,
  ]);

  await client.store.transaction(archiveOps);
  console.log(`Archived ${count} tasks`);
}
```

## Error Handling Strategies

### Catch and Inspect

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

async function safeTransaction(client: NoexClient, ops: TransactionOp[]) {
  try {
    return await client.store.transaction(ops);
  } catch (err) {
    if (err instanceof DisconnectedError) {
      console.error('Cannot execute transaction — not connected');
      throw err;
    }
    if (err instanceof TimeoutError) {
      console.error('Transaction timed out — state is unknown');
      throw err;
    }
    if (err instanceof NoexClientError) {
      console.error(`Transaction failed: [${err.code}] ${err.message}`);
      throw err;
    }
    throw err;
  }
}
```

### Retry on Timeout

```typescript
async function transactionWithRetry(
  client: NoexClient,
  ops: TransactionOp[],
  maxRetries = 3,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.store.transaction(ops);
    } catch (err) {
      if (err instanceof TimeoutError && attempt < maxRetries) {
        console.warn(`Transaction attempt ${attempt} timed out, retrying...`);
        continue;
      }
      throw err;
    }
  }
}
```

## When to Use Transactions

| Scenario | Use Transaction? | Why |
|----------|-----------------|-----|
| Insert a single record | No | One operation, already atomic |
| Insert a record + audit log | Yes | Two buckets must stay consistent |
| Update one field on one record | No | One operation, already atomic |
| Transfer value between records | Yes | Both updates must succeed together |
| Read multiple records for display | Maybe | Transaction gives a consistent snapshot |
| Seed multiple initial records | Yes | All-or-nothing initialization |

## Complete Working Example

A mini e-commerce flow: check stock, create order, decrement stock, log:

```typescript
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import type { TransactionOp } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Seed products
  const products = client.store.bucket('products');
  const laptop = await products.insert({ name: 'Laptop', price: 999, stock: 5 });

  // Check stock
  const checkResult = await client.store.transaction([
    { op: 'get', bucket: 'products', key: laptop.id },
  ]);

  const current = checkResult.results[0].data as Record<string, unknown>;
  const stock = current['stock'] as number;

  if (stock < 1) {
    console.log('Out of stock!');
    await client.disconnect();
    return;
  }

  // Place order atomically
  try {
    const orderResult = await client.store.transaction([
      { op: 'update', bucket: 'products', key: laptop.id, data: { stock: stock - 1 } },
      { op: 'insert', bucket: 'orders', data: { productId: laptop.id, quantity: 1, total: 999 } },
      { op: 'insert', bucket: 'logs', data: { action: 'order_placed', productId: laptop.id } },
      { op: 'get', bucket: 'products', key: laptop.id },
    ]);

    const order = orderResult.results[1].data as Record<string, unknown>;
    const updatedProduct = orderResult.results[3].data as Record<string, unknown>;

    console.log('Order placed:', order['id']);
    console.log('Remaining stock:', updatedProduct['stock']); // 4
  } catch (err) {
    if (err instanceof NoexClientError) {
      console.error(`Order failed: ${err.message}`);
    }
  }

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Build a function `swapRoles` that atomically swaps the `role` field between two users:
1. Read both users in a transaction
2. Validate both exist
3. Swap their roles in a second transaction
4. Return the updated records

<details>
<summary>Solution</summary>

```typescript
async function swapRoles(client: NoexClient, userAId: string, userBId: string) {
  // Read both users atomically
  const readResult = await client.store.transaction([
    { op: 'get', bucket: 'users', key: userAId },
    { op: 'get', bucket: 'users', key: userBId },
  ]);

  const userA = readResult.results[0].data as Record<string, unknown> | null;
  const userB = readResult.results[1].data as Record<string, unknown> | null;

  if (!userA || !userB) {
    throw new Error('One or both users not found');
  }

  const roleA = userA['role'];
  const roleB = userB['role'];

  // Swap atomically
  const swapResult = await client.store.transaction([
    { op: 'update', bucket: 'users', key: userAId, data: { role: roleB } },
    { op: 'update', bucket: 'users', key: userBId, data: { role: roleA } },
    { op: 'insert', bucket: 'logs', data: {
      action: 'role_swap',
      users: [userAId, userBId],
      timestamp: Date.now(),
    }},
  ]);

  return {
    userA: swapResult.results[0].data,
    userB: swapResult.results[1].data,
  };
}

// Usage:
const { userA, userB } = await swapRoles(client, 'user-1', 'user-2');
console.log('User A role:', (userA as Record<string, unknown>)['role']);
console.log('User B role:', (userB as Record<string, unknown>)['role']);
```

</details>

## Summary

- **Cross-bucket**: transactions span multiple buckets for logically related writes
- **Read-modify-write**: read state, validate, then write back — all atomically
- **Bulk initialization**: seed multiple collections in one atomic operation
- **Query operations** (`where`, `findOne`, `count`) work inside transactions alongside writes
- Handle `NoexClientError`, `TimeoutError`, and `DisconnectedError` for robust error recovery
- Use transactions when multiple operations must succeed or fail together
- Single-operation workflows don't need transactions — they're already atomic

---

Next: [Events](../06-rules/01-events.md)
