# Queries

Beyond single-record CRUD, the bucket API provides query methods for retrieving multiple records. This chapter covers the four query operations: `all()`, `where()`, `findOne()`, and `count()`.

## What You'll Learn

- How to retrieve all records from a bucket with `all()`
- How to filter records with `where()` using equality matching
- How to find a single record with `findOne()`
- How to count records with `count()` and optional filters

## all()

Returns every record in the bucket:

```typescript
const users = client.store.bucket('users');

const allUsers = await users.all();
console.log(`Total users: ${allUsers.length}`);

for (const user of allUsers) {
  console.log(user.id, user.name);
}
```

**Signature:**

```typescript
all(): Promise<(Record<string, unknown> & RecordMeta)[]>
```

Returns an array that may be empty if the bucket has no records. Each element includes the record data plus `RecordMeta`.

### When to Use `all()`

`all()` is straightforward but returns everything. For buckets with many records, consider `where()` with a filter, `paginate()` for chunked access, or `first()`/`last()` for limited results.

## where()

Filters records by equality matching on one or more fields:

```typescript
const users = client.store.bucket('users');

// Single field filter
const admins = await users.where({ role: 'admin' });
console.log(`Admins: ${admins.length}`);

// Multiple field filter (AND — all fields must match)
const activeAdmins = await users.where({ role: 'admin', active: true });
console.log(`Active admins: ${activeAdmins.length}`);
```

**Signature:**

```typescript
where(filter: Record<string, unknown>): Promise<(Record<string, unknown> & RecordMeta)[]>
```

### Filter Behavior

- Each key-value pair in the filter must match exactly
- Multiple fields act as AND — a record must match all of them
- Returns an empty array if no records match
- The filter checks for strict equality on field values

```typescript
// These both return records where role is 'admin' AND department is 'engineering'
const results = await users.where({ role: 'admin', department: 'engineering' });
```

## findOne()

Returns the first record matching the filter, or `null` if nothing matches:

```typescript
const users = client.store.bucket('users');

const admin = await users.findOne({ role: 'admin' });

if (admin) {
  console.log('Found admin:', admin.name);
} else {
  console.log('No admin found');
}
```

**Signature:**

```typescript
findOne(filter: Record<string, unknown>): Promise<(Record<string, unknown> & RecordMeta) | null>
```

`findOne()` is more efficient than `where()` when you only need one result — the server can stop searching after the first match.

## count()

Returns the number of records, optionally filtered:

```typescript
const users = client.store.bucket('users');

// Count all records
const total = await users.count();
console.log(`Total users: ${total}`);

// Count with filter
const adminCount = await users.count({ role: 'admin' });
console.log(`Admins: ${adminCount}`);
```

**Signature:**

```typescript
count(filter?: Record<string, unknown>): Promise<number>
```

`count()` is more efficient than `all().length` or `where(filter).length` because only the count is sent over the wire, not the full records.

## Combining Queries

Queries are independent requests. You can run them in parallel with `Promise.all`:

```typescript
const users = client.store.bucket('users');

const [total, adminCount, firstAdmin] = await Promise.all([
  users.count(),
  users.count({ role: 'admin' }),
  users.findOne({ role: 'admin' }),
]);

console.log(`${adminCount} of ${total} users are admins`);
if (firstAdmin) {
  console.log('First admin:', firstAdmin.name);
}
```

## Complete Working Example

A script that populates a bucket and demonstrates all four query methods:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const users = client.store.bucket('users');

  // Populate test data
  await users.insert({ name: 'Alice', role: 'admin', department: 'engineering' });
  await users.insert({ name: 'Bob', role: 'editor', department: 'marketing' });
  await users.insert({ name: 'Carol', role: 'admin', department: 'marketing' });
  await users.insert({ name: 'Dave', role: 'viewer', department: 'engineering' });

  // all() — every record
  const everyone = await users.all();
  console.log('All users:', everyone.map((u) => u.name));
  // ['Alice', 'Bob', 'Carol', 'Dave']

  // where() — filter by field
  const admins = await users.where({ role: 'admin' });
  console.log('Admins:', admins.map((u) => u.name));
  // ['Alice', 'Carol']

  // where() — multiple fields
  const marketingAdmins = await users.where({ role: 'admin', department: 'marketing' });
  console.log('Marketing admins:', marketingAdmins.map((u) => u.name));
  // ['Carol']

  // findOne() — single result
  const editor = await users.findOne({ role: 'editor' });
  console.log('Editor:', editor?.name);
  // 'Bob'

  // count() — total and filtered
  const total = await users.count();
  const engineeringCount = await users.count({ department: 'engineering' });
  console.log(`${engineeringCount} of ${total} users in engineering`);
  // 2 of 4

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

You have a `products` bucket with records like `{ name, category, price, inStock }`. Write a function that:
1. Counts total products and in-stock products
2. Finds all products in the `'electronics'` category
3. Finds a single out-of-stock product (if any)
4. Returns a summary object with all the results

<details>
<summary>Solution</summary>

```typescript
async function productSummary(client: NoexClient) {
  const products = client.store.bucket('products');

  const [total, inStockCount, electronics, outOfStock] = await Promise.all([
    products.count(),
    products.count({ inStock: true }),
    products.where({ category: 'electronics' }),
    products.findOne({ inStock: false }),
  ]);

  return {
    total,
    inStock: inStockCount,
    outOfStock: total - inStockCount,
    electronics: electronics.map((p) => ({ name: p.name, price: p.price })),
    firstOutOfStock: outOfStock ? outOfStock.name : null,
  };
}
```

Using `Promise.all` runs all four queries concurrently, reducing total latency to a single round-trip time instead of four sequential requests.

</details>

## Summary

- `all()` returns every record in a bucket — use sparingly on large datasets
- `where(filter)` returns records matching all filter fields (AND logic, equality matching)
- `findOne(filter)` returns the first matching record or `null` — more efficient than `where()` when you need one result
- `count(filter?)` returns the number of matching records without transferring the records themselves
- All query methods are independent — use `Promise.all` to run them in parallel

---

Next: [Aggregations & Pagination](./03-aggregations-pagination.md)
