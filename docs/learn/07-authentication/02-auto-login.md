# Auto Login

Manually calling `auth.login()` after every `connect()` and reconnect is tedious and error-prone. The SDK provides **auto-login** — pass a token in `ClientOptions.auth` and the SDK calls `auth.login()` automatically whenever the server requires authentication. This works both on initial connection and after every successful reconnect.

## What You'll Learn

- How to configure auto-login with `ClientOptions.auth.token`
- The exact sequence during initial connect and reconnect
- How auto-login interacts with subscription recovery
- What happens when the auto-login token is invalid or expired
- When to use auto-login vs manual login

## Configuring Auto-Login

Pass the token in the `auth` option when creating the client:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-secret-token' },
});

const welcome = await client.connect();
// If welcome.requiresAuth === true, auth.login() was already called.
// The connection is authenticated — ready for store/rules operations.
```

After `connect()` resolves, the client is already authenticated. No separate `auth.login()` call is needed.

## ClientOptions.auth

```typescript
interface ClientOptions {
  auth?: {
    token: string;
  };
  // ... other options
}
```

| Field | Type | Description |
|-------|------|-------------|
| auth.token | `string` | Token to use for automatic authentication |

## Connect Sequence

When `connect()` is called with `auth.token` configured:

```
1. WebSocket connection opens
2. Server sends welcome message  ─────  { requiresAuth: true/false }
3. If requiresAuth === true:
   └─ SDK calls auth.login(token) ────  authenticate automatically
4. 'connected' event emitted
5. 'welcome' event emitted
6. connect() promise resolves  ────────  WelcomeInfo returned
```

If `requiresAuth` is `false`, the auto-login step is skipped — the token is not sent to a server that doesn't expect it.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-token' },
});

const welcome = await client.connect();

if (welcome.requiresAuth) {
  // Already authenticated — auto-login happened during connect()
  const session = await client.auth.whoami();
  console.log(`Auto-logged in as ${session!.userId}`);
} else {
  // No auth needed — token was not sent
  console.log('Server does not require authentication');
}
```

## Reconnect Sequence

Auto-login is critical during reconnection. Without it, the client would reconnect but fail to restore subscriptions because the server rejects operations from unauthenticated connections.

```
1. Connection lost — state: 'reconnecting'
2. Exponential backoff delay
3. WebSocket connection re-established
4. Server sends welcome message
5. If requiresAuth === true:
   └─ SDK calls auth.login(token)  ───  re-authenticate
6. SubscriptionManager.resubscribeAll()  ─  restore subscriptions
7. 'connected' event emitted
8. 'reconnected' event emitted
9. 'welcome' event emitted
```

The sequence is: **connect → authenticate → resubscribe**. Authentication happens before subscription recovery, ensuring the resubscribe requests are accepted.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-token' },
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 1000,
  },
});

client.on('reconnected', () => {
  // By this point: reconnected + re-authenticated + subscriptions restored
  console.log('Fully recovered');
});

await client.connect();

// Subscribe to a query — will be automatically restored after reconnect
await client.store.subscribe('all-users', (data) => {
  console.log('Users:', data);
});
```

## Auto-Login Failure

If auto-login fails (invalid token, expired token, server error), the behavior depends on the context:

### During Initial connect()

The `connect()` promise **rejects** with the login error:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'invalid-token' },
});

try {
  await client.connect();
} catch (err) {
  // NoexClientError with code 'UNAUTHORIZED'
  console.log('Auto-login failed:', err);
}
```

### During Reconnect

The reconnect attempt is treated as a **failure**. The client retries according to the reconnect strategy (exponential backoff, `maxRetries`):

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'might-expire' },
  reconnect: { maxRetries: 5 },
});

client.on('error', (err) => {
  // Auto-login failures during reconnect are reported here
  console.log('Reconnect error:', err.message);
});

client.on('disconnected', () => {
  // Emitted if all retries are exhausted
  console.log('Permanently disconnected');
});
```

## Auto-Login vs Manual Login

| Scenario | Recommended approach |
|----------|---------------------|
| Static API key or service token | **Auto-login** — token doesn't change |
| User enters credentials at runtime | **Manual login** — get token first, then login |
| Token might expire and need refresh | **Manual login** — refresh logic before login |
| Simple scripts and backend services | **Auto-login** — minimal code |
| Multi-user application | **Manual login** — different tokens per session |

### Auto-login pattern (recommended for services)

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: process.env.API_TOKEN! },
  reconnect: true,
});

await client.connect();
// Ready to use — auth handled automatically, even across reconnects
```

### Manual login pattern (recommended for interactive apps)

```typescript
const client = new NoexClient('ws://localhost:8080', { WebSocket });
const welcome = await client.connect();

if (welcome.requiresAuth) {
  const token = await promptUserForCredentials();
  await client.auth.login(token);
}
```

## Complete Working Example

A service that connects with auto-login and monitors reconnection:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    auth: { token: 'service-api-key' },
    reconnect: {
      maxRetries: Infinity,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    },
  });

  client.on('connected', () => {
    console.log('Connected and authenticated');
  });

  client.on('reconnecting', () => {
    console.log('Connection lost — reconnecting...');
  });

  client.on('reconnected', () => {
    console.log('Reconnected — re-authenticated and subscriptions restored');
  });

  client.on('error', (err) => {
    console.error('Client error:', err.message);
  });

  const welcome = await client.connect();
  console.log(`Server version: ${welcome.version}`);
  console.log(`Requires auth: ${welcome.requiresAuth}`);

  // Verify authentication
  const session = await client.auth.whoami();
  if (session) {
    console.log(`Authenticated as ${session.userId} with roles: ${session.roles.join(', ')}`);
  }

  // Start working — subscriptions will survive reconnects
  await client.store.subscribe('active-sessions', (data) => {
    const sessions = data as Array<Record<string, unknown>>;
    console.log(`Active sessions: ${sessions.length}`);
  });

  // Keep the process alive
  console.log('Listening for updates... (Ctrl+C to stop)');
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Creates a client with auto-login configured
2. Connects and verifies authentication with `whoami()`
3. Inserts a record into a `logs` bucket to confirm operations work
4. Manually logs out and verifies `whoami()` returns `null`
5. Manually logs back in with the same token and verifies the session is restored

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  // 1. Create client with auto-login
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    auth: { token: 'my-token' },
  });

  // 2. Connect and verify
  await client.connect();
  const session = await client.auth.whoami();
  console.log(`Auto-login: ${session?.userId}`); // e.g. 'user-1'

  // 3. Perform a store operation
  const record = await client.store.bucket('logs').insert({
    action: 'test',
    timestamp: Date.now(),
  });
  console.log(`Inserted log: ${record['action']}`);

  // 4. Logout and verify
  await client.auth.logout();
  const afterLogout = await client.auth.whoami();
  console.log(`After logout: ${afterLogout}`); // null

  // 5. Manual re-login
  const restored = await client.auth.login('my-token');
  console.log(`Re-logged in as: ${restored.userId}`);

  const verified = await client.auth.whoami();
  console.log(`Session restored: ${verified?.userId}`);

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- Configure auto-login with `ClientOptions.auth.token` — the SDK calls `auth.login()` automatically
- Auto-login runs during `connect()` only when `welcome.requiresAuth === true`
- Auto-login runs during reconnect before subscription recovery — ensuring operations are accepted
- If the token is invalid during `connect()`, the promise rejects with `UNAUTHORIZED`
- If the token is invalid during reconnect, the attempt fails and the client retries
- Auto-login is ideal for static tokens (API keys, service accounts)
- Use manual login when tokens change at runtime or need refresh logic
- The connect → authenticate → resubscribe sequence ensures seamless recovery

---

Next: [Automatic Reconnect](../08-reconnection/01-automatic-reconnect.md)
