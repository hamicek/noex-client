# Subscription Recovery

When the connection drops and the SDK reconnects, all active subscriptions are **automatically restored**. The server assigns new subscription IDs, the SDK updates its internal mappings, and your callbacks continue receiving data — no manual intervention required.

## What You'll Learn

- How the SDK restores subscriptions after a reconnect
- What happens to subscription IDs, callbacks, and data
- The difference between store and rules subscription recovery
- How failed resubscriptions are handled
- Best practices for writing reconnect-safe subscription code

## How It Works

The `SubscriptionManager` keeps a registry of all active subscriptions. Each entry stores:

- The current `id` (server-assigned subscription ID)
- The `channel` (`'subscription'` for store, `'event'` for rules)
- The `callback` function
- The `resubscribe` payload (request type + params needed to recreate the subscription)

After a successful reconnect, the SDK calls `resubscribeAll()`, which replays every registered subscription against the new connection:

```
Connection restored
   │
   ├─ Re-authenticate (if auth.token configured)
   │
   └─ For each active subscription:
       ├─ Send the original subscribe request (store.subscribe or rules.subscribe)
       ├─ Server returns a new subscriptionId
       ├─ SDK updates the internal ID mapping (old → new)
       └─ If initial data is returned (store subs), deliver it to the callback
```

## Store Subscription Recovery

Store subscriptions receive **fresh data** on resubscribe. Your callback fires with the current query result, just like the initial subscription:

```typescript
const received: unknown[] = [];

await client.store.subscribe('all-users', (data) => {
  received.push(data);
  console.log('Users:', data);
});

// received: [ [...initial users...] ]

// --- Connection drops, SDK reconnects ---
// After reconnect, callback fires again with current data:
// received: [ [...initial users...], [...current users...] ]
```

This means your UI or data layer always gets a consistent snapshot after reconnect. You don't need to manually refetch.

## Rules Subscription Recovery

Rules subscriptions have **no initial data** — they only fire when matching events are emitted. After reconnect, the subscription is re-registered with the same pattern, and the callback resumes receiving future events:

```typescript
await client.rules.subscribe('user:*', (event, topic) => {
  console.log(`Event on ${topic}:`, event.data);
});

// --- Connection drops, SDK reconnects ---
// No callback fired on resubscribe (rules have no initial data).
// Future events matching 'user:*' will continue to arrive.
```

## Subscription ID Updates

The server assigns a **new subscription ID** after every subscribe request. When you reconnect and resubscribe, the old ID becomes invalid and the SDK transparently swaps it:

```
Before reconnect:
  Subscription 'abc-123' → callback fn

After reconnect:
  Subscription 'abc-123' deleted
  Subscription 'xyz-789' → same callback fn  (new ID from server)
```

This is fully transparent. If you hold a reference to the `unsubscribe` function returned by `store.subscribe()`, it continues to work — it unregisters based on the current (updated) ID.

## Failed Resubscriptions

If a resubscription fails (e.g., the server no longer defines that query), the subscription is **silently removed** from the registry and an error is logged to `console.error`:

```
Failed to resubscribe sub-old-id: NoexClientError: Query 'deleted-query' is not defined
```

The remaining subscriptions continue to be restored. A single failure does not abort the recovery of other subscriptions.

## The Full Reconnect Sequence

Putting it all together with auto-login:

```
1.  Connection lost
2.  Pending requests rejected (DisconnectedError)
3.  Exponential backoff delay
4.  WebSocket reconnection
5.  Server welcome message
6.  Auto-login (if auth.token configured and server requires auth)
7.  resubscribeAll():
    ├─ Store subscription 1 → new ID + callback(freshData)
    ├─ Store subscription 2 → new ID + callback(freshData)
    └─ Rules subscription 1 → new ID (no initial data)
8.  'connected' event
9.  'reconnected' event
10. 'welcome' event
```

Steps 6–7 are critical: authentication must succeed before subscriptions can be restored, because the server rejects operations from unauthenticated connections.

## Complete Working Example

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    auth: { token: 'my-service-token' },
    reconnect: {
      maxRetries: Infinity,
      initialDelayMs: 1_000,
    },
  });

  client.on('reconnecting', (attempt) => {
    console.log(`Reconnecting (attempt ${attempt})...`);
  });

  client.on('reconnected', () => {
    console.log('Reconnected — subscriptions automatically restored');
  });

  await client.connect();

  // Subscribe to a store query
  await client.store.subscribe('active-sessions', (data) => {
    const sessions = data as Array<Record<string, unknown>>;
    console.log(`Active sessions: ${sessions.length}`);
    // This callback fires:
    // 1. On initial subscribe (current data)
    // 2. On every push update (data changed on server)
    // 3. After reconnect (fresh snapshot from resubscribe)
  });

  // Subscribe to rules events
  await client.rules.subscribe('session:*', (event, topic) => {
    console.log(`Session event on ${topic}:`, event.data);
    // This callback fires:
    // 1. On every matching event
    // 2. Resumes after reconnect (no initial delivery)
  });

  console.log('Listening for updates... (Ctrl+C to stop)');
}

main().catch(console.error);
```

## Writing Reconnect-Safe Code

### Callbacks should be idempotent for store subscriptions

After reconnect, your store subscription callback receives a full data snapshot. Make sure your callback handles this correctly — replace the data, don't append to it:

```typescript
// Good — replace state on every callback
let users: User[] = [];
await client.store.subscribe('all-users', (data) => {
  users = data as User[]; // Full replacement
});

// Bad — accumulates duplicates after reconnect
const allData: User[] = [];
await client.store.subscribe('all-users', (data) => {
  allData.push(...(data as User[])); // Duplicates after reconnect!
});
```

### Don't rely on subscription IDs

The SDK manages subscription IDs internally. Use the `unsubscribe` function returned by `subscribe()` instead of tracking IDs:

```typescript
// Good — use the returned unsubscribe function
const unsub = await client.store.subscribe('users', callback);
// Later:
unsub();

// Bad — tracking IDs manually (they change on reconnect)
```

### Handle the gap between disconnect and reconnect

During the reconnect window, you won't receive any push updates. Data changes that happen on the server during this gap are not lost — the resubscribe delivers a fresh snapshot. But you won't see the individual mutations that happened in between.

## Exercise

Write a script that:
1. Connects a client with fast reconnect settings
2. Subscribes to a store query and a rules event pattern
3. Inserts a record to confirm the store subscription works
4. Logs the number of times each subscription callback fires
5. After reconnect, verifies that the store callback received fresh data and the rules callback did not fire on resubscribe

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    reconnect: {
      maxRetries: 10,
      initialDelayMs: 200,
      jitterMs: 0,
    },
  });

  await client.connect();

  let storeCallCount = 0;
  let rulesCallCount = 0;

  // Store subscription — callback fires on initial + push + reconnect
  await client.store.subscribe('all-users', (data) => {
    storeCallCount++;
    const records = data as Array<Record<string, unknown>>;
    console.log(`[store] Call #${storeCallCount}: ${records.length} records`);
  });

  // Rules subscription — callback fires only on matching events
  await client.rules.subscribe('user:*', (event, topic) => {
    rulesCallCount++;
    console.log(`[rules] Call #${rulesCallCount}: ${topic}`);
  });

  console.log(`After initial subscribe: store=${storeCallCount}, rules=${rulesCallCount}`);
  // store=1 (initial data), rules=0 (no initial data for rules)

  // Insert a record — triggers store push
  await client.store.bucket('users').insert({ name: 'Alice' });
  // Wait a moment for push delivery
  await new Promise((r) => setTimeout(r, 500));

  console.log(`After insert: store=${storeCallCount}, rules=${rulesCallCount}`);
  // store=2 (initial + push), rules=0

  // Wait for reconnect to happen (kill the server manually)
  client.on('reconnected', () => {
    // After reconnect, storeCallCount increased (fresh data delivery)
    // rulesCallCount did NOT increase (no initial data for rules)
    console.log(`After reconnect: store=${storeCallCount}, rules=${rulesCallCount}`);
  });

  console.log('Kill the server to test reconnect...');
}

main().catch(console.error);
```

</details>

## Summary

- All active subscriptions are automatically restored after reconnect — no manual code needed
- The SDK replays the original subscribe request for each subscription
- Store subscriptions receive fresh data on resubscribe (callback fires with current snapshot)
- Rules subscriptions resume without initial data (callback fires only on future events)
- Subscription IDs change on reconnect — the SDK updates its internal mappings transparently
- Failed resubscriptions are silently removed and logged to `console.error`
- Authentication runs before subscription recovery, ensuring the server accepts the requests
- Write idempotent callbacks — store subscriptions deliver full snapshots, not diffs

---

Next: [Heartbeat](./03-heartbeat.md)
