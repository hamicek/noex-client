import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { createMetrics } from './helpers/metrics.js';

const N = 1000;

describe('Stress: Request throughput', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected) await client.disconnect();
    await ctx.stop();
  });

  // ── Sequential insert ─────────────────────────────────────────────

  it('sequential insert', async () => {
    const metrics = createMetrics();
    const users = client.store.bucket('users');
    let errors = 0;

    for (let i = 0; i < N; i++) {
      const start = performance.now();
      try {
        await users.insert({ name: `user-${i}` });
      } catch {
        errors++;
      }
      metrics.record(performance.now() - start);
    }

    metrics.report('Sequential insert');

    expect(errors).toBe(0);
    expect(metrics.count).toBe(N);
    expect(metrics.rps).toBeGreaterThan(500);
    expect(await users.count()).toBe(N);
  });

  // ── Parallel insert ───────────────────────────────────────────────

  it('parallel insert', async () => {
    const metrics = createMetrics();
    const users = client.store.bucket('users');
    let errors = 0;

    const wallStart = performance.now();
    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const start = performance.now();
        return users.insert({ name: `user-${i}` }).then(
          () => metrics.record(performance.now() - start),
          () => {
            errors++;
            metrics.record(performance.now() - start);
          },
        );
      }),
    );
    const wallMs = performance.now() - wallStart;
    const wallRps = (N / wallMs) * 1000;

    metrics.report('Parallel insert');
    console.log(`  Wall:   ${wallMs.toFixed(1)}ms`);
    console.log(`  RPS:    ${Math.round(wallRps)} (wall-clock)`);

    expect(errors).toBe(0);
    expect(metrics.count).toBe(N);
    expect(wallRps).toBeGreaterThan(1000);
    expect(await users.count()).toBe(N);
  });

  // ── Sequential get ────────────────────────────────────────────────

  it('sequential get', async () => {
    const users = client.store.bucket('users');

    // Seed
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      const rec = await users.insert({ name: `user-${i}` });
      ids.push(rec['id'] as string);
    }

    // Measure
    const metrics = createMetrics();
    let misses = 0;

    for (const id of ids) {
      const start = performance.now();
      const found = await users.get(id);
      metrics.record(performance.now() - start);
      if (!found) misses++;
    }

    metrics.report('Sequential get');

    expect(misses).toBe(0);
    expect(metrics.count).toBe(N);
    expect(metrics.rps).toBeGreaterThan(500);
  });

  // ── Sequential where ──────────────────────────────────────────────

  it('sequential where', async () => {
    const users = client.store.bucket('users');

    // Seed 100 records
    for (let i = 0; i < 100; i++) {
      await users.insert({ name: `user-${i}` });
    }

    // Measure where queries
    const QUERIES = 500;
    const metrics = createMetrics();
    let emptyResults = 0;

    for (let i = 0; i < QUERIES; i++) {
      const start = performance.now();
      const result = await users.where({ name: `user-${i % 100}` });
      metrics.record(performance.now() - start);
      if (result.length === 0) emptyResults++;
    }

    metrics.report('Sequential where');

    expect(emptyResults).toBe(0);
    expect(metrics.count).toBe(QUERIES);
    expect(metrics.rps).toBeGreaterThan(200);
  });
});
