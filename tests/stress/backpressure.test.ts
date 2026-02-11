import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { createClientPool } from './helpers/client-pool.js';
import { createMetrics } from './helpers/metrics.js';
import { waitFor, flush } from './helpers/assertions.js';

// ── Constants ───────────────────────────────────────────────────

const INSERT_COUNT = 500;
const PAYLOAD_PADDING = 'x'.repeat(1024); // ~1 KB per record
const SUBSCRIBER_COUNT = 10;

const LOW_BACKPRESSURE = {
  maxBufferedBytes: 64_000, // 64 KB (default 1 MB)
  highWaterMark: 0.5, // effective threshold = 32 KB
};

// ── Helpers ─────────────────────────────────────────────────────

function createClient(url: string): NoexClient {
  return new NoexClient(url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
}

/**
 * Lightweight push tracker that avoids storing all intermediate snapshots
 * in memory. Only the latest callback value and a counter are retained.
 */
interface PushTracker {
  last: unknown;
  count: number;
}

function createPushTracker(): PushTracker {
  return { last: null, count: 0 };
}

// ── Tests ───────────────────────────────────────────────────────

describe('Stress: Backpressure', () => {
  let ctx: TestServerContext;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'items', schema: { data: { type: 'string', required: true } } },
      ],
      backpressure: LOW_BACKPRESSURE,
    });
    ctx.store.defineQuery('all-items', async (qCtx) => {
      return qCtx.bucket('items').all();
    });
  });

  afterEach(async () => {
    await ctx.stop();
  });

  // ── Burst flood with single subscriber ──────────────────────────

  it('server survives burst inserts under low backpressure threshold', async () => {
    const subscriber = createClient(ctx.url);
    await subscriber.connect();

    const tracker = createPushTracker();
    await subscriber.store.subscribe('all-items', (data) => {
      tracker.last = data;
      tracker.count++;
    });
    expect(tracker.count).toBe(1); // initial empty result

    const mutator = createClient(ctx.url);
    await mutator.connect();

    const rssBefore = process.memoryUsage().rss;
    const metrics = createMetrics();

    // Phase 1: Burst — fire all inserts concurrently to maximize buffer pressure
    const promises = Array.from({ length: INSERT_COUNT }, (_, i) => {
      const start = performance.now();
      return mutator.store
        .bucket('items')
        .insert({ data: `${PAYLOAD_PADDING}-${i}` })
        .then(() => metrics.record(performance.now() - start));
    });

    await Promise.all(promises);
    await ctx.store.settle();

    expect(ctx.server.isRunning).toBe(true);

    // Phase 2: Recovery — after buffer drains, trigger one final push
    // to guarantee the subscriber receives the complete dataset even if
    // intermediate pushes were dropped by backpressure.
    await flush(500);
    await mutator.store.bucket('items').insert({ data: `${PAYLOAD_PADDING}-recovery` });
    await ctx.store.settle();

    const expectedCount = INSERT_COUNT + 1;

    await waitFor(
      () => {
        const last = tracker.last;
        return Array.isArray(last) && last.length === expectedCount;
      },
      15_000,
    );

    const finalState = tracker.last as Record<string, unknown>[];
    expect(finalState).toHaveLength(expectedCount);

    const pushCount = tracker.count - 1; // exclude initial
    metrics.report(`Backpressure burst: ${INSERT_COUNT} inserts → 1 subscriber`);
    console.log(
      `  Pushes: ${pushCount}/${expectedCount} delivered ` +
        `(${((pushCount / expectedCount) * 100).toFixed(0)}%)`,
    );

    const rssAfter = process.memoryUsage().rss;
    const rssGrowthMB = (rssAfter - rssBefore) / (1024 * 1024);
    console.log(`  RSS Δ:  ${rssGrowthMB.toFixed(1)} MB`);
    expect(rssGrowthMB).toBeLessThan(300);

    await subscriber.disconnect();
    await mutator.disconnect();
  });

  // ── Amplified push pressure with multiple subscribers ───────────

  it('handles amplified push pressure with multiple subscribers', async () => {
    const pool = createClientPool(ctx.url, SUBSCRIBER_COUNT);
    await pool.connectAll();

    const trackers = new Map<number, PushTracker>();
    await pool.eachClient(async (client, index) => {
      const tracker = createPushTracker();
      trackers.set(index, tracker);
      await client.store.subscribe('all-items', (data) => {
        tracker.last = data;
        tracker.count++;
      });
    });

    for (const [, t] of trackers) {
      expect(t.count).toBe(1);
    }

    const mutator = createClient(ctx.url);
    await mutator.connect();

    const rssBefore = process.memoryUsage().rss;

    // Burst — each insert triggers a push to all subscribers
    await Promise.all(
      Array.from({ length: INSERT_COUNT }, (_, i) =>
        mutator.store.bucket('items').insert({ data: `${PAYLOAD_PADDING}-${i}` }),
      ),
    );
    await ctx.store.settle();

    expect(ctx.server.isRunning).toBe(true);

    // Recovery push after buffer drain
    await flush(500);
    await mutator.store.bucket('items').insert({ data: `${PAYLOAD_PADDING}-recovery` });
    await ctx.store.settle();

    const expectedCount = INSERT_COUNT + 1;

    await waitFor(
      () =>
        [...trackers.values()].every((t) => {
          const last = t.last;
          return Array.isArray(last) && last.length === expectedCount;
        }),
      15_000,
    );

    for (const [index, t] of trackers) {
      const finalState = t.last as Record<string, unknown>[];
      expect(finalState, `Subscriber ${index} incomplete`).toHaveLength(expectedCount);
    }

    const pushCounts = [...trackers.values()].map((t) => t.count - 1);
    console.log(
      `[Stress] Backpressure fan-out: ${INSERT_COUNT} inserts × ${SUBSCRIBER_COUNT} subs — ` +
        `pushes/sub: min=${Math.min(...pushCounts)} max=${Math.max(...pushCounts)}`,
    );

    const rssAfter = process.memoryUsage().rss;
    const rssGrowthMB = (rssAfter - rssBefore) / (1024 * 1024);
    console.log(`  RSS Δ:  ${rssGrowthMB.toFixed(1)} MB`);
    expect(rssGrowthMB).toBeLessThan(300);

    await pool.disconnectAll();
    await mutator.disconnect();
  });

  // ── Post-burst recovery ─────────────────────────────────────────

  it('server processes requests normally after burst subsides', async () => {
    const client = createClient(ctx.url);
    await client.connect();

    // Phase 1: Burst (no subscriber — pure request load)
    await Promise.all(
      Array.from({ length: INSERT_COUNT }, (_, i) =>
        client.store.bucket('items').insert({ data: `${PAYLOAD_PADDING}-${i}` }),
      ),
    );
    await ctx.store.settle();

    expect(ctx.server.isRunning).toBe(true);

    // Phase 2: Subscribe and verify the server still works correctly
    const tracker = createPushTracker();
    await client.store.subscribe('all-items', (data) => {
      tracker.last = data;
      tracker.count++;
    });

    expect(tracker.count).toBe(1);
    const initialData = tracker.last as Record<string, unknown>[];
    expect(initialData).toHaveLength(INSERT_COUNT);

    // New insert triggers a push
    await client.store.bucket('items').insert({ data: 'post-burst' });
    await ctx.store.settle();
    await waitFor(() => tracker.count >= 2, 5_000);

    const updatedData = tracker.last as Record<string, unknown>[];
    expect(updatedData).toHaveLength(INSERT_COUNT + 1);

    expect(ctx.server.isRunning).toBe(true);

    await client.disconnect();
  });
});
