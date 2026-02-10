import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError, type BucketsInfo, type StoreStats } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Store CRUD', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true }, role: { type: 'string' } } },
        { name: 'products', schema: { title: { type: 'string', required: true }, price: { type: 'number', required: true }, category: { type: 'string' } } },
      ],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected) await client.disconnect();
    await ctx.stop();
  });

  // ── insert ──────────────────────────────────────────────────────

  it('should insert a record and return it with metadata', async () => {
    const users = client.store.bucket('users');
    const alice = await users.insert({ name: 'Alice', role: 'admin' });

    expect(alice['name']).toBe('Alice');
    expect(alice['role']).toBe('admin');
    expect(typeof alice['id']).toBe('string');
    expect(alice['_version']).toBe(1);
    expect(typeof alice['_createdAt']).toBe('number');
  });

  // ── get ─────────────────────────────────────────────────────────

  it('should get an existing record by key', async () => {
    const users = client.store.bucket('users');
    const inserted = await users.insert({ name: 'Bob' });

    const found = await users.get(inserted['id']);

    expect(found).not.toBeNull();
    expect(found!['name']).toBe('Bob');
    expect(found!['id']).toBe(inserted['id']);
  });

  it('should return null for non-existent key', async () => {
    const users = client.store.bucket('users');
    const found = await users.get('nonexistent-id');

    expect(found).toBeNull();
  });

  // ── update ──────────────────────────────────────────────────────

  it('should update a record and increment version', async () => {
    const users = client.store.bucket('users');
    const inserted = await users.insert({ name: 'Charlie' });

    const updated = await users.update(inserted['id'], { name: 'Charles' });

    expect(updated['name']).toBe('Charles');
    expect(updated['id']).toBe(inserted['id']);
    expect(updated['_version']).toBe(2);
  });

  // ── delete ──────────────────────────────────────────────────────

  it('should delete a record', async () => {
    const users = client.store.bucket('users');
    const inserted = await users.insert({ name: 'Dave' });

    await users.delete(inserted['id']);

    const found = await users.get(inserted['id']);
    expect(found).toBeNull();
  });

  // ── all ─────────────────────────────────────────────────────────

  it('should return all records from a bucket', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'A' });
    await users.insert({ name: 'B' });
    await users.insert({ name: 'C' });

    const all = await users.all();

    expect(all).toHaveLength(3);
    const names = all.map((r) => r['name']).sort();
    expect(names).toEqual(['A', 'B', 'C']);
  });

  it('should return empty array when bucket is empty', async () => {
    const users = client.store.bucket('users');
    const all = await users.all();

    expect(all).toEqual([]);
  });

  // ── where ───────────────────────────────────────────────────────

  it('should filter records by criteria', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'Admin1', role: 'admin' });
    await users.insert({ name: 'User1', role: 'user' });
    await users.insert({ name: 'Admin2', role: 'admin' });

    const admins = await users.where({ role: 'admin' });

    expect(admins).toHaveLength(2);
    const names = admins.map((r) => r['name']).sort();
    expect(names).toEqual(['Admin1', 'Admin2']);
  });

  it('should return empty array when no records match', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'Alice', role: 'admin' });

    const result = await users.where({ role: 'superadmin' });

    expect(result).toEqual([]);
  });

  // ── findOne ─────────────────────────────────────────────────────

  it('should find one record by filter', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'Eve', role: 'admin' });
    await users.insert({ name: 'Frank', role: 'user' });

    const found = await users.findOne({ role: 'user' });

    expect(found).not.toBeNull();
    expect(found!['name']).toBe('Frank');
  });

  it('should return null when findOne has no match', async () => {
    const users = client.store.bucket('users');
    const found = await users.findOne({ role: 'nonexistent' });

    expect(found).toBeNull();
  });

  // ── count ───────────────────────────────────────────────────────

  it('should count all records', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'A' });
    await users.insert({ name: 'B' });
    await users.insert({ name: 'C' });

    const total = await users.count();

    expect(total).toBe(3);
  });

  it('should count records matching filter', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'A', role: 'admin' });
    await users.insert({ name: 'B', role: 'user' });
    await users.insert({ name: 'C', role: 'admin' });

    const adminCount = await users.count({ role: 'admin' });

    expect(adminCount).toBe(2);
  });

  it('should return 0 for empty bucket', async () => {
    const users = client.store.bucket('users');
    const total = await users.count();

    expect(total).toBe(0);
  });

  // ── first / last ────────────────────────────────────────────────

  it('should return first N records', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'First' });
    await users.insert({ name: 'Second' });
    await users.insert({ name: 'Third' });

    const result = await users.first(2);

    expect(result).toHaveLength(2);
    expect(result[0]!['name']).toBe('First');
    expect(result[1]!['name']).toBe('Second');
  });

  it('should return last N records', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'First' });
    await users.insert({ name: 'Second' });
    await users.insert({ name: 'Third' });

    const result = await users.last(2);

    expect(result).toHaveLength(2);
    expect(result[0]!['name']).toBe('Second');
    expect(result[1]!['name']).toBe('Third');
  });

  // ── paginate ────────────────────────────────────────────────────

  it('should paginate through records', async () => {
    const users = client.store.bucket('users');
    for (let i = 1; i <= 5; i++) {
      await users.insert({ name: `User${i}` });
    }

    // First page
    const page1 = await users.paginate({ limit: 2 });
    expect(page1.records).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    // Second page
    const page2 = await users.paginate({ limit: 2, after: page1.nextCursor });
    expect(page2.records).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    // Third page (last)
    const page3 = await users.paginate({ limit: 2, after: page2.nextCursor });
    expect(page3.records).toHaveLength(1);
    expect(page3.hasMore).toBe(false);

    // All records unique
    const allIds = [
      ...page1.records.map((r) => r['id']),
      ...page2.records.map((r) => r['id']),
      ...page3.records.map((r) => r['id']),
    ];
    expect(new Set(allIds).size).toBe(5);
  });

  // ── aggregation ─────────────────────────────────────────────────

  it('should calculate sum', async () => {
    const products = client.store.bucket('products');
    await products.insert({ title: 'A', price: 10, category: 'x' });
    await products.insert({ title: 'B', price: 20, category: 'x' });
    await products.insert({ title: 'C', price: 30, category: 'y' });

    const total = await products.sum('price');
    expect(total).toBe(60);

    const xTotal = await products.sum('price', { category: 'x' });
    expect(xTotal).toBe(30);
  });

  it('should calculate avg', async () => {
    const products = client.store.bucket('products');
    await products.insert({ title: 'A', price: 10 });
    await products.insert({ title: 'B', price: 20 });
    await products.insert({ title: 'C', price: 30 });

    const average = await products.avg('price');
    expect(average).toBe(20);
  });

  it('should calculate min and max', async () => {
    const products = client.store.bucket('products');
    await products.insert({ title: 'A', price: 15 });
    await products.insert({ title: 'B', price: 5 });
    await products.insert({ title: 'C', price: 25 });

    expect(await products.min('price')).toBe(5);
    expect(await products.max('price')).toBe(25);
  });

  it('should return null for min/max on empty bucket', async () => {
    const products = client.store.bucket('products');

    expect(await products.min('price')).toBeNull();
    expect(await products.max('price')).toBeNull();
  });

  // ── clear ───────────────────────────────────────────────────────

  it('should clear all records from a bucket', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'A' });
    await users.insert({ name: 'B' });
    expect(await users.count()).toBe(2);

    await users.clear();

    expect(await users.count()).toBe(0);
    expect(await users.all()).toEqual([]);
  });

  // ── error handling ──────────────────────────────────────────────

  it('should throw NoexClientError for undefined bucket', async () => {
    const unknown = client.store.bucket('nonexistent');

    await expect(unknown.all()).rejects.toThrow(NoexClientError);
  });

  // ── bucket independence ─────────────────────────────────────────

  it('should operate on separate buckets independently', async () => {
    const users = client.store.bucket('users');
    const products = client.store.bucket('products');

    await users.insert({ name: 'Alice' });
    await products.insert({ title: 'Widget', price: 9.99 });

    expect(await users.count()).toBe(1);
    expect(await products.count()).toBe(1);

    const allUsers = await users.all();
    expect(allUsers[0]!['name']).toBe('Alice');

    const allProducts = await products.all();
    expect(allProducts[0]!['title']).toBe('Widget');
  });

  // ── concurrent operations ───────────────────────────────────────

  it('should handle concurrent operations correctly', async () => {
    const users = client.store.bucket('users');

    const results = await Promise.all([
      users.insert({ name: 'A' }),
      users.insert({ name: 'B' }),
      users.insert({ name: 'C' }),
      users.insert({ name: 'D' }),
      users.insert({ name: 'E' }),
    ]);

    expect(results).toHaveLength(5);
    const names = results.map((r) => r['name']).sort();
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E']);

    const all = await users.all();
    expect(all).toHaveLength(5);
  });

  // ── buckets ──────────────────────────────────────────────────────

  it('should return bucket info with count and names', async () => {
    const info: BucketsInfo = await client.store.buckets();

    expect(info.count).toBe(2);
    expect([...info.names].sort()).toEqual(['products', 'users']);
  });

  // ── stats ────────────────────────────────────────────────────────

  it('should return store stats with empty buckets', async () => {
    const stats: StoreStats = await client.store.stats();

    expect(stats.buckets.count).toBe(2);
    expect([...stats.buckets.names].sort()).toEqual(['products', 'users']);
    expect(stats.records.total).toBe(0);
    expect(typeof stats.name).toBe('string');
    expect(typeof stats.queries).toBe('object');
    expect(typeof stats.persistence).toBe('object');
    expect(typeof stats.ttl).toBe('object');
  });

  it('should reflect inserted records in stats', async () => {
    const users = client.store.bucket('users');
    await users.insert({ name: 'Alice' });
    await users.insert({ name: 'Bob' });

    const products = client.store.bucket('products');
    await products.insert({ title: 'Widget', price: 10 });

    const stats: StoreStats = await client.store.stats();

    expect(stats.records.total).toBe(3);
    expect(stats.records.perBucket['users']).toBe(2);
    expect(stats.records.perBucket['products']).toBe(1);
  });
});
