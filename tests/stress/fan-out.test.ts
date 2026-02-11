import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { createClientPool } from './helpers/client-pool.js';
import { createMetrics } from './helpers/metrics.js';
import { waitFor, flush } from './helpers/assertions.js';

const SUBSCRIBERS = 100;
const MUTATIONS = 50;

describe('Stress: Subscription fan-out', () => {
  let ctx: TestServerContext;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
    ctx.store.defineQuery('all-users', async (qCtx) => {
      return qCtx.bucket('users').all();
    });
  });

  afterEach(async () => {
    await ctx.stop();
  });

  // ── Fan-out: sequential mutations ────────────────────────────────

  it(`delivers ${MUTATIONS} pushes to ${SUBSCRIBERS} subscribers`, async () => {
    const pool = createClientPool(ctx.url, SUBSCRIBERS);
    await pool.connectAll();

    // Each subscriber collects all callback invocations (initial + pushes)
    const received = new Map<number, unknown[]>();

    await pool.eachClient(async (client, index) => {
      received.set(index, []);
      await client.store.subscribe('all-users', (data) => {
        received.get(index)!.push(data);
      });
    });

    // All subscribers received the initial empty result
    for (const [index, msgs] of received) {
      expect(msgs, `Client ${index} missing initial data`).toHaveLength(1);
    }

    // One client mutates sequentially — each insert triggers a fan-out to all
    const mutator = pool.getClient(0);
    const metrics = createMetrics();
    const wallStart = performance.now();

    for (let i = 0; i < MUTATIONS; i++) {
      const start = performance.now();
      await mutator.store.bucket('users').insert({ name: `user-${i}` });
      await ctx.store.settle();
      metrics.record(performance.now() - start);
    }

    // Wait for every subscriber to receive all pushes
    const expectedCallbacks = 1 + MUTATIONS;
    await waitFor(
      () => [...received.values()].every((msgs) => msgs.length >= expectedCallbacks),
      15_000,
    );
    const wallMs = performance.now() - wallStart;

    metrics.report(`Fan-out: ${SUBSCRIBERS} subs × ${MUTATIONS} mutations`);
    console.log(`  Wall:   ${wallMs.toFixed(0)}ms`);

    // Exact callback count per subscriber
    for (const [index, msgs] of received) {
      expect(msgs, `Client ${index} wrong callback count`).toHaveLength(expectedCallbacks);
    }

    // Total push count (excluding initials)
    const totalPushes = [...received.values()].reduce((s, m) => s + m.length - 1, 0);
    expect(totalPushes).toBe(SUBSCRIBERS * MUTATIONS);

    // Push data consistency — every subscriber sees the same final state
    const finals = [...received.values()].map((msgs) => msgs[msgs.length - 1]);
    const finalUsers = finals[0] as Record<string, unknown>[];
    expect(finalUsers).toHaveLength(MUTATIONS);

    for (let i = 1; i < finals.length; i++) {
      expect(finals[i]).toEqual(finals[0]);
    }

    await pool.disconnectAll();
  });

  // ── Fan-out: burst mutations ─────────────────────────────────────

  it('handles burst mutations across many subscribers', async () => {
    const BURST_SUBS = 50;
    const BURST_SIZE = 100;

    const pool = createClientPool(ctx.url, BURST_SUBS, { batchSize: 50 });
    await pool.connectAll();

    const received = new Map<number, unknown[]>();

    await pool.eachClient(async (client, index) => {
      received.set(index, []);
      await client.store.subscribe('all-users', (data) => {
        received.get(index)!.push(data);
      });
    });

    // Fire all mutations concurrently — store may coalesce query re-evaluations
    const mutator = pool.getClient(0);
    const wallStart = performance.now();

    await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, i) =>
        mutator.store.bucket('users').insert({ name: `burst-${i}` }),
      ),
    );
    await ctx.store.settle();

    // Wait for every subscriber's final push to reflect the complete dataset.
    // Intermediate pushes may be coalesced — only the final state matters.
    await waitFor(
      () =>
        [...received.values()].every((msgs) => {
          if (msgs.length < 2) return false;
          const last = msgs[msgs.length - 1];
          return Array.isArray(last) && last.length === BURST_SIZE;
        }),
      15_000,
    );
    const wallMs = performance.now() - wallStart;

    const pushCounts = [...received.values()].map((msgs) => msgs.length - 1);
    console.log(
      `[Stress] Burst fan-out: ${BURST_SUBS} subs × ${BURST_SIZE} mutations — ` +
        `pushes/sub: min=${Math.min(...pushCounts)} max=${Math.max(...pushCounts)} — ` +
        `${wallMs.toFixed(0)}ms`,
    );

    // Final state consistency
    for (const [index, msgs] of received) {
      const finalState = msgs[msgs.length - 1] as Record<string, unknown>[];
      expect(finalState, `Client ${index} incomplete final state`).toHaveLength(BURST_SIZE);
    }

    await pool.disconnectAll();
  });

  // ── Subscription cleanup ─────────────────────────────────────────

  it('cleans up after mass unsubscribe', async () => {
    const pool = createClientPool(ctx.url, SUBSCRIBERS);
    await pool.connectAll();

    // Subscribe all
    const unsubscribes: Array<() => void> = [];
    await pool.eachClient(async (client) => {
      const unsub = await client.store.subscribe('all-users', () => {});
      unsubscribes.push(unsub);
    });

    // Unsubscribe all synchronously
    for (const unsub of unsubscribes) {
      unsub();
    }

    // Let fire-and-forget unsubscribe messages reach the server
    await flush(200);

    // Re-subscribe with one client to verify subscriptions still work
    const received: unknown[] = [];
    await pool.getClient(0).store.subscribe('all-users', (data) => {
      received.push(data);
    });
    expect(received).toHaveLength(1); // initial data

    await pool.getClient(0).store.bucket('users').insert({ name: 'after-cleanup' });
    await ctx.store.settle();
    await waitFor(() => received.length >= 2, 5_000);

    expect(received).toHaveLength(2);
    const users = received[1] as Record<string, unknown>[];
    expect(users).toHaveLength(1);
    expect(users[0]!['name']).toBe('after-cleanup');

    await pool.disconnectAll();
    await waitFor(() => ctx.server.connectionCount === 0, 10_000);
    expect(ctx.server.connectionCount).toBe(0);
  });
});
