import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError } from '../../src/index.js';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

// ── Fixtures ──────────────────────────────────────────────────────

const ADMIN_SECRET = 'test-identity-secret';

function builtInAuth(overrides?: Record<string, unknown>) {
  return {
    builtIn: true as const,
    adminSecret: ADMIN_SECRET,
    ...overrides,
  };
}

function createClient(url: string, options?: Record<string, unknown>): NoexClient {
  return new NoexClient(url, {
    WebSocket: WebSocket as never,
    reconnect: false,
    ...options,
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: Client IdentityAPI', () => {
  let ctx: TestServerContext | undefined;
  let client: NoexClient | undefined;
  let client2: NoexClient | undefined;

  afterEach(async () => {
    for (const c of [client, client2]) {
      if (c?.isConnected) await c.disconnect();
    }
    client = undefined;
    client2 = undefined;

    if (ctx) {
      await ctx.stop();
      ctx = undefined;
    }
  });

  // ── Helpers ──────────────────────────────────────────────────

  async function setupAndLogin(authOverrides?: Record<string, unknown>): Promise<NoexClient> {
    ctx = await startTestServer({ auth: builtInAuth(authOverrides) });
    client = createClient(ctx.url);
    await client.connect();
    await client.identity.loginWithSecret(ADMIN_SECRET);
    return client;
  }

  // ── Auth operations ──────────────────────────────────────────

  describe('login / logout / whoami', () => {
    it('logs in with admin secret and returns session info', async () => {
      ctx = await startTestServer({ auth: builtInAuth() });
      client = createClient(ctx.url);
      await client.connect();

      const result = await client.identity.loginWithSecret(ADMIN_SECRET);

      expect(result.token).toBeTruthy();
      expect(typeof result.expiresAt).toBe('number');
      expect(result.user.id).toBe('__superadmin__');
      expect(result.user.username).toBe('__superadmin__');
      expect(result.user.roles).toEqual(['superadmin']);
    });

    it('rejects invalid secret', async () => {
      ctx = await startTestServer({ auth: builtInAuth() });
      client = createClient(ctx.url);
      await client.connect();

      await expect(client.identity.loginWithSecret('wrong')).rejects.toThrow(NoexClientError);
    });

    it('logs in with username/password after creating a user', async () => {
      const c = await setupAndLogin();

      await c.identity.createUser({
        username: 'alice',
        password: 'Str0ngP@ss!',
        displayName: 'Alice',
      });

      // Logout and re-login as alice
      await c.identity.logout();
      const result = await c.identity.login('alice', 'Str0ngP@ss!');

      expect(result.user.username).toBe('alice');
      expect(result.token).toBeTruthy();
    });

    it('rejects login with wrong password', async () => {
      const c = await setupAndLogin();
      await c.identity.createUser({ username: 'bob', password: 'Correct1!' });

      await c.identity.logout();
      await expect(c.identity.login('bob', 'WrongPass1!')).rejects.toThrow(NoexClientError);
    });

    it('whoami returns authenticated user info', async () => {
      const c = await setupAndLogin();
      const who = await c.identity.whoami();

      expect(who.authenticated).toBe(true);
      expect(who.userId).toBe('__superadmin__');
      expect(who.roles).toEqual(['superadmin']);
    });

    it('logout clears session', async () => {
      const c = await setupAndLogin();
      await c.identity.logout();

      // Operations should fail after logout
      await expect(c.identity.listRoles()).rejects.toThrow(NoexClientError);
    });

    it('refreshSession returns new token', async () => {
      const c = await setupAndLogin();
      const oldLogin = await c.identity.loginWithSecret(ADMIN_SECRET);
      const refreshed = await c.identity.refreshSession();

      expect(refreshed.token).not.toBe(oldLogin.token);
      expect(refreshed.user.id).toBe('__superadmin__');
    });
  });

  // ── User CRUD ───────────────────────────────────────────────

  describe('user management', () => {
    it('creates a user with all fields', async () => {
      const c = await setupAndLogin();

      const user = await c.identity.createUser({
        username: 'alice',
        password: 'P@ssw0rd!',
        displayName: 'Alice Doe',
        email: 'alice@example.com',
        metadata: { department: 'eng' },
      });

      expect(user.id).toBeTruthy();
      expect(user.username).toBe('alice');
      expect(user.displayName).toBe('Alice Doe');
      expect(user.email).toBe('alice@example.com');
      expect(user.enabled).toBe(true);
      expect(user.metadata).toEqual({ department: 'eng' });
    });

    it('rejects duplicate username', async () => {
      const c = await setupAndLogin();
      await c.identity.createUser({ username: 'alice', password: 'P@ssw0rd!' });
      await expect(
        c.identity.createUser({ username: 'alice', password: 'Other1234!' }),
      ).rejects.toThrow(NoexClientError);
    });

    it('gets a user by id', async () => {
      const c = await setupAndLogin();
      const created = await c.identity.createUser({ username: 'bob', password: 'Secret123!' });

      const fetched = await c.identity.getUser(created.id);
      expect(fetched.username).toBe('bob');
      expect(fetched.id).toBe(created.id);
    });

    it('updates a user', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'carol', password: 'Pass1234!' });

      const updated = await c.identity.updateUser(user.id, {
        displayName: 'Carol Updated',
        email: 'carol@new.com',
      });

      expect(updated.displayName).toBe('Carol Updated');
      expect(updated.email).toBe('carol@new.com');
    });

    it('deletes a user', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'dave', password: 'Pass1234!' });

      await c.identity.deleteUser(user.id);

      await expect(c.identity.getUser(user.id)).rejects.toThrow(NoexClientError);
    });

    it('lists users with pagination', async () => {
      const c = await setupAndLogin();
      await c.identity.createUser({ username: 'user1', password: 'Pass1234!' });
      await c.identity.createUser({ username: 'user2', password: 'Pass1234!' });

      const result = await c.identity.listUsers({ page: 1, pageSize: 10 });

      expect(result.users.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('enables and disables a user', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'eve', password: 'Pass1234!' });

      const disabled = await c.identity.disableUser(user.id);
      expect(disabled.enabled).toBe(false);

      const enabled = await c.identity.enableUser(user.id);
      expect(enabled.enabled).toBe(true);
    });
  });

  // ── Password operations ─────────────────────────────────────

  describe('password operations', () => {
    it('changes own password', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'frank', password: 'OldPass1!' });
      await c.identity.assignRole(user.id, 'writer');

      // Login as frank
      await c.identity.logout();
      await c.identity.login('frank', 'OldPass1!');

      await c.identity.changePassword(user.id, 'OldPass1!', 'NewPass2!');

      // Old password should fail
      await c.identity.logout();
      await expect(c.identity.login('frank', 'OldPass1!')).rejects.toThrow(NoexClientError);

      // New password should work
      const result = await c.identity.login('frank', 'NewPass2!');
      expect(result.user.username).toBe('frank');
    });

    it('admin resets user password', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'grace', password: 'OldPass1!' });

      await c.identity.resetPassword(user.id, 'ResetPass1!');

      await c.identity.logout();
      const result = await c.identity.login('grace', 'ResetPass1!');
      expect(result.user.username).toBe('grace');
    });
  });

  // ── Role management ─────────────────────────────────────────

  describe('role management', () => {
    it('lists system roles', async () => {
      const c = await setupAndLogin();
      const roles = await c.identity.listRoles();

      const names = roles.map((r) => r.name).sort();
      expect(names).toEqual(['admin', 'reader', 'superadmin', 'writer']);
      expect(roles.every((r) => r.system)).toBe(true);
    });

    it('creates a custom role', async () => {
      const c = await setupAndLogin();

      const role = await c.identity.createRole({
        name: 'editor',
        description: 'Can edit content',
        permissions: [{ allow: ['store.insert', 'store.update'] }],
      });

      expect(role.name).toBe('editor');
      expect(role.system).toBe(false);
      expect(role.permissions).toHaveLength(1);
    });

    it('assigns and removes a role', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'hank', password: 'Pass1234!' });

      await c.identity.assignRole(user.id, 'writer');
      let roles = await c.identity.getUserRoles(user.id);
      expect(roles.map((r) => r.name)).toContain('writer');

      await c.identity.removeRole(user.id, 'writer');
      roles = await c.identity.getUserRoles(user.id);
      expect(roles.map((r) => r.name)).not.toContain('writer');
    });

    it('deletes a custom role', async () => {
      const c = await setupAndLogin();
      const role = await c.identity.createRole({ name: 'temporary' });

      await c.identity.deleteRole(role.id);

      const roles = await c.identity.listRoles();
      expect(roles.find((r) => r.name === 'temporary')).toBeUndefined();
    });

    it('cannot delete a system role', async () => {
      const c = await setupAndLogin();
      const roles = await c.identity.listRoles();
      const adminRole = roles.find((r) => r.name === 'admin')!;

      await expect(c.identity.deleteRole(adminRole.id)).rejects.toThrow(NoexClientError);
    });
  });

  // ── ACL & Ownership ─────────────────────────────────────────

  describe('ACL & ownership', () => {
    it('grants and revokes access', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'ivan', password: 'Pass1234!' });

      // Create a bucket first
      await c.store.defineBucket('products', {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          name: { type: 'string' },
        },
      });

      // Grant access
      await c.identity.grant({
        subjectType: 'user',
        subjectId: user.id,
        resourceType: 'bucket',
        resourceName: 'products',
        operations: ['read', 'write'],
      });

      // Check ACL
      const entries = await c.identity.getAcl('bucket', 'products');
      const userEntry = entries.find((e) => e.subjectId === user.id);
      expect(userEntry).toBeTruthy();
      expect(userEntry!.operations).toEqual(expect.arrayContaining(['read', 'write']));

      // Revoke access
      await c.identity.revoke({
        subjectType: 'user',
        subjectId: user.id,
        resourceType: 'bucket',
        resourceName: 'products',
        operations: ['write'],
      });

      const afterRevoke = await c.identity.getAcl('bucket', 'products');
      const afterEntry = afterRevoke.find((e) => e.subjectId === user.id);
      expect(afterEntry?.operations).not.toContain('write');
    });

    it('reports owner after defineBucket', async () => {
      const c = await setupAndLogin();

      await c.store.defineBucket('docs', {
        key: 'id',
        schema: { id: { type: 'string', generated: 'uuid' } },
      });

      const owner = await c.identity.getOwner('bucket', 'docs');
      expect(owner).not.toBeNull();
      expect(owner!.userId).toBe('__superadmin__');
    });

    it('transfers ownership', async () => {
      const c = await setupAndLogin();
      const user = await c.identity.createUser({ username: 'julia', password: 'Pass1234!' });

      await c.store.defineBucket('shared', {
        key: 'id',
        schema: { id: { type: 'string', generated: 'uuid' } },
      });

      await c.identity.transferOwner('bucket', 'shared', user.id);

      const owner = await c.identity.getOwner('bucket', 'shared');
      expect(owner!.userId).toBe(user.id);
    });

    it('myAccess returns effective permissions', async () => {
      const c = await setupAndLogin();
      const access = await c.identity.myAccess();

      expect(access.user.id).toBe('__superadmin__');
      expect(access.user.roles).toContain('superadmin');
    });
  });

  // ── Auto-login with credentials ─────────────────────────────

  describe('auto-login with credentials', () => {
    it('auto-logs in when credentials are provided', async () => {
      ctx = await startTestServer({ auth: builtInAuth() });

      // Create a user via admin
      const admin = createClient(ctx.url);
      await admin.connect();
      await admin.identity.loginWithSecret(ADMIN_SECRET);
      const autoUser = await admin.identity.createUser({ username: 'auto', password: 'AutoP@ss1' });
      await admin.identity.assignRole(autoUser.id, 'writer');
      await admin.disconnect();

      // Connect with credentials — should auto-login
      client = new NoexClient(ctx.url, {
        WebSocket: WebSocket as never,
        reconnect: false,
        auth: { credentials: { username: 'auto', password: 'AutoP@ss1' } },
      });

      const welcome = await client.connect();
      expect(welcome.requiresAuth).toBe(true);

      // Should be authenticated already
      const who = await client.identity.whoami();
      expect(who.authenticated).toBe(true);
    });

    it('auto-login with token still works', async () => {
      ctx = await startTestServer({ auth: builtInAuth() });

      // Get a token first
      const admin = createClient(ctx.url);
      await admin.connect();
      const loginResult = await admin.identity.loginWithSecret(ADMIN_SECRET);
      await admin.disconnect();

      // Connect with token
      client = new NoexClient(ctx.url, {
        WebSocket: WebSocket as never,
        reconnect: false,
        auth: { token: loginResult.token },
      });

      await client.connect();

      const who = await client.identity.whoami();
      expect(who.authenticated).toBe(true);
      expect(who.userId).toBe('__superadmin__');
    });
  });

  // ── Reconnect with saved token ──────────────────────────────

  describe('reconnect with saved token', () => {
    it('reconnects using saved session token after credential login', async () => {
      ctx = await startTestServer({ auth: builtInAuth() });

      // Create a user
      const admin = createClient(ctx.url);
      await admin.connect();
      await admin.identity.loginWithSecret(ADMIN_SECRET);
      const user = await admin.identity.createUser({ username: 'reconnector', password: 'Recon1234!' });
      await admin.identity.assignRole(user.id, 'reader');
      await admin.disconnect();

      // Connect with credentials and reconnect enabled
      client = new NoexClient(ctx.url, {
        WebSocket: WebSocket as never,
        reconnect: { maxRetries: 3, initialDelayMs: 100, maxDelayMs: 200 },
        auth: { credentials: { username: 'reconnector', password: 'Recon1234!' } },
      });

      await client.connect();

      // Verify authenticated
      const whoBefore = await client.identity.whoami();
      expect(whoBefore.authenticated).toBe(true);

      // Wait for reconnect
      const reconnected = new Promise<void>((resolve) => {
        client!.on('reconnected', () => resolve());
      });

      // Force disconnect by stopping and restarting server
      const port = ctx.port;
      await ctx.server.stop();

      // Restart on same port
      const { NoexServer } = await import('@hamicek/noex-server');
      ctx.server = await NoexServer.start({
        store: ctx.store,
        port,
        host: '127.0.0.1',
        auth: builtInAuth(),
      });

      await reconnected;

      // Should be re-authenticated
      const whoAfter = await client.identity.whoami();
      expect(whoAfter.authenticated).toBe(true);
    });
  });
});
