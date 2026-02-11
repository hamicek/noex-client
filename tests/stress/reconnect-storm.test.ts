import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { createClientPool } from './helpers/client-pool.js';
import { createMetrics } from './helpers/metrics.js';
import { waitFor, flush } from './helpers/assertions.js';

// ── Constants ───────────────────────────────────────────────────

const N = 50;
const WAVES = 3;

const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 10,
  maxRetries: 20,
} as const;

const BUCKET_SCHEMA = { name: { type: 'string', required: true } } as const;

// ── Tests ───────────────────────────────────────────────────────

describe('Stress: Reconnect storm', () => {
  let ctx: TestServerContext;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [{ name: 'users', schema: BUCKET_SCHEMA }],
    });
    ctx.store.defineQuery('all-users', async (qCtx) => {
      return qCtx.bucket('users').all();
    });
  });

  afterEach(async () => {
    await ctx.stop();
  });

  // ── Force-disconnect + immediate new client waves ───────────

  it('handles 3 waves of force-disconnect + immediate reconnect', async () => {
    const metrics = createMetrics();

    for (let wave = 0; wave < WAVES; wave++) {
      const waveStart = performance.now();

      // Connect fresh clients — old connections may still be draining on server
      const pool = createClientPool(ctx.url, N, { batchSize: N });
      await pool.connectAll();

      // Wait for server to stabilize (old connections cleaned + new accepted)
      await waitFor(() => ctx.server.connectionCount === N, 10_000);

      // Every client subscribes — verify push machinery is functional
      const received = new Map<number, unknown[]>();
      await pool.eachClient(async (client, index) => {
        received.set(index, []);
        await client.store.subscribe('all-users', (data) => {
          received.get(index)!.push(data);
        });
      });

      // Trigger a mutation and verify fan-out reaches everyone
      await pool.getClient(0).store.bucket('users').insert({ name: `wave-${wave}` });
      await ctx.store.settle();

      await waitFor(
        () => [...received.values()].every((msgs) => msgs.length >= 2),
        5_000,
      );

      for (const [, msgs] of received) {
        expect(msgs.length).toBeGreaterThanOrEqual(2);
      }

      metrics.record(performance.now() - waveStart);

      // Simulate sudden network failure — no graceful close frame
      pool.forceDisconnectAll();
      // Intentionally don't wait for server cleanup — next wave creates overlap
    }

    // After the final wave, let the server fully drain
    await waitFor(() => ctx.server.connectionCount === 0, 10_000);

    expect(ctx.server.connectionCount).toBe(0);
    expect(ctx.server.isRunning).toBe(true);

    // Verify no leaked subscriptions on server
    const stats = await ctx.server.getStats();
    expect(stats.connections.totalStoreSubscriptions).toBe(0);

    metrics.report(`Reconnect storm: ${WAVES} waves × ${N} clients`);
  });

  // ── Auto-reconnect storm (built-in reconnect) ────────────────

  it('survives simultaneous auto-reconnect of 50 clients', async () => {
    const pool = createClientPool(ctx.url, N, {
      batchSize: N,
      clientOptions: { reconnect: FAST_RECONNECT },
    });
    await pool.connectAll();

    expect(pool.connectedCount).toBe(N);
    expect(ctx.server.connectionCount).toBe(N);

    // All clients subscribe
    const received = new Map<number, unknown[]>();
    await pool.eachClient(async (client, index) => {
      received.set(index, []);
      await client.store.subscribe('all-users', (data) => {
        received.get(index)!.push(data);
      });
    });

    // Force-disconnect triggers 50 simultaneous reconnect attempts
    pool.forceDisconnectAll();

    // Wait for close events to propagate before checking reconnect —
    // otherwise waitFor resolves immediately since connectedCount is still N
    await waitFor(() => pool.connectedCount < N, 5_000);

    // All clients reconnect in parallel
    await waitFor(
      () => pool.connectedCount === N && ctx.server.connectionCount === N,
      15_000,
    );

    // Subscriptions auto-restored via resubscribeAll:
    // each client received initial (1) + at least one resubscribe delivery (1)
    await waitFor(
      () => [...received.values()].every((msgs) => msgs.length >= 2),
      10_000,
    );

    // Verify data flow is intact post-storm
    await pool.getClient(0).store.bucket('users').insert({ name: 'post-storm' });
    await ctx.store.settle();

    await waitFor(
      () => [...received.values()].every((msgs) => msgs.length >= 3),
      10_000,
    );

    // Final state consistency — every subscriber sees the same data
    const finals = [...received.values()].map((msgs) => msgs[msgs.length - 1]);
    const expected = finals[0];
    for (let i = 1; i < finals.length; i++) {
      expect(finals[i]).toEqual(expected);
    }

    await pool.disconnectAll();
    await waitFor(() => ctx.server.connectionCount === 0, 10_000);
  });

  // ── Repeated auto-reconnect storms ────────────────────────────

  it('survives 3 consecutive reconnect storms without resource leak', async () => {
    const pool = createClientPool(ctx.url, N, {
      batchSize: N,
      clientOptions: { reconnect: FAST_RECONNECT },
    });
    await pool.connectAll();

    const metrics = createMetrics();

    for (let wave = 0; wave < WAVES; wave++) {
      const start = performance.now();

      expect(ctx.server.connectionCount).toBe(N);

      // Force-disconnect all → triggers reconnect storm
      pool.forceDisconnectAll();

      // Wait for close events to propagate before checking reconnect
      await waitFor(() => pool.connectedCount < N, 5_000);

      // Wait for all clients to reconnect
      await waitFor(
        () => pool.connectedCount === N && ctx.server.connectionCount === N,
        15_000,
      );

      // Verify each client can still make requests after reconnect
      const results = await pool.eachClient(async (client, i) => {
        return client.store.bucket('users').insert({ name: `storm-${wave}-${i}` });
      });
      expect(results.filter((r) => r !== null)).toHaveLength(N);

      metrics.record(performance.now() - start);
    }

    metrics.report(`Repeated storms: ${WAVES} × ${N} auto-reconnects`);

    // Verify server health and resource cleanup
    expect(ctx.server.isRunning).toBe(true);

    const stats = await ctx.server.getStats();
    expect(stats.connections.active).toBe(N);
    expect(stats.connections.totalStoreSubscriptions).toBe(0); // no subscriptions in this test

    await pool.disconnectAll();
    await waitFor(() => ctx.server.connectionCount === 0, 10_000);

    expect(ctx.server.connectionCount).toBe(0);

    const finalStats = await ctx.server.getStats();
    expect(finalStats.connections.active).toBe(0);
    expect(finalStats.connections.totalStoreSubscriptions).toBe(0);
  });
});
