import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthConfig, AuthSession as ServerAuthSession } from '@hamicek/noex-server';
import { NoexClient, DisconnectedError, NoexClientError } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Helpers ──────────────────────────────────────────────────────

function waitFor(
  fn: () => boolean,
  timeoutMs = 3000,
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

function waitForEvent<T = void>(
  client: NoexClient,
  event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'error' | 'welcome',
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer);
      unsub();
      resolve(args[0] as T);
    });
  });
}

const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 0,
  maxRetries: 20,
} as const;

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Edge Cases', () => {
  let ctx: TestServerContext | undefined;
  let client: NoexClient | undefined;

  afterEach(async () => {
    if (client) {
      try { await client.disconnect(); } catch { /* already disconnected */ }
      client = undefined;
    }
    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }
  });

  // ── Connect → Disconnect → Connect (reuse client) ────────────

  describe('connect/disconnect lifecycle', () => {
    it('should reconnect after intentional disconnect', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
      });
      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

      // First connect
      const welcome1 = await client.connect();
      expect(welcome1.version).toBe('1.0.0');
      expect(client.isConnected).toBe(true);

      // Insert a record
      await client.store.bucket('items').insert({ value: 1 });

      // Disconnect
      await client.disconnect();
      expect(client.state).toBe('disconnected');

      // Reconnect — same client instance
      const welcome2 = await client.connect();
      expect(welcome2.version).toBe('1.0.0');
      expect(client.isConnected).toBe(true);

      // Verify operations work after reconnecting
      const all = await client.store.bucket('items').all();
      expect(all).toHaveLength(1);
      expect(all[0]!['value']).toBe(1);

      // Insert another record
      await client.store.bucket('items').insert({ value: 2 });
      const all2 = await client.store.bucket('items').all();
      expect(all2).toHaveLength(2);
    });

    it('should handle multiple connect/disconnect cycles', async () => {
      ctx = await startTestServer();
      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

      for (let i = 0; i < 5; i++) {
        await client.connect();
        expect(client.isConnected).toBe(true);
        await client.disconnect();
        expect(client.state).toBe('disconnected');
      }
    });

    it('should emit events correctly on each cycle', async () => {
      ctx = await startTestServer();
      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

      let connectedCount = 0;
      let disconnectedCount = 0;
      client.on('connected', () => { connectedCount++; });
      client.on('disconnected', () => { disconnectedCount++; });

      await client.connect();
      await client.disconnect();
      await client.connect();
      await client.disconnect();

      expect(connectedCount).toBe(2);
      expect(disconnectedCount).toBe(2);
    });
  });

  // ── Request during reconnecting state ─────────────────────────

  describe('requests during reconnecting state', () => {
    it('should throw DisconnectedError when client is reconnecting', async () => {
      const store = await Store.start({ name: `edge-reconnecting-${Date.now()}` });
      await store.defineBucket('items', {
        key: 'id',
        schema: { id: { type: 'string', generated: 'uuid' }, value: { type: 'number', required: true } },
      });

      const server = await NoexServer.start({ store, port: 0, host: '127.0.0.1' });
      const port = server.port;

      client = new NoexClient(`ws://127.0.0.1:${port}`, {
        WebSocket: WebSocket as never,
        reconnect: FAST_RECONNECT,
      });

      await client.connect();

      // Kill the server to trigger reconnect
      await server.stop();
      await waitFor(() => client!.state === 'reconnecting');

      // Attempt to send request while reconnecting
      // BucketAPI methods are async, so the synchronous throw from request()
      // is converted to a rejected promise
      await expect(
        client!.store.bucket('items').all(),
      ).rejects.toThrow(DisconnectedError);

      // Verify the error has the correct code
      try {
        await client!.store.bucket('items').all();
      } catch (err) {
        expect(err).toBeInstanceOf(DisconnectedError);
        expect((err as DisconnectedError).code).toBe('DISCONNECTED');
        expect(err.message).toContain('reconnecting');
      }

      // Clean up
      await client.disconnect();
      client = undefined;
      await store.stop();
    });
  });

  // ── Multiple subscriptions to same query ──────────────────────

  describe('multiple subscriptions to same query', () => {
    it('should support independent subscriptions to the same query', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'users', schema: { name: { type: 'string', required: true } } }],
      });

      ctx.store.defineQuery('all-users', async (qCtx) => {
        return qCtx.bucket('users').all();
      });

      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      const received1: unknown[] = [];
      const received2: unknown[] = [];

      const unsub1 = await client.store.subscribe('all-users', (data) => {
        received1.push(data);
      });

      const unsub2 = await client.store.subscribe('all-users', (data) => {
        received2.push(data);
      });

      // Both should receive initial data
      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);

      // Insert a record
      await client.store.bucket('users').insert({ name: 'Alice' });
      await ctx.store.settle();
      await waitFor(() => received1.length >= 2 && received2.length >= 2);

      // Both subscriptions received the push
      expect(received1).toHaveLength(2);
      expect(received2).toHaveLength(2);

      // Unsubscribe first — second should still work
      unsub1();

      await client.store.bucket('users').insert({ name: 'Bob' });
      await ctx.store.settle();
      await waitFor(() => received2.length >= 3);

      expect(received1).toHaveLength(2); // No more updates
      expect(received2).toHaveLength(3); // Still receiving

      unsub2();
    });
  });

  // ── Auto-login after reconnect ────────────────────────────────

  describe('auto-login after reconnect', () => {
    function createAuth(): AuthConfig {
      return {
        validate: async (token) => {
          if (token === 'valid-token') {
            return { userId: 'user-1', roles: ['user'] } as ServerAuthSession;
          }
          return null;
        },
      };
    }

    it('should auto-login after reconnect when auth token is configured', async () => {
      const store = await Store.start({ name: `edge-auth-reconnect-${Date.now()}` });
      await store.defineBucket('items', {
        key: 'id',
        schema: { id: { type: 'string', generated: 'uuid' }, value: { type: 'number', required: true } },
      });

      let server: NoexServer | undefined = await NoexServer.start({
        store,
        auth: createAuth(),
        port: 0,
        host: '127.0.0.1',
      });
      const port = server.port;

      client = new NoexClient(`ws://127.0.0.1:${port}`, {
        WebSocket: WebSocket as never,
        reconnect: FAST_RECONNECT,
        auth: { token: 'valid-token' },
      });

      const welcome = await client.connect();
      expect(welcome.requiresAuth).toBe(true);

      // Verify we're authenticated
      const session = await client.auth.whoami();
      expect(session).not.toBeNull();
      expect(session!.userId).toBe('user-1');

      // Restart server to force reconnect
      const reconnectedPromise = waitForEvent(client, 'reconnected');
      await server.stop();
      server = undefined;

      server = await NoexServer.start({
        store,
        auth: createAuth(),
        port,
        host: '127.0.0.1',
      });

      await reconnectedPromise;

      // After reconnect, should be auto-logged-in again
      const sessionAfter = await client.auth.whoami();
      expect(sessionAfter).not.toBeNull();
      expect(sessionAfter!.userId).toBe('user-1');

      // Operations should work
      const record = await client.store.bucket('items').insert({ value: 42 });
      expect(record['value']).toBe(42);

      // Clean up
      await client.disconnect();
      client = undefined;
      if (server?.isRunning) await server.stop();
      await store.stop();
    });
  });

  // ── Concurrent requests under load ────────────────────────────

  describe('concurrent operations', () => {
    it('should handle 50 concurrent inserts without losing correlation', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
      });
      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      const bucket = client.store.bucket('items');
      const promises = Array.from({ length: 50 }, (_, i) =>
        bucket.insert({ value: i }),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      const values = results.map((r) => r['value'] as number).sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i));

      const all = await bucket.all();
      expect(all).toHaveLength(50);
    });

    it('should handle mixed concurrent operations', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
      });
      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      const bucket = client.store.bucket('items');

      // Insert first
      const inserted = await bucket.insert({ value: 100 });
      const key = inserted['id'];

      // Mixed operations concurrently
      const [getResult, countResult, allResult] = await Promise.all([
        bucket.get(key),
        bucket.count(),
        bucket.all(),
      ]);

      expect(getResult).not.toBeNull();
      expect(getResult!['value']).toBe(100);
      expect(countResult).toBe(1);
      expect(allResult).toHaveLength(1);
    });
  });

  // ── Subscribe with callback error on initial data ─────────────

  describe('subscription resilience', () => {
    it('should reject subscribe and clean up when initial data callback throws', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'users', schema: { name: { type: 'string', required: true } } }],
      });

      ctx.store.defineQuery('user-count', async (qCtx) => {
        return qCtx.bucket('users').count();
      });

      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      let callCount = 0;

      // Callback throws on initial data delivery — subscribe itself rejects
      await expect(
        client.store.subscribe('user-count', () => {
          callCount++;
          throw new Error('initial boom');
        }),
      ).rejects.toThrow('initial boom');

      expect(callCount).toBe(1);

      // Client should remain functional despite the failed subscribe
      expect(client.isConnected).toBe(true);

      // Subscription is cleaned up — no stray pushes
      await client.store.bucket('users').insert({ name: 'Test' });
      await ctx.store.settle();
      await new Promise((r) => setTimeout(r, 200));

      // Callback should NOT have been called again (subscription was cleaned up)
      expect(callCount).toBe(1);

      // Can still do normal operations
      const all = await client.store.bucket('users').all();
      expect(all).toHaveLength(1);
    });

    it('should handle push callback errors gracefully (after initial data)', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'users', schema: { name: { type: 'string', required: true } } }],
      });

      ctx.store.defineQuery('user-count', async (qCtx) => {
        return qCtx.bucket('users').count();
      });

      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      let callCount = 0;
      const received: unknown[] = [];

      // Callback succeeds on initial data, throws on first push, then works again
      await client.store.subscribe('user-count', (data) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('push boom');
        }
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(0);

      // First insert — callback throws on push, but client survives
      await client.store.bucket('users').insert({ name: 'First' });
      await ctx.store.settle();
      await waitFor(() => callCount >= 2);

      // Client still functional
      expect(client.isConnected).toBe(true);

      // Second insert — callback should work again
      await client.store.bucket('users').insert({ name: 'Second' });
      await ctx.store.settle();
      await waitFor(() => callCount >= 3);

      expect(received).toHaveLength(2); // initial + third call
      expect(received[1]).toBe(2);
    });

    it('should handle rapid subscribe/unsubscribe churn', async () => {
      ctx = await startTestServer({
        buckets: [{ name: 'users', schema: { name: { type: 'string', required: true } } }],
      });

      ctx.store.defineQuery('all-users', async (qCtx) => {
        return qCtx.bucket('users').all();
      });

      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      // Rapidly subscribe and unsubscribe
      for (let i = 0; i < 10; i++) {
        const unsub = await client.store.subscribe('all-users', () => {});
        unsub();
      }

      // Client should be clean and functional
      expect(client.isConnected).toBe(true);

      const bucket = client.store.bucket('users');
      const alice = await bucket.insert({ name: 'Alice' });
      expect(alice['name']).toBe('Alice');
    });
  });

  // ── Error propagation ─────────────────────────────────────────

  describe('error propagation', () => {
    it('should propagate server errors with correct error class', async () => {
      ctx = await startTestServer();
      client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
      await client.connect();

      try {
        await client.store.bucket('nonexistent').all();
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect(typeof (err as NoexClientError).code).toBe('string');
        expect(typeof (err as NoexClientError).message).toBe('string');
      }
    });

    it('DisconnectedError has correct properties', () => {
      const err = new DisconnectedError('test reason');
      expect(err).toBeInstanceOf(NoexClientError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('DisconnectedError');
      expect(err.code).toBe('DISCONNECTED');
      expect(err.message).toBe('test reason');
    });

    it('DisconnectedError uses default message', () => {
      const err = new DisconnectedError();
      expect(err.message).toBe('Not connected');
    });
  });

  // ── Subscription recovery preserves data flow ─────────────────

  describe('subscription recovery data flow', () => {
    it('pushes continue working after reconnect with subscription', async () => {
      const store = await Store.start({ name: `edge-sub-recovery-${Date.now()}` });
      await store.defineBucket('counters', {
        key: 'id',
        schema: { id: { type: 'string', generated: 'uuid' }, value: { type: 'number', required: true } },
      });

      store.defineQuery('counter-count', async (qCtx) => {
        return qCtx.bucket('counters').count();
      });

      let server: NoexServer | undefined = await NoexServer.start({
        store,
        port: 0,
        host: '127.0.0.1',
      });
      const port = server.port;

      client = new NoexClient(`ws://127.0.0.1:${port}`, {
        WebSocket: WebSocket as never,
        reconnect: FAST_RECONNECT,
      });

      await client.connect();

      const received: unknown[] = [];
      await client.store.subscribe('counter-count', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(0);

      // Insert before reconnect
      await client.store.bucket('counters').insert({ value: 1 });
      await store.settle();
      await waitFor(() => received.length >= 2);
      expect(received[1]).toBe(1);

      // Restart server
      const reconnectedPromise = waitForEvent(client, 'reconnected');
      await server.stop();
      server = undefined;

      server = await NoexServer.start({ store, port, host: '127.0.0.1' });
      await reconnectedPromise;

      // Wait for resubscribe data
      await waitFor(() => received.length >= 3);

      // Insert after reconnect — push should arrive
      await client.store.bucket('counters').insert({ value: 2 });
      await store.settle();
      await waitFor(() => {
        return received.some((v, i) => i >= 3 && v === 2);
      });

      // Clean up
      await client.disconnect();
      client = undefined;
      if (server?.isRunning) await server.stop();
      await store.stop();
    });
  });
});
