import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClientPool } from './client-pool.js';
import { startTestServer } from '../../integration/helpers/test-server.js';
import type { TestServerContext } from '../../integration/helpers/test-server.js';

let ctx: TestServerContext;

beforeEach(async () => {
  ctx = await startTestServer({
    buckets: [{ name: 'items', schema: { value: { type: 'number' } } }],
  });
});

afterEach(async () => {
  await ctx.stop();
});

describe('createClientPool', () => {
  it('creates a pool with the specified number of clients', () => {
    const pool = createClientPool(ctx.url, 5);
    expect(pool.size).toBe(5);
    expect(pool.connectedCount).toBe(0);
  });

  it('connectAll connects all clients in batches', async () => {
    const pool = createClientPool(ctx.url, 10, { batchSize: 3 });
    await pool.connectAll();

    expect(pool.connectedCount).toBe(10);
    expect(ctx.server.connectionCount).toBe(10);

    await pool.disconnectAll();
  });

  it('disconnectAll gracefully closes all connections', async () => {
    const pool = createClientPool(ctx.url, 5);
    await pool.connectAll();
    expect(pool.connectedCount).toBe(5);

    await pool.disconnectAll();
    expect(pool.connectedCount).toBe(0);

    // Give server a moment to process disconnections
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.server.connectionCount).toBe(0);
  });

  it('disconnectAll is safe to call on already-disconnected clients', async () => {
    const pool = createClientPool(ctx.url, 3);
    await pool.connectAll();
    await pool.disconnectAll();

    // Calling again should not throw
    await pool.disconnectAll();
    expect(pool.connectedCount).toBe(0);
  });

  it('forceDisconnectAll terminates connections immediately', async () => {
    const pool = createClientPool(ctx.url, 5);
    await pool.connectAll();
    expect(pool.connectedCount).toBe(5);

    pool.forceDisconnectAll();

    // Wait for async close handlers to fire
    await new Promise((r) => setTimeout(r, 100));
    expect(pool.connectedCount).toBe(0);
  });

  it('getClient returns the correct client', async () => {
    const pool = createClientPool(ctx.url, 3);
    await pool.connectAll();

    const c0 = pool.getClient(0);
    const c1 = pool.getClient(1);
    const c2 = pool.getClient(2);

    expect(c0).not.toBe(c1);
    expect(c1).not.toBe(c2);
    expect(c0.isConnected).toBe(true);

    await pool.disconnectAll();
  });

  it('getClient throws RangeError for invalid index', () => {
    const pool = createClientPool(ctx.url, 3);
    expect(() => pool.getClient(-1)).toThrow(RangeError);
    expect(() => pool.getClient(3)).toThrow(RangeError);
    expect(() => pool.getClient(100)).toThrow(RangeError);
  });

  it('eachClient runs function on every client and collects results', async () => {
    const pool = createClientPool(ctx.url, 5);
    await pool.connectAll();

    const results = await pool.eachClient(async (client, index) => {
      await client.store.bucket('items').insert({ value: index });
      return index * 2;
    });

    expect(results).toEqual([0, 2, 4, 6, 8]);

    await pool.disconnectAll();
  });

  it('connectedCount reflects real-time state', async () => {
    const pool = createClientPool(ctx.url, 3);
    expect(pool.connectedCount).toBe(0);

    await pool.connectAll();
    expect(pool.connectedCount).toBe(3);

    // Disconnect one manually
    await pool.getClient(0).disconnect();
    expect(pool.connectedCount).toBe(2);

    await pool.disconnectAll();
    expect(pool.connectedCount).toBe(0);
  });

  it('supports custom clientOptions', async () => {
    const pool = createClientPool(ctx.url, 2, {
      clientOptions: { requestTimeoutMs: 1000 },
    });
    await pool.connectAll();
    expect(pool.connectedCount).toBe(2);
    await pool.disconnectAll();
  });
});
