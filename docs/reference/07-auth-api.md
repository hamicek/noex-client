# Auth API

The `AuthAPI` class provides authentication methods — logging in with a token, logging out, and querying the current session. It is available as the `auth` property on `NoexClient`.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const auth = client.auth;
```

Relevant types:

```typescript
import type { AuthSession } from '@hamicek/noex-client';
```

---

## Methods

### login()

```typescript
login(token: string): Promise<AuthSession>
```

Authenticates the connection with the given token. The server validates the token and, on success, associates the connection with a session. If the connection is already authenticated, calling `login()` again replaces the current session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| token | `string` | yes | Authentication token (e.g. JWT, API key) |

**Returns:** `Promise<AuthSession>` — the authenticated session with `userId`, `roles`, and optional `expiresAt`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `token` is empty or not a string
- `NoexClientError` with code `UNAUTHORIZED` if the token is invalid or expired
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const session = await auth.login('my-secret-token');
console.log(`Logged in as ${session.userId}`);
console.log(`Roles: ${session.roles.join(', ')}`);
```

---

### logout()

```typescript
logout(): Promise<void>
```

Ends the current session. The server clears the authentication state for this connection. Calling `logout()` when not authenticated is a no-op — it succeeds silently.

**Returns:** `Promise<void>`

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
await auth.logout();
```

---

### whoami()

```typescript
whoami(): Promise<AuthSession | null>
```

Returns the current session if authenticated, or `null` if not. This method also detects expired sessions — if the session has expired since the last request, the server clears the state and returns `null`.

**Returns:** `Promise<AuthSession | null>` — the current session, or `null` if not authenticated

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const session = await auth.whoami();
if (session) {
  console.log(`Authenticated as ${session.userId}`);
  if (session.expiresAt) {
    const remaining = session.expiresAt - Date.now();
    console.log(`Session expires in ${Math.round(remaining / 1000)}s`);
  }
} else {
  console.log('Not authenticated');
}
```

---

## Auto-Login

When `ClientOptions.auth.token` is set, `NoexClient` automatically calls `auth.login()` during `connect()` if the server requires authentication (indicated by `welcome.requiresAuth === true`).

```typescript
const client = new NoexClient('ws://localhost:3000', {
  auth: { token: 'my-secret-token' },
});

// connect() automatically calls auth.login() if the server requires auth
const welcome = await client.connect();
```

Auto-login also runs during reconnection — the client re-authenticates with the same token before restoring subscriptions.

**Sequence during connect:**

1. WebSocket connection is established
2. Server sends `welcome` message with `requiresAuth` flag
3. If `requiresAuth === true` and `options.auth.token` is set, `auth.login(token)` is called
4. `connected` and `welcome` events are emitted

**Sequence during reconnect:**

1. WebSocket connection is re-established
2. Server sends `welcome` message
3. If `requiresAuth === true` and `options.auth.token` is set, `auth.login(token)` is called
4. Active subscriptions are restored via `SubscriptionManager.resubscribeAll()`
5. `connected`, `reconnected`, and `welcome` events are emitted

If auto-login fails (e.g. the token has expired), the reconnect attempt is treated as a failure and the client retries according to the reconnect strategy.

---

## Session Lifecycle

```
┌─────────────┐      login()       ┌───────────────┐
│  No session  │ ────────────────▶  │ Authenticated  │
│  whoami→null │                    │ whoami→session │
└─────────────┘                    └───────────────┘
       ▲                                  │
       │           logout()               │
       │◀──────────────────────────────────│
       │                                  │
       │      session expired             │
       │◀──────────────────────────────────│
       │                                  │
       │      connection lost             │
       │◀──────────────────────────────────│
```

- **Authentication** is per-connection — a new connection starts unauthenticated
- **Re-authentication** is possible at any time by calling `login()` again
- **Logout** is idempotent — calling it when already unauthenticated is safe
- **Expiration** is checked server-side — when a session expires, subsequent `whoami()` returns `null`
- **Reconnection** creates a new connection, so re-authentication is required (handled automatically when `auth.token` is configured)

---

## Types

### AuthSession

```typescript
interface AuthSession {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly expiresAt?: number;
}
```

| Field | Type | Description |
|-------|------|-------------|
| userId | `string` | Unique user identifier |
| roles | `readonly string[]` | Array of role names assigned to the user |
| metadata | `Record<string, unknown>` | Optional metadata attached to the session |
| expiresAt | `number` | Optional Unix timestamp (ms) when the session expires |

---

## See Also

- [NoexClient](./01-noex-client.md) — connection lifecycle, `auth` property, `connect()` auto-login
- [Configuration](./02-configuration.md) — `ClientOptions.auth`, `requestTimeoutMs`
- [Transport](./08-transport.md) — reconnect strategy, re-authentication on reconnect
- [Types](./09-types.md) — `AuthSession`
- [Errors](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
