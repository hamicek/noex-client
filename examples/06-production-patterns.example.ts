/**
 * Example 6 — Production Patterns
 *
 * Demonstrates production-oriented features of NoexClient:
 * - Audit log querying
 * - Connection lifecycle events (connected, disconnected, reconnecting, reconnected)
 * - Auto-reconnect with subscription restoration
 * - Graceful shutdown handling
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthConfig, AuthSession, BuiltInAuthConfig } from '@hamicek/noex-server';
import { NoexClient } from '../src/index.js';
import { waitFor } from './helpers.js';

// ── Auth fixtures ──────────────────────────────────────────────────

const sessions: Record<string, AuthSession> = {
  'token-admin': { userId: 'admin-1', roles: ['admin'] },
  'token-user': { userId: 'user-1', roles: ['writer'] },
};

function createAuth(): AuthConfig {
  return {
    validate: async (token) => sessions[token] ?? null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Example: Production Patterns', () => {
  let store: Store;
  let server: NoexServer;
  const clients: NoexClient[] = [];

  async function createClient(url: string, opts?: {
    token?: string;
    reconnect?: boolean | { maxRetries?: number; initialDelayMs?: number };
  }): Promise<NoexClient> {
    const client = new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: opts?.reconnect ?? false,
      ...(opts?.token ? { auth: { token: opts.token } } : {}),
    });
    clients.push(client);
    await client.connect();
    return client;
  }

  afterEach(async () => {
    for (const c of clients) {
      if (c.isConnected) await c.disconnect();
    }
    clients.length = 0;
    if (server?.isRunning) await server.stop();
    if (store) await store.stop();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Audit log: query entries after mutations
  // ────────────────────────────────────────────────────────────────

  it('audit: query audit log entries via client', async () => {
    store = await Store.start({ name: 'prod-audit-example' });
    await store.defineBucket('tasks', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        title: { type: 'string', required: true },
      },
    });

    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
      auth: createAuth(),
      audit: { tiers: ['admin', 'write'] },
    });

    const url = `ws://127.0.0.1:${server.port}`;
    const client = await createClient(url, { token: 'token-admin' });

    // Perform some mutations
    await client.store.bucket('tasks').insert({ title: 'Write tests' });
    await client.store.bucket('tasks').insert({ title: 'Deploy app' });

    // Query audit log — should capture auth.login (auto-login) + 2 inserts
    const entries = await client.audit.query();
    console.log('Audit entries:', entries.length);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // Filter by operation
    const inserts = await client.audit.query({ operation: 'store.insert' });
    expect(inserts.length).toBe(2);
    expect(inserts[0]!.userId).toBe('admin-1');
    expect(inserts[0]!.result).toBe('success');
    console.log('Insert audit entries:', inserts.map((e) => `${e.operation} → ${e.result}`));

    // Filter by user
    const adminEntries = await client.audit.query({ userId: 'admin-1' });
    expect(adminEntries.length).toBeGreaterThanOrEqual(2);
    console.log('Admin entries:', adminEntries.length);
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Audit log: onEntry persistence to file
  // ────────────────────────────────────────────────────────────────

  it('audit: onEntry persists entries to JSONL file', async () => {
    const tmpFile = path.join(os.tmpdir(), `noex-audit-${Date.now()}.jsonl`);

    store = await Store.start({ name: 'prod-audit-file' });
    await store.defineBucket('logs', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        message: { type: 'string', required: true },
      },
    });

    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
      auth: createAuth(),
      audit: {
        tiers: ['admin', 'write'],
        onEntry: (entry) => {
          fs.appendFileSync(tmpFile, JSON.stringify(entry) + '\n');
        },
      },
    });

    const url = `ws://127.0.0.1:${server.port}`;
    const client = await createClient(url, { token: 'token-admin' });

    await client.store.bucket('logs').insert({ message: 'Server started' });
    await client.store.bucket('logs').insert({ message: 'First request' });

    // Read persisted file
    const lines = fs.readFileSync(tmpFile, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Each line is valid JSON with expected shape
    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('operation');
      expect(entry).toHaveProperty('result');
      expect(entry).toHaveProperty('remoteAddress');
    }

    const insertLines = lines
      .map((l) => JSON.parse(l))
      .filter((e) => e.operation === 'store.insert');
    expect(insertLines.length).toBe(2);
    console.log('Persisted', lines.length, 'audit entries to', tmpFile);

    // Cleanup
    fs.unlinkSync(tmpFile);
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Connection lifecycle events
  // ────────────────────────────────────────────────────────────────

  it('lifecycle: connected, disconnected events', async () => {
    store = await Store.start({ name: 'prod-lifecycle' });
    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
    });

    const url = `ws://127.0.0.1:${server.port}`;
    const events: string[] = [];

    const client = new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    clients.push(client);

    client.on('connected', () => events.push('connected'));
    client.on('disconnected', () => events.push('disconnected'));

    await client.connect();
    expect(events).toEqual(['connected']);

    await client.disconnect();
    await waitFor(() => events.includes('disconnected'));
    expect(events).toEqual(['connected', 'disconnected']);
    console.log('Lifecycle events:', events);
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Auto-reconnect with subscription restoration
  // ────────────────────────────────────────────────────────────────

  it('reconnect: auto-reconnect restores subscriptions', async () => {
    store = await Store.start({ name: 'prod-reconnect' });
    await store.defineBucket('items', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        name: { type: 'string', required: true },
      },
    });
    store.defineDeclarativeQuery('all-items', {
      bucket: 'items',
      select: ['id', 'name'],
    });

    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
    });

    const port = server.port;
    const url = `ws://127.0.0.1:${port}`;
    const events: string[] = [];

    const client = new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: { maxRetries: 5, initialDelayMs: 100 },
    });
    clients.push(client);

    client.on('connected', () => events.push('connected'));
    client.on('reconnecting', (attempt) => events.push(`reconnecting:${attempt}`));
    client.on('reconnected', () => events.push('reconnected'));
    client.on('disconnected', () => events.push('disconnected'));

    await client.connect();

    // Subscribe to a query — callback fires immediately with initial data (empty)
    const pushes: unknown[][] = [];
    await client.store.subscribe('all-items', (data) => {
      pushes.push(data as unknown[]);
    });
    expect(pushes.length).toBe(1);       // initial callback
    expect(pushes[0]!.length).toBe(0);   // no items yet

    // Insert data — triggers subscription push with updated result
    await client.store.bucket('items').insert({ name: 'Item A' });
    await waitFor(() => pushes.length >= 2);
    expect(pushes[1]!.length).toBe(1);
    console.log('Before restart: subscription received', pushes.length, 'push(es)');

    // Kill and restart server on same port — triggers reconnect
    await server.stop();
    store = await Store.start({ name: 'prod-reconnect-2' });
    await store.defineBucket('items', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        name: { type: 'string', required: true },
      },
    });
    store.defineDeclarativeQuery('all-items', {
      bucket: 'items',
      select: ['id', 'name'],
    });

    server = await NoexServer.start({
      store,
      port,
      host: '127.0.0.1',
    });

    // Wait for reconnect
    await waitFor(() => events.includes('reconnected'), 5000);
    expect(events).toContain('reconnecting:1');
    expect(events).toContain('reconnected');
    console.log('Reconnect events:', events);

    // Subscription should be restored — insert triggers push again
    const pushCountBefore = pushes.length;
    await client.store.bucket('items').insert({ name: 'Item B' });
    await waitFor(() => pushes.length > pushCountBefore, 3000);
    console.log('After reconnect: subscription restored, total pushes:', pushes.length);
  });

  // ────────────────────────────────────────────────────────────────
  // 5. Graceful server shutdown notification
  // ────────────────────────────────────────────────────────────────

  it('shutdown: client receives disconnected event on server stop', async () => {
    store = await Store.start({ name: 'prod-shutdown' });
    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
    });

    const url = `ws://127.0.0.1:${server.port}`;
    const client = await createClient(url);

    const events: string[] = [];
    client.on('disconnected', (reason) => events.push(`disconnected:${reason}`));

    // Graceful stop with period
    await server.stop({ gracePeriodMs: 100 });

    await waitFor(() => events.length > 0);
    expect(events.length).toBe(1);
    expect(events[0]).toMatch(/^disconnected:/);
    console.log('Shutdown event:', events[0]);
  });

  // ────────────────────────────────────────────────────────────────
  // 6. Server stats monitoring
  // ────────────────────────────────────────────────────────────────

  it('monitoring: server.getStats() returns health metrics', async () => {
    store = await Store.start({ name: 'prod-stats' });
    await store.defineBucket('data', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        value: { type: 'number' },
      },
    });
    store.defineDeclarativeQuery('all-data', {
      bucket: 'data',
      select: ['id', 'value'],
    });

    server = await NoexServer.start({
      store,
      port: 0,
      host: '127.0.0.1',
      auth: createAuth(),
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });

    const url = `ws://127.0.0.1:${server.port}`;

    // Connect two clients
    const admin = await createClient(url, { token: 'token-admin' });
    const user = await createClient(url, { token: 'token-user' });

    // Subscribe to a query to generate subscription stats
    await admin.store.subscribe('all-data', () => {});

    const stats = await server.getStats();

    expect(stats.connectionCount).toBe(2);
    expect(stats.authEnabled).toBe(true);
    expect(stats.rateLimitEnabled).toBe(true);
    expect(stats.connections.active).toBe(2);
    expect(stats.connections.authenticated).toBe(2);
    expect(stats.connections.totalStoreSubscriptions).toBe(1);
    expect(stats.uptimeMs).toBeGreaterThan(0);

    console.log('Server stats:');
    console.log('  connections:', stats.connections.active, '(auth:', stats.connections.authenticated + ')');
    console.log('  subscriptions:', stats.connections.totalStoreSubscriptions);
    console.log('  uptime:', stats.uptimeMs + 'ms');
    console.log('  auth:', stats.authEnabled, '| rateLimit:', stats.rateLimitEnabled);
  });
});
