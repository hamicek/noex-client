import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { BucketDefinition } from '../../src/index.js';
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

describe('Integration: Admin Store (client)', () => {
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

  // ── defineBucket ────────────────────────────────────────────────

  describe('defineBucket', () => {
    it('should create a bucket and allow CRUD on it', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      const result = await client.store.defineBucket('users', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          name: { type: 'string', required: true },
          email: { type: 'string' },
        },
        indexes: ['email'],
      });

      expect(result.name).toBe('users');
      expect(result.created).toBe(true);

      // Verify CRUD works
      const record = await client.store.bucket('users').insert({ name: 'Alice', email: 'alice@test.com' });
      expect(record['name']).toBe('Alice');
      expect(typeof record['id']).toBe('string');

      const fetched = await client.store.bucket('users').get(record['id']);
      expect(fetched).not.toBeNull();
      expect(fetched!['email']).toBe('alice@test.com');
    });

    it('should return ALREADY_EXISTS for duplicate bucket', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      const config: BucketDefinition = {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          title: { type: 'string', required: true },
        },
      };

      await client.store.defineBucket('posts', config);

      try {
        await client.store.defineBucket('posts', config);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('ALREADY_EXISTS');
      }
    });

    it('should work without auth when server has no auth configured', async () => {
      ctx = await startTestServer();
      const client = await createClient(ctx.url);

      const result = await client.store.defineBucket('open', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          value: { type: 'string' },
        },
      });

      expect(result.created).toBe(true);

      const record = await client.store.bucket('open').insert({ value: 'test' });
      expect(record['value']).toBe('test');
    });
  });

  // ── dropBucket ──────────────────────────────────────────────────

  describe('dropBucket', () => {
    it('should drop an existing bucket', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('temp', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          data: { type: 'string' },
        },
      });

      const result = await client.store.dropBucket('temp');
      expect(result.name).toBe('temp');
      expect(result.dropped).toBe(true);
    });

    it('should return BUCKET_NOT_DEFINED after drop when inserting', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('ephemeral', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          value: { type: 'string' },
        },
      });

      await client.store.dropBucket('ephemeral');

      try {
        await client.store.bucket('ephemeral').insert({ value: 'should-fail' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
      }
    });

    it('should return BUCKET_NOT_DEFINED for non-existent bucket', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      try {
        await client.store.dropBucket('no-such-bucket');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
      }
    });
  });

  // ── getBucketSchema ─────────────────────────────────────────────

  describe('getBucketSchema', () => {
    it('should return bucket configuration', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('docs', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          content: { type: 'string', required: true },
        },
        indexes: ['content'],
      });

      const result = await client.store.getBucketSchema('docs');
      expect(result.name).toBe('docs');
      expect(result.config.key).toBe('id');
      expect(result.config.schema['id']).toBeDefined();
      expect(result.config.schema['content']).toBeDefined();
      expect(result.config.indexes).toContain('content');
    });

    it('should reflect changes after updateBucket', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('evolving', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          name: { type: 'string' },
        },
      });

      await client.store.updateBucket('evolving', {
        addFields: { email: { type: 'string', format: 'email' } },
      });

      const result = await client.store.getBucketSchema('evolving');
      expect(result.config.schema['email']).toBeDefined();
      expect(result.config.schema['email']!.format).toBe('email');
    });

    it('should return BUCKET_NOT_DEFINED for non-existent bucket', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await expect(client.store.getBucketSchema('ghost')).rejects.toThrow(NoexClientError);
    });
  });

  // ── updateBucket ────────────────────────────────────────────────

  describe('updateBucket', () => {
    it('should add new fields and allow insert with them', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('profiles', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          name: { type: 'string', required: true },
        },
      });

      const result = await client.store.updateBucket('profiles', {
        addFields: {
          phone: { type: 'string' },
          age: { type: 'number', min: 0 },
        },
      });

      expect(result.name).toBe('profiles');
      expect(result.updated).toBe(true);

      // Verify new fields work
      const record = await client.store.bucket('profiles').insert({
        name: 'Bob',
        phone: '+420123456789',
        age: 30,
      });
      expect(record['phone']).toBe('+420123456789');
      expect(record['age']).toBe(30);
    });

    it('should add indexes', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('indexed', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          name: { type: 'string', required: true },
          email: { type: 'string' },
        },
      });

      await client.store.updateBucket('indexed', {
        addIndexes: ['email'],
      });

      await client.store.bucket('indexed').insert({ name: 'Alice', email: 'alice@test.com' });

      const results = await client.store.bucket('indexed').where({ email: 'alice@test.com' });
      expect(results).toHaveLength(1);
      expect(results[0]!['name']).toBe('Alice');
    });

    it('should preserve existing data after update', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      await client.store.defineBucket('items', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          title: { type: 'string', required: true },
        },
      });

      const record = await client.store.bucket('items').insert({ title: 'Original' });
      const key = record['id'];

      await client.store.updateBucket('items', {
        addFields: { description: { type: 'string' } },
      });

      const fetched = await client.store.bucket('items').get(key);
      expect(fetched).not.toBeNull();
      expect(fetched!['title']).toBe('Original');
    });

    it('should return BUCKET_NOT_DEFINED for non-existent bucket', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'admin' });

      try {
        await client.store.updateBucket('nonexistent', {
          addFields: { x: { type: 'string' } },
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
      }
    });
  });

  // ── Tier enforcement ────────────────────────────────────────────

  describe('tier enforcement', () => {
    it('should reject defineBucket from writer', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'writer' });

      try {
        await client.store.defineBucket('forbidden', {
          key: 'id',
          schema: { id: { type: 'string', generated: 'uuid' } },
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should reject dropBucket from reader', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'reader' });

      await expect(client.store.dropBucket('anything')).rejects.toThrow(NoexClientError);
    });

    it('should reject updateBucket from writer', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'writer' });

      await expect(
        client.store.updateBucket('anything', { addFields: { x: { type: 'string' } } }),
      ).rejects.toThrow(NoexClientError);
    });

    it('should reject getBucketSchema from reader', async () => {
      ctx = await startTestServer({ auth: createAuth() });
      const client = await createClient(ctx.url, { token: 'reader' });

      await expect(client.store.getBucketSchema('anything')).rejects.toThrow(NoexClientError);
    });
  });
});
