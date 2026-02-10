import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { TransactionOp } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Store Transactions', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true }, credits: { type: 'number', default: 0 } } },
        { name: 'logs', schema: { action: { type: 'string', required: true }, userId: { type: 'string' } } },
      ],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected) await client.disconnect();
    await ctx.stop();
  });

  // ── Basic transaction ──────────────────────────────────────────

  it('should execute a single insert in a transaction', async () => {
    const result = await client.store.transaction([
      { op: 'insert', bucket: 'users', data: { name: 'Alice', credits: 100 } },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.index).toBe(0);

    const data = result.results[0]!.data as Record<string, unknown>;
    expect(data['name']).toBe('Alice');
    expect(data['credits']).toBe(100);
    expect(typeof data['id']).toBe('string');
  });

  it('should execute multiple operations atomically', async () => {
    const inserted = await client.store.bucket('users').insert({ name: 'Bob', credits: 200 });
    const bobId = inserted['id'] as string;

    const result = await client.store.transaction([
      { op: 'get', bucket: 'users', key: bobId },
      { op: 'update', bucket: 'users', key: bobId, data: { credits: 500 } },
      { op: 'insert', bucket: 'logs', data: { action: 'credit_update', userId: bobId } },
    ]);

    expect(result.results).toHaveLength(3);

    // Get result
    const getResult = result.results[0]!.data as Record<string, unknown>;
    expect(getResult['name']).toBe('Bob');
    expect(getResult['credits']).toBe(200);

    // Update result
    const updateResult = result.results[1]!.data as Record<string, unknown>;
    expect(updateResult['credits']).toBe(500);

    // Insert result (log entry)
    const logResult = result.results[2]!.data as Record<string, unknown>;
    expect(logResult['action']).toBe('credit_update');
    expect(logResult['userId']).toBe(bobId);
  });

  // ── Cross-bucket ───────────────────────────────────────────────

  it('should work across different buckets', async () => {
    const result = await client.store.transaction([
      { op: 'insert', bucket: 'users', data: { name: 'Carol' } },
      { op: 'insert', bucket: 'logs', data: { action: 'user_created' } },
    ]);

    expect(result.results).toHaveLength(2);

    const user = result.results[0]!.data as Record<string, unknown>;
    expect(user['name']).toBe('Carol');

    const log = result.results[1]!.data as Record<string, unknown>;
    expect(log['action']).toBe('user_created');

    // Verify both records are persisted
    const allUsers = await client.store.bucket('users').all();
    const allLogs = await client.store.bucket('logs').all();
    expect(allUsers).toHaveLength(1);
    expect(allLogs).toHaveLength(1);
  });

  // ── Operations ─────────────────────────────────────────────────

  it('should support delete in transaction', async () => {
    const inserted = await client.store.bucket('users').insert({ name: 'Dave' });
    const daveId = inserted['id'] as string;

    const result = await client.store.transaction([
      { op: 'delete', bucket: 'users', key: daveId },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.data).toEqual({ deleted: true });

    const found = await client.store.bucket('users').get(daveId);
    expect(found).toBeNull();
  });

  it('should support where in transaction', async () => {
    await client.store.bucket('users').insert({ name: 'Eve', credits: 100 });
    await client.store.bucket('users').insert({ name: 'Frank', credits: 200 });

    const result = await client.store.transaction([
      { op: 'where', bucket: 'users', filter: { credits: 100 } },
    ]);

    expect(result.results).toHaveLength(1);
    const found = result.results[0]!.data as Record<string, unknown>[];
    expect(found).toHaveLength(1);
    expect(found[0]!['name']).toBe('Eve');
  });

  it('should support findOne in transaction', async () => {
    await client.store.bucket('users').insert({ name: 'Grace', credits: 300 });

    const result = await client.store.transaction([
      { op: 'findOne', bucket: 'users', filter: { name: 'Grace' } },
    ]);

    expect(result.results).toHaveLength(1);
    const found = result.results[0]!.data as Record<string, unknown>;
    expect(found['name']).toBe('Grace');
  });

  it('should support count in transaction', async () => {
    await client.store.bucket('users').insert({ name: 'H1' });
    await client.store.bucket('users').insert({ name: 'H2' });

    const result = await client.store.transaction([
      { op: 'count', bucket: 'users' },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.data).toBe(2);
  });

  it('should return null for get of non-existent key', async () => {
    const result = await client.store.transaction([
      { op: 'get', bucket: 'users', key: 'nonexistent' },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.data).toBeNull();
  });

  // ── Result ordering ────────────────────────────────────────────

  it('should return results indexed by operation position', async () => {
    const result = await client.store.transaction([
      { op: 'insert', bucket: 'users', data: { name: 'I1' } },
      { op: 'insert', bucket: 'users', data: { name: 'I2' } },
      { op: 'count', bucket: 'users' },
    ]);

    expect(result.results).toHaveLength(3);
    expect(result.results[0]!.index).toBe(0);
    expect(result.results[1]!.index).toBe(1);
    expect(result.results[2]!.index).toBe(2);
    expect(result.results[2]!.data).toBe(2);
  });

  // ── Error handling ─────────────────────────────────────────────

  it('should reject on empty operations array', async () => {
    await expect(
      client.store.transaction([]),
    ).rejects.toThrow();
  });

  it('should reject with validation error for invalid operation', async () => {
    await expect(
      client.store.transaction([
        { op: 'insert', bucket: 'users', data: {} } as TransactionOp,
      ]),
    ).rejects.toThrow();
  });

  it('should reject on non-existent bucket', async () => {
    await expect(
      client.store.transaction([
        { op: 'insert', bucket: 'nonexistent', data: { name: 'test' } },
      ]),
    ).rejects.toThrow();
  });
});
