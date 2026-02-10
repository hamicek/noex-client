# Aggregations & Pagination

When buckets grow large, you need tools to navigate and summarize data without pulling everything at once. This chapter covers ordering methods (`first`, `last`), cursor-based pagination, and numeric aggregation functions.

## What You'll Learn

- How to retrieve the oldest and newest records with `first()` and `last()`
- How cursor-based pagination works with `paginate()`
- How to compute `sum()`, `avg()`, `min()`, and `max()` over numeric fields
- How to combine pagination and aggregations for dashboard-style queries

## first() and last()

Retrieve a limited number of records from the beginning or end of the bucket (insertion order):

```typescript
const logs = client.store.bucket('logs');

// Oldest 5 records
const oldest = await logs.first(5);
console.log('Oldest:', oldest.map((l) => l.id));

// Newest 3 records
const newest = await logs.last(3);
console.log('Newest:', newest.map((l) => l.id));
```

**Signatures:**

```typescript
first(n: number): Promise<(Record<string, unknown> & RecordMeta)[]>
last(n: number): Promise<(Record<string, unknown> & RecordMeta)[]>
```

These are useful when you only need a sample of records without setting up full pagination.

## paginate()

For larger datasets, use cursor-based pagination to retrieve records in chunks:

```typescript
const users = client.store.bucket('users');

// First page: 10 records
const page1 = await users.paginate({ limit: 10 });
console.log('Page 1:', page1.records.length, 'records');
console.log('Has more:', page1.hasMore);

// Next page: use the cursor from the previous result
if (page1.hasMore && page1.nextCursor) {
  const page2 = await users.paginate({ limit: 10, after: page1.nextCursor });
  console.log('Page 2:', page2.records.length, 'records');
}
```

**Signature:**

```typescript
paginate(options: { limit: number; after?: unknown }): Promise<PaginatedResult<Record<string, unknown>>>
```

**PaginatedResult:**

```typescript
interface PaginatedResult<T> {
  readonly records: (T & RecordMeta)[];  // records for this page
  readonly hasMore: boolean;              // true if there's another page
  readonly nextCursor?: unknown;          // cursor to pass as `after` for the next page
}
```

### Iterating All Pages

A common pattern to process all records in chunks:

```typescript
const products = client.store.bucket('products');
let cursor: unknown = undefined;
let allRecords: Array<Record<string, unknown>> = [];

do {
  const page = await products.paginate({ limit: 50, after: cursor });
  allRecords = allRecords.concat(page.records);
  cursor = page.hasMore ? page.nextCursor : undefined;
} while (cursor !== undefined);

console.log(`Loaded ${allRecords.length} products in chunks of 50`);
```

### Why Cursor-Based?

Cursor-based pagination is more robust than offset-based (`SKIP/LIMIT`):

| Aspect | Offset-based | Cursor-based |
|--------|-------------|--------------|
| **Insert during pagination** | Can show duplicates or skip records | Consistent — cursor marks an exact position |
| **Delete during pagination** | Can skip records | No data loss |
| **Performance** | Degrades with large offsets | Constant time per page |

## Aggregation Functions

Compute numeric summaries over a field across all records (or a filtered subset):

### sum()

Total of a numeric field:

```typescript
const orders = client.store.bucket('orders');

const totalRevenue = await orders.sum('amount');
console.log('Total revenue:', totalRevenue);

// With filter
const vipRevenue = await orders.sum('amount', { customerTier: 'vip' });
console.log('VIP revenue:', vipRevenue);
```

### avg()

Average of a numeric field:

```typescript
const products = client.store.bucket('products');

const avgPrice = await products.avg('price');
console.log('Average price:', avgPrice);
```

### min() and max()

Minimum and maximum values. Returns `null` if the bucket is empty:

```typescript
const products = client.store.bucket('products');

const cheapest = await products.min('price');
const mostExpensive = await products.max('price');

console.log('Price range:', cheapest, '–', mostExpensive);
// null if no products exist
```

**Signatures:**

```typescript
sum(field: string, filter?: Record<string, unknown>): Promise<number>
avg(field: string, filter?: Record<string, unknown>): Promise<number>
min(field: string, filter?: Record<string, unknown>): Promise<number | null>
max(field: string, filter?: Record<string, unknown>): Promise<number | null>
```

### Running Multiple Aggregations

Use `Promise.all` to compute multiple aggregations in parallel:

```typescript
const orders = client.store.bucket('orders');

const [total, average, minimum, maximum, count] = await Promise.all([
  orders.sum('amount'),
  orders.avg('amount'),
  orders.min('amount'),
  orders.max('amount'),
  orders.count(),
]);

console.log(`${count} orders: sum=${total}, avg=${average}, min=${minimum}, max=${maximum}`);
```

## Complete Working Example

A dashboard-style script combining pagination and aggregations:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const orders = client.store.bucket('orders');

  // Insert sample data
  await orders.insert({ customer: 'Alice', amount: 150, status: 'completed' });
  await orders.insert({ customer: 'Bob', amount: 320, status: 'completed' });
  await orders.insert({ customer: 'Carol', amount: 89, status: 'pending' });
  await orders.insert({ customer: 'Alice', amount: 210, status: 'completed' });
  await orders.insert({ customer: 'Dave', amount: 475, status: 'completed' });

  // Aggregations
  const [total, avg, min, max, count] = await Promise.all([
    orders.sum('amount'),
    orders.avg('amount'),
    orders.min('amount'),
    orders.max('amount'),
    orders.count(),
  ]);

  console.log('Dashboard:');
  console.log(`  Orders: ${count}`);
  console.log(`  Revenue: $${total}`);
  console.log(`  Average: $${avg.toFixed(2)}`);
  console.log(`  Range: $${min} – $${max}`);

  // Filtered aggregation
  const completedRevenue = await orders.sum('amount', { status: 'completed' });
  const completedCount = await orders.count({ status: 'completed' });
  console.log(`  Completed: ${completedCount} orders, $${completedRevenue} revenue`);

  // Pagination
  console.log('\nPaginated list:');
  const page = await orders.paginate({ limit: 3 });
  for (const order of page.records) {
    console.log(`  ${order.customer}: $${order.amount} (${order.status})`);
  }
  console.log(`  Has more: ${page.hasMore}`);

  // First and last
  const newest = await orders.last(2);
  console.log('\nNewest 2 orders:');
  for (const order of newest) {
    console.log(`  ${order.customer}: $${order.amount}`);
  }

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

You have a `sales` bucket with records `{ product, quantity, unitPrice, region }`. Write a function that:
1. Calculates total quantity sold and total revenue (`quantity × unitPrice` is pre-computed as a `revenue` field)
2. Finds the cheapest and most expensive unit price
3. Paginates through all sales in batches of 20, counting how many pages are needed

<details>
<summary>Solution</summary>

```typescript
async function salesReport(client: NoexClient) {
  const sales = client.store.bucket('sales');

  // Aggregations in parallel
  const [totalQty, totalRevenue, minPrice, maxPrice] = await Promise.all([
    sales.sum('quantity'),
    sales.sum('revenue'),
    sales.min('unitPrice'),
    sales.max('unitPrice'),
  ]);

  console.log(`Total quantity: ${totalQty}`);
  console.log(`Total revenue: $${totalRevenue}`);
  console.log(`Unit price range: $${minPrice} – $${maxPrice}`);

  // Paginate and count pages
  let pages = 0;
  let cursor: unknown = undefined;

  do {
    const page = await sales.paginate({ limit: 20, after: cursor });
    pages++;
    console.log(`Page ${pages}: ${page.records.length} records`);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor !== undefined);

  console.log(`Total pages: ${pages}`);
}
```

The aggregations run in a single `Promise.all` (one round-trip), while pagination requires sequential requests because each page depends on the cursor from the previous one.

</details>

## Summary

- `first(n)` and `last(n)` return the oldest and newest records by insertion order
- `paginate({ limit, after? })` provides cursor-based pagination — more robust than offset-based
- `PaginatedResult` includes `records`, `hasMore`, and `nextCursor` for iterating through pages
- `sum()`, `avg()`, `min()`, `max()` compute numeric aggregations on a field, optionally filtered
- `min()` and `max()` return `null` when the bucket is empty
- Use `Promise.all` to run independent aggregations in parallel

---

Next: [Typed Buckets](./04-typed-buckets.md)
