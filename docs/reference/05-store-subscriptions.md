# Store Subscriptions

Reactive query subscriptions allow the client to receive real-time updates whenever server-side data changes. This document covers the full subscription lifecycle — from establishing a subscription through initial data delivery, push updates, unsubscribe, and automatic reconnect recovery.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const store = client.store;
```

Relevant types:

```typescript
import type { Unsubscribe } from '@hamicek/noex-client';
```

---

## Subscription Lifecycle

### 1. Subscribe

Calling `store.subscribe()` sends a `store.subscribe` request to the server. The server registers the subscription, evaluates the query immediately, and returns the initial result together with a unique `subscriptionId`.

### 2. Initial Data Delivery

The callback is invoked **synchronously** with the initial data before the `subscribe()` promise resolves. This guarantees that by the time `await` completes, your callback has already processed the first result.

If the callback throws during initial data delivery, the subscription is automatically cleaned up — both locally and on the server — and the error is re-thrown to the caller.

### 3. Push Updates

Whenever the underlying data changes, the server sends a push message:

```json
{
  "type": "push",
  "subscriptionId": "sub_abc123",
  "channel": "subscription",
  "data": { ... }
}
```

The `PushRouter` routes the message to the `SubscriptionManager`, which invokes the registered callback with the new data. If the callback throws, the error is logged to `console.error` but the subscription remains active.

### 4. Unsubscribe

Calling the returned `Unsubscribe` function removes the local registration and sends a fire-and-forget `store.unsubscribe` request to the server. The function is synchronous — it does not wait for server confirmation.

### 5. Disconnect

When the client disconnects intentionally via `client.disconnect()`, all subscriptions are cleared immediately. No server-side unsubscribe requests are sent — the server cleans up subscriptions when the WebSocket closes.

---

## Methods

### store.subscribe()

```typescript
subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>
subscribe(query: string, params: Record<string, unknown>, callback: (data: unknown) => void): Promise<Unsubscribe>
```

Subscribes to a server-side reactive query.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | `string` | yes | Server-side query name |
| params | `Record<string, unknown>` | no | Query parameters passed to the server |
| callback | `(data: unknown) => void` | yes | Called with initial data and on every subsequent push |

**Returns:** `Promise<Unsubscribe>` — resolves to a synchronous unsubscribe function `() => void`

**Throws:**
- `NoexClientError` if the query name is invalid or the server rejects the subscription
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected
- Re-throws any error thrown by `callback` during initial data delivery (subscription is cleaned up automatically)

**Example — basic subscription:**

```typescript
const unsubscribe = await store.subscribe('activeUsers', (data) => {
  console.log('Active users:', data);
});

// Stop receiving updates
unsubscribe();
```

**Example — subscription with parameters:**

```typescript
const unsub = await store.subscribe(
  'usersByRole',
  { role: 'admin' },
  (data) => {
    console.log('Admins:', data);
  },
);
```

**Example — error handling in callback:**

```typescript
try {
  await store.subscribe('query', (data) => {
    // If this throws during initial delivery, the subscription
    // is cleaned up and the error propagates to the caller.
    processData(data);
  });
} catch (err) {
  console.error('Subscription failed:', err);
}
```

---

### Unsubscribe function

```typescript
const unsubscribe: Unsubscribe = await store.subscribe('query', callback);
unsubscribe(); // synchronous, returns void
```

The `Unsubscribe` function returned by `subscribe()`:

1. Removes the subscription from the local `SubscriptionManager`
2. Sends a `store.unsubscribe` request to the server (fire-and-forget)
3. Returns `void` synchronously — does not wait for server confirmation

Calling the function multiple times is safe — the second call is a no-op on the server side.

---

### store.unsubscribe()

```typescript
unsubscribe(subscriptionId: string): Promise<void>
```

Unsubscribes by server-assigned subscription ID. This is an advanced method — prefer the `Unsubscribe` function returned by `subscribe()` for normal use.

Unlike the `Unsubscribe` function, this method awaits the server response.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| subscriptionId | `string` | yes | Server-assigned subscription ID |

**Returns:** `Promise<void>`

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

---

## Reconnect Recovery

When the client reconnects after a connection loss, all active subscriptions are automatically restored via `SubscriptionManager.resubscribeAll()`.

### Recovery sequence

1. The WebSocket connection is re-established
2. If auto-login is configured and the server requires auth, the client re-authenticates
3. `resubscribeAll()` iterates over all registered subscriptions and for each one:
   - Sends the original `store.subscribe` request (same query and params)
   - Updates the local mapping with the new `subscriptionId` assigned by the server
   - Delivers fresh data to the callback (if the server returns initial data)
4. If a resubscription fails, that subscription is removed from the local registry and logged to `console.error`
5. The `reconnected` event is emitted after all subscriptions are restored

### Important details

- The server assigns a **new `subscriptionId`** on each resubscribe — the old ID is no longer valid
- The callback receives fresh data, not a diff from the previous state
- Subscriptions that fail to resubscribe are silently dropped — no error is thrown to the user
- The original `Unsubscribe` function remains valid and will correctly unsubscribe the new server-side subscription

**Example — observing reconnect:**

```typescript
client.on('reconnected', () => {
  console.log('Reconnected — subscriptions restored automatically');
});

const unsub = await store.subscribe('liveData', (data) => {
  // This callback receives data both during normal operation
  // and after reconnect recovery with fresh server data.
  renderDashboard(data);
});
```

---

## Push Message Protocol

Store push messages use the `subscription` channel:

```typescript
// Server → Client
{
  type: 'push',
  subscriptionId: string,  // server-assigned ID
  channel: 'subscription', // distinguishes store pushes from rules event pushes
  data: unknown            // query result
}
```

The `PushRouter` inspects incoming messages. If `type === 'push'`, it extracts the `subscriptionId` and `channel`, then delegates to the `SubscriptionManager.handlePush()` method which invokes the registered callback.

---

## Internal Types

### SubscriptionEntry

Internal type used by the `SubscriptionManager` to track active subscriptions:

```typescript
interface SubscriptionEntry {
  id: string;                              // server-assigned subscriptionId (updated on reconnect)
  channel: 'subscription' | 'event';       // 'subscription' for store, 'event' for rules
  callback: (data: unknown) => void;       // user-provided callback
  resubscribe: {
    type: string;                          // request type, e.g. 'store.subscribe'
    payload: Record<string, unknown>;      // original request payload (query, params)
  };
}
```

The `resubscribe` field stores the original request so the subscription can be transparently restored after reconnect.

---

## See Also

- [Store API](./03-store-api.md) — `subscribe()`, `unsubscribe()`, and other store methods
- [NoexClient](./01-noex-client.md) — connection lifecycle and `on()` events
- [Transport](./08-transport.md) — reconnect strategy, exponential backoff, heartbeat
- [Configuration](./02-configuration.md) — `requestTimeoutMs`, `reconnect` options
- [Types](./09-types.md) — `Unsubscribe`
- [Errors](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
