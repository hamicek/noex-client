# Store API

Namespace for all store operations — bucket access, reactive subscriptions, atomic transactions, and store metadata. Available as `client.store` after connecting.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const store = client.store;
```

`StoreAPI` is also exported directly for type annotations:

```typescript
import type { StoreAPI } from '@hamicek/noex-client';
```

---

## Methods

### bucket()

```typescript
bucket<T extends Record<string, unknown> = Record<string, unknown>>(name: string): BucketAPI<T>
```

Returns a `BucketAPI` scoped to the given bucket name. The returned object is a lightweight wrapper — no server call is made. Multiple calls with the same name create independent instances.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | yes | Bucket name |

**Returns:** `BucketAPI<T>` — typed bucket accessor

**Example:**

```typescript
interface User {
  name: string;
  email: string;
}

const users = store.bucket<User>('users');
const record = await users.insert({ name: 'Alice', email: 'alice@example.com' });
```

---

### subscribe()

```typescript
subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>
subscribe(query: string, params: Record<string, unknown>, callback: (data: unknown) => void): Promise<Unsubscribe>
```

Subscribes to a server-side reactive query. The server evaluates the query immediately and sends the initial result, then pushes updated results whenever the underlying data changes.

The `callback` is invoked **synchronously** with the initial data before the returned promise resolves. Subsequent pushes invoke the callback asynchronously.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | `string` | yes | Server-side query name |
| params | `Record<string, unknown>` | no | Query parameters passed to the server |
| callback | `(data: unknown) => void` | yes | Called with initial data and on every subsequent push |

**Returns:** `Promise<Unsubscribe>` — async; resolves to a synchronous unsubscribe function `() => void`

**Throws:**
- `NoexClientError` if the query name is invalid or the server rejects the subscription
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected
- Re-throws any error thrown by `callback` during initial data delivery (the subscription is cleaned up automatically in this case)

**Example:**

```typescript
const unsubscribe = await store.subscribe('activeUsers', (data) => {
  console.log('Active users:', data);
});

// With parameters
const unsub = await store.subscribe(
  'usersByRole',
  { role: 'admin' },
  (data) => {
    console.log('Admins:', data);
  },
);

// Later — stop receiving updates
unsubscribe();
```

**Reconnect behavior:** Active subscriptions are automatically restored after a reconnect. The server assigns a new `subscriptionId` and delivers fresh data to the callback.

---

### unsubscribe()

```typescript
unsubscribe(subscriptionId: string): Promise<void>
```

Unsubscribes from a store subscription by its server-assigned ID. In most cases you should use the `Unsubscribe` function returned by `subscribe()` instead — this method is available for advanced scenarios where you manage subscription IDs manually.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| subscriptionId | `string` | yes | Server-assigned subscription ID |

**Returns:** `Promise<void>`

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

---

### transaction()

```typescript
transaction(operations: TransactionOp[]): Promise<TransactionResult>
```

Executes multiple store operations atomically. All operations succeed or all fail. Operations are executed in order and may reference results of earlier operations within the same transaction on the server.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| operations | `TransactionOp[]` | yes | Array of operations to execute atomically |

**Returns:** `Promise<TransactionResult>` — results indexed by operation position

**Throws:**
- `NoexClientError` if any operation fails (the entire transaction is rolled back)
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const result = await store.transaction([
  { op: 'insert', bucket: 'orders', data: { product: 'Widget', qty: 5 } },
  { op: 'update', bucket: 'inventory', key: 'widget-1', data: { qty: 95 } },
  { op: 'count', bucket: 'orders' },
]);

// result.results[0].data — inserted order record
// result.results[1].data — updated inventory record
// result.results[2].data — total order count
```

---

### buckets()

```typescript
buckets(): Promise<BucketsInfo>
```

Returns metadata about all buckets in the store.

**Returns:** `Promise<BucketsInfo>` — bucket count and names

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const info = await store.buckets();
console.log(info.count);  // 3
console.log(info.names);  // ['users', 'orders', 'inventory']
```

---

### stats()

```typescript
stats(): Promise<StoreStats>
```

Returns detailed statistics about the store — bucket counts, record counts, index counts, active queries, persistence, and TTL configuration.

**Returns:** `Promise<StoreStats>` — comprehensive store statistics

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const stats = await store.stats();
console.log(stats.buckets.count);              // number of buckets
console.log(stats.records.total);              // total records across all buckets
console.log(stats.queries.activeSubscriptions); // active subscription count
```

---

## Types

### TransactionOp

A discriminated union describing a single operation within a transaction:

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

### TransactionResult

```typescript
interface TransactionResult {
  readonly results: ReadonlyArray<{ readonly index: number; readonly data: unknown }>;
}
```

### BucketsInfo

```typescript
interface BucketsInfo {
  readonly count: number;
  readonly names: readonly string[];
}
```

### StoreStats

```typescript
interface StoreStats {
  readonly name: string;
  readonly buckets: BucketsInfo;
  readonly records: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly indexes: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly queries: {
    readonly defined: number;
    readonly activeSubscriptions: number;
  };
  readonly persistence: {
    readonly enabled: boolean;
  };
  readonly ttl: {
    readonly enabled: boolean;
    readonly checkIntervalMs: number;
  };
}
```

---

## See Also

- [NoexClient](./01-noex-client.md) — `client.store` property
- [Bucket API](./04-bucket-api.md) — CRUD, queries, and aggregation on a single bucket
- [Store Subscriptions](./05-store-subscriptions.md) — detailed subscription lifecycle and reconnect recovery
- [Configuration](./02-configuration.md) — request timeout settings
- [Types](./09-types.md) — Unsubscribe, TransactionOp, TransactionResult, BucketsInfo, StoreStats
- [Errors](./10-errors.md) — NoexClientError, TimeoutError, DisconnectedError
