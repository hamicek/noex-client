import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';
import { NoexClient, NoexClientError } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Fixtures ──────────────────────────────────────────────────────

const userSession: AuthSession = {
  userId: 'user-1',
  roles: ['user'],
};

const adminSession: AuthSession = {
  userId: 'admin-1',
  roles: ['admin'],
};

function createAuth(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    validate: async (token) => {
      if (token === 'valid-user') return userSession;
      if (token === 'valid-admin') return adminSession;
      if (token === 'expiring') {
        return { userId: 'exp-1', roles: ['user'], expiresAt: Date.now() - 1000 };
      }
      return null;
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Auth', () => {
  let ctx: TestServerContext | undefined;
  let client: NoexClient | undefined;

  afterEach(async () => {
    if (client?.isConnected) {
      await client.disconnect();
    }
    client = undefined;

    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }
  });

  // ── welcome.requiresAuth ──────────────────────────────────────

  it('should report requiresAuth=true when auth is configured', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    const welcome = await client.connect();
    expect(welcome.requiresAuth).toBe(true);
  });

  it('should report requiresAuth=false when auth is not configured', async () => {
    ctx = await startTestServer();
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    const welcome = await client.connect();
    expect(welcome.requiresAuth).toBe(false);
  });

  // ── login ─────────────────────────────────────────────────────

  it('should login with valid token', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    const session = await client.auth.login('valid-user');

    expect(session.userId).toBe('user-1');
    expect(session.roles).toEqual(['user']);
  });

  it('should reject login with invalid token', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await expect(client.auth.login('bad-token')).rejects.toThrow(NoexClientError);

    try {
      await client.auth.login('bad-token');
    } catch (err) {
      expect((err as NoexClientError).code).toBe('UNAUTHORIZED');
    }
  });

  it('should reject login with already-expired token', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await expect(client.auth.login('expiring')).rejects.toThrow(NoexClientError);
  });

  // ── logout ────────────────────────────────────────────────────

  it('should logout successfully', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await client.auth.login('valid-user');
    await client.auth.logout();

    const who = await client.auth.whoami();
    expect(who).toBeNull();
  });

  // ── whoami ────────────────────────────────────────────────────

  it('should return session for authenticated user', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await client.auth.login('valid-admin');

    const session = await client.auth.whoami();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe('admin-1');
    expect(session!.roles).toEqual(['admin']);
  });

  it('should return null for unauthenticated user', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    const session = await client.auth.whoami();
    expect(session).toBeNull();
  });

  // ── auto-login ────────────────────────────────────────────────

  it('should auto-login when token is provided and auth is required', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
      auth: { token: 'valid-user' },
    });

    const welcome = await client.connect();
    expect(welcome.requiresAuth).toBe(true);

    // Should already be authenticated
    const session = await client.auth.whoami();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe('user-1');
  });

  it('should not auto-login when auth is not required', async () => {
    ctx = await startTestServer(); // No auth configured
    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
      auth: { token: 'valid-user' },
    });

    const welcome = await client.connect();
    expect(welcome.requiresAuth).toBe(false);
    // No error thrown — auto-login was skipped
  });

  // ── operations gated by auth ──────────────────────────────────

  it('should reject store operations without login when auth is required', async () => {
    ctx = await startTestServer({
      auth: createAuth(),
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await expect(
      client.store.bucket('items').insert({ value: 42 }),
    ).rejects.toThrow(NoexClientError);
  });

  it('should allow store operations after login', async () => {
    ctx = await startTestServer({
      auth: createAuth(),
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await client.auth.login('valid-user');

    const record = await client.store.bucket('items').insert({ value: 42 });
    expect(record['value']).toBe(42);
  });

  it('should reject store operations after logout', async () => {
    ctx = await startTestServer({
      auth: createAuth(),
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await client.auth.login('valid-user');
    await client.auth.logout();

    await expect(
      client.store.bucket('items').insert({ value: 1 }),
    ).rejects.toThrow(NoexClientError);
  });

  // ── re-authentication ──────────────────────────────────────────

  it('should allow re-login with a different token', async () => {
    ctx = await startTestServer({ auth: createAuth() });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    await client.auth.login('valid-user');
    let session = await client.auth.whoami();
    expect(session!.userId).toBe('user-1');

    await client.auth.login('valid-admin');
    session = await client.auth.whoami();
    expect(session!.userId).toBe('admin-1');
  });

  // ── optional auth (required: false) ───────────────────────────

  it('should allow operations without login when auth.required=false', async () => {
    ctx = await startTestServer({
      auth: createAuth({ required: false }),
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });

    const welcome = await client.connect();
    expect(welcome.requiresAuth).toBe(false);

    const record = await client.store.bucket('items').insert({ value: 99 });
    expect(record['value']).toBe(99);
  });

  // ── permissions ───────────────────────────────────────────────

  it('should enforce permissions', async () => {
    ctx = await startTestServer({
      auth: createAuth({
        permissions: {
          check: (session, _operation, _resource) => {
            return session.roles.includes('admin');
          },
        },
      }),
      buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
    });
    client = new NoexClient(ctx.url, { WebSocket: WebSocket as never, reconnect: false });
    await client.connect();

    // User without admin role — should be denied
    await client.auth.login('valid-user');
    await expect(
      client.store.bucket('items').insert({ value: 1 }),
    ).rejects.toThrow(NoexClientError);

    // Re-login as admin — should be allowed
    await client.auth.login('valid-admin');
    const record = await client.store.bucket('items').insert({ value: 2 });
    expect(record['value']).toBe(2);
  });
});
