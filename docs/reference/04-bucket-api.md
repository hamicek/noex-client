# Bucket API

Typed accessor for a single bucket — CRUD operations, queries, aggregations, and bulk operations. Obtained via `store.bucket<T>(name)`.

`BucketAPI<T>` is generic — the type parameter `T` describes the shape of your records (excluding server-managed metadata). All methods that return records produce `T & RecordMeta`, which adds `id`, `_version`, `_createdAt`, and `_updatedAt` fields.

## Import

`BucketAPI` instances are not constructed directly. Use `StoreAPI.bucket()`:

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

interface User {
  name: string;
  email: string;
  age: number;
}

const users = client.store.bucket<User>('users');
```

`BucketAPI` is also exported for type annotations:

```typescript
import type { BucketAPI } from '@hamicek/noex-client';
```

---

## CRUD Methods

### insert()

```typescript
insert(data: Omit<T, keyof RecordMeta>): Promise<T & RecordMeta>
```

Creates a new record in the bucket. The server generates `id`, `_version`, `_createdAt`, and `_updatedAt` automatically.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | `Omit<T, keyof RecordMeta>` | yes | Record data (without metadata fields) |

**Returns:** `Promise<T & RecordMeta>` — the created record including server-generated metadata

**Throws:**
- `NoexClientError` if the server rejects the insert (e.g. validation error)
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const user = await users.insert({ name: 'Alice', email: 'alice@example.com', age: 30 });
console.log(user.id);         // '550e8400-...'
console.log(user._version);   // 1
console.log(user._createdAt); // 1700000000000
```

---

### get()

```typescript
get(key: unknown): Promise<(T & RecordMeta) | null>
```

Retrieves a single record by its key. Returns `null` if the record does not exist.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| key | `unknown` | yes | Record key (typically the `id`) |

**Returns:** `Promise<(T & RecordMeta) | null>` — the record, or `null` if not found

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const user = await users.get('550e8400-...');
if (user) {
  console.log(user.name); // 'Alice'
}
```

---

### update()

```typescript
update(key: unknown, data: Partial<Omit<T, keyof RecordMeta>>): Promise<T & RecordMeta>
```

Updates an existing record. Only the provided fields are changed — omitted fields retain their current values. The server increments `_version` and updates `_updatedAt`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| key | `unknown` | yes | Record key (typically the `id`) |
| data | `Partial<Omit<T, keyof RecordMeta>>` | yes | Fields to update |

**Returns:** `Promise<T & RecordMeta>` — the updated record with new metadata

**Throws:**
- `NoexClientError` if the record does not exist or the server rejects the update
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const updated = await users.update('550e8400-...', { age: 31 });
console.log(updated._version);   // 2
console.log(updated._updatedAt); // 1700000060000
```

---

### delete()

```typescript
delete(key: unknown): Promise<void>
```

Deletes a record by its key.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| key | `unknown` | yes | Record key (typically the `id`) |

**Returns:** `Promise<void>`

**Throws:**
- `NoexClientError` if the record does not exist or the server rejects the deletion
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
await users.delete('550e8400-...');
```

---

## Query Methods

### all()

```typescript
all(): Promise<(T & RecordMeta)[]>
```

Returns all records in the bucket.

**Returns:** `Promise<(T & RecordMeta)[]>` — array of all records

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const allUsers = await users.all();
console.log(allUsers.length); // 42
```

---

### where()

```typescript
where(filter: Partial<T>): Promise<(T & RecordMeta)[]>
```

Returns all records matching the filter. Filter fields are matched with equality.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| filter | `Partial<T>` | yes | Fields to match against |

**Returns:** `Promise<(T & RecordMeta)[]>` — matching records

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const admins = await users.where({ age: 30 });
```

---

### findOne()

```typescript
findOne(filter: Partial<T>): Promise<(T & RecordMeta) | null>
```

Returns the first record matching the filter, or `null` if no match is found.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| filter | `Partial<T>` | yes | Fields to match against |

**Returns:** `Promise<(T & RecordMeta) | null>` — first matching record, or `null`

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const alice = await users.findOne({ email: 'alice@example.com' });
```

---

### count()

```typescript
count(filter?: Partial<T>): Promise<number>
```

Returns the number of records in the bucket. When a filter is provided, counts only matching records.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| filter | `Partial<T>` | no | Fields to match against; omit to count all |

**Returns:** `Promise<number>` — record count

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const total = await users.count();
const over30 = await users.count({ age: 30 });
```

---

### first()

```typescript
first(n: number): Promise<(T & RecordMeta)[]>
```

Returns the first `n` records in insertion order.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| n | `number` | yes | Number of records to return |

**Returns:** `Promise<(T & RecordMeta)[]>` — up to `n` records from the beginning

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const newest = await users.first(5);
```

---

### last()

```typescript
last(n: number): Promise<(T & RecordMeta)[]>
```

Returns the last `n` records in insertion order.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| n | `number` | yes | Number of records to return |

**Returns:** `Promise<(T & RecordMeta)[]>` — up to `n` records from the end

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const recent = await users.last(10);
```

---

### paginate()

```typescript
paginate(options: { limit: number; after?: unknown }): Promise<PaginatedResult<T>>
```

Returns a page of records with cursor-based pagination. Use `nextCursor` from the result to fetch subsequent pages.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| options.limit | `number` | yes | Maximum number of records per page |
| options.after | `unknown` | no | Cursor from a previous `PaginatedResult.nextCursor`; omit for the first page |

**Returns:** `Promise<PaginatedResult<T>>` — records, `hasMore` flag, and optional `nextCursor`

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
// First page
const page1 = await users.paginate({ limit: 20 });
console.log(page1.records.length); // up to 20
console.log(page1.hasMore);        // true

// Next page
if (page1.hasMore) {
  const page2 = await users.paginate({ limit: 20, after: page1.nextCursor });
}
```

---

## Aggregation Methods

### sum()

```typescript
sum(field: string, filter?: Partial<T>): Promise<number>
```

Returns the sum of a numeric field across all records, or across records matching the filter.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| field | `string` | yes | Name of the numeric field to sum |
| filter | `Partial<T>` | no | Fields to match against; omit to aggregate all |

**Returns:** `Promise<number>` — sum of the field values

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const totalAge = await users.sum('age');
const totalAgeOver30 = await users.sum('age', { age: 30 });
```

---

### avg()

```typescript
avg(field: string, filter?: Partial<T>): Promise<number>
```

Returns the average of a numeric field across all records, or across records matching the filter.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| field | `string` | yes | Name of the numeric field to average |
| filter | `Partial<T>` | no | Fields to match against; omit to aggregate all |

**Returns:** `Promise<number>` — average of the field values

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const averageAge = await users.avg('age');
```

---

### min()

```typescript
min(field: string, filter?: Partial<T>): Promise<number | null>
```

Returns the minimum value of a numeric field. Returns `null` if the bucket is empty (or no records match the filter).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| field | `string` | yes | Name of the numeric field |
| filter | `Partial<T>` | no | Fields to match against; omit to aggregate all |

**Returns:** `Promise<number | null>` — minimum value, or `null` if no records

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const youngest = await users.min('age');
```

---

### max()

```typescript
max(field: string, filter?: Partial<T>): Promise<number | null>
```

Returns the maximum value of a numeric field. Returns `null` if the bucket is empty (or no records match the filter).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| field | `string` | yes | Name of the numeric field |
| filter | `Partial<T>` | no | Fields to match against; omit to aggregate all |

**Returns:** `Promise<number | null>` — maximum value, or `null` if no records

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const oldest = await users.max('age');
```

---

## Bulk Methods

### clear()

```typescript
clear(): Promise<void>
```

Deletes all records in the bucket.

**Returns:** `Promise<void>`

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
await users.clear();
const count = await users.count(); // 0
```

---

## Types

### RecordMeta

Server-managed metadata fields added to every stored record:

```typescript
interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}
```

### PaginatedResult

```typescript
interface PaginatedResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly records: (T & RecordMeta)[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}
```

---

## See Also

- [Store API](./03-store-api.md) — `store.bucket()` method that creates `BucketAPI` instances
- [Store Subscriptions](./05-store-subscriptions.md) — reactive subscriptions on store queries
- [Types](./09-types.md) — RecordMeta, PaginatedResult, StoreRecord
- [Errors](./10-errors.md) — NoexClientError, TimeoutError, DisconnectedError
