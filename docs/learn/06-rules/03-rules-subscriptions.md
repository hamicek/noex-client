# Rules Subscriptions

Rules subscriptions let you receive **real-time event notifications** from the rule engine. When you subscribe with a topic pattern, the server pushes every matching event to your callback as it's processed. This is conceptually similar to store subscriptions but with important differences: rules subscriptions use the `event` push channel, do **not** deliver initial data, and the callback receives a `RulesEvent` object with the matching topic.

## What You'll Learn

- How to subscribe to rule engine events with `rules.subscribe()`
- How topic pattern matching works
- The difference between rules subscriptions and store subscriptions
- How to manage multiple concurrent subscriptions
- How unsubscribe works (synchronous, fire-and-forget)

## Rules vs Store Subscriptions

| | Store Subscriptions | Rules Subscriptions |
|---|---------------------|---------------------|
| **Subscribe to** | Named server-side query | Topic pattern |
| **Initial data** | Yes — callback receives current query result | No — only future events |
| **Push channel** | `subscription` | `event` |
| **Callback signature** | `(data: unknown) => void` | `(event: RulesEvent, topic: string) => void` |
| **Push content** | Full query result (re-evaluated) | Individual event that matched the pattern |
| **Reconnect recovery** | Resubscribes + delivers initial data | Resubscribes only — no replay of missed events |

## rules.subscribe()

Subscribe to events matching a topic pattern:

```typescript
const unsubscribe = await client.rules.subscribe('order.*', (event, topic) => {
  console.log(`Event on ${topic}:`, event.data);
});
```

**Signature:**

```typescript
subscribe(
  pattern: string,
  callback: (event: RulesEvent, topic: string) => void,
): Promise<Unsubscribe>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| pattern | `string` | Topic pattern to match (e.g. `'order.*'`) |
| callback | `(event: RulesEvent, topic: string) => void` | Called with each matching event and its topic |

Returns `Promise<Unsubscribe>` — a synchronous function `() => void` that stops the subscription.

## No Initial Data

Unlike store subscriptions, rules subscriptions do **not** deliver initial data. The callback is only invoked when new events arrive after the subscription is established:

```typescript
const events: RulesEvent[] = [];

const unsub = await client.rules.subscribe('order.*', (event) => {
  events.push(event);
});

// At this point, events is empty — no initial delivery
console.log(events.length); // 0

// Only after emitting will the callback fire
await client.rules.emit('order.created', { orderId: '1' });
// events.length === 1 (after the push arrives)
```

## Topic Pattern Matching

The `*` wildcard matches any single segment of the topic (segments are separated by `.`):

```typescript
// Matches: order.created, order.shipped, order.cancelled
await client.rules.subscribe('order.*', (event, topic) => {
  console.log(`Order event: ${topic}`);
});

// Matches: user.registered
await client.rules.subscribe('user.*', (event, topic) => {
  console.log(`User event: ${topic}`);
});

// Matches everything (single-segment topics)
await client.rules.subscribe('*', (event, topic) => {
  console.log(`Any event: ${topic}`);
});
```

Events that don't match the pattern are not delivered:

```typescript
const received: string[] = [];

const unsub = await client.rules.subscribe('order.*', (_event, topic) => {
  received.push(topic);
});

await client.rules.emit('order.created', {});  // → delivered
await client.rules.emit('user.login', {});      // → NOT delivered
await client.rules.emit('order.shipped', {});   // → delivered

// received === ['order.created', 'order.shipped']
unsub();
```

## Unsubscribe

The `Unsubscribe` function returned by `subscribe()` is **synchronous** and returns `void`:

```typescript
const unsubscribe = await client.rules.subscribe('order.*', callback);

// Later — stop receiving events
unsubscribe();
```

When called:
1. The subscription is immediately removed from the local `SubscriptionManager`
2. A `rules.unsubscribe` request is sent to the server (fire-and-forget — errors are silently caught)
3. No further events are delivered to the callback

Calling `unsubscribe()` multiple times is safe — subsequent calls are no-ops.

## Multiple Concurrent Subscriptions

You can have multiple active subscriptions with different patterns. Each operates independently:

```typescript
const orderUnsub = await client.rules.subscribe('order.*', (event, topic) => {
  console.log(`[order] ${topic}:`, event.data);
});

const userUnsub = await client.rules.subscribe('user.*', (event, topic) => {
  console.log(`[user] ${topic}:`, event.data);
});

// Both receive their respective events independently
await client.rules.emit('order.created', { orderId: '1' });
await client.rules.emit('user.registered', { userId: 'u1' });

// Unsubscribing one doesn't affect the other
orderUnsub();
// user subscription still active
await client.rules.emit('user.login', { userId: 'u1' });
// [user] callback fires — [order] does not

userUnsub();
```

## Reconnect Recovery

Rules subscriptions are automatically restored when the client reconnects. The SDK re-sends the `rules.subscribe` request with the original pattern and the server assigns a new `subscriptionId`:

```typescript
client.on('reconnected', () => {
  console.log('Reconnected — rules subscriptions restored automatically');
});

const unsub = await client.rules.subscribe('order.*', (event, topic) => {
  // This callback works during normal operation AND after reconnect.
  // Any events emitted while disconnected are lost — no replay.
  handleOrderEvent(event, topic);
});
```

After reconnect:
- The subscription is re-established with the same pattern
- No initial data is delivered (rules subscriptions never deliver initial data)
- Events that occurred while disconnected are **not** replayed
- If resubscription fails, the subscription is silently removed and logged to `console.error`

## Complete Working Example

An order monitoring system that logs all order events in real time:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { RulesEvent } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Subscribe to all order events
  const unsub = await client.rules.subscribe('order.*', (event: RulesEvent, topic: string) => {
    const time = new Date(event.timestamp).toISOString();
    console.log(`[${time}] ${topic}:`, JSON.stringify(event.data));
    if (event.correlationId) {
      console.log(`  correlation: ${event.correlationId}`);
    }
  });

  // Simulate order lifecycle
  const placed = await client.rules.emit('order.placed', {
    orderId: 'ORD-1',
    total: 150,
  });

  await client.rules.emit(
    'order.paid',
    { orderId: 'ORD-1', method: 'card' },
    placed.id,
    placed.id,
  );

  await client.rules.emit(
    'order.shipped',
    { orderId: 'ORD-1', carrier: 'FedEx' },
    placed.id,
  );

  // Wait for all pushes to arrive
  await new Promise((r) => setTimeout(r, 500));

  // Clean up
  unsub();
  await client.disconnect();
}

main().catch(console.error);
```

Output:

```
[2025-01-15T10:00:00.050Z] order.placed: {"orderId":"ORD-1","total":150}
[2025-01-15T10:00:00.100Z] order.paid: {"orderId":"ORD-1","method":"card"}
  correlation: evt-abc123
[2025-01-15T10:00:00.150Z] order.shipped: {"orderId":"ORD-1","carrier":"FedEx"}
  correlation: evt-abc123
```

## Exercise

Write a script that:
1. Creates two subscriptions: one for `order.*` events and one for `payment.*` events
2. Collects events into two separate arrays
3. Emits `order.created`, `payment.received`, and `order.shipped`
4. Waits for pushes, then verifies:
   - The order array has 2 events (`order.created`, `order.shipped`)
   - The payment array has 1 event (`payment.received`)
5. Unsubscribes from orders only, emits `order.cancelled`, and verifies the order array is still 2

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { RulesEvent } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const orderEvents: Array<{ event: RulesEvent; topic: string }> = [];
  const paymentEvents: Array<{ event: RulesEvent; topic: string }> = [];

  // 1. Subscribe to both patterns
  const unsubOrders = await client.rules.subscribe('order.*', (event, topic) => {
    orderEvents.push({ event, topic });
  });

  const unsubPayments = await client.rules.subscribe('payment.*', (event, topic) => {
    paymentEvents.push({ event, topic });
  });

  // 3. Emit events
  await client.rules.emit('order.created', { orderId: '1' });
  await client.rules.emit('payment.received', { amount: 100 });
  await client.rules.emit('order.shipped', { orderId: '1' });

  // 4. Wait and verify
  await new Promise((r) => setTimeout(r, 500));

  console.log('Order events:', orderEvents.length);   // 2
  console.log('Payment events:', paymentEvents.length); // 1
  console.log('Order topics:', orderEvents.map((e) => e.topic));
  // ['order.created', 'order.shipped']

  // 5. Unsubscribe orders, emit one more
  unsubOrders();
  await client.rules.emit('order.cancelled', { orderId: '1' });
  await new Promise((r) => setTimeout(r, 200));

  console.log('Order events after unsub:', orderEvents.length); // still 2

  unsubPayments();
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `rules.subscribe(pattern, callback)` subscribes to rule engine events matching the pattern
- No initial data is delivered — the callback fires only on new events
- The callback receives `(event: RulesEvent, topic: string)` — both the event and the matched topic
- The returned `Unsubscribe` function is synchronous and fire-and-forget
- Multiple subscriptions with different patterns work independently
- Unsubscribing one pattern does not affect others
- Subscriptions are automatically restored on reconnect (no replay of missed events)
- The push channel is `event` (distinct from store's `subscription` channel)

---

Next: [Login & Logout](../07-authentication/01-login-logout.md)
