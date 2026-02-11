import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestServer, type TestServerContext } from '../integration/helpers/test-server.js';
import { NoexClientError } from '../../src/index.js';
import { createClientPool } from './helpers/client-pool.js';
import { createMetrics } from './helpers/metrics.js';
import { flush } from './helpers/assertions.js';

// ── Constants ───────────────────────────────────────────────────

const CLIENT_COUNT = 10;
const REQUESTS_PER_CLIENT = 20;
const MAX_REQUESTS = 50;
const WINDOW_MS = 60_000;

const BUCKET_SCHEMA = { value: { type: 'number', required: true } } as const;

// ── Helpers ─────────────────────────────────────────────────────

interface Outcomes {
  ok: number;
  rateLimited: number;
  error: number;
}

function emptyOutcomes(): Outcomes {
  return { ok: 0, rateLimited: 0, error: 0 };
}

function sumOutcomes(results: Outcomes[]): Outcomes {
  return results.reduce(
    (acc, r) => ({
      ok: acc.ok + r.ok,
      rateLimited: acc.rateLimited + r.rateLimited,
      error: acc.error + r.error,
    }),
    emptyOutcomes(),
  );
}

// ── Tests ───────────────────────────────────────────────────────

describe('Stress: Rate limiting under load', () => {
  let ctx: TestServerContext;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [{ name: 'items', schema: BUCKET_SCHEMA }],
      rateLimit: { maxRequests: MAX_REQUESTS, windowMs: WINDOW_MS },
    });
  });

  afterEach(async () => {
    await ctx.stop();
  });

  // ── Enforces limits across concurrent clients (shared IP) ─────

  it('enforces limits across concurrent clients', async () => {
    const pool = createClientPool(ctx.url, CLIENT_COUNT);
    await pool.connectAll();

    const metrics = createMetrics();

    // All clients share 127.0.0.1 → single rate limit bucket.
    // 10 clients × 20 sequential requests = 200 total.
    // Only MAX_REQUESTS (50) should succeed.
    const results = await pool.eachClient(async (client) => {
      const outcomes = emptyOutcomes();
      const items = client.store.bucket('items');

      for (let i = 0; i < REQUESTS_PER_CLIENT; i++) {
        const start = performance.now();
        try {
          await items.insert({ value: i });
          outcomes.ok++;
        } catch (e) {
          if (e instanceof NoexClientError && e.code === 'RATE_LIMITED') {
            outcomes.rateLimited++;
          } else {
            outcomes.error++;
          }
        }
        metrics.record(performance.now() - start);
      }
      return outcomes;
    });

    const totals = sumOutcomes(results);
    metrics.report('Rate limiting — sequential per client');
    console.log(
      `  OK: ${totals.ok}  Rate-limited: ${totals.rateLimited}  Errors: ${totals.error}`,
    );

    expect(totals.ok).toBeLessThanOrEqual(MAX_REQUESTS);
    expect(totals.ok).toBeGreaterThan(0);
    expect(totals.rateLimited).toBeGreaterThan(0);
    expect(totals.error).toBe(0);
    expect(totals.ok + totals.rateLimited).toBe(CLIENT_COUNT * REQUESTS_PER_CLIENT);

    await pool.disconnectAll();
  });

  // ── Parallel burst — all requests fired concurrently ──────────

  it('enforces limits under parallel burst', async () => {
    const pool = createClientPool(ctx.url, CLIENT_COUNT);
    await pool.connectAll();

    const metrics = createMetrics();

    // Fire all requests from all clients concurrently
    const results = await pool.eachClient(async (client) => {
      const outcomes = emptyOutcomes();
      const items = client.store.bucket('items');

      const promises = Array.from({ length: REQUESTS_PER_CLIENT }, async (_, i) => {
        const start = performance.now();
        try {
          await items.insert({ value: i });
          outcomes.ok++;
        } catch (e) {
          if (e instanceof NoexClientError && e.code === 'RATE_LIMITED') {
            outcomes.rateLimited++;
          } else {
            outcomes.error++;
          }
        }
        metrics.record(performance.now() - start);
      });

      await Promise.all(promises);
      return outcomes;
    });

    const totals = sumOutcomes(results);
    metrics.report('Rate limiting — parallel burst');
    console.log(
      `  OK: ${totals.ok}  Rate-limited: ${totals.rateLimited}  Errors: ${totals.error}`,
    );

    expect(totals.ok).toBeLessThanOrEqual(MAX_REQUESTS);
    expect(totals.ok).toBeGreaterThan(0);
    expect(totals.rateLimited).toBeGreaterThan(0);
    expect(totals.error).toBe(0);
    expect(totals.ok + totals.rateLimited).toBe(CLIENT_COUNT * REQUESTS_PER_CLIENT);

    await pool.disconnectAll();
  });

  // ── Window reset — requests resume after expiry ───────────────

  it('allows requests again after rate limit window expires', async () => {
    // Use a short window so the test doesn't take long
    await ctx.stop();
    const SHORT_WINDOW_MS = 500;
    const SHORT_MAX = 5;
    ctx = await startTestServer({
      buckets: [{ name: 'items', schema: BUCKET_SCHEMA }],
      rateLimit: { maxRequests: SHORT_MAX, windowMs: SHORT_WINDOW_MS },
    });

    const pool = createClientPool(ctx.url, 1);
    await pool.connectAll();
    const client = pool.getClient(0);
    const items = client.store.bucket('items');

    // Exhaust the limit
    for (let i = 0; i < SHORT_MAX; i++) {
      await items.insert({ value: i });
    }

    // Next request should be rate limited
    try {
      await items.insert({ value: 999 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NoexClientError);
      expect((e as NoexClientError).code).toBe('RATE_LIMITED');
    }

    // Wait for window to expire
    await flush(SHORT_WINDOW_MS + 100);

    // Requests should work again
    const result = await items.insert({ value: 1000 });
    expect(result).toBeDefined();
    expect(result['value']).toBe(1000);

    await pool.disconnectAll();
  });

  // ── Rate limit details include retryAfterMs ───────────────────

  it('rate limit errors include retryAfterMs details', async () => {
    await ctx.stop();
    ctx = await startTestServer({
      buckets: [{ name: 'items', schema: BUCKET_SCHEMA }],
      rateLimit: { maxRequests: 1, windowMs: WINDOW_MS },
    });

    const pool = createClientPool(ctx.url, 1);
    await pool.connectAll();
    const client = pool.getClient(0);
    const items = client.store.bucket('items');

    // Exhaust the single-request limit
    await items.insert({ value: 0 });

    // Second request should include retryAfterMs
    try {
      await items.insert({ value: 1 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NoexClientError);
      const err = e as NoexClientError;
      expect(err.code).toBe('RATE_LIMITED');
      const details = err.details as Record<string, unknown>;
      expect(details).toBeDefined();
      expect(typeof details['retryAfterMs']).toBe('number');
      expect(details['retryAfterMs']).toBeGreaterThan(0);
    }

    await pool.disconnectAll();
  });

  // ── Server stays healthy after sustained rate limiting ────────

  it('server remains healthy after sustained rate limiting pressure', async () => {
    const pool = createClientPool(ctx.url, CLIENT_COUNT);
    await pool.connectAll();

    // Bombard the server with 3 waves of requests, most of which will be rate limited.
    // The server must not crash or leak connections.
    for (let wave = 0; wave < 3; wave++) {
      await pool.eachClient(async (client) => {
        const items = client.store.bucket('items');
        for (let i = 0; i < REQUESTS_PER_CLIENT; i++) {
          try {
            await items.insert({ value: wave * REQUESTS_PER_CLIENT + i });
          } catch {
            // Rate limited — expected
          }
        }
      });
    }

    expect(ctx.server.isRunning).toBe(true);
    expect(ctx.server.connectionCount).toBe(CLIENT_COUNT);

    await pool.disconnectAll();
  });
});
