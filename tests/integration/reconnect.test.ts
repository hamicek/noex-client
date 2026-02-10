import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '../../src/index.js';

// ── Helpers ──────────────────────────────────────────────────────

function waitFor(
  fn: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 10);
  });
}

function waitForEvent<T = void>(
  client: NoexClient,
  event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'error' | 'welcome',
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer);
      unsub();
      resolve(args[0] as T);
    });
  });
}

// ── Fast reconnect options (for tests) ──────────────────────────

const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 0,
  maxRetries: 20,
} as const;

// ── Test state ──────────────────────────────────────────────────

let store: Store | undefined;
let server: NoexServer | undefined;
let client: NoexClient | undefined;

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Reconnect', () => {
  afterEach(async () => {
    if (client) {
      try { await client.disconnect(); } catch { /* already disconnected */ }
      client = undefined;
    }
    if (server?.isRunning) {
      await server.stop();
    }
    server = undefined;
    if (store) {
      await store.stop();
      store = undefined;
    }
  });

  async function setup() {
    store = await Store.start({ name: `reconnect-test-${Date.now()}` });
    await store.defineBucket('users', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        name: { type: 'string', required: true },
      },
    });

    store.defineQuery('all-users', async (qCtx) => {
      return qCtx.bucket('users').all();
    });

    store.defineQuery('user-count', async (qCtx) => {
      return qCtx.bucket('users').count();
    });

    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
    });
  }

  async function restartServer() {
    const port = server!.port;
    await server!.stop();
    server = undefined;

    server = await NoexServer.start({
      store: store!,
      port,
      host: '127.0.0.1',
    });
  }

  function createClient(port: number, overrides?: Record<string, unknown>) {
    return new NoexClient(`ws://127.0.0.1:${port}`, {
      WebSocket: WebSocket as never,
      reconnect: FAST_RECONNECT,
      connectTimeoutMs: 2_000,
      ...overrides,
    });
  }

  // ── Basic reconnect ──────────────────────────────────────────

  it('reconnects after server restart', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();
    expect(client.isConnected).toBe(true);

    const reconnectedPromise = waitForEvent(client, 'reconnected');

    // Stop server → triggers disconnect
    await server!.stop();
    server = undefined;

    // Client should enter reconnecting state
    await waitFor(() => client!.state === 'reconnecting');

    // Start new server on the same port
    server = await NoexServer.start({
      store: store!,
      port,
      host: '127.0.0.1',
    });

    await reconnectedPromise;
    expect(client.isConnected).toBe(true);
    expect(client.state).toBe('connected');
  });

  // ── Reconnecting events ──────────────────────────────────────

  it('emits reconnecting events with attempt numbers', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    const attempts: number[] = [];
    client.on('reconnecting', (attempt) => {
      attempts.push(attempt);
    });

    const reconnectedPromise = waitForEvent(client, 'reconnected');

    // Stop server — don't restart immediately
    await server!.stop();
    server = undefined;

    // Wait for a few reconnect attempts to accumulate
    await waitFor(() => attempts.length >= 2);

    // Now restart
    server = await NoexServer.start({
      store: store!,
      port,
      host: '127.0.0.1',
    });

    await reconnectedPromise;

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0]).toBe(1);
    expect(attempts[1]).toBe(2);
  });

  // ── Connected event after reconnect ──────────────────────────

  it('emits connected event after successful reconnect', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    let connectedCount = 0;
    client.on('connected', () => { connectedCount++; });

    const reconnectedPromise = waitForEvent(client, 'reconnected');

    await restartServer();
    await reconnectedPromise;

    // connected should have been emitted once (for the reconnect)
    expect(connectedCount).toBe(1);
  });

  // ── Max retries ──────────────────────────────────────────────

  it('gives up after max retries and emits disconnected', async () => {
    await setup();
    const port = server!.port;

    client = new NoexClient(`ws://127.0.0.1:${port}`, {
      WebSocket: WebSocket as never,
      reconnect: {
        initialDelayMs: 10,
        maxDelayMs: 10,
        jitterMs: 0,
        maxRetries: 3,
      },
      connectTimeoutMs: 100,
    });

    await client.connect();

    const errors: Error[] = [];
    client.on('error', (err) => errors.push(err));

    const disconnectedPromise = waitForEvent<string>(client, 'disconnected');

    // Stop server permanently
    await server!.stop();
    server = undefined;

    const reason = await disconnectedPromise;
    expect(client.state).toBe('disconnected');
    expect(reason).toContain('Max reconnect');
    const maxRetryError = errors.find((e) => e.message.includes('Max reconnect'));
    expect(maxRetryError).toBeDefined();
  });

  // ── Subscription recovery ────────────────────────────────────

  it('restores store subscriptions after reconnect', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    // Insert initial data
    await client.store.bucket('users').insert({ name: 'Alice' });

    const received: unknown[] = [];
    await client.store.subscribe('all-users', (data) => {
      received.push(data);
    });

    expect(received).toHaveLength(1);
    const initial = received[0] as Record<string, unknown>[];
    expect(initial).toHaveLength(1);

    const reconnectedPromise = waitForEvent(client, 'reconnected');
    await restartServer();
    await reconnectedPromise;

    // Resubscribe should have delivered current data
    await waitFor(() => received.length >= 2);

    const resubData = received[received.length - 1] as Record<string, unknown>[];
    expect(resubData).toHaveLength(1);
    expect(resubData[0]!['name']).toBe('Alice');
  });

  // ── Push after reconnect ─────────────────────────────────────

  it('receives push notifications after reconnect', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    const received: unknown[] = [];
    await client.store.subscribe('user-count', (data) => {
      received.push(data);
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(0);

    const reconnectedPromise = waitForEvent(client, 'reconnected');
    await restartServer();
    await reconnectedPromise;

    // Insert after reconnect — should trigger push via resubscribed subscription
    await client.store.bucket('users').insert({ name: 'Bob' });
    await store!.settle();
    await waitFor(() => {
      // Look for a count of 1 in received values
      return received.some((v) => v === 1);
    });

    expect(received[received.length - 1]).toBe(1);
  });

  // ── Multiple subscriptions ───────────────────────────────────

  it('restores multiple subscriptions after reconnect', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    const usersReceived: unknown[] = [];
    const countReceived: unknown[] = [];

    await client.store.subscribe('all-users', (data) => {
      usersReceived.push(data);
    });
    await client.store.subscribe('user-count', (data) => {
      countReceived.push(data);
    });

    expect(usersReceived).toHaveLength(1);
    expect(countReceived).toHaveLength(1);

    const reconnectedPromise = waitForEvent(client, 'reconnected');
    await restartServer();
    await reconnectedPromise;

    // Both should have received resubscribe data
    await waitFor(() => usersReceived.length >= 2 && countReceived.length >= 2);

    expect(usersReceived[usersReceived.length - 1]).toEqual([]);
    expect(countReceived[countReceived.length - 1]).toBe(0);
  });

  // ── Pending requests rejected ────────────────────────────────

  it('rejects pending requests on connection loss', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    // Start a request then immediately kill the server
    const requestPromise = client.store.bucket('users').all();
    await server!.stop();
    server = undefined;

    await expect(requestPromise).rejects.toThrow();
  });

  // ── Intentional disconnect during reconnect ──────────────────

  it('stops reconnecting on intentional disconnect', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    // Stop server
    await server!.stop();
    server = undefined;

    await waitFor(() => client!.state === 'reconnecting');

    // Intentional disconnect while reconnecting
    await client.disconnect();
    expect(client.state).toBe('disconnected');

    // Verify no more reconnect attempts
    const attempts: number[] = [];
    client.on('reconnecting', (n) => attempts.push(n));
    await new Promise((r) => setTimeout(r, 300));
    expect(attempts).toHaveLength(0);
  });

  // ── reconnect: false ─────────────────────────────────────────

  it('does not reconnect when reconnect is disabled', async () => {
    await setup();
    const port = server!.port;

    client = new NoexClient(`ws://127.0.0.1:${port}`, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const disconnectedPromise = waitForEvent<string>(client, 'disconnected');
    await server!.stop();
    server = undefined;

    await disconnectedPromise;
    expect(client.state).toBe('disconnected');

    // Wait a bit to verify no reconnect attempt
    await new Promise((r) => setTimeout(r, 200));
    expect(client.state).toBe('disconnected');
  });

  // ── Requests work after reconnect ────────────────────────────

  it('can send requests after reconnect', async () => {
    await setup();
    const port = server!.port;

    client = createClient(port);
    await client.connect();

    const reconnectedPromise = waitForEvent(client, 'reconnected');
    await restartServer();
    await reconnectedPromise;

    // Should be able to perform CRUD operations
    const inserted = await client.store.bucket('users').insert({ name: 'PostReconnect' });
    expect(inserted['name']).toBe('PostReconnect');

    const all = await client.store.bucket('users').all() as Record<string, unknown>[];
    expect(all).toHaveLength(1);
    expect(all[0]!['name']).toBe('PostReconnect');
  });
});
