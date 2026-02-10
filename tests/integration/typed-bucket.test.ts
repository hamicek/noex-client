import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';
import type { RecordMeta } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── User-defined schema types ──────────────────────────────────────

interface User {
  name: string;
  role: string;
}

interface Product {
  title: string;
  price: number;
  category: string;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Integration: TypedBucketAPI', () => {
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

  it('should insert with typed data and return typed record', async () => {
    const users = client.store.bucket<User>('users');
    const alice = await users.insert({ name: 'Alice', role: 'admin' });

    // Runtime checks — server returns the expected shape
    expect(alice.name).toBe('Alice');
    expect(alice.role).toBe('admin');
    expect(typeof alice.id).toBe('string');
    expect(alice._version).toBe(1);
    expect(typeof alice._createdAt).toBe('number');
    expect(typeof alice._updatedAt).toBe('number');

    // Compile-time: alice is User & RecordMeta — accessing typed fields without index access
    const name: string = alice.name;
    const version: number = alice._version;
    expect(name).toBe('Alice');
    expect(version).toBe(1);
  });

  // ── get ─────────────────────────────────────────────────────────

  it('should get a typed record by key', async () => {
    const users = client.store.bucket<User>('users');
    const inserted = await users.insert({ name: 'Bob', role: 'user' });

    const found = await users.get(inserted.id);

    expect(found).not.toBeNull();
    expect(found!.name).toBe('Bob');
    expect(found!.role).toBe('user');
    expect(found!.id).toBe(inserted.id);
  });

  it('should return null for non-existent key (typed)', async () => {
    const users = client.store.bucket<User>('users');
    const found = await users.get('nonexistent');

    expect(found).toBeNull();
  });

  // ── update ──────────────────────────────────────────────────────

  it('should update with typed partial data', async () => {
    const users = client.store.bucket<User>('users');
    const inserted = await users.insert({ name: 'Charlie', role: 'user' });

    const updated = await users.update(inserted.id, { role: 'admin' });

    expect(updated.name).toBe('Charlie');
    expect(updated.role).toBe('admin');
    expect(updated._version).toBe(2);
  });

  // ── all ─────────────────────────────────────────────────────────

  it('should return all records with typed array', async () => {
    const users = client.store.bucket<User>('users');
    await users.insert({ name: 'A', role: 'admin' });
    await users.insert({ name: 'B', role: 'user' });

    const all = await users.all();

    expect(all).toHaveLength(2);
    // Compile-time: all is (User & RecordMeta)[] — direct property access
    const names: string[] = all.map((u) => u.name);
    expect(names.sort()).toEqual(['A', 'B']);
  });

  // ── where ───────────────────────────────────────────────────────

  it('should filter with typed filter object', async () => {
    const users = client.store.bucket<User>('users');
    await users.insert({ name: 'Admin1', role: 'admin' });
    await users.insert({ name: 'User1', role: 'user' });
    await users.insert({ name: 'Admin2', role: 'admin' });

    const admins = await users.where({ role: 'admin' });

    expect(admins).toHaveLength(2);
    const names: string[] = admins.map((u) => u.name).sort();
    expect(names).toEqual(['Admin1', 'Admin2']);
  });

  // ── findOne ─────────────────────────────────────────────────────

  it('should find one record with typed filter', async () => {
    const users = client.store.bucket<User>('users');
    await users.insert({ name: 'Eve', role: 'admin' });

    const found = await users.findOne({ name: 'Eve' });

    expect(found).not.toBeNull();
    expect(found!.role).toBe('admin');
    expect(typeof found!._version).toBe('number');
  });

  // ── count ───────────────────────────────────────────────────────

  it('should count with typed filter', async () => {
    const users = client.store.bucket<User>('users');
    await users.insert({ name: 'A', role: 'admin' });
    await users.insert({ name: 'B', role: 'user' });
    await users.insert({ name: 'C', role: 'admin' });

    expect(await users.count({ role: 'admin' })).toBe(2);
    expect(await users.count()).toBe(3);
  });

  // ── first / last ──────────────────────────────────────────────

  it('should return first/last with typed records', async () => {
    const users = client.store.bucket<User>('users');
    await users.insert({ name: 'First', role: 'user' });
    await users.insert({ name: 'Second', role: 'user' });
    await users.insert({ name: 'Third', role: 'user' });

    const firstTwo = await users.first(2);
    expect(firstTwo).toHaveLength(2);
    expect(firstTwo[0]!.name).toBe('First');

    const lastTwo = await users.last(2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo[1]!.name).toBe('Third');
  });

  // ── paginate ──────────────────────────────────────────────────

  it('should paginate with typed records', async () => {
    const users = client.store.bucket<User>('users');
    for (let i = 1; i <= 3; i++) {
      await users.insert({ name: `User${i}`, role: 'user' });
    }

    const page1 = await users.paginate({ limit: 2 });
    expect(page1.records).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    // Compile-time: page1.records is (User & RecordMeta)[]
    expect(typeof page1.records[0]!.name).toBe('string');

    const page2 = await users.paginate({ limit: 2, after: page1.nextCursor });
    expect(page2.records).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  // ── aggregation with typed filter ──────────────────────────────

  it('should aggregate with typed filter', async () => {
    const products = client.store.bucket<Product>('products');
    await products.insert({ title: 'A', price: 10, category: 'x' });
    await products.insert({ title: 'B', price: 20, category: 'x' });
    await products.insert({ title: 'C', price: 30, category: 'y' });

    expect(await products.sum('price', { category: 'x' })).toBe(30);
    expect(await products.avg('price')).toBe(20);
    expect(await products.min('price')).toBe(10);
    expect(await products.max('price')).toBe(30);
  });

  // ── delete + clear ────────────────────────────────────────────

  it('should delete typed record by key', async () => {
    const users = client.store.bucket<User>('users');
    const alice = await users.insert({ name: 'Alice', role: 'admin' });

    await users.delete(alice.id);

    expect(await users.get(alice.id)).toBeNull();
  });

  it('should clear typed bucket', async () => {
    const users = client.store.bucket<User>('users');
    await users.insert({ name: 'A', role: 'user' });
    await users.insert({ name: 'B', role: 'user' });

    await users.clear();

    expect(await users.count()).toBe(0);
  });

  // ── untyped bucket still works (backward compatibility) ────────

  it('should work without type parameter (untyped)', async () => {
    const users = client.store.bucket('users');
    const alice = await users.insert({ name: 'Alice', role: 'admin' });

    expect(alice['name']).toBe('Alice');
    expect(typeof alice['id']).toBe('string');
    expect(alice['_version']).toBe(1);

    const all = await users.all();
    expect(all).toHaveLength(1);
  });

  // ── typed bucket with id in schema ────────────────────────────

  it('should work when user includes id in type', async () => {
    interface UserWithId {
      id: string;
      name: string;
      role: string;
    }
    const users = client.store.bucket<UserWithId>('users');

    // insert omits 'id' — only user data fields required
    const alice = await users.insert({ name: 'Alice', role: 'admin' });

    // Return type includes id from RecordMeta
    expect(typeof alice.id).toBe('string');
    expect(alice.name).toBe('Alice');
  });

  // ── different typed buckets coexist ───────────────────────────

  it('should handle multiple typed buckets independently', async () => {
    const users = client.store.bucket<User>('users');
    const products = client.store.bucket<Product>('products');

    const alice = await users.insert({ name: 'Alice', role: 'admin' });
    const widget = await products.insert({ title: 'Widget', price: 9.99, category: 'gadgets' });

    // Each bucket returns its own typed records
    expect(alice.name).toBe('Alice');
    expect(widget.title).toBe('Widget');
    expect(widget.price).toBe(9.99);

    expect(await users.count()).toBe(1);
    expect(await products.count()).toBe(1);
  });
});
