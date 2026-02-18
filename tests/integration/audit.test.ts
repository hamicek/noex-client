import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../../src/index.js';
import type { AuditEntry } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Fixtures ──────────────────────────────────────────────────────

const sessions: Record<string, AuthSession> = {
  admin:  { userId: 'admin-1',  roles: ['admin'] },
  writer: { userId: 'writer-1', roles: ['writer'] },
  reader: { userId: 'reader-1', roles: ['reader'] },
};

function createAuth(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    validate: async (token) => sessions[token] ?? null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Integration: Audit API', () => {
  let ctx: TestServerContext | undefined;
  const clients: NoexClient[] = [];

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
  });

  // ── Basic audit query ──────────────────────────────────────────

  describe('query', () => {
    it('should return audit entries for admin operations', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      // audit.query is itself an admin-tier operation that gets audited
      const entries = await client.audit.query();

      // The query itself generated an audit entry; query again to see it
      const entries2 = await client.audit.query();
      expect(entries2.length).toBeGreaterThanOrEqual(1);

      const auditEntry = entries2.find((e) => e.operation === 'audit.query');
      expect(auditEntry).toBeDefined();
      expect(auditEntry!.result).toBe('success');
      expect(auditEntry!.userId).toBe('admin-1');
    });

    it('should return empty array when no audit entries exist', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });
      const client = await createClient(ctx.url, { token: 'admin' });

      // Query immediately — only the audit.query itself may be audited
      const entries = await client.audit.query({ operation: 'store.insert' });
      expect(entries).toEqual([]);
    });
  });

  // ── Filtering ──────────────────────────────────────────────────

  describe('query with filters', () => {
    it('should filter by userId', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });

      const admin = await createClient(ctx.url, { token: 'admin' });

      // Generate audit entries (audit.query is admin-tier)
      await admin.audit.query();

      const entries = await admin.audit.query({ userId: 'admin-1' });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.every((e) => e.userId === 'admin-1')).toBe(true);
    });

    it('should filter by operation', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });

      const admin = await createClient(ctx.url, { token: 'admin' });

      // Generate audit entries
      await admin.audit.query();
      await admin.audit.query();

      const entries = await admin.audit.query({ operation: 'audit.query' });
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries.every((e) => e.operation === 'audit.query')).toBe(true);
    });

    it('should respect limit', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });

      const admin = await createClient(ctx.url, { token: 'admin' });

      // Generate multiple audit entries (audit.query is admin-tier)
      await admin.audit.query();
      await admin.audit.query();
      await admin.audit.query();

      const entries = await admin.audit.query({ limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it('should filter by result', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });

      const writer = await createClient(ctx.url, { token: 'writer' });

      // Writer tries admin-tier operation → FORBIDDEN error (gets audited)
      await expect(writer.audit.query()).rejects.toThrow(NoexClientError);

      const admin = await createClient(ctx.url, { token: 'admin' });
      const entries = await admin.audit.query({ result: 'error' });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.every((e) => e.result === 'error')).toBe(true);
    });
  });

  // ── Access control ─────────────────────────────────────────────

  describe('access control', () => {
    it('should reject audit query from non-admin (writer)', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });

      const writer = await createClient(ctx.url, { token: 'writer' });

      try {
        await writer.audit.query();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoexClientError);
        expect((err as NoexClientError).code).toBe('FORBIDDEN');
      }
    });

    it('should reject audit query from non-admin (reader)', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: {},
      });

      const reader = await createClient(ctx.url, { token: 'reader' });

      await expect(reader.audit.query()).rejects.toThrow(NoexClientError);
    });
  });

  // ── Custom tiers config ────────────────────────────────────────

  describe('custom audit tiers', () => {
    it('should audit write operations when configured', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        audit: { tiers: ['admin', 'write'] },
        buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
      });

      const admin = await createClient(ctx.url, { token: 'admin' });
      await admin.store.bucket('items').insert({ value: 42 });

      const entries = await admin.audit.query({ operation: 'store.insert' });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0]!.resource).toBe('items');
    });
  });

  // ── No audit config ────────────────────────────────────────────

  describe('no audit config', () => {
    it('should return error when audit is not configured', async () => {
      ctx = await startTestServer({
        auth: createAuth(),
        // No audit config
      });

      const admin = await createClient(ctx.url, { token: 'admin' });
      await expect(admin.audit.query()).rejects.toThrow(NoexClientError);
    });
  });
});

// ── Session Revocation ────────────────────────────────────────────

describe('Integration: Session Revocation (client)', () => {
  let ctx: TestServerContext | undefined;
  const clients: NoexClient[] = [];

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
  });

  it('should emit session_revoked event when server revokes session', async () => {
    ctx = await startTestServer({
      auth: {
        validate: async (token) =>
          token === 'writer' ? { userId: 'writer-1', roles: ['writer'] } : null,
      },
    });

    const client = await createClient(ctx.url, { token: 'writer' });

    const revoked = new Promise<string>((resolve) => {
      client.on('session_revoked', (reason) => resolve(reason));
    });

    ctx.server.revokeSession('writer-1');

    const reason = await revoked;
    expect(reason).toBe('Session revoked by administrator');
  });

  it('should not attempt to reconnect after session revocation', async () => {
    ctx = await startTestServer({
      auth: {
        validate: async (token) =>
          token === 'writer' ? { userId: 'writer-1', roles: ['writer'] } : null,
      },
    });

    // Enable reconnect to verify it does NOT reconnect after revocation
    const client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: { maxRetries: 3, initialDelayMs: 50 },
      auth: { token: 'writer' },
    });
    clients.push(client);
    await client.connect();

    let reconnectAttempts = 0;
    client.on('reconnecting', () => { reconnectAttempts++; });

    const revoked = new Promise<void>((resolve) => {
      client.on('session_revoked', () => resolve());
    });

    ctx.server.revokeSession('writer-1');
    await revoked;

    // Wait a bit to ensure no reconnect attempts are made
    await new Promise((r) => setTimeout(r, 200));
    expect(reconnectAttempts).toBe(0);
  });

  it('should emit session_revoked with revokeSessions by role', async () => {
    ctx = await startTestServer({
      auth: {
        validate: async (token) => {
          if (token === 'w1') return { userId: 'writer-1', roles: ['writer'] };
          if (token === 'w2') return { userId: 'writer-2', roles: ['writer'] };
          return null;
        },
      },
    });

    const client1 = await createClient(ctx.url, { token: 'w1' });
    const client2 = await createClient(ctx.url, { token: 'w2' });

    const revoked1 = new Promise<string>((resolve) => {
      client1.on('session_revoked', resolve);
    });
    const revoked2 = new Promise<string>((resolve) => {
      client2.on('session_revoked', resolve);
    });

    const count = ctx.server.revokeSessions({ role: 'writer' });
    expect(count).toBe(2);

    const [r1, r2] = await Promise.all([revoked1, revoked2]);
    expect(r1).toBe('Session revoked by administrator');
    expect(r2).toBe('Session revoked by administrator');
  });

  it('should not affect other clients when revoking a specific user', async () => {
    ctx = await startTestServer({
      auth: {
        validate: async (token) => {
          if (token === 'writer') return { userId: 'writer-1', roles: ['writer'] };
          if (token === 'reader') return { userId: 'reader-1', roles: ['reader'] };
          return null;
        },
      },
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });

    const writer = await createClient(ctx.url, { token: 'writer' });
    const reader = await createClient(ctx.url, { token: 'reader' });

    const revoked = new Promise<void>((resolve) => {
      writer.on('session_revoked', () => resolve());
    });

    ctx.server.revokeSession('writer-1');
    await revoked;

    // Reader should still be able to operate
    const items = await reader.store.bucket('items').all();
    expect(items).toEqual([]);
  });
});
