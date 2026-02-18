import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { DeclarativeQueryConfig } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Fixtures ──────────────────────────────────────────────────────

const sessions: Record<string, AuthSession> = {
  admin:  { userId: 'admin-1',  roles: ['admin'] },
  writer: { userId: 'writer-1', roles: ['writer'] },
  reader: { userId: 'reader-1', roles: ['reader'] },
};

function createAuth(): AuthConfig {
  return {
    validate: async (token) => sessions[token] ?? null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Integration: Admin Queries (client)', () => {
  let ctx: TestServerContext | undefined;
  const clients: NoexClient[] = [];

  async function createClient(
    url: string,
    options?: { token?: string },
  ): Promise<NoexClient> {
    const client = new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: false,
      ...(options?.token ? { auth: { token: options.token } } : {}),
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  afterEach(async () => {
    for (const c of clients) {
      if (c.isConnected) await c.disconnect();
    }
    clients.length = 0;

    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }
  });

  // ── defineQuery ───────────────────────────────────────────────────

  describe('defineQuery', () => {
    it('should define a declarative query', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string', required: true } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      const result = await client.store.defineQuery('all-users', {
        bucket: 'users',
      });

      expect(result.name).toBe('all-users');
      expect(result.defined).toBe(true);
    });

    it('should define query and subscribe to get initial data', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: {
          name: { type: 'string', required: true },
          role: { type: 'string' },
          active: { type: 'boolean' },
        } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.bucket('users').insert({ name: 'Alice', role: 'admin', active: true });
      await client.store.bucket('users').insert({ name: 'Bob', role: 'user', active: false });

      await client.store.defineQuery('active-users', {
        bucket: 'users',
        filter: { active: true },
      });

      let received: unknown = null;
      const unsub = await client.store.subscribe('active-users', (data) => {
        received = data;
      });

      expect(received).toBeInstanceOf(Array);
      const records = received as Array<Record<string, unknown>>;
      expect(records).toHaveLength(1);
      expect(records[0]!['name']).toBe('Alice');

      unsub();
    });

    it('should receive reactive push after insert', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'items', schema: {
          title: { type: 'string', required: true },
        } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineQuery('all-items', {
        bucket: 'items',
      });

      const snapshots: unknown[] = [];
      const unsub = await client.store.subscribe('all-items', (data) => {
        snapshots.push(data);
      });

      // Initial data (empty)
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toEqual([]);

      // Insert triggers reactive push
      await client.store.bucket('items').insert({ title: 'Widget' });

      // Wait for push
      await new Promise((r) => setTimeout(r, 200));

      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      const latest = snapshots[snapshots.length - 1] as Array<Record<string, unknown>>;
      expect(latest).toHaveLength(1);
      expect(latest[0]!['title']).toBe('Widget');

      unsub();
    });

    it('should support sort and limit', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: {
          name: { type: 'string', required: true },
          age: { type: 'number' },
        } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.bucket('users').insert({ name: 'Charlie', age: 30 });
      await client.store.bucket('users').insert({ name: 'Alice', age: 25 });
      await client.store.bucket('users').insert({ name: 'Bob', age: 35 });

      await client.store.defineQuery('top-2-by-name', {
        bucket: 'users',
        sort: { name: 'asc' },
        limit: 2,
      });

      let received: unknown = null;
      const unsub = await client.store.subscribe('top-2-by-name', (data) => {
        received = data;
      });

      const records = received as Array<Record<string, unknown>>;
      expect(records).toHaveLength(2);
      expect(records[0]!['name']).toBe('Alice');
      expect(records[1]!['name']).toBe('Bob');

      unsub();
    });

    it('should support fields projection', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: {
          name: { type: 'string', required: true },
          role: { type: 'string' },
          age: { type: 'number' },
        } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.bucket('users').insert({ name: 'Alice', role: 'admin', age: 25 });

      await client.store.defineQuery('names-only', {
        bucket: 'users',
        fields: ['name', 'role'],
      });

      let received: unknown = null;
      const unsub = await client.store.subscribe('names-only', (data) => {
        received = data;
      });

      const records = received as Array<Record<string, unknown>>;
      expect(records).toHaveLength(1);
      expect(records[0]!['name']).toBe('Alice');
      expect(records[0]!['role']).toBe('admin');
      expect(records[0]!['age']).toBeUndefined();

      unsub();
    });

    it('should support aggregate count', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: {
          name: { type: 'string', required: true },
          active: { type: 'boolean' },
        } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.bucket('users').insert({ name: 'Alice', active: true });
      await client.store.bucket('users').insert({ name: 'Bob', active: true });
      await client.store.bucket('users').insert({ name: 'Charlie', active: false });

      await client.store.defineQuery('active-count', {
        bucket: 'users',
        filter: { active: true },
        aggregate: { function: 'count' },
      });

      let received: unknown = null;
      const unsub = await client.store.subscribe('active-count', (data) => {
        received = data;
      });

      expect(received).toBe(2);

      unsub();
    });

    it('should support parametrized queries', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: {
          name: { type: 'string', required: true },
          role: { type: 'string' },
        } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.bucket('users').insert({ name: 'Alice', role: 'admin' });
      await client.store.bucket('users').insert({ name: 'Bob', role: 'user' });

      await client.store.defineQuery('users-by-role', {
        bucket: 'users',
        filter: { role: '{{ params.role }}' },
      });

      let received: unknown = null;
      const unsub = await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
        received = data;
      });

      const records = received as Array<Record<string, unknown>>;
      expect(records).toHaveLength(1);
      expect(records[0]!['name']).toBe('Alice');

      unsub();
    });

    it('should return ALREADY_EXISTS for duplicate query name', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineQuery('dup', { bucket: 'users' });

      try {
        await client.store.defineQuery('dup', { bucket: 'users' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('ALREADY_EXISTS');
      }
    });

    it('should return BUCKET_NOT_DEFINED for non-existent bucket', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      try {
        await client.store.defineQuery('bad', { bucket: 'nonexistent' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
      }
    });

    it('should work without auth when server has no auth configured', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'items', schema: { value: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url);

      const result = await client.store.defineQuery('all-items', {
        bucket: 'items',
      });

      expect(result.name).toBe('all-items');
      expect(result.defined).toBe(true);
    });
  });

  // ── undefineQuery ─────────────────────────────────────────────────

  describe('undefineQuery', () => {
    it('should remove an existing query', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineQuery('temp', { bucket: 'users' });

      const result = await client.store.undefineQuery('temp');
      expect(result.name).toBe('temp');
      expect(result.undefined).toBe(true);
    });

    it('should fail to subscribe after undefine', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineQuery('doomed', { bucket: 'users' });
      await client.store.undefineQuery('doomed');

      try {
        await client.store.subscribe('doomed', () => {});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('QUERY_NOT_DEFINED');
      }
    });

    it('should return QUERY_NOT_DEFINED for non-existent query', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      try {
        await client.store.undefineQuery('no-such-query');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('QUERY_NOT_DEFINED');
      }
    });
  });

  // ── listQueries ──────────────────────────────────────────────────

  describe('listQueries', () => {
    it('should return empty list when no queries defined', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      const result = await client.store.listQueries();
      expect(result.queries).toEqual([]);
    });

    it('should return defined queries with metadata', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' }, active: { type: 'boolean' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineQuery('q1', {
        bucket: 'users',
        filter: { active: true },
      });
      await client.store.defineQuery('q2', {
        bucket: 'users',
        sort: { name: 'asc' },
        limit: 5,
      });

      const result = await client.store.listQueries();
      expect(result.queries).toHaveLength(2);

      const names = result.queries.map((q) => q.name);
      expect(names).toContain('q1');
      expect(names).toContain('q2');

      const q1 = result.queries.find((q) => q.name === 'q1')!;
      expect(q1.type).toBe('declarative');
      expect(q1.config).toBeDefined();
      expect(q1.config!.bucket).toBe('users');
    });

    it('should reflect removals', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineQuery('to-remove', { bucket: 'users' });
      await client.store.undefineQuery('to-remove');

      const result = await client.store.listQueries();
      expect(result.queries).toEqual([]);
    });
  });

  // ── Tier enforcement ──────────────────────────────────────────────

  describe('tier enforcement', () => {
    it('should reject defineQuery from writer', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'writer' });

      try {
        await client.store.defineQuery('forbidden', { bucket: 'users' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should reject defineQuery from reader', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'reader' });

      await expect(
        client.store.defineQuery('forbidden', { bucket: 'users' }),
      ).rejects.toThrow(NoexClientError);
    });

    it('should reject undefineQuery from writer', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'writer' });

      await expect(
        client.store.undefineQuery('anything'),
      ).rejects.toThrow(NoexClientError);
    });

    it('should reject listQueries from reader', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        buckets: [{ name: 'users', schema: { name: { type: 'string' } } }],
      });
      const client = await createClient(ctx.url, { token: 'reader' });

      await expect(
        client.store.listQueries(),
      ).rejects.toThrow(NoexClientError);
    });
  });

  // ── End-to-end scenario ───────────────────────────────────────────

  describe('end-to-end', () => {
    it('should define bucket + query remotely and use reactive subscriptions', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      // 1. Define bucket remotely
      await client.store.defineBucket('products', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          name: { type: 'string', required: true },
          category: { type: 'string' },
          price: { type: 'number' },
        },
      });

      // 2. Define query remotely
      await client.store.defineQuery('cheap-electronics', {
        bucket: 'products',
        filter: { category: 'electronics' },
        sort: { price: 'asc' },
        limit: 10,
      });

      // 3. Subscribe
      const snapshots: unknown[] = [];
      const unsub = await client.store.subscribe('cheap-electronics', (data) => {
        snapshots.push(data);
      });

      // Initial: empty
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toEqual([]);

      // 4. Insert product
      await client.store.bucket('products').insert({
        name: 'USB Cable',
        category: 'electronics',
        price: 5.99,
      });

      // Wait for reactive push
      await new Promise((r) => setTimeout(r, 200));

      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      const latest = snapshots[snapshots.length - 1] as Array<Record<string, unknown>>;
      expect(latest).toHaveLength(1);
      expect(latest[0]!['name']).toBe('USB Cable');

      // 5. Insert non-matching product — should not appear
      await client.store.bucket('products').insert({
        name: 'T-Shirt',
        category: 'clothing',
        price: 19.99,
      });

      await new Promise((r) => setTimeout(r, 200));

      const final = snapshots[snapshots.length - 1] as Array<Record<string, unknown>>;
      expect(final).toHaveLength(1);
      expect(final[0]!['name']).toBe('USB Cable');

      unsub();
    });
  });
});
