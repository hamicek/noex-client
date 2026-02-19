/**
 * Example 1 — Store CRUD
 *
 * Demonstrates basic Create / Read / Update / Delete operations,
 * filtering, pagination, and aggregation — all through the
 * NoexClient ↔ NoexServer WebSocket protocol.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../src/index.js';
import { startExample, type ExampleContext } from './helpers.js';

describe('Example: Store CRUD', () => {
  let ctx: ExampleContext;
  let client: NoexClient;

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx?.stop();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Insert, get, update, delete
  // ────────────────────────────────────────────────────────────────
  it('basic CRUD lifecycle', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'users',
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string', format: 'email' },
            age: { type: 'number' },
          },
        },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const users = client.store.bucket('users');

    // INSERT — returns the record with auto-generated id + metadata
    const alice = await users.insert({
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
    });
    console.log('Inserted:', alice);

    expect(alice['name']).toBe('Alice');
    expect(typeof alice['id']).toBe('string');
    expect(alice['_version']).toBe(1);

    // GET — retrieve by primary key
    const found = await users.get(alice['id']);
    expect(found).not.toBeNull();
    expect(found!['email']).toBe('alice@example.com');

    // UPDATE — partial update, bumps version
    const updated = await users.update(alice['id'], { age: 31 });
    expect(updated['age']).toBe(31);
    expect(updated['_version']).toBe(2);

    // DELETE
    await users.delete(alice['id']);
    const gone = await users.get(alice['id']);
    expect(gone).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Queries: where, findOne, count, first, last
  // ────────────────────────────────────────────────────────────────
  it('filtering and querying', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'products',
          schema: {
            title: { type: 'string', required: true },
            price: { type: 'number', required: true },
            category: { type: 'string', required: true },
          },
        },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const products = client.store.bucket('products');

    // Seed data
    await products.insert({ title: 'Keyboard', price: 79, category: 'electronics' });
    await products.insert({ title: 'Mouse', price: 49, category: 'electronics' });
    await products.insert({ title: 'Notebook', price: 12, category: 'office' });
    await products.insert({ title: 'Pen', price: 3, category: 'office' });
    await products.insert({ title: 'Monitor', price: 299, category: 'electronics' });

    // all() — every record in the bucket
    const all = await products.all();
    expect(all).toHaveLength(5);

    // where() — filter by field value
    const electronics = await products.where({ category: 'electronics' });
    expect(electronics).toHaveLength(3);
    console.log('Electronics:', electronics.map((p) => p['title']));

    // findOne() — single match
    const pen = await products.findOne({ title: 'Pen' });
    expect(pen).not.toBeNull();
    expect(pen!['price']).toBe(3);

    // count() — total or filtered
    expect(await products.count()).toBe(5);
    expect(await products.count({ category: 'office' })).toBe(2);

    // first() / last() — ordered slices
    const first2 = await products.first(2);
    expect(first2).toHaveLength(2);

    const last2 = await products.last(2);
    expect(last2).toHaveLength(2);
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Pagination
  // ────────────────────────────────────────────────────────────────
  it('cursor-based pagination', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'items',
          schema: { value: { type: 'number', required: true } },
        },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const items = client.store.bucket('items');

    // Insert 10 items
    for (let i = 1; i <= 10; i++) {
      await items.insert({ value: i });
    }

    // Paginate through 3 at a time
    const allValues: number[] = [];
    let cursor: unknown = undefined;

    while (true) {
      const page = await items.paginate({
        limit: 3,
        ...(cursor !== undefined ? { after: cursor } : {}),
      });

      for (const record of page.records) {
        allValues.push(record['value'] as number);
      }

      console.log(`Page: ${page.records.length} items, hasMore: ${page.hasMore}`);

      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    expect(allValues).toHaveLength(10);
    // All values should be unique
    expect(new Set(allValues).size).toBe(10);
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Aggregation: sum, avg, min, max
  // ────────────────────────────────────────────────────────────────
  it('aggregation functions', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'orders',
          schema: {
            amount: { type: 'number', required: true },
            region: { type: 'string', required: true },
          },
        },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const orders = client.store.bucket('orders');

    await orders.insert({ amount: 100, region: 'EU' });
    await orders.insert({ amount: 200, region: 'EU' });
    await orders.insert({ amount: 150, region: 'US' });
    await orders.insert({ amount: 50, region: 'US' });

    // Global aggregations
    const total = await orders.sum('amount');
    const average = await orders.avg('amount');
    const minimum = await orders.min('amount');
    const maximum = await orders.max('amount');

    console.log(`Total: ${total}, Avg: ${average}, Min: ${minimum}, Max: ${maximum}`);

    expect(total).toBe(500);
    expect(average).toBe(125);
    expect(minimum).toBe(50);
    expect(maximum).toBe(200);

    // Filtered aggregation — only EU orders
    const euTotal = await orders.sum('amount', { region: 'EU' });
    expect(euTotal).toBe(300);
    console.log(`EU total: ${euTotal}`);
  });

  // ────────────────────────────────────────────────────────────────
  // 5. Multiple buckets — independent data spaces
  // ────────────────────────────────────────────────────────────────
  it('working with multiple buckets', async () => {
    ctx = await startExample({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
        { name: 'posts', schema: { title: { type: 'string', required: true }, authorId: { type: 'string' } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const usersBucket = client.store.bucket('users');
    const postsBucket = client.store.bucket('posts');

    const author = await usersBucket.insert({ name: 'Bob' });
    await postsBucket.insert({ title: 'Hello World', authorId: author['id'] });
    await postsBucket.insert({ title: 'Second Post', authorId: author['id'] });

    // Each bucket has its own data
    expect(await usersBucket.count()).toBe(1);
    expect(await postsBucket.count()).toBe(2);

    // Filter posts by author
    const bobPosts = await postsBucket.where({ authorId: author['id'] });
    expect(bobPosts).toHaveLength(2);
    console.log('Bob\'s posts:', bobPosts.map((p) => p['title']));

    // Store metadata
    const info = await client.store.buckets();
    console.log(`Buckets: ${info.names.join(', ')} (${info.count} total)`);
    expect(info.count).toBe(2);
  });
});
