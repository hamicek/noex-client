# Recovery Strategies

Knowing the error types is only half the story. The other half is deciding **what to do** when each error occurs. This chapter covers retry patterns, graceful degradation, and callback error handling — everything you need to build resilient production applications.

## What You'll Learn

- Which errors are safe to retry and which are not
- How to implement retry logic for idempotent operations
- How to handle callback errors in subscriptions
- Graceful degradation strategies when the server is unreachable
- How to map error codes to user-facing messages

## Retry Safety: Idempotent vs Non-Idempotent

The most important question before retrying a failed request is: **is this operation safe to repeat?**

| Operation | Idempotent? | Safe to retry? |
|-----------|-------------|---------------|
| `bucket.get(key)` | Yes | Yes |
| `bucket.all()` | Yes | Yes |
| `bucket.where(filter)` | Yes | Yes |
| `bucket.findOne(filter)` | Yes | Yes |
| `bucket.count()` | Yes | Yes |
| `bucket.update(key, data)` | Yes* | Yes (same data) |
| `bucket.delete(key)` | Yes | Yes (second delete is a no-op) |
| `bucket.insert(data)` | **No** | **No** — may create duplicates |
| `rules.emit(topic, data)` | **No** | **No** — may emit duplicate events |
| `store.subscribe(query, cb)` | Yes | Yes |
| `store.transaction(ops)` | Depends | Only if all ops are idempotent |

\* `update` is idempotent only when you're setting the same values. If the update depends on the current state (e.g. incrementing a counter), it is **not** idempotent.

## Retry Pattern for Idempotent Operations

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1_000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry non-recoverable errors
      if (err instanceof NoexClientError) {
        switch (err.code) {
          case 'VALIDATION_ERROR':
          case 'BUCKET_NOT_DEFINED':
          case 'QUERY_NOT_DEFINED':
          case 'UNAUTHORIZED':
          case 'FORBIDDEN':
          case 'ALREADY_EXISTS':
          case 'UNKNOWN_OPERATION':
          case 'RULES_NOT_AVAILABLE':
            throw err; // No point retrying — the input is wrong
        }
      }

      // Retry on timeout, disconnect, rate limit, conflict, internal error
      if (attempt < maxRetries) {
        const wait = err instanceof NoexClientError && err.code === 'RATE_LIMITED'
          ? delayMs * 2  // Back off more for rate limiting
          : delayMs;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw lastError;
}

// Usage
const users = await withRetry(() => client.store.bucket('users').all());
```

## Error Code Decision Matrix

| Error Code | Action | Retry? |
|-----------|--------|--------|
| `TIMEOUT` | Request may have succeeded — check state before retrying | Idempotent only |
| `DISCONNECTED` | Wait for reconnect, then retry | Idempotent only |
| `RATE_LIMITED` | Back off, wait longer | Yes, with delay |
| `BACKPRESSURE` | Reduce request rate | Yes, with delay |
| `CONFLICT` | Re-read the record, apply changes, retry | Yes (read-modify-write) |
| `INTERNAL_ERROR` | Log for investigation, retry once | Yes, once |
| `VALIDATION_ERROR` | Fix the input data | No |
| `BUCKET_NOT_DEFINED` | Use the correct bucket name | No |
| `QUERY_NOT_DEFINED` | Use the correct query name | No |
| `UNAUTHORIZED` | Call `auth.login()` first | No (re-auth, then retry) |
| `FORBIDDEN` | User lacks permissions | No |
| `ALREADY_EXISTS` | Record exists — use `update` instead | No |
| `NOT_FOUND` | Record doesn't exist — handle gracefully | No |
| `PARSE_ERROR` | SDK bug or protocol mismatch | No |
| `INVALID_REQUEST` | SDK bug or protocol mismatch | No |
| `UNKNOWN_OPERATION` | Mismatched client/server versions | No |
| `RULES_NOT_AVAILABLE` | Server has no rules engine configured | No |

## Handling Disconnected State

When the client is reconnecting, all requests throw `DisconnectedError`. Instead of retrying immediately, wait for the connection to be restored:

```typescript
import { DisconnectedError } from '@hamicek/noex-client';

async function waitForConnection(client: NoexClient, timeoutMs = 30_000): Promise<void> {
  if (client.isConnected) return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubConnected();
      unsubDisconnected();
      reject(new Error('Timed out waiting for connection'));
    }, timeoutMs);

    const unsubConnected = client.on('connected', () => {
      clearTimeout(timer);
      unsubConnected();
      unsubDisconnected();
      resolve();
    });

    const unsubDisconnected = client.on('disconnected', () => {
      clearTimeout(timer);
      unsubConnected();
      unsubDisconnected();
      reject(new Error('Client disconnected permanently'));
    });
  });
}

// Usage
try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    await waitForConnection(client);
    // Retry after reconnection
    const users = await client.store.bucket('users').all();
  }
}
```

## Subscription Callback Errors

Errors thrown inside subscription callbacks are handled differently depending on when they occur:

### During initial data delivery

If the callback throws when receiving initial data (the first call after `subscribe()`), the subscription is **cleaned up** and the `subscribe()` promise rejects:

```typescript
try {
  await client.store.subscribe('all-users', (data) => {
    throw new Error('Failed to process initial data');
  });
} catch (err) {
  // err.message === 'Failed to process initial data'
  // Subscription was cleaned up — no leak
  // Client remains functional
}
```

### During push updates

If the callback throws on subsequent push deliveries, the error is **caught and logged** to `console.error`. The subscription stays active and continues to receive future pushes:

```typescript
let callCount = 0;

await client.store.subscribe('user-count', (data) => {
  callCount++;
  if (callCount === 2) {
    throw new Error('Temporary processing error');
    // Logged to console.error, but subscription continues
  }
  console.log('Count:', data);
});

// After the throw:
// - Error logged to console.error
// - Subscription is still active
// - Next push will call the callback again
```

### Best practice: guard your callbacks

```typescript
await client.store.subscribe('all-users', (data) => {
  try {
    const users = data as User[];
    updateUI(users);
  } catch (err) {
    // Handle gracefully instead of relying on the SDK's error catching
    console.error('Failed to process subscription data:', err);
    showErrorBanner('Data update failed');
  }
});
```

## Graceful Degradation

When the server is unreachable and reconnect hasn't succeeded yet, your application should degrade gracefully:

```typescript
import { NoexClient, DisconnectedError, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

class ResilientApp {
  private client: NoexClient;
  private lastKnownUsers: User[] = [];
  private isOnline = false;

  constructor(url: string) {
    this.client = new NoexClient(url, {
      WebSocket,
      reconnect: { maxRetries: Infinity },
    });

    this.client.on('connected', () => {
      this.isOnline = true;
      console.log('Online');
    });

    this.client.on('reconnecting', () => {
      this.isOnline = false;
      console.log('Offline — using cached data');
    });

    this.client.on('disconnected', () => {
      this.isOnline = false;
      console.log('Disconnected');
    });
  }

  async start() {
    await this.client.connect();

    await this.client.store.subscribe('all-users', (data) => {
      this.lastKnownUsers = data as User[];
      console.log(`Users updated: ${this.lastKnownUsers.length}`);
    });
  }

  getUsers(): User[] {
    // Always returns data — live or cached
    return this.lastKnownUsers;
  }

  async addUser(name: string): Promise<boolean> {
    if (!this.isOnline) {
      console.log('Cannot add user — offline');
      return false;
    }

    try {
      await this.client.store.bucket('users').insert({ name });
      return true;
    } catch (err) {
      if (err instanceof DisconnectedError) {
        console.log('Connection lost during operation');
        return false;
      }
      throw err;
    }
  }
}

interface User {
  id: string;
  name: string;
}
```

## Mapping Error Codes to User Messages

```typescript
function getUserMessage(err: unknown): string {
  if (err instanceof DisconnectedError) {
    return 'You are currently offline. Please check your connection.';
  }
  if (err instanceof TimeoutError) {
    return 'The server is taking too long to respond. Please try again.';
  }
  if (err instanceof NoexClientError) {
    switch (err.code) {
      case 'VALIDATION_ERROR':
        return 'Please check your input and try again.';
      case 'UNAUTHORIZED':
        return 'Your session has expired. Please log in again.';
      case 'FORBIDDEN':
        return 'You do not have permission for this action.';
      case 'NOT_FOUND':
        return 'The requested item was not found.';
      case 'ALREADY_EXISTS':
        return 'This item already exists.';
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait a moment.';
      case 'CONFLICT':
        return 'The data was modified by someone else. Please refresh and try again.';
      default:
        return 'An unexpected error occurred. Please try again later.';
    }
  }
  return 'Something went wrong.';
}
```

## Complete Working Example

```typescript
import {
  NoexClient,
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    requestTimeoutMs: 5_000,
    reconnect: { maxRetries: 10 },
  });

  client.on('error', (err) => {
    console.error(`[client error] ${err.message}`);
  });

  await client.connect();
  const bucket = client.store.bucket('users');

  // Safe insert with error handling
  async function createUser(name: string) {
    try {
      return await bucket.insert({ name });
    } catch (err) {
      if (err instanceof NoexClientError) {
        switch (err.code) {
          case 'VALIDATION_ERROR':
            console.log(`Invalid input: ${err.message}`);
            return null;
          case 'ALREADY_EXISTS':
            console.log(`User "${name}" already exists`);
            return null;
          case 'RATE_LIMITED':
            console.log('Rate limited — waiting...');
            await new Promise((r) => setTimeout(r, 2_000));
            return bucket.insert({ name }); // Retry once
          default:
            console.log(`Server error [${err.code}]: ${err.message}`);
            return null;
        }
      }
      if (err instanceof DisconnectedError) {
        console.log('Not connected — cannot create user');
        return null;
      }
      throw err; // Unknown error — rethrow
    }
  }

  await createUser('Alice');
  await createUser('Bob');

  // Safe read with retry
  async function getUsers() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await bucket.all();
      } catch (err) {
        if (err instanceof TimeoutError && attempt < 2) {
          console.log(`Timeout, retrying (${attempt + 1}/2)...`);
          continue;
        }
        throw err;
      }
    }
  }

  const users = await getUsers();
  console.log('Users:', users);

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Build a `SafeBucket` wrapper class that:
1. Wraps a `BucketAPI` instance
2. Provides `safeGet(key)` — returns `null` instead of throwing on `NOT_FOUND`
3. Provides `safeInsert(data)` — retries once on `RATE_LIMITED`, returns `null` on `ALREADY_EXISTS`
4. Provides `safeAll()` — retries up to 3 times on `TIMEOUT`

<details>
<summary>Solution</summary>

```typescript
import {
  NoexClientError,
  TimeoutError,
  type BucketAPI,
} from '@hamicek/noex-client';

class SafeBucket<T extends Record<string, unknown>> {
  constructor(private readonly bucket: BucketAPI<T>) {}

  async safeGet(key: unknown): Promise<(T & Record<string, unknown>) | null> {
    try {
      return await this.bucket.get(key);
    } catch (err) {
      if (err instanceof NoexClientError && err.code === 'NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  async safeInsert(data: T): Promise<(T & Record<string, unknown>) | null> {
    try {
      return await this.bucket.insert(data);
    } catch (err) {
      if (err instanceof NoexClientError) {
        if (err.code === 'ALREADY_EXISTS') return null;
        if (err.code === 'RATE_LIMITED') {
          await new Promise((r) => setTimeout(r, 1_000));
          return this.bucket.insert(data); // Retry once (no catch — let it throw)
        }
      }
      throw err;
    }
  }

  async safeAll(): Promise<Array<T & Record<string, unknown>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.bucket.all();
      } catch (err) {
        lastError = err;
        if (!(err instanceof TimeoutError)) throw err;
        // TimeoutError — retry
      }
    }
    throw lastError;
  }
}

// Usage
// const safe = new SafeBucket(client.store.bucket('users'));
// const user = await safe.safeGet('nonexistent'); // null, not an error
// const all = await safe.safeAll(); // Retries up to 3x on timeout
```

</details>

## Summary

- **Idempotent operations** (get, all, where, count, delete) are safe to retry; **insert and emit are not**
- Check `err.code` to decide the right recovery strategy per error type
- **Don't retry** validation errors, auth errors, or "not defined" errors — fix the root cause
- **Do retry** timeouts, rate limits, and internal errors — with appropriate delays
- Wait for the `connected` event instead of busy-retrying during `DisconnectedError`
- Subscription callback errors during initial data delivery reject the `subscribe()` promise
- Subscription callback errors during push updates are caught and logged — the subscription stays alive
- Build graceful degradation with cached data for periods when the server is unreachable
- Map error codes to user-friendly messages for UI applications

---

Next: [Test Setup](../10-testing/01-test-setup.md)
