import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Logic } from '@hamicek/noex-logic';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type {
  ComputedFieldsConfig,
  DerivedViewInfo,
  DerivedViewExplanation,
  ConstraintDefinition,
} from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Helpers ──────────────────────────────────────────────────────

function waitFor(
  fn: () => boolean,
  timeoutMs = 2000,
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
    }, 5);
  });
}

let instanceCounter = 0;

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Logic API', () => {
  let ctx: TestServerContext;
  let client: NoexClient;
  let logic: Logic;

  beforeEach(async () => {
    const suffix = ++instanceCounter;
    const storeForLogic = (await import('@hamicek/noex-store')).Store;
    // Logic is created via the test-server helper with a shared store
    // But we need to create Logic separately and pass it in
    logic = await Logic.start({ store: undefined as never }); // will be overwritten

    // Start test server — create logic after store is available
    ctx = await startTestServer({
      buckets: [
        {
          name: 'items',
          schema: {
            qty: { type: 'number' },
            price: { type: 'number' },
          },
        },
        {
          name: 'customers',
          schema: {
            name: { type: 'string' },
          },
        },
        {
          name: 'invoices',
          schema: {
            customerId: { type: 'string' },
            total: { type: 'number' },
            status: { type: 'string' },
          },
        },
        {
          name: 'accounts',
          schema: {
            balance: { type: 'number' },
          },
        },
      ],
    });

    // Destroy the placeholder logic and create one with the actual store
    await logic.destroy();
    logic = await Logic.start({ store: ctx.store });

    // Restart server with logic
    await ctx.server.stop();
    const { NoexServer } = await import('@hamicek/noex-server');
    const server = await NoexServer.start({
      store: ctx.store,
      logic,
      port: 0,
      host: '127.0.0.1',
    });
    ctx = { ...ctx, server, logic, port: server.port, url: `ws://127.0.0.1:${server.port}` };

    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected) await client.disconnect();
    if (logic) await logic.destroy();
    await ctx.stop();
  });

  // ── Computed Fields ────────────────────────────────────────────

  describe('computed fields', () => {
    it('defines computed fields', async () => {
      await client.logic.defineComputed('items', {
        total: {
          depends: ['qty', 'price'],
          expr: { $multiply: ['$qty', '$price'] },
        },
      });

      const list = await client.logic.listComputed();
      expect(list).toHaveLength(1);
      expect(list[0]!.bucket).toBe('items');
    });

    it('auto-computes on insert', async () => {
      await client.logic.defineComputed('items', {
        total: {
          depends: ['qty', 'price'],
          expr: { $multiply: ['$qty', '$price'] },
        },
      });

      await client.store.bucket('items').insert({ id: 'i1', qty: 3, price: 10 });
      await logic.settle();

      const record = await client.store.bucket('items').get('i1');
      expect(record!['total']).toBe(30);
    });

    it('drops computed fields', async () => {
      await client.logic.defineComputed('items', {
        total: { depends: ['qty', 'price'], expr: { $multiply: ['$qty', '$price'] } },
      });

      const dropped = await client.logic.dropComputed('items');
      expect(dropped).toBe(true);

      const list = await client.logic.listComputed();
      expect(list).toHaveLength(0);
    });

    it('returns false when dropping non-existent computed', async () => {
      const dropped = await client.logic.dropComputed('nonexistent');
      expect(dropped).toBe(false);
    });
  });

  // ── Derived Views ──────────────────────────────────────────────

  describe('derived views', () => {
    it('defines and queries a simple view', async () => {
      await client.store.bucket('items').insert({ id: 'i1', qty: 5, price: 20 });

      await client.logic.defineView({
        name: 'item_summary',
        from: { i: 'items' },
        select: {
          itemId: 'i.id',
          qty: 'i.qty',
          price: 'i.price',
        },
      });

      const data = await client.logic.queryView('item_summary');
      expect(data).toHaveLength(1);
      expect(data[0]!['itemId']).toBe('i1');
      expect(data[0]!['qty']).toBe(5);
    });

    it('defines and queries a join view', async () => {
      await client.store.bucket('customers').insert({ id: 'c1', name: 'Alice' });
      await client.store.bucket('invoices').insert({ id: 'inv1', customerId: 'c1', total: 200, status: 'paid' });

      await client.logic.defineView({
        name: 'invoice_details',
        from: { i: 'invoices', c: 'customers' },
        join: { 'i.customerId': 'c.id' },
        select: {
          invoiceId: 'i.id',
          customerName: 'c.name',
          total: 'i.total',
        },
      });

      const data = await client.logic.queryView('invoice_details');
      expect(data).toHaveLength(1);
      expect(data[0]!['customerName']).toBe('Alice');
      expect(data[0]!['total']).toBe(200);
    });

    it('explains a view', async () => {
      await client.logic.defineView({
        name: 'explained_view',
        from: { i: 'items' },
        select: { id: 'i.id' },
      });

      const explanation = await client.logic.explainView('explained_view');
      expect(explanation.name).toBe('explained_view');
      expect(explanation.sources).toEqual({ i: 'items' });
    });

    it('lists views', async () => {
      await client.logic.defineView({
        name: 'listed_view',
        from: { i: 'items' },
        select: { id: 'i.id' },
      });

      const views = await client.logic.listViews();
      expect(views.length).toBeGreaterThanOrEqual(1);
      expect(views.some((v) => v.name === 'listed_view')).toBe(true);
    });

    it('drops a view', async () => {
      await client.logic.defineView({
        name: 'drop_me',
        from: { i: 'items' },
        select: { id: 'i.id' },
      });

      const dropped = await client.logic.dropView('drop_me');
      expect(dropped).toBe(true);

      const views = await client.logic.listViews();
      expect(views.some((v) => v.name === 'drop_me')).toBe(false);
    });

    it('returns false when dropping non-existent view', async () => {
      const dropped = await client.logic.dropView('nonexistent');
      expect(dropped).toBe(false);
    });
  });

  // ── View Subscriptions ─────────────────────────────────────────

  describe('view subscriptions', () => {
    it('delivers initial data on subscribe', async () => {
      await client.store.bucket('items').insert({ id: 'i1', qty: 3, price: 10 });

      await client.logic.defineView({
        name: 'sub_view',
        from: { i: 'items' },
        select: { id: 'i.id', qty: 'i.qty' },
        reactive: true,
      });

      const received: Array<Record<string, unknown>[]> = [];
      const unsub = await client.logic.subscribeView('sub_view', (data) => {
        received.push(data);
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toHaveLength(1);
      expect(received[0]![0]!['id']).toBe('i1');

      unsub();
    });

    it('pushes updates when source data changes', async () => {
      await client.logic.defineView({
        name: 'push_view',
        from: { i: 'items' },
        select: { id: 'i.id', qty: 'i.qty' },
        reactive: true,
      });

      const received: Array<Record<string, unknown>[]> = [];
      const unsub = await client.logic.subscribeView('push_view', (data) => {
        received.push(data);
      });

      // Initial data (empty)
      expect(received).toHaveLength(1);
      expect(received[0]).toHaveLength(0);

      await client.store.bucket('items').insert({ id: 'i1', qty: 7, price: 5 });

      await waitFor(() => received.length >= 2);
      expect(received[1]).toHaveLength(1);
      expect(received[1]![0]!['qty']).toBe(7);

      unsub();
    });

    it('stops receiving after unsubscribe', async () => {
      await client.logic.defineView({
        name: 'stop_view',
        from: { i: 'items' },
        select: { id: 'i.id' },
        reactive: true,
      });

      const received: Array<Record<string, unknown>[]> = [];
      const unsub = await client.logic.subscribeView('stop_view', (data) => {
        received.push(data);
      });

      unsub();

      await client.store.bucket('items').insert({ id: 'i1', qty: 1, price: 1 });
      await new Promise((r) => setTimeout(r, 300));

      // Only initial data
      expect(received).toHaveLength(1);
    });
  });

  // ── Constraints ────────────────────────────────────────────────

  describe('constraints', () => {
    it('defines a constraint', async () => {
      await client.logic.defineConstraint({
        name: 'positive_balance',
        on: 'accounts',
        expr: { $gte: ['$balance', 0] },
        message: 'Balance must be non-negative',
      });

      const list = await client.logic.listConstraints();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((c) => c.name === 'positive_balance')).toBe(true);
    });

    it('rejects insert that violates constraint', async () => {
      await client.logic.defineConstraint({
        name: 'positive_balance_2',
        on: 'accounts',
        expr: { $gte: ['$balance', 0] },
        message: 'Balance must be non-negative',
      });

      await expect(
        client.store.bucket('accounts').insert({ id: 'a1', balance: -100 }),
      ).rejects.toThrow(NoexClientError);
    });

    it('allows insert that satisfies constraint', async () => {
      await client.logic.defineConstraint({
        name: 'positive_balance_3',
        on: 'accounts',
        expr: { $gte: ['$balance', 0] },
        message: 'Balance must be non-negative',
      });

      const record = await client.store.bucket('accounts').insert({ id: 'a1', balance: 100 });
      expect(record['balance']).toBe(100);
    });

    it('drops a constraint', async () => {
      await client.logic.defineConstraint({
        name: 'to_drop',
        on: 'accounts',
        expr: { $gte: ['$balance', 0] },
        message: 'nope',
      });

      const dropped = await client.logic.dropConstraint('to_drop');
      expect(dropped).toBe(true);

      // After dropping, negative balance should be allowed
      const record = await client.store.bucket('accounts').insert({ id: 'a2', balance: -50 });
      expect(record['balance']).toBe(-50);
    });

    it('returns false when dropping non-existent constraint', async () => {
      const dropped = await client.logic.dropConstraint('nonexistent');
      expect(dropped).toBe(false);
    });
  });

  // ── Expression Evaluation ──────────────────────────────────────

  describe('expression evaluation', () => {
    it('evaluates a simple arithmetic expression', async () => {
      const result = await client.logic.evaluateExpr({ $add: [2, 3] });
      expect(result).toBe(5);
    });

    it('evaluates with field references', async () => {
      const result = await client.logic.evaluateExpr(
        { $multiply: ['$price', '$qty'] },
        { price: 15, qty: 4 },
      );
      expect(result).toBe(60);
    });

    it('evaluates nested expressions', async () => {
      const result = await client.logic.evaluateExpr(
        { $add: [{ $multiply: ['$a', '$b'] }, '$c'] },
        { a: 3, b: 4, c: 5 },
      );
      expect(result).toBe(17);
    });
  });

  // ── Logic Not Available ────────────────────────────────────────

  describe('logic not available', () => {
    it('rejects when server has no logic engine', async () => {
      const noLogicCtx = await startTestServer();
      const noLogicClient = new NoexClient(noLogicCtx.url, {
        WebSocket: WebSocket as never,
        reconnect: false,
      });
      await noLogicClient.connect();

      try {
        await expect(
          noLogicClient.logic.listComputed(),
        ).rejects.toThrow(NoexClientError);
      } finally {
        await noLogicClient.disconnect();
        await noLogicCtx.stop();
      }
    });
  });
});
