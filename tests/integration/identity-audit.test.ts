import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Fixtures ──────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-audit-secret';

function createClient(url: string): NoexClient {
  return new NoexClient(url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Identity Audit', () => {
  let ctx: TestServerContext | undefined;
  let client: NoexClient | undefined;

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    client = undefined;

    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }
  });

  it('logs identity.loginWithSecret to audit', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);

    const entries = await client.audit.query({ operation: 'identity.loginWithSecret' });

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.operation).toBe('identity.loginWithSecret');
    expect(entries[0]!.result).toBe('success');
  });

  it('logs failed identity.login to audit', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();

    await client.identity.login('nonexistent', 'bad').catch(() => {});

    // Login as admin to query audit
    await client.identity.loginWithSecret(ADMIN_SECRET);
    const entries = await client.audit.query({ operation: 'identity.login', result: 'error' });

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.operation).toBe('identity.login');
    expect(entries[0]!.result).toBe('error');
  });

  it('logs identity.createUser to audit', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);

    await client.identity.createUser({ username: 'audited', password: 'Audit123!' });

    const entries = await client.audit.query({ operation: 'identity.createUser' });

    expect(entries.length).toBe(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.resource).toBe('user:audited');
    expect(entries[0]!.details).toEqual({ username: 'audited' });
  });

  it('logs identity.assignRole to audit', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);

    const user = await client.identity.createUser({ username: 'roled', password: 'Role1234!' });
    await client.identity.assignRole(user.id, 'writer');

    const entries = await client.audit.query({ operation: 'identity.assignRole' });

    expect(entries.length).toBe(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.details).toEqual({ userId: user.id, roleName: 'writer' });
  });

  it('logs identity.grant to audit with details', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);

    await client.store.defineBucket('audited-bucket', {
      key: 'id',
      schema: { id: { type: 'string', generated: 'uuid' } },
    });

    const user = await client.identity.createUser({ username: 'grantee', password: 'Grant123!' });
    await client.identity.grant({
      subjectType: 'user',
      subjectId: user.id,
      resourceType: 'bucket',
      resourceName: 'audited-bucket',
      operations: ['read', 'write'],
    });

    const entries = await client.audit.query({ operation: 'identity.grant' });

    expect(entries.length).toBe(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.details).toMatchObject({
      subjectType: 'user',
      subjectId: user.id,
      resourceType: 'bucket',
      resourceName: 'audited-bucket',
    });
  });

  it('logs identity.deleteUser to audit', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);

    const user = await client.identity.createUser({ username: 'deleted', password: 'Del12345!' });
    await client.identity.deleteUser(user.id);

    const entries = await client.audit.query({ operation: 'identity.deleteUser' });

    expect(entries.length).toBe(1);
    expect(entries[0]!.result).toBe('success');
    expect(entries[0]!.resource).toBe(`user:${user.id}`);
  });

  it('logs identity.logout to audit', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      audit: { tiers: ['admin'] },
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);
    await client.identity.logout();

    // Re-login to query audit
    await client.identity.loginWithSecret(ADMIN_SECRET);
    const entries = await client.audit.query({ operation: 'identity.logout' });

    expect(entries.length).toBe(1);
    expect(entries[0]!.result).toBe('success');
  });

  it('does not log identity operations when audit is disabled', async () => {
    ctx = await startTestServer({
      auth: { builtIn: true, adminSecret: ADMIN_SECRET },
      // No audit config
    });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);

    // audit.query should fail because audit is not configured
    await expect(client.audit.query()).rejects.toThrow();
  });
});
