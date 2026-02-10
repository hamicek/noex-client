# Part 3: Store Operations

Read and write data through typed bucket handles.

## Chapters

### [3.1 Basic CRUD](./01-basic-crud.md)

Create, read, update, and delete records:
- `client.store.bucket('name')` — get a bucket handle
- `insert(data)`, `get(key)`, `update(key, data)`, `delete(key)`
- `RecordMeta` — id, createdAt, updatedAt added by the server

### [3.2 Queries](./02-queries.md)

Query records with filters:
- `all()` — every record in the bucket
- `where(filter)` — records matching a condition
- `findOne(filter)` — single record or null
- `count(filter?)` — number of matching records

### [3.3 Aggregations & Pagination](./03-aggregations-pagination.md)

Navigate large datasets and compute aggregates:
- `first(n)`, `last(n)` — oldest and newest records
- `paginate({ limit, after? })` — cursor-based pagination
- `sum(field)`, `avg(field)`, `min(field)`, `max(field)` — numeric aggregations

### [3.4 Typed Buckets](./04-typed-buckets.md)

Leverage TypeScript generics for type-safe records:
- `BucketAPI<T>` — generic type parameter
- Intersection with `RecordMeta` in return types
- Compile-time checks for insert and update payloads

## What You'll Learn

By the end of this section, you'll be able to:
- Perform all CRUD operations on any bucket
- Query, filter, and paginate records
- Use aggregation functions for numeric analysis
- Define typed buckets with full TypeScript support

---

Start with: [Basic CRUD](./01-basic-crud.md)
