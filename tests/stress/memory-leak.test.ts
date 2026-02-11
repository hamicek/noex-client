import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { waitFor, flush } from './helpers/assertions.js';

// ── Constants ───────────────────────────────────────────────────

const CYCLES = 100;
const MAX_RSS_GROWTH_MB = 20;

const BUCKET_SCHEMA = { name: { type: 'string', required: true } } as const;

// ── Helpers ─────────────────────────────────────────────────────

declare const gc: undefined | (() => void);

function forceGC(): void {
  if (typeof gc === 'function') gc();
}

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function createClient(url: string): NoexClient {
  return new NoexClient(url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
}

// ── Tests ───────────────────────────────────────────────────────

describe('Stress: Memory leak detection', () => {
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

  // ── Full lifecycle: connect → subscribe → push → unsubscribe → disconnect ──

  it('no leak after 100 connect/subscribe/disconnect cycles', async () => {
    // Warm up: stabilize JIT and lazy allocations
    for (let i = 0; i < 5; i++) {
      const c = createClient(ctx.url);
      await c.connect();
      const unsub = await c.store.subscribe('all-users', () => {});
      unsub();
      await c.disconnect();
    }
    await waitFor(() => ctx.server.connectionCount === 0, 5_000);
    await flush(200);

    forceGC();
    const baselineRss = rssMB();
    const samples: number[] = [baselineRss];

    for (let i = 0; i < CYCLES; i++) {
      const client = createClient(ctx.url);
      await client.connect();

      // Subscribe → receive initial data
      const unsub = await client.store.subscribe('all-users', () => {});

      // Mutate → trigger push to subscriber
      await client.store.bucket('users').insert({ name: `cycle-${i}` });
      await ctx.store.settle();

      // Clean teardown
      unsub();
      await client.disconnect();

      // Sample RSS every 20 cycles
      if ((i + 1) % 20 === 0) {
        forceGC();
        samples.push(rssMB());
      }
    }

    await waitFor(() => ctx.server.connectionCount === 0, 10_000);
    await flush(500);

    forceGC();
    await flush(200);

    const finalRss = rssMB();
    samples.push(finalRss);
    const growth = finalRss - baselineRss;

    console.log(`[Stress] Memory leak: ${CYCLES} connect/subscribe/disconnect cycles`);
    console.log(`  Baseline RSS: ${baselineRss.toFixed(1)} MB`);
    console.log(`  Final RSS:    ${finalRss.toFixed(1)} MB`);
    console.log(`  Growth:       ${growth.toFixed(1)} MB`);
    console.log(`  Samples:      ${samples.map((s) => s.toFixed(1)).join(' → ')} MB`);

    expect(growth).toBeLessThan(MAX_RSS_GROWTH_MB);
    expect(ctx.server.connectionCount).toBe(0);

    const stats = await ctx.server.getStats();
    expect(stats.connections.totalStoreSubscriptions).toBe(0);
    expect(stats.connections.active).toBe(0);
  });

  // ── Subscribe/unsubscribe on a persistent connection ──────────

  it('no leak after 100 subscribe/unsubscribe cycles on same connection', async () => {
    const client = createClient(ctx.url);
    await client.connect();

    // Warm up
    for (let i = 0; i < 5; i++) {
      const unsub = await client.store.subscribe('all-users', () => {});
      unsub();
    }
    await flush(200);

    forceGC();
    const baselineRss = rssMB();

    for (let i = 0; i < CYCLES; i++) {
      const unsub = await client.store.subscribe('all-users', () => {});

      await client.store.bucket('users').insert({ name: `sub-cycle-${i}` });
      await ctx.store.settle();

      unsub();
    }

    await flush(500);
    forceGC();
    await flush(200);

    const finalRss = rssMB();
    const growth = finalRss - baselineRss;

    console.log(`[Stress] Memory leak: ${CYCLES} subscribe/unsubscribe on same connection`);
    console.log(`  Baseline RSS: ${baselineRss.toFixed(1)} MB`);
    console.log(`  Final RSS:    ${finalRss.toFixed(1)} MB`);
    console.log(`  Growth:       ${growth.toFixed(1)} MB`);

    // Each cycle inserts a record → data accumulates in the store.
    // We test for subscription handler leaks, not data growth —
    // generous threshold accounts for 100 small stored records.
    expect(growth).toBeLessThan(50);

    const stats = await ctx.server.getStats();
    expect(stats.connections.totalStoreSubscriptions).toBe(0);

    await client.disconnect();
  });

  // ── Linear vs exponential growth ──────────────────────────────

  it('RSS grows linearly, not exponentially', async () => {
    // Warm up
    for (let i = 0; i < 3; i++) {
      const c = createClient(ctx.url);
      await c.connect();
      await c.disconnect();
    }
    await waitFor(() => ctx.server.connectionCount === 0, 5_000);
    await flush(200);

    forceGC();

    const phases = 4;
    const cyclesPerPhase = 25;
    const growths: number[] = [];

    for (let phase = 0; phase < phases; phase++) {
      forceGC();
      const phaseStartRss = rssMB();

      for (let i = 0; i < cyclesPerPhase; i++) {
        const client = createClient(ctx.url);
        await client.connect();

        const unsub = await client.store.subscribe('all-users', () => {});
        await client.store.bucket('users').insert({
          name: `phase-${phase}-${i}`,
        });
        await ctx.store.settle();

        unsub();
        await client.disconnect();
      }

      await waitFor(() => ctx.server.connectionCount === 0, 5_000);
      await flush(200);
      forceGC();
      await flush(200);

      growths.push(rssMB() - phaseStartRss);
    }

    console.log(
      `[Stress] Linear growth check: phase growths = ` +
        `${growths.map((g) => g.toFixed(1)).join(', ')} MB`,
    );

    // Exponential leak detection: the last phase should not grow
    // significantly more than the first. 3× multiplier + 5 MB absolute
    // tolerance handles natural variance and V8 heap expansion.
    const firstGrowth = Math.max(growths[0]!, 0.1);
    const lastGrowth = growths[growths.length - 1]!;
    expect(lastGrowth).toBeLessThan(firstGrowth * 3 + 5);

    expect(ctx.server.connectionCount).toBe(0);
  });
});
