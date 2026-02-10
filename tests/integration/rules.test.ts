import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RuleEngine } from '@hamicek/noex-rules';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { RulesEvent, Fact } from '../../src/index.js';
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

describe('Integration: Rules API', () => {
  let ctx: TestServerContext;
  let client: NoexClient;
  let engine: RuleEngine;

  beforeEach(async () => {
    const suffix = ++instanceCounter;
    engine = await RuleEngine.start({ name: `client-rules-${suffix}` });

    ctx = await startTestServer({ rules: engine });

    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected) await client.disconnect();
    await ctx.stop();
    await engine.stop();
  });

  // ── emit ───────────────────────────────────────────────────────

  describe('emit', () => {
    it('emits an event and returns the event object', async () => {
      const event = await client.rules.emit('order.created', { orderId: '123' });

      expect(event.topic).toBe('order.created');
      expect(event.data['orderId']).toBe('123');
      expect(typeof event.id).toBe('string');
      expect(typeof event.timestamp).toBe('number');
    });

    it('emits with empty data when omitted', async () => {
      const event = await client.rules.emit('system.ping');

      expect(event.topic).toBe('system.ping');
    });

    it('emits with correlationId', async () => {
      const event = await client.rules.emit(
        'order.shipped',
        { orderId: '456' },
        'corr-1',
      );

      expect(event.topic).toBe('order.shipped');
      expect(event.correlationId).toBe('corr-1');
    });

    it('emits with correlationId and causationId', async () => {
      const event = await client.rules.emit(
        'order.delivered',
        { orderId: '789' },
        'corr-2',
        'cause-1',
      );

      expect(event.correlationId).toBe('corr-2');
      expect(event.causationId).toBe('cause-1');
    });
  });

  // ── facts CRUD ─────────────────────────────────────────────────

  describe('facts', () => {
    it('sets and gets a fact', async () => {
      await client.rules.setFact('user:1:name', 'Alice');

      const value = await client.rules.getFact('user:1:name');
      expect(value).toBe('Alice');
    });

    it('returns null for non-existent fact', async () => {
      const value = await client.rules.getFact('nonexistent');
      expect(value).toBeNull();
    });

    it('overwrites an existing fact', async () => {
      await client.rules.setFact('counter', 1);
      await client.rules.setFact('counter', 2);

      const value = await client.rules.getFact('counter');
      expect(value).toBe(2);
    });

    it('setFact returns a Fact object', async () => {
      const fact = await client.rules.setFact('key1', 'val1');

      expect(fact.key).toBe('key1');
      expect(fact.value).toBe('val1');
      expect(typeof fact.timestamp).toBe('number');
      expect(fact.version).toBeGreaterThanOrEqual(1);
    });

    it('deletes an existing fact and returns true', async () => {
      await client.rules.setFact('temp', 42);

      const deleted = await client.rules.deleteFact('temp');
      expect(deleted).toBe(true);

      const value = await client.rules.getFact('temp');
      expect(value).toBeNull();
    });

    it('deletes a non-existent fact and returns false', async () => {
      const deleted = await client.rules.deleteFact('nonexistent');
      expect(deleted).toBe(false);
    });

    it('supports complex values (objects)', async () => {
      const complexValue = { name: 'Alice', roles: ['admin', 'user'] };
      await client.rules.setFact('user:1:profile', complexValue);

      const value = await client.rules.getFact('user:1:profile') as Record<string, unknown>;
      expect(value['name']).toBe('Alice');
      expect(value['roles']).toEqual(['admin', 'user']);
    });
  });

  // ── queryFacts ─────────────────────────────────────────────────

  describe('queryFacts', () => {
    it('queries facts by pattern', async () => {
      await client.rules.setFact('user:1:name', 'Alice');
      await client.rules.setFact('user:2:name', 'Bob');
      await client.rules.setFact('product:1:title', 'Widget');

      const facts = await client.rules.queryFacts('user:*:name');
      expect(facts).toHaveLength(2);

      const names = facts.map((f) => f.value);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('returns empty array when no facts match', async () => {
      const facts = await client.rules.queryFacts('nonexistent:*');
      expect(facts).toEqual([]);
    });
  });

  // ── getAllFacts ─────────────────────────────────────────────────

  describe('getAllFacts', () => {
    it('returns all facts', async () => {
      await client.rules.setFact('a', 1);
      await client.rules.setFact('b', 2);

      const facts = await client.rules.getAllFacts();
      expect(facts.length).toBeGreaterThanOrEqual(2);

      const keys = facts.map((f) => f.key);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('returns empty array when no facts exist', async () => {
      const facts = await client.rules.getAllFacts();
      expect(facts).toEqual([]);
    });
  });

  // ── subscribe ──────────────────────────────────────────────────

  describe('subscribe', () => {
    it('receives events matching the pattern', async () => {
      const received: Array<{ event: RulesEvent; topic: string }> = [];

      const unsub = await client.rules.subscribe('order.*', (event, topic) => {
        received.push({ event, topic });
      });

      await client.rules.emit('order.created', { orderId: 'a1' });
      await waitFor(() => received.length >= 1);

      expect(received).toHaveLength(1);
      expect(received[0]!.topic).toBe('order.created');
      expect(received[0]!.event.data['orderId']).toBe('a1');

      unsub();
    });

    it('does not receive events that do not match the pattern', async () => {
      const received: Array<{ event: RulesEvent; topic: string }> = [];

      const unsub = await client.rules.subscribe('order.*', (event, topic) => {
        received.push({ event, topic });
      });

      await client.rules.emit('user.created', { userId: 'u1' });

      // Wait a bit to confirm no push arrives
      await new Promise((r) => setTimeout(r, 200));
      expect(received).toHaveLength(0);

      unsub();
    });

    it('receives multiple events', async () => {
      const received: Array<{ event: RulesEvent; topic: string }> = [];

      const unsub = await client.rules.subscribe('order.*', (event, topic) => {
        received.push({ event, topic });
      });

      await client.rules.emit('order.created', { id: '1' });
      await client.rules.emit('order.shipped', { id: '2' });
      await waitFor(() => received.length >= 2);

      expect(received).toHaveLength(2);
      expect(received[0]!.topic).toBe('order.created');
      expect(received[1]!.topic).toBe('order.shipped');

      unsub();
    });

    it('stops receiving after unsubscribe', async () => {
      const received: Array<{ event: RulesEvent; topic: string }> = [];

      const unsub = await client.rules.subscribe('order.*', (event, topic) => {
        received.push({ event, topic });
      });

      await client.rules.emit('order.created', { id: '1' });
      await waitFor(() => received.length >= 1);

      unsub();

      await client.rules.emit('order.shipped', { id: '2' });
      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(1);
    });

    it('supports multiple concurrent subscriptions', async () => {
      const orderEvents: string[] = [];
      const userEvents: string[] = [];

      const unsub1 = await client.rules.subscribe('order.*', (event, topic) => {
        orderEvents.push(topic);
      });

      const unsub2 = await client.rules.subscribe('user.*', (event, topic) => {
        userEvents.push(topic);
      });

      await client.rules.emit('order.created', {});
      await client.rules.emit('user.registered', {});
      await waitFor(() => orderEvents.length >= 1 && userEvents.length >= 1);

      expect(orderEvents).toEqual(['order.created']);
      expect(userEvents).toEqual(['user.registered']);

      unsub1();
      unsub2();
    });

    it('unsubscribing one does not affect others', async () => {
      const orderEvents: string[] = [];
      const allEvents: string[] = [];

      const unsubOrder = await client.rules.subscribe('order.*', (_event, topic) => {
        orderEvents.push(topic);
      });

      const unsubAll = await client.rules.subscribe('*', (_event, topic) => {
        allEvents.push(topic);
      });

      unsubOrder();

      await client.rules.emit('order.created', {});
      await waitFor(() => allEvents.length >= 1);

      // Wildcard subscription still active
      expect(allEvents).toHaveLength(1);

      // Order subscription stopped
      await new Promise((r) => setTimeout(r, 100));
      expect(orderEvents).toHaveLength(0);

      unsubAll();
    });
  });

  // ── rules not available ────────────────────────────────────────

  describe('rules not available', () => {
    it('rejects when server has no rules engine', async () => {
      // Start a separate server without rules
      const noRulesCtx = await startTestServer();
      const noRulesClient = new NoexClient(noRulesCtx.url, {
        WebSocket: WebSocket as never,
        reconnect: false,
      });
      await noRulesClient.connect();

      try {
        await expect(
          noRulesClient.rules.emit('test.event'),
        ).rejects.toThrow(NoexClientError);
      } finally {
        await noRulesClient.disconnect();
        await noRulesCtx.stop();
      }
    });
  });
});
