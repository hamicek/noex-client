/**
 * Example 4 — Atomic Transactions
 *
 * Transactions let you execute multiple store operations atomically:
 * either all succeed, or none take effect. This is essential for
 * maintaining data consistency across buckets.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../src/index.js';
import { startExample, type ExampleContext } from './helpers.js';

describe('Example: Transactions', () => {
  let ctx: ExampleContext;
  let client: NoexClient;

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx?.stop();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Basic transaction — multiple inserts atomically
  // ────────────────────────────────────────────────────────────────
  it('atomic multi-insert', async () => {
    ctx = await startExample({
      buckets: [
        { name: 'accounts', schema: { owner: { type: 'string', required: true }, balance: { type: 'number', default: 0 } } },
        { name: 'audit-log', schema: { action: { type: 'string', required: true }, detail: { type: 'string' } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    // Create an account AND log the action in one atomic transaction
    const result = await client.store.transaction([
      { op: 'insert', bucket: 'accounts', data: { owner: 'Alice', balance: 1000 } },
      { op: 'insert', bucket: 'audit-log', data: { action: 'account_created', detail: 'Alice, initial balance 1000' } },
    ]);

    expect(result.results).toHaveLength(2);

    const account = result.results[0]!.data as Record<string, unknown>;
    const log = result.results[1]!.data as Record<string, unknown>;

    expect(account['owner']).toBe('Alice');
    expect(account['balance']).toBe(1000);
    expect(log['action']).toBe('account_created');

    console.log('Account:', account['owner'], '| Balance:', account['balance']);
    console.log('Audit log:', log['action']);
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Read + Write in one transaction (transfer pattern)
  // ────────────────────────────────────────────────────────────────
  it('transfer between accounts', async () => {
    ctx = await startExample({
      buckets: [
        { name: 'accounts', schema: { owner: { type: 'string', required: true }, balance: { type: 'number', default: 0 } } },
        { name: 'transfers', schema: { fromId: { type: 'string', required: true }, toId: { type: 'string', required: true }, amount: { type: 'number', required: true } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const accounts = client.store.bucket('accounts');

    // Create two accounts
    const alice = await accounts.insert({ owner: 'Alice', balance: 500 });
    const bob = await accounts.insert({ owner: 'Bob', balance: 200 });

    const aliceId = alice['id'] as string;
    const bobId = bob['id'] as string;
    const transferAmount = 150;

    // Atomic transfer: debit Alice, credit Bob, log the transfer
    const result = await client.store.transaction([
      { op: 'update', bucket: 'accounts', key: aliceId, data: { balance: 500 - transferAmount } },
      { op: 'update', bucket: 'accounts', key: bobId, data: { balance: 200 + transferAmount } },
      { op: 'insert', bucket: 'transfers', data: { fromId: aliceId, toId: bobId, amount: transferAmount } },
    ]);

    expect(result.results).toHaveLength(3);

    // Verify balances
    const aliceAfter = await accounts.get(aliceId);
    const bobAfter = await accounts.get(bobId);

    expect(aliceAfter!['balance']).toBe(350);
    expect(bobAfter!['balance']).toBe(350);

    console.log(`Transfer: Alice ${500} → ${aliceAfter!['balance']}, Bob ${200} → ${bobAfter!['balance']}`);
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Mixed operations: get, count, insert, delete
  // ────────────────────────────────────────────────────────────────
  it('mixed operations in a single transaction', async () => {
    ctx = await startExample({
      buckets: [
        { name: 'items', schema: { name: { type: 'string', required: true }, quantity: { type: 'number', default: 1 } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const items = client.store.bucket('items');
    const widget = await items.insert({ name: 'Widget', quantity: 10 });
    await items.insert({ name: 'Gadget', quantity: 5 });

    const result = await client.store.transaction([
      { op: 'get', bucket: 'items', key: widget['id'] },
      { op: 'count', bucket: 'items' },
      { op: 'where', bucket: 'items', filter: { name: 'Gadget' } },
      { op: 'delete', bucket: 'items', key: widget['id'] },
    ]);

    expect(result.results).toHaveLength(4);

    // Results are indexed by operation position
    expect(result.results[0]!.index).toBe(0);
    expect((result.results[0]!.data as Record<string, unknown>)['name']).toBe('Widget');

    expect(result.results[1]!.index).toBe(1);
    expect(result.results[1]!.data).toBe(2); // count before delete

    expect(result.results[2]!.index).toBe(2);
    expect((result.results[2]!.data as unknown[])).toHaveLength(1);

    expect(result.results[3]!.index).toBe(3);
    expect(result.results[3]!.data).toEqual({ deleted: true });

    // Verify Widget is gone
    expect(await items.get(widget['id'])).toBeNull();
    expect(await items.count()).toBe(1);

    console.log('Transaction completed with', result.results.length, 'operations');
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Cross-bucket consistency
  // ────────────────────────────────────────────────────────────────
  it('cross-bucket atomic operations', async () => {
    ctx = await startExample({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true }, postCount: { type: 'number', default: 0 } } },
        { name: 'posts', schema: { title: { type: 'string', required: true }, authorId: { type: 'string', required: true } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    // Create user
    const user = await client.store.bucket('users').insert({ name: 'Author' });
    const userId = user['id'] as string;

    // Atomically create a post AND increment the user's post count
    const result = await client.store.transaction([
      { op: 'insert', bucket: 'posts', data: { title: 'My First Post', authorId: userId } },
      { op: 'update', bucket: 'users', key: userId, data: { postCount: 1 } },
    ]);

    expect(result.results).toHaveLength(2);

    const post = result.results[0]!.data as Record<string, unknown>;
    const updatedUser = result.results[1]!.data as Record<string, unknown>;

    expect(post['title']).toBe('My First Post');
    expect(updatedUser['postCount']).toBe(1);

    console.log(`User "${updatedUser['name']}" now has ${updatedUser['postCount']} post(s)`);
  });
});
