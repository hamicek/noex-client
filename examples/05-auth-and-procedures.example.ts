/**
 * Example 5 — Authentication & Server-Side Procedures
 *
 * Demonstrates:
 * - Token-based authentication (login, logout, whoami)
 * - Role-based access control
 * - Server-side procedures (declarative multi-step workflows)
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RuleEngine } from '@hamicek/noex-rules';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../src/index.js';
import { startExample, waitFor, type ExampleContext } from './helpers.js';

// ── Auth fixtures ──────────────────────────────────────────────────

const sessions: Record<string, AuthSession> = {
  'token-admin':  { userId: 'admin-1',  roles: ['admin'] },
  'token-editor': { userId: 'editor-1', roles: ['writer'] },
  'token-viewer': { userId: 'viewer-1', roles: ['reader'] },
};

function createAuth(): AuthConfig {
  return {
    validate: async (token) => sessions[token] ?? null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Example: Auth & Procedures', () => {
  let ctx: ExampleContext;
  let engine: RuleEngine;
  const clients: NoexClient[] = [];

  async function createClient(url: string, token?: string): Promise<NoexClient> {
    const client = new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: false,
      ...(token ? { auth: { token } } : {}),
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
    if (engine) await engine.stop();
    await ctx?.stop();
  });

  // ────────────────────────────────────────────────────────────────
  // Part A: Authentication
  // ────────────────────────────────────────────────────────────────

  it('auth: login, whoami, logout', async () => {
    ctx = await startExample({
      auth: createAuth(),
      buckets: [
        { name: 'notes', schema: { text: { type: 'string', required: true } } },
      ],
    });

    const client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    clients.push(client);

    // Connect — welcome tells us auth is required
    const welcome = await client.connect();
    expect(welcome.requiresAuth).toBe(true);
    console.log('Server requires auth:', welcome.requiresAuth);

    // Before login — operations are rejected
    await expect(
      client.store.bucket('notes').insert({ text: 'secret' }),
    ).rejects.toThrow(NoexClientError);

    // Login
    const session = await client.auth.login('token-admin');
    console.log('Logged in as:', session.userId, '| roles:', session.roles);
    expect(session.userId).toBe('admin-1');

    // whoami
    const who = await client.auth.whoami();
    expect(who).not.toBeNull();
    expect(who!.userId).toBe('admin-1');

    // Now operations work
    const note = await client.store.bucket('notes').insert({ text: 'Hello!' });
    expect(note['text']).toBe('Hello!');

    // Logout
    await client.auth.logout();
    const afterLogout = await client.auth.whoami();
    expect(afterLogout).toBeNull();
    console.log('After logout: whoami =', afterLogout);
  });

  it('auth: auto-login with token in options', async () => {
    ctx = await startExample({
      auth: createAuth(),
      buckets: [
        { name: 'notes', schema: { text: { type: 'string', required: true } } },
      ],
    });

    // Passing auth.token in options triggers automatic login on connect
    const client = await createClient(ctx.url, 'token-editor');

    const who = await client.auth.whoami();
    expect(who).not.toBeNull();
    expect(who!.userId).toBe('editor-1');
    console.log('Auto-logged in as:', who!.userId);

    // Can immediately use the store
    const note = await client.store.bucket('notes').insert({ text: 'Auto-login works!' });
    expect(note['text']).toBe('Auto-login works!');
  });

  it('auth: role-based access control', async () => {
    ctx = await startExample({
      auth: {
        ...createAuth(),
        permissions: {
          default: 'deny',
          rules: [
            { role: 'admin', allow: '*' },
            { role: 'writer', allow: ['store.insert', 'store.update', 'store.get', 'store.all', 'store.where', 'store.findOne', 'store.count'] },
            { role: 'reader', allow: ['store.get', 'store.all', 'store.where', 'store.findOne', 'store.count'] },
          ],
        },
      },
      buckets: [
        { name: 'articles', schema: { title: { type: 'string', required: true } } },
      ],
    });

    // Admin can do everything
    const admin = await createClient(ctx.url, 'token-admin');
    const article = await admin.store.bucket('articles').insert({ title: 'Admin Article' });
    expect(article['title']).toBe('Admin Article');
    console.log('Admin: inserted article');

    // Writer can insert and read
    const editor = await createClient(ctx.url, 'token-editor');
    await editor.store.bucket('articles').insert({ title: 'Editor Article' });
    const all = await editor.store.bucket('articles').all();
    expect(all.length).toBeGreaterThanOrEqual(2);
    console.log('Writer: inserted + read', all.length, 'articles');

    // Reader can only read
    const viewer = await createClient(ctx.url, 'token-viewer');
    const viewerAll = await viewer.store.bucket('articles').all();
    expect(viewerAll.length).toBeGreaterThanOrEqual(2);

    // Reader cannot insert
    await expect(
      viewer.store.bucket('articles').insert({ title: 'Forbidden' }),
    ).rejects.toThrow(NoexClientError);
    console.log('Reader: read OK, insert blocked (as expected)');
  });

  // ────────────────────────────────────────────────────────────────
  // Part B: Server-Side Procedures
  // ────────────────────────────────────────────────────────────────

  it('procedures: register and call a multi-step workflow', async () => {
    engine = await RuleEngine.start({ name: 'example-procedures' });
    ctx = await startExample({
      rules: engine,
      auth: createAuth(),
      buckets: [
        { name: 'orders', schema: { status: { type: 'string' }, total: { type: 'number' } } },
        { name: 'items', schema: { orderId: { type: 'string', required: true }, price: { type: 'number', required: true } } },
      ],
    });

    const admin = await createClient(ctx.url, 'token-admin');

    // Seed data: an order with 3 items
    const orderBucket = admin.store.bucket('orders');
    const itemsBucket = admin.store.bucket('items');

    const order = await orderBucket.insert({ status: 'pending', total: 0 });
    const orderId = order['id'] as string;

    await itemsBucket.insert({ orderId, price: 100 });
    await itemsBucket.insert({ orderId, price: 75.50 });
    await itemsBucket.insert({ orderId, price: 24.50 });

    // Register a procedure: calculate total from items and update the order
    await admin.procedures.register({
      name: 'finalize-order',
      description: 'Calculate total from items, update order status, emit event',
      input: { orderId: { type: 'string', required: true } },
      steps: [
        // 1. Find all items for this order
        { action: 'store.where', bucket: 'items', filter: { orderId: '{{ input.orderId }}' }, as: 'items' },
        // 2. Sum prices
        { action: 'aggregate', source: 'items', field: 'price', op: 'sum', as: 'total' },
        // 3. Update order with calculated total and new status
        { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { total: '{{ total }}', status: 'finalized' } },
        // 4. Emit an event for other systems
        { action: 'rules.emit', topic: 'order.finalized', data: { orderId: '{{ input.orderId }}', total: '{{ total }}' } },
      ],
    });

    // Subscribe to order events
    const events: string[] = [];
    const unsub = await admin.rules.subscribe('order.*', (_event, topic) => {
      events.push(topic);
    });

    // Call the procedure
    const result = await admin.procedures.call('finalize-order', { orderId });

    expect(result.success).toBe(true);
    expect(result.results['total']).toBe(200);

    // Verify the order was updated
    const updated = await orderBucket.get(orderId);
    expect(updated!['total']).toBe(200);
    expect(updated!['status']).toBe('finalized');

    // Verify event was emitted
    await waitFor(() => events.length >= 1);
    expect(events).toContain('order.finalized');

    console.log('Order finalized! Total:', result.results['total']);
    console.log('Events received:', events);

    unsub();
  });

  it('procedures: conditional logic', async () => {
    engine = await RuleEngine.start({ name: 'example-conditional' });
    ctx = await startExample({
      rules: engine,
      auth: createAuth(),
      buckets: [
        { name: 'orders', schema: { status: { type: 'string' }, total: { type: 'number' }, priority: { type: 'string' } } },
      ],
    });

    const admin = await createClient(ctx.url, 'token-admin');

    // Register: classify order priority based on total
    await admin.procedures.register({
      name: 'classify-order',
      description: 'Set priority based on order total',
      input: { orderId: { type: 'string', required: true } },
      steps: [
        { action: 'store.get', bucket: 'orders', key: '{{ input.orderId }}', as: 'order' },
        {
          action: 'if',
          condition: { ref: 'order.total', operator: 'gte', value: 500 },
          then: [
            { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { priority: 'high' } },
          ],
          else: [
            { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { priority: 'normal' } },
          ],
        },
      ],
    });

    const orders = admin.store.bucket('orders');

    // High-value order
    const big = await orders.insert({ status: 'new', total: 999, priority: 'unset' });
    await admin.procedures.call('classify-order', { orderId: big['id'] });
    const bigUpdated = await orders.get(big['id']);
    expect(bigUpdated!['priority']).toBe('high');

    // Normal order
    const small = await orders.insert({ status: 'new', total: 49, priority: 'unset' });
    await admin.procedures.call('classify-order', { orderId: small['id'] });
    const smallUpdated = await orders.get(small['id']);
    expect(smallUpdated!['priority']).toBe('normal');

    console.log('Big order priority:', bigUpdated!['priority']);
    console.log('Small order priority:', smallUpdated!['priority']);
  });

  it('procedures: CRUD lifecycle', async () => {
    engine = await RuleEngine.start({ name: 'example-proc-crud' });
    ctx = await startExample({
      rules: engine,
      auth: createAuth(),
      buckets: [
        { name: 'data', schema: { value: { type: 'number' } } },
      ],
    });

    const admin = await createClient(ctx.url, 'token-admin');

    // Register
    await admin.procedures.register({
      name: 'my-proc',
      description: 'Original description',
      steps: [
        { action: 'store.insert', bucket: 'data', data: { value: 42 }, as: 'result' },
      ],
    });

    // List
    const list = await admin.procedures.list();
    expect(list.procedures).toHaveLength(1);
    expect(list.procedures[0]!.name).toBe('my-proc');
    console.log('Procedures:', list.procedures.map((p) => p.name));

    // Get details
    const detail = await admin.procedures.get('my-proc');
    expect(detail.description).toBe('Original description');

    // Update
    await admin.procedures.update('my-proc', { description: 'Updated description' });
    const updated = await admin.procedures.get('my-proc');
    expect(updated.description).toBe('Updated description');

    // Call
    const result = await admin.procedures.call('my-proc');
    expect(result.success).toBe(true);

    // Unregister
    const unreg = await admin.procedures.unregister('my-proc');
    expect(unreg.unregistered).toBe(true);

    // Verify it's gone
    await expect(admin.procedures.call('my-proc')).rejects.toThrow(NoexClientError);
    console.log('Procedure lifecycle: register → list → get → update → call → unregister');
  });
});
