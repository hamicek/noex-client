import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Helpers ──────────────────────────────────────────────────────

function waitFor(
  fn: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 5);
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Store Subscriptions', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true }, role: { type: 'string', default: 'user' } } },
      ],
    });

    ctx.store.defineQuery('all-users', async (qCtx) => {
      return qCtx.bucket('users').all();
    });

    ctx.store.defineQuery('users-by-role', async (qCtx, params: { role: string }) => {
      return qCtx.bucket('users').where({ role: params!.role });
    });

    ctx.store.defineQuery('user-count', async (qCtx) => {
      return qCtx.bucket('users').count();
    });

    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    await ctx.stop();
  });

  // ── Initial data ──────────────────────────────────────────────

  describe('subscribe — initial data', () => {
    it('delivers empty array for empty bucket', async () => {
      const received: unknown[] = [];
      await client.store.subscribe('all-users', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([]);
    });

    it('delivers existing records as initial data', async () => {
      await client.store.bucket('users').insert({ name: 'Alice' });

      const received: unknown[] = [];
      await client.store.subscribe('all-users', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      const users = received[0] as Record<string, unknown>[];
      expect(users).toHaveLength(1);
      expect(users[0]!['name']).toBe('Alice');
    });

    it('delivers filtered initial data with params', async () => {
      await client.store.bucket('users').insert({ name: 'Admin', role: 'admin' });
      await client.store.bucket('users').insert({ name: 'User', role: 'user' });

      const received: unknown[] = [];
      await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      const users = received[0] as Record<string, unknown>[];
      expect(users).toHaveLength(1);
      expect(users[0]!['name']).toBe('Admin');
    });

    it('delivers scalar initial data (count query)', async () => {
      await client.store.bucket('users').insert({ name: 'A' });
      await client.store.bucket('users').insert({ name: 'B' });

      const received: unknown[] = [];
      await client.store.subscribe('user-count', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(2);
    });
  });

  // ── Push on data change ───────────────────────────────────────

  describe('push notifications', () => {
    it('calls callback when record is inserted', async () => {
      const received: unknown[] = [];
      await client.store.subscribe('all-users', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1); // initial

      await client.store.bucket('users').insert({ name: 'Bob' });
      await ctx.store.settle();
      await waitFor(() => received.length >= 2);

      const users = received[1] as Record<string, unknown>[];
      expect(users).toHaveLength(1);
      expect(users[0]!['name']).toBe('Bob');
    });

    it('calls callback when record is updated', async () => {
      const inserted = await client.store.bucket('users').insert({ name: 'Carol' });

      const received: unknown[] = [];
      await client.store.subscribe('all-users', (data) => {
        received.push(data);
      });

      await client.store.bucket('users').update(inserted['id'], { name: 'Caroline' });
      await ctx.store.settle();
      await waitFor(() => received.length >= 2);

      const users = received[1] as Record<string, unknown>[];
      expect(users).toHaveLength(1);
      expect(users[0]!['name']).toBe('Caroline');
    });

    it('calls callback when record is deleted', async () => {
      const inserted = await client.store.bucket('users').insert({ name: 'Dave' });

      const received: unknown[] = [];
      await client.store.subscribe('all-users', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toHaveLength(1);

      await client.store.bucket('users').delete(inserted['id']);
      await ctx.store.settle();
      await waitFor(() => received.length >= 2);

      expect(received[1]).toEqual([]);
    });

    it('pushes updated scalar value (count)', async () => {
      const received: unknown[] = [];
      await client.store.subscribe('user-count', (data) => {
        received.push(data);
      });

      expect(received[0]).toBe(0);

      await client.store.bucket('users').insert({ name: 'Eve' });
      await ctx.store.settle();
      await waitFor(() => received.length >= 2);

      expect(received[1]).toBe(1);
    });

    it('delivers pushes for multiple sequential mutations', async () => {
      const received: unknown[] = [];
      await client.store.subscribe('user-count', (data) => {
        received.push(data);
      });

      await client.store.bucket('users').insert({ name: 'First' });
      await ctx.store.settle();
      await waitFor(() => received.length >= 2);
      expect(received[1]).toBe(1);

      await client.store.bucket('users').insert({ name: 'Second' });
      await ctx.store.settle();
      await waitFor(() => received.length >= 3);
      expect(received[2]).toBe(2);
    });

    it('only pushes when query result actually changes', async () => {
      const received: unknown[] = [];
      await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([]);

      // Insert a regular user — filtered query result unchanged
      await client.store.bucket('users').insert({ name: 'Regular', role: 'user' });
      await ctx.store.settle();

      // Small delay to verify no push arrives
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toHaveLength(1);

      // Insert an admin — query result changes
      await client.store.bucket('users').insert({ name: 'AdminUser', role: 'admin' });
      await ctx.store.settle();
      await waitFor(() => received.length >= 2);

      const admins = received[1] as Record<string, unknown>[];
      expect(admins).toHaveLength(1);
      expect(admins[0]!['name']).toBe('AdminUser');
    });
  });

  // ── Unsubscribe ───────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('returned function is synchronous', async () => {
      const unsub = await client.store.subscribe('all-users', () => {});
      expect(typeof unsub).toBe('function');

      // Call is synchronous (no await needed)
      unsub();
    });

    it('stops push notifications after unsubscribe', async () => {
      const received: unknown[] = [];
      const unsub = await client.store.subscribe('all-users', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);

      unsub();

      await client.store.bucket('users').insert({ name: 'Ghost' });
      await ctx.store.settle();

      // Wait a bit to confirm no push arrives
      await new Promise((r) => setTimeout(r, 200));
      expect(received).toHaveLength(1);
    });

    it('explicit unsubscribe via store.unsubscribe', async () => {
      let subscriptionId: string | undefined;

      // We need to get the subscriptionId — subscribe, then read from protocol
      const result = await client.request('store.subscribe', { query: 'all-users' }) as {
        subscriptionId: string;
        data: unknown;
      };
      subscriptionId = result.subscriptionId;

      await client.store.unsubscribe(subscriptionId);

      // Verify no push arrives after explicit unsubscribe
      await client.store.bucket('users').insert({ name: 'Nobody' });
      await ctx.store.settle();
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  // ── Multiple subscriptions ────────────────────────────────────

  describe('multiple subscriptions', () => {
    it('supports multiple active subscriptions', async () => {
      const usersReceived: unknown[] = [];
      const countReceived: unknown[] = [];

      await client.store.subscribe('all-users', (data) => {
        usersReceived.push(data);
      });

      await client.store.subscribe('user-count', (data) => {
        countReceived.push(data);
      });

      expect(usersReceived).toHaveLength(1);
      expect(countReceived).toHaveLength(1);

      await client.store.bucket('users').insert({ name: 'MultiSub' });
      await ctx.store.settle();
      await waitFor(() => usersReceived.length >= 2 && countReceived.length >= 2);

      const users = usersReceived[1] as Record<string, unknown>[];
      expect(users).toHaveLength(1);
      expect(users[0]!['name']).toBe('MultiSub');
      expect(countReceived[1]).toBe(1);
    });

    it('unsubscribing one does not affect others', async () => {
      const usersReceived: unknown[] = [];
      const countReceived: unknown[] = [];

      const unsubUsers = await client.store.subscribe('all-users', (data) => {
        usersReceived.push(data);
      });

      await client.store.subscribe('user-count', (data) => {
        countReceived.push(data);
      });

      unsubUsers();

      await client.store.bucket('users').insert({ name: 'StillWorking' });
      await ctx.store.settle();
      await waitFor(() => countReceived.length >= 2);

      // Count subscription still works
      expect(countReceived[1]).toBe(1);

      // Users subscription stopped
      await new Promise((r) => setTimeout(r, 100));
      expect(usersReceived).toHaveLength(1);
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('rejects on unknown query', async () => {
      await expect(
        client.store.subscribe('nonexistent-query', () => {}),
      ).rejects.toThrow();
    });

    it('callback errors do not crash the client', async () => {
      const received: unknown[] = [];
      let callCount = 0;

      await client.store.subscribe('all-users', (data) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('callback boom');
        }
        received.push(data);
      });

      await client.store.bucket('users').insert({ name: 'Survivor' });
      await ctx.store.settle();
      await waitFor(() => callCount >= 2);

      // Client is still functional after callback error
      expect(client.isConnected).toBe(true);

      // Can still make requests
      const all = await client.store.bucket('users').all();
      expect(all).toHaveLength(1);
    });
  });
});
