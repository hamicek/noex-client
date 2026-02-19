/**
 * Example 2 — Reactive Subscriptions
 *
 * Demonstrates real-time reactive queries. When data in the store
 * changes, all subscribed clients receive push notifications with
 * the updated query result — no polling needed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../src/index.js';
import { startExample, waitFor, type ExampleContext } from './helpers.js';

describe('Example: Reactive Subscriptions', () => {
  let ctx: ExampleContext;
  let client: NoexClient;

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx?.stop();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Subscribe to a query — get initial data + live pushes
  // ────────────────────────────────────────────────────────────────
  it('live query: react to inserts, updates, and deletes', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'tasks',
          schema: {
            title: { type: 'string', required: true },
            done: { type: 'boolean', default: false },
          },
        },
      ],
    });

    // Define a query on the server side (store.defineQuery is server-side)
    ctx.store.defineQuery('all-tasks', async (qCtx) => {
      return qCtx.bucket('tasks').all();
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    // Subscribe — callback fires immediately with current state,
    // then again whenever the query result changes.
    const snapshots: unknown[] = [];
    const unsub = await client.store.subscribe('all-tasks', (data) => {
      snapshots.push(data);
      console.log(`  [push ${snapshots.length}]`, JSON.stringify(data));
    });

    // Initial: empty array
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual([]);

    // INSERT a task → push with 1 record
    const tasks = client.store.bucket('tasks');
    const task1 = await tasks.insert({ title: 'Buy milk' });
    await ctx.store.settle();
    await waitFor(() => snapshots.length >= 2);

    const snap1 = snapshots[1] as Record<string, unknown>[];
    expect(snap1).toHaveLength(1);
    expect(snap1[0]!['title']).toBe('Buy milk');

    // UPDATE the task → push with updated data
    await tasks.update(task1['id'], { done: true });
    await ctx.store.settle();
    await waitFor(() => snapshots.length >= 3);

    const snap2 = snapshots[2] as Record<string, unknown>[];
    expect(snap2[0]!['done']).toBe(true);

    // DELETE the task → push with empty array
    await tasks.delete(task1['id']);
    await ctx.store.settle();
    await waitFor(() => snapshots.length >= 4);

    expect(snapshots[3]).toEqual([]);

    // Unsubscribe — no more pushes
    unsub();
    console.log(`Total pushes received: ${snapshots.length}`);
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Parameterized query — subscribe with filter
  // ────────────────────────────────────────────────────────────────
  it('parameterized query: filter by status', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'tasks',
          schema: {
            title: { type: 'string', required: true },
            status: { type: 'string', default: 'todo' },
          },
        },
      ],
    });

    ctx.store.defineQuery(
      'tasks-by-status',
      async (qCtx, params: { status: string }) => {
        return qCtx.bucket('tasks').where({ status: params.status });
      },
    );

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const tasks = client.store.bucket('tasks');

    // Pre-populate data
    await tasks.insert({ title: 'Task A', status: 'done' });
    await tasks.insert({ title: 'Task B', status: 'todo' });

    // Subscribe only to "todo" tasks
    const todoSnapshots: unknown[] = [];
    const unsub = await client.store.subscribe(
      'tasks-by-status',
      { status: 'todo' },
      (data) => todoSnapshots.push(data),
    );

    // Initial: 1 "todo" task
    expect(todoSnapshots).toHaveLength(1);
    const initial = todoSnapshots[0] as Record<string, unknown>[];
    expect(initial).toHaveLength(1);
    expect(initial[0]!['title']).toBe('Task B');

    // Insert another "done" task — our "todo" subscription should NOT push
    await tasks.insert({ title: 'Task C', status: 'done' });
    await ctx.store.settle();
    await new Promise((r) => setTimeout(r, 100));
    expect(todoSnapshots).toHaveLength(1); // no new push

    // Insert a "todo" task — NOW we get a push
    await tasks.insert({ title: 'Task D', status: 'todo' });
    await ctx.store.settle();
    await waitFor(() => todoSnapshots.length >= 2);

    const updated = todoSnapshots[1] as Record<string, unknown>[];
    expect(updated).toHaveLength(2);
    console.log('Todo tasks:', updated.map((t) => t['title']));

    unsub();
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Scalar query — subscribe to a count
  // ────────────────────────────────────────────────────────────────
  it('scalar subscription: live counter', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'messages',
          schema: { text: { type: 'string', required: true } },
        },
      ],
    });

    ctx.store.defineQuery('message-count', async (qCtx) => {
      return qCtx.bucket('messages').count();
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const counts: unknown[] = [];
    const unsub = await client.store.subscribe('message-count', (data) => {
      counts.push(data);
    });

    expect(counts[0]).toBe(0);

    const messages = client.store.bucket('messages');
    await messages.insert({ text: 'Hello' });
    await ctx.store.settle();
    await waitFor(() => counts.length >= 2);
    expect(counts[1]).toBe(1);

    await messages.insert({ text: 'World' });
    await ctx.store.settle();
    await waitFor(() => counts.length >= 3);
    expect(counts[2]).toBe(2);

    console.log('Count history:', counts);

    unsub();
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Multiple concurrent subscriptions
  // ────────────────────────────────────────────────────────────────
  it('multiple subscriptions — independent and concurrent', async () => {
    ctx = await startExample({
      buckets: [
        {
          name: 'tasks',
          schema: {
            title: { type: 'string', required: true },
            priority: { type: 'string', default: 'normal' },
          },
        },
      ],
    });

    ctx.store.defineQuery('all-tasks', async (qCtx) => {
      return qCtx.bucket('tasks').all();
    });

    ctx.store.defineQuery('task-count', async (qCtx) => {
      return qCtx.bucket('tasks').count();
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();

    const listSnapshots: unknown[] = [];
    const countSnapshots: unknown[] = [];

    const unsub1 = await client.store.subscribe('all-tasks', (data) => {
      listSnapshots.push(data);
    });

    const unsub2 = await client.store.subscribe('task-count', (data) => {
      countSnapshots.push(data);
    });

    // Both get initial data
    expect(listSnapshots).toHaveLength(1);
    expect(countSnapshots).toHaveLength(1);

    // Insert triggers both
    await client.store.bucket('tasks').insert({ title: 'Do laundry' });
    await ctx.store.settle();
    await waitFor(() => listSnapshots.length >= 2 && countSnapshots.length >= 2);

    expect((listSnapshots[1] as unknown[]).length).toBe(1);
    expect(countSnapshots[1]).toBe(1);

    // Unsubscribe only the list — count should still work
    unsub1();

    await client.store.bucket('tasks').insert({ title: 'Cook dinner' });
    await ctx.store.settle();
    await waitFor(() => countSnapshots.length >= 3);

    expect(countSnapshots[2]).toBe(2);

    // list did NOT receive another push
    await new Promise((r) => setTimeout(r, 100));
    expect(listSnapshots).toHaveLength(2);

    unsub2();
    console.log('List pushes:', listSnapshots.length, '| Count pushes:', countSnapshots.length);
  });
});
