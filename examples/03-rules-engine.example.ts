/**
 * Example 3 — Rules Engine (Events + Facts)
 *
 * The rules engine provides:
 * - Event bus: emit events on topics, subscribe to patterns
 * - Fact store: key-value storage with pattern-based queries
 * - Rules: register reactive rules that fire on events
 *
 * This example shows all three through the client API.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RuleEngine } from '@hamicek/noex-rules';
import { NoexClient } from '../src/index.js';
import type { RulesEvent } from '../src/index.js';
import { startExample, waitFor, type ExampleContext } from './helpers.js';

describe('Example: Rules Engine', () => {
  let ctx: ExampleContext;
  let client: NoexClient;
  let engine: RuleEngine;

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx?.stop();
    if (engine) await engine.stop();
  });

  async function setup(): Promise<void> {
    engine = await RuleEngine.start({ name: 'example-rules' });
    ctx = await startExample({ rules: engine });
    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  }

  // ────────────────────────────────────────────────────────────────
  // 1. Emit events and subscribe to patterns
  // ────────────────────────────────────────────────────────────────
  it('event bus: emit and subscribe', async () => {
    await setup();

    const received: Array<{ topic: string; data: Record<string, unknown> }> = [];

    // Subscribe to all "order.*" events
    const unsub = await client.rules.subscribe('order.*', (event, topic) => {
      received.push({ topic, data: event.data });
    });

    // Emit events
    const e1 = await client.rules.emit('order.created', { orderId: 'ORD-001', amount: 99.50 });
    console.log('Emitted:', e1.topic, '→ id:', e1.id);

    await client.rules.emit('order.shipped', { orderId: 'ORD-001', carrier: 'DHL' });

    // This event does NOT match "order.*"
    await client.rules.emit('user.registered', { userId: 'U-1' });

    await waitFor(() => received.length >= 2);

    expect(received).toHaveLength(2);
    expect(received[0]!.topic).toBe('order.created');
    expect(received[0]!.data['orderId']).toBe('ORD-001');
    expect(received[1]!.topic).toBe('order.shipped');

    console.log('Received events:', received.map((r) => r.topic));

    unsub();
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Event correlation IDs
  // ────────────────────────────────────────────────────────────────
  it('correlation and causation IDs for event tracing', async () => {
    await setup();

    // Emit a chain of causally-linked events
    const first = await client.rules.emit('order.placed', { orderId: 'ORD-100' });

    const second = await client.rules.emit(
      'payment.processed',
      { orderId: 'ORD-100', amount: 150 },
      first.id,           // correlationId — links to the same flow
    );

    const third = await client.rules.emit(
      'order.confirmed',
      { orderId: 'ORD-100' },
      first.id,           // correlationId
      second.id,          // causationId — direct cause
    );

    expect(second.correlationId).toBe(first.id);
    expect(third.correlationId).toBe(first.id);
    expect(third.causationId).toBe(second.id);

    console.log('Event chain:', first.id, '→', second.id, '→', third.id);
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Facts CRUD — key-value store with pattern queries
  // ────────────────────────────────────────────────────────────────
  it('facts: set, get, query, delete', async () => {
    await setup();

    // Set facts (key-value pairs with any JSON value)
    await client.rules.setFact('user:1:name', 'Alice');
    await client.rules.setFact('user:1:role', 'admin');
    await client.rules.setFact('user:2:name', 'Bob');
    await client.rules.setFact('user:2:role', 'viewer');
    await client.rules.setFact('config:theme', 'dark');

    // Get a single fact
    const name = await client.rules.getFact('user:1:name');
    expect(name).toBe('Alice');

    // Non-existent fact returns null
    const missing = await client.rules.getFact('user:99:name');
    expect(missing).toBeNull();

    // Pattern query — all user names
    const names = await client.rules.queryFacts('user:*:name');
    expect(names).toHaveLength(2);
    console.log('User names:', names.map((f) => `${f.key} = ${f.value}`));

    // Pattern query — everything about user:1
    const user1Facts = await client.rules.queryFacts('user:1:*');
    expect(user1Facts).toHaveLength(2);

    // Get all facts
    const allFacts = await client.rules.getAllFacts();
    expect(allFacts.length).toBe(5);
    console.log('All facts:', allFacts.map((f) => f.key));

    // Delete a fact
    const deleted = await client.rules.deleteFact('config:theme');
    expect(deleted).toBe(true);

    const afterDelete = await client.rules.getFact('config:theme');
    expect(afterDelete).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Facts support complex values
  // ────────────────────────────────────────────────────────────────
  it('facts with complex values', async () => {
    await setup();

    const profile = {
      displayName: 'Alice Wonderland',
      settings: { notifications: true, theme: 'dark' },
      tags: ['admin', 'beta-tester'],
    };

    const fact = await client.rules.setFact('user:1:profile', profile);
    expect(fact.key).toBe('user:1:profile');
    expect(fact.version).toBeGreaterThanOrEqual(1);
    expect(typeof fact.timestamp).toBe('number');

    const retrieved = await client.rules.getFact('user:1:profile') as Record<string, unknown>;
    expect(retrieved['displayName']).toBe('Alice Wonderland');
    expect((retrieved['tags'] as string[])).toContain('beta-tester');

    console.log('Complex fact:', retrieved);
  });

  // ────────────────────────────────────────────────────────────────
  // 5. Multiple event subscriptions with different patterns
  // ────────────────────────────────────────────────────────────────
  it('multiple subscriptions with different patterns', async () => {
    await setup();

    const orderEvents: string[] = [];
    const allEvents: string[] = [];

    const unsub1 = await client.rules.subscribe('order.*', (_event, topic) => {
      orderEvents.push(topic);
    });

    // Wildcard '*' catches everything
    const unsub2 = await client.rules.subscribe('*', (_event, topic) => {
      allEvents.push(topic);
    });

    await client.rules.emit('order.created', {});
    await client.rules.emit('user.login', {});
    await client.rules.emit('order.shipped', {});

    await waitFor(() => orderEvents.length >= 2 && allEvents.length >= 3);

    expect(orderEvents).toEqual(['order.created', 'order.shipped']);
    expect(allEvents).toEqual(['order.created', 'user.login', 'order.shipped']);

    console.log('order.* got:', orderEvents.length, '| * got:', allEvents.length);

    unsub1();
    unsub2();
  });

  // ────────────────────────────────────────────────────────────────
  // 6. Rules engine statistics
  // ────────────────────────────────────────────────────────────────
  it('engine stats', async () => {
    await setup();

    await client.rules.setFact('a', 1);
    await client.rules.setFact('b', 2);
    await client.rules.emit('test.event', { x: 1 });
    await client.rules.emit('test.event', { x: 2 });

    const stats = await client.rules.stats();

    console.log('Rules stats:', {
      facts: stats.factsCount,
      eventsProcessed: stats.eventsProcessed,
      rules: stats.rulesCount,
    });

    expect(stats.factsCount).toBeGreaterThanOrEqual(2);
    expect(stats.eventsProcessed).toBeGreaterThanOrEqual(2);
  });
});
