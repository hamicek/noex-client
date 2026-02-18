import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RuleEngine } from '@hamicek/noex-rules';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { ProcedureConfig } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Fixtures ──────────────────────────────────────────────────────

const sessions: Record<string, AuthSession> = {
  admin:  { userId: 'admin-1',  roles: ['admin'] },
  writer: { userId: 'writer-1', roles: ['writer'] },
  reader: { userId: 'reader-1', roles: ['reader'] },
};

function createAuth(): AuthConfig {
  return {
    validate: async (token) => sessions[token] ?? null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Integration: Procedures (client)', () => {
  let ctx: TestServerContext | undefined;
  let engine: RuleEngine | undefined;
  const clients: NoexClient[] = [];
  let counter = 0;

  async function setup(options?: { auth?: AuthConfig }): Promise<void> {
    const suffix = ++counter;
    engine = await RuleEngine.start({ name: `client-procedures-${suffix}` });

    ctx = await startTestServer({
      rules: engine,
      buckets: [
        {
          name: 'orders',
          schema: {
            status: { type: 'string' },
            total: { type: 'number' },
          },
        },
        {
          name: 'items',
          schema: {
            orderId: { type: 'string', required: true },
            price: { type: 'number', required: true },
          },
        },
      ],
      ...(options?.auth ? { auth: options.auth } : {}),
    });
  }

  async function createClient(
    url: string,
    options?: { token?: string },
  ): Promise<NoexClient> {
    const client = new NoexClient(url, {
      WebSocket: WebSocket as never,
      reconnect: false,
      ...(options?.token ? { auth: { token: options.token } } : {}),
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

    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }

    if (engine) {
      await engine.stop();
      engine = undefined;
    }
  });

  // ── register ──────────────────────────────────────────────────────

  describe('register', () => {
    it('should register a procedure and return confirmation', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const result = await client.procedures.register({
        name: 'simple-proc',
        description: 'A simple procedure',
        input: { id: { type: 'string' } },
        steps: [
          { action: 'store.get', bucket: 'orders', key: '{{ input.id }}', as: 'order' },
        ],
      });

      expect(result.name).toBe('simple-proc');
      expect(result.registered).toBe(true);
    });

    it('should return ALREADY_EXISTS for duplicate procedure name', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'dup-proc',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'order' },
        ],
      });

      try {
        await client.procedures.register({
          name: 'dup-proc',
          steps: [
            { action: 'store.get', bucket: 'orders', key: 'y', as: 'order' },
          ],
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('ALREADY_EXISTS');
      }
    });

    it('should return VALIDATION_ERROR for invalid procedure (no steps)', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.procedures.register({
          name: 'bad-proc',
          steps: [],
        } as unknown as ProcedureConfig);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ── call ──────────────────────────────────────────────────────────

  describe('call', () => {
    it('should call a simple get procedure', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      // Insert test data
      const bucket = client.store.bucket('orders');
      const inserted = await bucket.insert({ status: 'pending', total: 0 });
      const orderId = (inserted as Record<string, unknown>)['id'] as string;

      // Register procedure
      await client.procedures.register({
        name: 'get-order',
        input: { orderId: { type: 'string' } },
        steps: [
          { action: 'store.get', bucket: 'orders', key: '{{ input.orderId }}', as: 'order' },
        ],
      });

      // Call
      const result = await client.procedures.call('get-order', { orderId });

      expect(result.success).toBe(true);
      const order = result.results['order'] as Record<string, unknown>;
      expect(order['id']).toBe(orderId);
      expect(order['status']).toBe('pending');
    });

    it('should call a procedure with aggregation', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      // Insert data
      const orderBucket = client.store.bucket('orders');
      const itemsBucket = client.store.bucket('items');
      const order = await orderBucket.insert({ status: 'pending', total: 0 });
      const orderId = (order as Record<string, unknown>)['id'] as string;

      await itemsBucket.insert({ orderId, price: 100 });
      await itemsBucket.insert({ orderId, price: 50 });

      // Register procedure
      await client.procedures.register({
        name: 'calc-total',
        input: { orderId: { type: 'string' } },
        steps: [
          { action: 'store.where', bucket: 'items', filter: { orderId: '{{ input.orderId }}' }, as: 'items' },
          { action: 'aggregate', source: 'items', field: 'price', op: 'sum', as: 'total' },
          { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { total: '{{ total }}', status: 'calculated' } },
        ],
      });

      // Call
      const result = await client.procedures.call('calc-total', { orderId });

      expect(result.success).toBe(true);
      expect(result.results['total']).toBe(150);

      // Verify the order was updated
      const updated = await orderBucket.get(orderId);
      expect((updated as Record<string, unknown>)['total']).toBe(150);
      expect((updated as Record<string, unknown>)['status']).toBe('calculated');
    });

    it('should call a procedure with conditional logic', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const bucket = client.store.bucket('orders');
      const order = await bucket.insert({ status: 'pending', total: 500 });
      const orderId = (order as Record<string, unknown>)['id'] as string;

      await client.procedures.register({
        name: 'check-value',
        input: { orderId: { type: 'string' } },
        steps: [
          { action: 'store.get', bucket: 'orders', key: '{{ input.orderId }}', as: 'order' },
          {
            action: 'if',
            condition: { ref: 'order.total', operator: 'gte', value: 100 },
            then: [
              { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { status: 'high-value' } },
            ],
            else: [
              { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { status: 'normal' } },
            ],
          },
        ],
      });

      const result = await client.procedures.call('check-value', { orderId });
      expect(result.success).toBe(true);

      const updated = await bucket.get(orderId);
      expect((updated as Record<string, unknown>)['status']).toBe('high-value');
    });

    it('should call a procedure with transaction', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'transactional',
        input: { status: { type: 'string' } },
        steps: [
          { action: 'store.insert', bucket: 'orders', data: { status: '{{ input.status }}', total: 0 }, as: 'inserted' },
        ],
        transaction: true,
      });

      const result = await client.procedures.call('transactional', { status: 'from-tx' });

      expect(result.success).toBe(true);
      const inserted = result.results['inserted'] as Record<string, unknown>;
      expect(inserted['status']).toBe('from-tx');
    });

    it('should call a procedure with rules.emit', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      // Subscribe to events
      const received: Array<{ topic: string; data: Record<string, unknown> }> = [];
      const pushPromise = new Promise<void>((resolve) => {
        client.rules.subscribe('order.*', (event, topic) => {
          received.push({ topic, data: event.data });
          resolve();
        });
      });

      await new Promise((r) => setTimeout(r, 50));

      // Register procedure that emits event
      await client.procedures.register({
        name: 'notify-order',
        input: { orderId: { type: 'string' } },
        steps: [
          { action: 'rules.emit', topic: 'order.processed', data: { orderId: '{{ input.orderId }}' } },
        ],
      });

      // Call procedure
      await client.procedures.call('notify-order', { orderId: 'ord-123' });

      await pushPromise;

      expect(received).toHaveLength(1);
      expect(received[0]!.topic).toBe('order.processed');
      expect(received[0]!.data['orderId']).toBe('ord-123');
    });

    it('should return a custom value from a return step', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'return-value',
        input: { x: { type: 'number' } },
        steps: [
          { action: 'return', value: { computed: '{{ input.x }}' } },
        ],
      });

      const result = await client.procedures.call('return-value', { x: 42 });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ computed: 42 });
    });

    it('should return NOT_FOUND for non-existent procedure', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.procedures.call('ghost-procedure');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });

    it('should return VALIDATION_ERROR for invalid input', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'typed-proc',
        input: { count: { type: 'number', required: true } },
        steps: [
          { action: 'return', value: '{{ input.count }}' },
        ],
      });

      try {
        await client.procedures.call('typed-proc', {});
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ── unregister ──────────────────────────────────────────────────────

  describe('unregister', () => {
    it('should remove a registered procedure', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'removable',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'order' },
        ],
      });

      const result = await client.procedures.unregister('removable');

      expect(result.name).toBe('removable');
      expect(result.unregistered).toBe(true);

      // Verify it's gone
      try {
        await client.procedures.call('removable');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });

    it('should return NOT_FOUND for non-existent procedure', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.procedures.unregister('ghost');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });
  });

  // ── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update procedure properties', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'updatable',
        description: 'Original',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'order' },
        ],
      });

      const result = await client.procedures.update('updatable', {
        description: 'Updated',
      });

      expect(result.name).toBe('updatable');
      expect(result.updated).toBe(true);

      // Verify via get
      const detail = await client.procedures.get('updatable');
      expect(detail.description).toBe('Updated');
    });

    it('should return error for non-existent procedure', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await expect(
        client.procedures.update('ghost', { description: 'x' }),
      ).rejects.toThrow(NoexClientError);
    });
  });

  // ── get ─────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return full procedure detail', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'detail-proc',
        description: 'Detailed',
        input: { id: { type: 'string' } },
        steps: [
          { action: 'store.get', bucket: 'orders', key: '{{ input.id }}', as: 'order' },
        ],
      });

      const detail = await client.procedures.get('detail-proc');

      expect(detail.name).toBe('detail-proc');
      expect(detail.description).toBe('Detailed');
      expect(detail.input).toEqual({ id: { type: 'string' } });
      expect(Array.isArray(detail.steps)).toBe(true);
      expect(detail.steps).toHaveLength(1);
    });

    it('should return NOT_FOUND for non-existent procedure', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.procedures.get('missing');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });
  });

  // ── list ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return summary list of all procedures', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.procedures.register({
        name: 'proc-a',
        description: 'Procedure A',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'order' },
        ],
      });
      await client.procedures.register({
        name: 'proc-b',
        description: 'Procedure B',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'o1' },
          { action: 'store.get', bucket: 'orders', key: 'y', as: 'o2' },
        ],
      });

      const result = await client.procedures.list();

      expect(result.procedures).toHaveLength(2);

      const names = result.procedures.map((p) => p.name);
      expect(names).toContain('proc-a');
      expect(names).toContain('proc-b');

      for (const proc of result.procedures) {
        expect(typeof proc.name).toBe('string');
        expect(typeof proc.stepsCount).toBe('number');
      }

      const procB = result.procedures.find((p) => p.name === 'proc-b')!;
      expect(procB.stepsCount).toBe(2);
    });

    it('should return empty list when no procedures registered', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const result = await client.procedures.list();

      expect(result.procedures).toEqual([]);
    });
  });

  // ── Full CRUD cycle ─────────────────────────────────────────────────

  describe('full CRUD cycle', () => {
    it('register -> get -> update -> list -> call -> unregister', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      // Register
      const regResult = await client.procedures.register({
        name: 'lifecycle-proc',
        description: 'Lifecycle test',
        input: { orderId: { type: 'string' } },
        steps: [
          { action: 'store.get', bucket: 'orders', key: '{{ input.orderId }}', as: 'order' },
        ],
      });
      expect(regResult.name).toBe('lifecycle-proc');
      expect(regResult.registered).toBe(true);

      // Get
      const detail = await client.procedures.get('lifecycle-proc');
      expect(detail.name).toBe('lifecycle-proc');
      expect(detail.description).toBe('Lifecycle test');

      // Update
      const updateResult = await client.procedures.update('lifecycle-proc', {
        description: 'Updated lifecycle',
      });
      expect(updateResult.updated).toBe(true);

      // Verify update
      const updated = await client.procedures.get('lifecycle-proc');
      expect(updated.description).toBe('Updated lifecycle');

      // List
      const listResult = await client.procedures.list();
      expect(listResult.procedures).toHaveLength(1);
      expect(listResult.procedures[0]!.name).toBe('lifecycle-proc');

      // Insert data and call
      const bucket = client.store.bucket('orders');
      const order = await bucket.insert({ status: 'active', total: 100 });
      const orderId = (order as Record<string, unknown>)['id'] as string;

      const callResult = await client.procedures.call('lifecycle-proc', { orderId });
      expect(callResult.success).toBe(true);
      const resultOrder = callResult.results['order'] as Record<string, unknown>;
      expect(resultOrder['id']).toBe(orderId);

      // Unregister
      const unregResult = await client.procedures.unregister('lifecycle-proc');
      expect(unregResult.unregistered).toBe(true);

      // List (should be empty)
      const listAfter = await client.procedures.list();
      expect(listAfter.procedures).toHaveLength(0);
    });
  });

  // ── End-to-end: calculate invoice ──────────────────────────────────

  describe('end-to-end: calculate invoice', () => {
    it('calculates total from items and updates order', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const orderBucket = client.store.bucket('orders');
      const itemsBucket = client.store.bucket('items');

      // Insert order
      const order = await orderBucket.insert({ status: 'pending', total: 0 });
      const orderId = (order as Record<string, unknown>)['id'] as string;

      // Insert items
      await itemsBucket.insert({ orderId, price: 100 });
      await itemsBucket.insert({ orderId, price: 50.50 });
      await itemsBucket.insert({ orderId, price: 25 });

      // Register procedure
      await client.procedures.register({
        name: 'calculate-invoice',
        description: 'Calculate order total from items',
        input: { orderId: { type: 'string', required: true } },
        steps: [
          { action: 'store.get', bucket: 'orders', key: '{{ input.orderId }}', as: 'order' },
          { action: 'store.where', bucket: 'items', filter: { orderId: '{{ input.orderId }}' }, as: 'items' },
          { action: 'aggregate', source: 'items', field: 'price', op: 'sum', as: 'total' },
          { action: 'store.update', bucket: 'orders', key: '{{ input.orderId }}', data: { total: '{{ total }}', status: 'calculated' } },
        ],
        transaction: true,
      });

      // Call the procedure
      const result = await client.procedures.call('calculate-invoice', { orderId });

      expect(result.success).toBe(true);
      expect(result.results['total']).toBe(175.50);
      const items = result.results['items'] as unknown[];
      expect(items).toHaveLength(3);

      // Verify the order state
      const updatedOrder = await orderBucket.get(orderId);
      expect((updatedOrder as Record<string, unknown>)['total']).toBe(175.50);
      expect((updatedOrder as Record<string, unknown>)['status']).toBe('calculated');
    });
  });

  // ── Tier enforcement ──────────────────────────────────────────────

  describe('tier enforcement', () => {
    it('should reject register from writer', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'writer' });

      try {
        await client.procedures.register({
          name: 'forbidden',
          steps: [
            { action: 'store.get', bucket: 'orders', key: 'x', as: 'o' },
          ],
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should reject register from reader', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'reader' });

      try {
        await client.procedures.register({
          name: 'forbidden',
          steps: [
            { action: 'store.get', bucket: 'orders', key: 'x', as: 'o' },
          ],
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should allow writer to call a procedure', async () => {
      await setup({ auth: createAuth() });

      // Admin registers procedure
      const admin = await createClient(ctx!.url, { token: 'admin' });
      await admin.procedures.register({
        name: 'callable',
        steps: [
          { action: 'store.insert', bucket: 'orders', data: { status: 'created', total: 0 }, as: 'order' },
        ],
      });

      // Writer calls it
      const writer = await createClient(ctx!.url, { token: 'writer' });
      const result = await writer.procedures.call('callable');

      expect(result.success).toBe(true);
    });

    it('should reject call from reader', async () => {
      await setup({ auth: createAuth() });

      // Admin registers procedure
      const admin = await createClient(ctx!.url, { token: 'admin' });
      await admin.procedures.register({
        name: 'not-for-readers',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'o' },
        ],
      });

      // Reader tries to call
      const reader = await createClient(ctx!.url, { token: 'reader' });
      try {
        await reader.procedures.call('not-for-readers');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should allow reader to get a procedure', async () => {
      await setup({ auth: createAuth() });

      // Admin registers procedure
      const admin = await createClient(ctx!.url, { token: 'admin' });
      await admin.procedures.register({
        name: 'viewable',
        description: 'Viewable by readers',
        steps: [
          { action: 'store.get', bucket: 'orders', key: 'x', as: 'o' },
        ],
      });

      // Reader can get it
      const reader = await createClient(ctx!.url, { token: 'reader' });
      const detail = await reader.procedures.get('viewable');

      expect(detail.name).toBe('viewable');
      expect(detail.description).toBe('Viewable by readers');
    });

    it('should reject unregister from writer', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'writer' });

      await expect(
        client.procedures.unregister('any'),
      ).rejects.toThrow(NoexClientError);
    });

    it('should reject list from writer', async () => {
      await setup({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'writer' });

      try {
        await client.procedures.list();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });
  });

  // ── No auth mode ──────────────────────────────────────────────────

  describe('no auth mode', () => {
    it('should allow procedure operations without auth configured', async () => {
      await setup();
      const client = await createClient(ctx!.url);

      // Register
      const regResult = await client.procedures.register({
        name: 'open-proc',
        steps: [
          { action: 'store.insert', bucket: 'orders', data: { status: 'open', total: 0 }, as: 'order' },
        ],
      });
      expect(regResult.registered).toBe(true);

      // Call
      const callResult = await client.procedures.call('open-proc');
      expect(callResult.success).toBe(true);

      // List
      const listResult = await client.procedures.list();
      expect(listResult.procedures).toHaveLength(1);
    });
  });
});
