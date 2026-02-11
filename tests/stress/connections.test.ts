import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { createClientPool } from './helpers/client-pool.js';
import { createMetrics } from './helpers/metrics.js';
import { waitFor, flush } from './helpers/assertions.js';

const N = 200;
const BATCH_SIZE = 50;

describe('Stress: Concurrent connections', () => {
  let ctx: TestServerContext;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
  });

  afterEach(async () => {
    await ctx.stop();
  });

  // ── 200 simultaneous clients ─────────────────────────────────────

  it('handles 200 simultaneous clients', async () => {
    const pool = createClientPool(ctx.url, N, { batchSize: BATCH_SIZE });

    // Connect all clients in batches
    const connectStart = performance.now();
    await pool.connectAll();
    const connectMs = performance.now() - connectStart;
    console.log(`[Stress] Connected ${N} clients in ${connectMs.toFixed(0)}ms`);

    expect(pool.connectedCount).toBe(N);
    expect(ctx.server.connectionCount).toBe(N);

    // Every client sends one request — measure aggregate latency
    const metrics = createMetrics();
    let errors = 0;

    const results = await pool.eachClient(async (client, index) => {
      const start = performance.now();
      try {
        const rec = await client.store.bucket('users').insert({ name: `user-${index}` });
        metrics.record(performance.now() - start);
        return rec;
      } catch {
        errors++;
        metrics.record(performance.now() - start);
        return null;
      }
    });

    metrics.report(`${N} clients × 1 request`);

    expect(errors).toBe(0);
    expect(results.filter((r) => r !== null)).toHaveLength(N);

    // Graceful disconnect
    await pool.disconnectAll();
    await waitFor(() => ctx.server.connectionCount === 0, 10_000);

    expect(ctx.server.connectionCount).toBe(0);
  });

  // ── Resource cleanup after mass disconnect ───────────────────────

  it('cleans up server resources after mass disconnect', async () => {
    const baselineRss = process.memoryUsage().rss;

    const pool = createClientPool(ctx.url, N, { batchSize: BATCH_SIZE });
    await pool.connectAll();
    expect(ctx.server.connectionCount).toBe(N);

    // Each client performs a write to exercise the full request path
    await pool.eachClient(async (client, i) => {
      await client.store.bucket('users').insert({ name: `user-${i}` });
    });

    await pool.disconnectAll();
    await waitFor(() => ctx.server.connectionCount === 0, 10_000);

    // Let async cleanup settle (timers, event handlers, etc.)
    await flush(500);

    expect(ctx.server.connectionCount).toBe(0);

    const afterRss = process.memoryUsage().rss;
    const growthMb = (afterRss - baselineRss) / (1024 * 1024);
    console.log(`[Stress] RSS growth after ${N} connect/disconnect: ${growthMb.toFixed(1)} MB`);

    // Generous threshold — catches catastrophic leaks, not micro-allocations
    expect(growthMb).toBeLessThan(100);
  });

  // ── Sequential connect/disconnect waves ──────────────────────────

  it('survives multiple connect/disconnect waves', async () => {
    const WAVES = 3;
    const PER_WAVE = 50;

    for (let wave = 0; wave < WAVES; wave++) {
      const pool = createClientPool(ctx.url, PER_WAVE, { batchSize: PER_WAVE });
      await pool.connectAll();

      expect(ctx.server.connectionCount).toBe(PER_WAVE);

      // Every client in this wave performs a write
      await pool.eachClient(async (client, i) => {
        await client.store.bucket('users').insert({ name: `wave-${wave}-${i}` });
      });

      await pool.disconnectAll();
      await waitFor(() => ctx.server.connectionCount === 0, 5_000);
    }

    // After all waves, server should be completely clean
    expect(ctx.server.connectionCount).toBe(0);
  });
});
