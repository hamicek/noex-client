import type {
  IdentityLoginResult,
  IdentityUserInfo,
  IdentityCreateUserInput,
  IdentityUpdateUserInput,
  IdentityListUsersResult,
  IdentityRoleInfo,
  IdentityCreateRoleInput,
  IdentityUpdateRoleInput,
  IdentityGrantInput,
  IdentityRevokeInput,
  IdentityAclEntry,
  IdentityAclResourceType,
  IdentityOwnerInfo,
  IdentityEffectiveAccess,
  SendFn,
} from '../types.js';

export class IdentityAPI {
  constructor(private readonly send: SendFn) {}

  // ── Auth ──────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<IdentityLoginResult> {
    return this.send('identity.login', { username, password }) as Promise<IdentityLoginResult>;
  }

  async loginWithSecret(secret: string): Promise<IdentityLoginResult> {
    return this.send('identity.loginWithSecret', { secret }) as Promise<IdentityLoginResult>;
  }

  async logout(): Promise<void> {
    await this.send('identity.logout', {});
  }

  async whoami(): Promise<{
    authenticated: boolean;
    userId?: string;
    roles?: readonly string[];
    expiresAt?: number | null;
  }> {
    return this.send('identity.whoami', {}) as Promise<{
      authenticated: boolean;
      userId?: string;
      roles?: readonly string[];
      expiresAt?: number | null;
    }>;
  }

  async refreshSession(): Promise<IdentityLoginResult> {
    return this.send('identity.refreshSession', {}) as Promise<IdentityLoginResult>;
  }

  // ── User Management ──────────────────────────────────────────

  async createUser(input: IdentityCreateUserInput): Promise<IdentityUserInfo> {
    return this.send('identity.createUser', input as unknown as Record<string, unknown>) as Promise<IdentityUserInfo>;
  }

  async getUser(userId: string): Promise<IdentityUserInfo> {
    return this.send('identity.getUser', { userId }) as Promise<IdentityUserInfo>;
  }

  async updateUser(userId: string, updates: IdentityUpdateUserInput): Promise<IdentityUserInfo> {
    const payload: Record<string, unknown> = { userId };
    if (updates.displayName !== undefined) payload['displayName'] = updates.displayName;
    if (updates.email !== undefined) payload['email'] = updates.email;
    if (updates.metadata !== undefined) payload['metadata'] = updates.metadata;
    return this.send('identity.updateUser', payload) as Promise<IdentityUserInfo>;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.send('identity.deleteUser', { userId });
  }

  async listUsers(options?: { page?: number; pageSize?: number }): Promise<IdentityListUsersResult> {
    return this.send('identity.listUsers', options ?? {}) as Promise<IdentityListUsersResult>;
  }

  async enableUser(userId: string): Promise<IdentityUserInfo> {
    return this.send('identity.enableUser', { userId }) as Promise<IdentityUserInfo>;
  }

  async disableUser(userId: string): Promise<IdentityUserInfo> {
    return this.send('identity.disableUser', { userId }) as Promise<IdentityUserInfo>;
  }

  // ── Password ─────────────────────────────────────────────────

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    await this.send('identity.changePassword', { userId, currentPassword, newPassword });
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await this.send('identity.resetPassword', { userId, newPassword });
  }

  // ── Roles ────────────────────────────────────────────────────

  async createRole(input: IdentityCreateRoleInput): Promise<IdentityRoleInfo> {
    return this.send('identity.createRole', input as unknown as Record<string, unknown>) as Promise<IdentityRoleInfo>;
  }

  async updateRole(roleId: string, updates: IdentityUpdateRoleInput): Promise<IdentityRoleInfo> {
    const payload: Record<string, unknown> = { roleId };
    if (updates.description !== undefined) payload['description'] = updates.description;
    if (updates.permissions !== undefined) payload['permissions'] = updates.permissions;
    return this.send('identity.updateRole', payload) as Promise<IdentityRoleInfo>;
  }

  async deleteRole(roleId: string): Promise<void> {
    await this.send('identity.deleteRole', { roleId });
  }

  async listRoles(): Promise<IdentityRoleInfo[]> {
    const result = await this.send('identity.listRoles', {}) as { roles: IdentityRoleInfo[] };
    return result.roles;
  }

  async assignRole(userId: string, roleName: string): Promise<void> {
    await this.send('identity.assignRole', { userId, roleName });
  }

  async removeRole(userId: string, roleName: string): Promise<void> {
    await this.send('identity.removeRole', { userId, roleName });
  }

  async getUserRoles(userId: string): Promise<IdentityRoleInfo[]> {
    const result = await this.send('identity.getUserRoles', { userId }) as { roles: IdentityRoleInfo[] };
    return result.roles;
  }

  // ── ACL ──────────────────────────────────────────────────────

  async grant(input: IdentityGrantInput): Promise<void> {
    await this.send('identity.grant', input as unknown as Record<string, unknown>);
  }

  async revoke(input: IdentityRevokeInput): Promise<void> {
    await this.send('identity.revoke', input as unknown as Record<string, unknown>);
  }

  async getAcl(resourceType: IdentityAclResourceType, resourceName: string): Promise<IdentityAclEntry[]> {
    const result = await this.send('identity.getAcl', { resourceType, resourceName }) as { entries: IdentityAclEntry[] };
    return result.entries;
  }

  async myAccess(): Promise<IdentityEffectiveAccess> {
    return this.send('identity.myAccess', {}) as Promise<IdentityEffectiveAccess>;
  }

  // ── Ownership ────────────────────────────────────────────────

  async getOwner(resourceType: IdentityAclResourceType, resourceName: string): Promise<IdentityOwnerInfo | null> {
    const result = await this.send('identity.getOwner', { resourceType, resourceName }) as { owner: IdentityOwnerInfo | null };
    return result.owner;
  }

  async transferOwner(resourceType: IdentityAclResourceType, resourceName: string, newOwnerId: string): Promise<void> {
    await this.send('identity.transferOwner', { resourceType, resourceName, newOwnerId });
  }
}
