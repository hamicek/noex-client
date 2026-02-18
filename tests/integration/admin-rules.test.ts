import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RuleEngine } from '@hamicek/noex-rules';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { RuleInput } from '../../src/index.js';
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

function makeRule(id: string, topic: string): RuleInput {
  return {
    id,
    name: `Rule ${id}`,
    priority: 100,
    enabled: true,
    tags: ['test'],
    trigger: { type: 'event', topic },
    conditions: [],
    actions: [
      { type: 'emit_event', topic: `output.${id}`, data: { source: id } },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Integration: Admin Rules (client)', () => {
  let ctx: TestServerContext | undefined;
  let engine: RuleEngine | undefined;
  const clients: NoexClient[] = [];
  let counter = 0;

  async function setupWithRules(options?: {
    auth?: AuthConfig;
  }): Promise<void> {
    const suffix = ++counter;
    engine = await RuleEngine.start({ name: `client-admin-rules-${suffix}` });
    ctx = await startTestServer({
      rules: engine,
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

  // ── registerRule ──────────────────────────────────────────────────

  describe('registerRule', () => {
    it('should register a rule and return metadata', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const result = await client.rules.registerRule(
        makeRule('welcome-email', 'user.registered'),
      );

      expect(result.id).toBe('welcome-email');
      expect(result.name).toBe('Rule welcome-email');
      expect(typeof result.version).toBe('number');
      expect(typeof result.createdAt).toBe('number');
      expect(typeof result.updatedAt).toBe('number');
    });

    it('should fire registered rule on event emission', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('fire-test', 'test.trigger'));

      // Subscribe to the output topic
      const received: Array<{ topic: string; data: Record<string, unknown> }> = [];
      const pushPromise = new Promise<void>((resolve) => {
        client.rules.subscribe('output.*', (event, topic) => {
          received.push({ topic, data: event.data });
          resolve();
        });
      });

      // Small delay to ensure subscription is active
      await new Promise((r) => setTimeout(r, 50));

      // Emit event that triggers the rule
      await client.rules.emit('test.trigger', { value: 42 });

      await pushPromise;

      expect(received).toHaveLength(1);
      expect(received[0]!.topic).toBe('output.fire-test');
      expect(received[0]!.data['source']).toBe('fire-test');
    });

    it('should return ALREADY_EXISTS for duplicate rule id', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('dup-rule', 'some.topic'));

      try {
        await client.rules.registerRule(makeRule('dup-rule', 'other.topic'));
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('ALREADY_EXISTS');
      }
    });

    it('should return VALIDATION_ERROR for invalid rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.rules.registerRule({
          id: 'bad-rule',
          name: 'Bad Rule',
          priority: 100,
          enabled: true,
          tags: [],
          // Missing trigger
          conditions: [],
          actions: [],
        } as unknown as RuleInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ── unregisterRule ────────────────────────────────────────────────

  describe('unregisterRule', () => {
    it('should remove a registered rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('removable', 'remove.topic'));

      const result = await client.rules.unregisterRule('removable');

      expect(result.ruleId).toBe('removable');
      expect(result.unregistered).toBe(true);
    });

    it('should return NOT_FOUND for non-existent rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.rules.unregisterRule('ghost-rule');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });
  });

  // ── updateRule ────────────────────────────────────────────────────

  describe('updateRule', () => {
    it('should update rule properties and increment version', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const regResult = await client.rules.registerRule(
        makeRule('updatable', 'update.topic'),
      );
      const originalVersion = regResult.version;

      const result = await client.rules.updateRule('updatable', {
        priority: 200,
        tags: ['updated', 'test'],
      });

      expect(result.id).toBe('updatable');
      expect(result.version).toBeGreaterThan(originalVersion);
      expect(typeof result.updatedAt).toBe('number');
    });

    it('should reflect updated behavior', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('behavior-update', 'behavior.trigger'));

      // Update the rule to emit on a different output topic
      await client.rules.updateRule('behavior-update', {
        actions: [
          { type: 'emit_event', topic: 'new-output.behavior-update', data: { changed: true } },
        ],
      });

      // Subscribe to new output
      const received: string[] = [];
      const pushPromise = new Promise<void>((resolve) => {
        client.rules.subscribe('new-output.*', (_event, topic) => {
          received.push(topic);
          resolve();
        });
      });

      await new Promise((r) => setTimeout(r, 50));

      await client.rules.emit('behavior.trigger', {});

      await pushPromise;

      expect(received).toHaveLength(1);
      expect(received[0]).toBe('new-output.behavior-update');
    });

    it('should return error for non-existent rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await expect(
        client.rules.updateRule('nonexistent', { priority: 500 }),
      ).rejects.toThrow(NoexClientError);
    });
  });

  // ── enableRule / disableRule ──────────────────────────────────────

  describe('enableRule / disableRule', () => {
    it('should disable a rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('toggle-rule', 'toggle.trigger'));

      const result = await client.rules.disableRule('toggle-rule');

      expect(result.ruleId).toBe('toggle-rule');
      expect(result.enabled).toBe(false);

      // Verify via getRule
      const detail = await client.rules.getRule('toggle-rule');
      expect(detail.enabled).toBe(false);
    });

    it('should enable a disabled rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule({
        ...makeRule('disabled-rule', 'disabled.trigger'),
        enabled: false,
      });

      const result = await client.rules.enableRule('disabled-rule');

      expect(result.ruleId).toBe('disabled-rule');
      expect(result.enabled).toBe(true);
    });

    it('should return NOT_FOUND for non-existent rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await expect(
        client.rules.disableRule('no-such-rule'),
      ).rejects.toThrow(NoexClientError);

      await expect(
        client.rules.enableRule('no-such-rule'),
      ).rejects.toThrow(NoexClientError);
    });
  });

  // ── getRule ───────────────────────────────────────────────────────

  describe('getRule', () => {
    it('should return full rule detail', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('detail-rule', 'detail.topic'));

      const detail = await client.rules.getRule('detail-rule');

      expect(detail.id).toBe('detail-rule');
      expect(detail.name).toBe('Rule detail-rule');
      expect(detail.priority).toBe(100);
      expect(detail.enabled).toBe(true);
      expect(detail.tags).toEqual(['test']);
      expect(detail.trigger).toEqual({ type: 'event', topic: 'detail.topic' });
      expect(detail.conditions).toEqual([]);
      expect(Array.isArray(detail.actions)).toBe(true);
      expect(typeof detail.version).toBe('number');
      expect(typeof detail.createdAt).toBe('number');
      expect(typeof detail.updatedAt).toBe('number');
    });

    it('should return NOT_FOUND for non-existent rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      try {
        await client.rules.getRule('missing');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });
  });

  // ── getRules ──────────────────────────────────────────────────────

  describe('getRules', () => {
    it('should return summary list of all rules', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.registerRule(makeRule('rule-a', 'topic.a'));
      await client.rules.registerRule(makeRule('rule-b', 'topic.b'));

      const result = await client.rules.getRules();

      expect(result.rules).toHaveLength(2);

      const ruleIds = result.rules.map((r) => r.id);
      expect(ruleIds).toContain('rule-a');
      expect(ruleIds).toContain('rule-b');

      // Verify summary format — has essential fields but no conditions/actions
      for (const rule of result.rules) {
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.name).toBe('string');
        expect(typeof rule.enabled).toBe('boolean');
        expect(typeof rule.priority).toBe('number');
        expect(typeof rule.version).toBe('number');
        expect(Array.isArray(rule.tags)).toBe(true);
      }
    });

    it('should return empty list when no rules registered', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const result = await client.rules.getRules();

      expect(result.rules).toEqual([]);
    });
  });

  // ── validateRule ──────────────────────────────────────────────────

  describe('validateRule', () => {
    it('should return valid for a correct rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const result = await client.rules.validateRule(
        makeRule('valid-rule', 'valid.topic') as unknown as Record<string, unknown>,
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for an invalid rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      const result = await client.rules.validateRule({
        id: 'invalid',
        // Missing required fields
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should not actually register the rule', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      await client.rules.validateRule(
        makeRule('dry-run', 'dry.topic') as unknown as Record<string, unknown>,
      );

      // Verify rule was NOT registered
      try {
        await client.rules.getRule('dry-run');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('NOT_FOUND');
      }
    });
  });

  // ── Full CRUD cycle ───────────────────────────────────────────────

  describe('full CRUD cycle', () => {
    it('register → get → update → disable → enable → list → unregister', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'admin' });

      // Register
      const regResult = await client.rules.registerRule(
        makeRule('lifecycle', 'lifecycle.topic'),
      );
      expect(regResult.id).toBe('lifecycle');

      // Get
      const detail = await client.rules.getRule('lifecycle');
      expect(detail.id).toBe('lifecycle');
      expect(detail.priority).toBe(100);

      // Update
      const updateResult = await client.rules.updateRule('lifecycle', {
        priority: 999,
      });
      expect(updateResult.version).toBeGreaterThan(regResult.version);

      // Verify update
      const updated = await client.rules.getRule('lifecycle');
      expect(updated.priority).toBe(999);

      // Disable
      const disableResult = await client.rules.disableRule('lifecycle');
      expect(disableResult.enabled).toBe(false);

      // Enable
      const enableResult = await client.rules.enableRule('lifecycle');
      expect(enableResult.enabled).toBe(true);

      // List (should have 1 rule)
      const listResult = await client.rules.getRules();
      expect(listResult.rules).toHaveLength(1);

      // Unregister
      const unregResult = await client.rules.unregisterRule('lifecycle');
      expect(unregResult.unregistered).toBe(true);

      // List (should be empty)
      const listAfter = await client.rules.getRules();
      expect(listAfter.rules).toHaveLength(0);
    });
  });

  // ── Tier enforcement ──────────────────────────────────────────────

  describe('tier enforcement', () => {
    it('should reject registerRule from writer', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'writer' });

      try {
        await client.rules.registerRule(makeRule('forbidden', 'x.y'));
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should reject unregisterRule from writer', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'writer' });

      await expect(
        client.rules.unregisterRule('any'),
      ).rejects.toThrow(NoexClientError);
    });

    it('should reject getRules from reader', async () => {
      await setupWithRules({ auth: createAuth() });
      const client = await createClient(ctx!.url, { token: 'reader' });

      try {
        await client.rules.getRules();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });
  });

  // ── No auth mode ──────────────────────────────────────────────────

  describe('no auth mode', () => {
    it('should allow admin rules operations without auth configured', async () => {
      await setupWithRules();
      const client = await createClient(ctx!.url);

      const result = await client.rules.registerRule(
        makeRule('open-rule', 'open.topic'),
      );

      expect(result.id).toBe('open-rule');

      const listResult = await client.rules.getRules();
      expect(listResult.rules).toHaveLength(1);
    });
  });
});
