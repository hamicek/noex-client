import type { AuthSession, SendFn } from '../types.js';

export class AuthAPI {
  constructor(private readonly send: SendFn) {}

  async login(token: string): Promise<AuthSession> {
    return this.send('auth.login', { token }) as Promise<AuthSession>;
  }

  async logout(): Promise<void> {
    await this.send('auth.logout', {});
  }

  async whoami(): Promise<AuthSession | null> {
    const result = await this.send('auth.whoami', {}) as {
      authenticated: boolean;
      userId?: string;
      roles?: readonly string[];
      expiresAt?: number | null;
    };

    if (!result.authenticated) return null;

    return {
      userId: result.userId!,
      roles: result.roles!,
      ...(result.expiresAt != null ? { expiresAt: result.expiresAt } : {}),
    };
  }
}
