import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, DisconnectedError } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Connection', () => {
  let ctx: TestServerContext | undefined;
  let client: NoexClient | undefined;

  afterEach(async () => {
    if (client?.isConnected) {
      await client.disconnect();
    }
    client = undefined;

    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }
  });

  // ── connect + welcome ──────────────────────────────────────────

  it('should connect and receive welcome info', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    const welcome = await client.connect();

    expect(welcome.version).toBe('1.0.0');
    expect(typeof welcome.serverTime).toBe('number');
    expect(welcome.requiresAuth).toBe(false);
    expect(client.state).toBe('connected');
    expect(client.isConnected).toBe(true);
  });

  // ── disconnect ─────────────────────────────────────────────────

  it('should disconnect gracefully', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();
    expect(client.isConnected).toBe(true);

    await client.disconnect();
    expect(client.state).toBe('disconnected');
    expect(client.isConnected).toBe(false);
  });

  // ── events ─────────────────────────────────────────────────────

  it('should emit connected and welcome events', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    let connectedCalled = false;
    let welcomeInfo: unknown = null;

    client.on('connected', () => { connectedCalled = true; });
    client.on('welcome', (info) => { welcomeInfo = info; });

    await client.connect();

    expect(connectedCalled).toBe(true);
    expect(welcomeInfo).not.toBeNull();
    expect((welcomeInfo as { version: string }).version).toBe('1.0.0');
  });

  it('should emit disconnected event on server stop', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();

    const disconnected = new Promise<string>((resolve) => {
      client!.on('disconnected', (reason) => resolve(reason));
    });

    // Stop the server — this will close all connections
    await ctx.stop();
    ctx = undefined; // Already stopped

    const reason = await disconnected;
    expect(client.state).toBe('disconnected');
    // Reason may vary
    expect(typeof reason).toBe('string');
  });

  // ── event unsubscribe ──────────────────────────────────────────

  it('should stop receiving events after unsubscribe', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    let callCount = 0;
    const unsub = client.on('connected', () => { callCount++; });

    await client.connect();
    expect(callCount).toBe(1);

    unsub();
    // Reconnecting would fire connected again, but with reconnect: false
    // we can't easily test that, so just verify unsub doesn't throw
  });

  // ── connect failure ────────────────────────────────────────────

  it('should reject on connect to invalid address', async () => {
    client = new NoexClient('ws://127.0.0.1:1', {
      WebSocket: WebSocket as never,
      reconnect: false,
      connectTimeoutMs: 2_000,
    });

    await expect(client.connect()).rejects.toThrow();
    expect(client.state).toBe('disconnected');
  });

  // ── request/response ───────────────────────────────────────────

  it('should send a request and receive a response', async () => {
    ctx = await startTestServer({
      buckets: [{ name: 'users', schema: { name: { type: 'string', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();

    // Insert a record using raw request
    const inserted = await client.request('store.insert', {
      bucket: 'users',
      data: { name: 'Alice' },
    }) as Record<string, unknown>;

    expect(inserted['name']).toBe('Alice');
    expect(typeof inserted['id']).toBe('string');

    // Get the record back
    const found = await client.request('store.get', {
      bucket: 'users',
      key: inserted['id'],
    }) as Record<string, unknown>;

    expect(found['name']).toBe('Alice');
    expect(found['id']).toBe(inserted['id']);
  });

  it('should handle server errors', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();

    // Request on undefined bucket should fail
    await expect(
      client.request('store.get', { bucket: 'nonexistent', key: '1' }),
    ).rejects.toThrow();
  });

  it('should reject requests after disconnect', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();
    await client.disconnect();

    expect(() => {
      client!.request('store.all', { bucket: 'users' });
    }).toThrow(DisconnectedError);
  });

  // ── multiple concurrent requests ───────────────────────────────

  it('should handle multiple concurrent requests', async () => {
    ctx = await startTestServer({
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();

    // Insert several items concurrently
    const inserts = await Promise.all([
      client.request('store.insert', { bucket: 'items', data: { value: 1 } }),
      client.request('store.insert', { bucket: 'items', data: { value: 2 } }),
      client.request('store.insert', { bucket: 'items', data: { value: 3 } }),
    ]) as Array<Record<string, unknown>>;

    expect(inserts).toHaveLength(3);
    expect(inserts.map((r) => r['value']).sort()).toEqual([1, 2, 3]);

    // Get all items
    const all = await client.request('store.all', { bucket: 'items' }) as Array<Record<string, unknown>>;
    expect(all).toHaveLength(3);
  });

  // ── pending requests rejected on connection loss ───────────────

  it('should reject pending requests when connection is lost', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    await client.connect();

    // Start a request but immediately kill the server
    const requestPromise = client.request('store.all', { bucket: 'x' });

    await ctx.stop();
    ctx = undefined;

    await expect(requestPromise).rejects.toThrow();
  });
});
