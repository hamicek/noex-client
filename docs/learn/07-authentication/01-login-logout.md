# Login & Logout

The noex server can require authentication before allowing access to store and rules operations. The client SDK provides three methods: `auth.login()` to authenticate with a token, `auth.whoami()` to inspect the current session, and `auth.logout()` to end it. Authentication is per-connection — each new connection starts unauthenticated.

## What You'll Learn

- How to check whether the server requires authentication
- How to authenticate with `auth.login()` and inspect the session
- How to query the current session with `auth.whoami()`
- How to end a session with `auth.logout()`
- The `AuthSession` structure (userId, roles, expiresAt, metadata)
- How auth gates store and rules operations

## Authentication Flow

```
Client                              Server
┌──────────────┐   connect()       ┌──────────────────────────┐
│              │──────────────────>│ WebSocket opened          │
│              │   welcome         │                          │
│              │<──────────────────│ { requiresAuth: true }   │
│              │                   │                          │
│              │   auth.login()    │                          │
│ auth.login() │──────────────────>│ Validate token           │
│              │   AuthSession     │                          │
│              │<──────────────────│ { userId, roles, ... }   │
│              │                   │                          │
│              │   store / rules   │                          │
│  operations  │──────────────────>│ Allowed (authenticated)  │
└──────────────┘                   └──────────────────────────┘
```

The server signals whether authentication is required through the `welcome` message's `requiresAuth` field. When `requiresAuth` is `true`, all store and rules operations are rejected until `auth.login()` succeeds.

## Checking requiresAuth

The `connect()` method returns a `WelcomeInfo` object that includes the `requiresAuth` flag:

```typescript
const welcome = await client.connect();

if (welcome.requiresAuth) {
  console.log('Server requires authentication');
  await client.auth.login('my-token');
} else {
  console.log('No authentication required');
}
```

## auth.login()

Authenticates the connection with a token. The server validates the token and returns an `AuthSession`:

```typescript
const session = await client.auth.login('my-secret-token');
console.log(session.userId); // 'user-1'
console.log(session.roles);  // ['user']
```

**Signature:**

```typescript
login(token: string): Promise<AuthSession>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| token | `string` | Authentication token (e.g. JWT, API key) |

Returns `Promise<AuthSession>` — the authenticated session.

**Throws:**
- `NoexClientError` with code `UNAUTHORIZED` if the token is invalid or expired
- `NoexClientError` with code `VALIDATION_ERROR` if the token is empty
- `TimeoutError` if the server does not respond in time
- `DisconnectedError` if the client is not connected

### Re-authentication

Calling `login()` while already authenticated **replaces** the current session. This is useful for switching users or escalating privileges without disconnecting:

```typescript
// Login as regular user
await client.auth.login('user-token');
let session = await client.auth.whoami();
console.log(session!.userId); // 'user-1'

// Switch to admin
await client.auth.login('admin-token');
session = await client.auth.whoami();
console.log(session!.userId); // 'admin-1'
```

## AuthSession

The session object returned by `login()` and `whoami()`:

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
| roles | `readonly string[]` | Roles assigned to the user (e.g. `['admin', 'editor']`) |
| metadata | `Record<string, unknown>` | Optional metadata attached by the server's `validate` function |
| expiresAt | `number` | Optional Unix timestamp (ms) when the session expires |

## auth.whoami()

Returns the current session or `null` if not authenticated:

```typescript
const session = await client.auth.whoami();

if (session) {
  console.log(`Logged in as ${session.userId}`);
  console.log(`Roles: ${session.roles.join(', ')}`);

  if (session.expiresAt) {
    const remaining = session.expiresAt - Date.now();
    console.log(`Expires in ${Math.round(remaining / 1000)}s`);
  }
} else {
  console.log('Not authenticated');
}
```

**Signature:**

```typescript
whoami(): Promise<AuthSession | null>
```

The server checks expiration — if the session has expired since the last request, `whoami()` returns `null` even though `login()` previously succeeded.

## auth.logout()

Ends the current session:

```typescript
await client.auth.logout();
```

**Signature:**

```typescript
logout(): Promise<void>
```

Logout is **idempotent** — calling it when not authenticated succeeds silently. After logout, store and rules operations are rejected again (if `requiresAuth` is `true`).

## Session Lifecycle

```
┌─────────────┐      login()       ┌───────────────┐
│  No session  │ ────────────────> │ Authenticated  │
│  whoami→null │                   │ whoami→session │
└─────────────┘                   └───────────────┘
       ▲                                 │
       │           logout()              │
       │<────────────────────────────────│
       │                                 │
       │      session expired            │
       │<────────────────────────────────│
       │                                 │
       │      connection lost            │
       │<────────────────────────────────│
```

Key points:
- **Per-connection**: every new connection (including after reconnect) starts unauthenticated
- **Re-login**: call `login()` again to switch sessions
- **Idempotent logout**: safe to call even when not authenticated
- **Server-side expiration**: expired sessions return `null` from `whoami()`

## Auth-Gated Operations

When the server requires authentication, store and rules operations are rejected with `NoexClientError` until the client is authenticated:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
const welcome = await client.connect();

if (welcome.requiresAuth) {
  // This fails — not authenticated yet
  try {
    await client.store.bucket('items').insert({ value: 42 });
  } catch (err) {
    if (err instanceof NoexClientError) {
      console.log(err.code); // authentication-related error
    }
  }

  // Authenticate first
  await client.auth.login('valid-token');

  // Now it works
  const record = await client.store.bucket('items').insert({ value: 42 });
  console.log(record['value']); // 42
}
```

After logout, operations are rejected again:

```typescript
await client.auth.logout();

// This fails — session ended
try {
  await client.store.bucket('items').insert({ value: 1 });
} catch (err) {
  console.log('Rejected after logout');
}
```

## Complete Working Example

```typescript
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  const welcome = await client.connect();

  console.log(`Requires auth: ${welcome.requiresAuth}`);

  if (!welcome.requiresAuth) {
    console.log('Server does not require auth — skipping login');
    await client.disconnect();
    return;
  }

  // Login
  try {
    const session = await client.auth.login('my-api-key');
    console.log(`Logged in as ${session.userId}`);
    console.log(`Roles: ${session.roles.join(', ')}`);
  } catch (err) {
    if (err instanceof NoexClientError && err.code === 'UNAUTHORIZED') {
      console.log('Invalid token — cannot authenticate');
      await client.disconnect();
      return;
    }
    throw err;
  }

  // Check current session
  const who = await client.auth.whoami();
  console.log(`Current user: ${who?.userId}`);

  // Perform authenticated operations
  const items = client.store.bucket('items');
  const record = await items.insert({ name: 'Widget', price: 10 });
  console.log(`Created item: ${record['name']}`);

  // Logout
  await client.auth.logout();
  const afterLogout = await client.auth.whoami();
  console.log(`After logout: ${afterLogout}`); // null

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Connects to the server and checks `welcome.requiresAuth`
2. If auth is required, logs in with a token
3. Uses `whoami()` to display the user's roles
4. Performs one store operation (insert into a `tasks` bucket)
5. Logs out and verifies `whoami()` returns `null`
6. Attempts another insert after logout and catches the error

<details>
<summary>Solution</summary>

```typescript
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  const welcome = await client.connect();

  // 1. Check requiresAuth
  console.log(`Requires auth: ${welcome.requiresAuth}`);

  if (welcome.requiresAuth) {
    // 2. Login
    const session = await client.auth.login('valid-token');
    console.log(`Logged in as ${session.userId}`);

    // 3. Display roles
    const who = await client.auth.whoami();
    console.log(`Roles: ${who!.roles.join(', ')}`);

    // 4. Perform a store operation
    const record = await client.store.bucket('tasks').insert({
      title: 'Review PR',
      done: false,
    });
    console.log(`Created task: ${record['title']}`);

    // 5. Logout and verify
    await client.auth.logout();
    const afterLogout = await client.auth.whoami();
    console.log(`After logout: ${afterLogout}`); // null

    // 6. Attempt insert after logout
    try {
      await client.store.bucket('tasks').insert({ title: 'Should fail' });
    } catch (err) {
      if (err instanceof NoexClientError) {
        console.log(`Rejected: ${err.code}`);
      }
    }
  }

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `auth.login(token)` authenticates the connection and returns an `AuthSession`
- `auth.whoami()` returns the current session or `null` if not authenticated
- `auth.logout()` ends the session — idempotent, safe to call when not authenticated
- Authentication is per-connection — new connections start unauthenticated
- Re-login replaces the current session without disconnecting
- `welcome.requiresAuth` indicates whether the server requires authentication
- When `requiresAuth` is `true`, store and rules operations are rejected until authenticated
- Session expiration is checked server-side — `whoami()` returns `null` for expired sessions

---

Next: [Auto Login](./02-auto-login.md)
