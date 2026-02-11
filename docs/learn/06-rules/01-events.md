# Events

The rule engine processes **events** — messages published to a topic that trigger server-side rules. The client SDK provides `rules.emit()` to publish events and receive the server-created event object with its assigned `id`, `timestamp`, and `source`. Events can be linked together using correlation and causation IDs, enabling end-to-end tracing of event chains.

## What You'll Learn

- How to emit events into the rule engine with `rules.emit()`
- The structure of the returned `RulesEvent` object
- How to trace related events with `correlationId` and `causationId`
- Error handling when the rule engine is unavailable

## How Events Work

Events flow from the client to the server-side rule engine:

```
Client                          Server
┌──────────────┐  rules.emit   ┌───────────────────────┐
│ rules.emit() │──────────────>│ Rule Engine            │
│              │               │ ┌───────────────────┐  │
│              │               │ │ Assign id, ts     │  │
│              │               │ │ Evaluate rules    │  │
│              │  RulesEvent   │ │ Return event      │  │
│              │<──────────────│ └───────────────────┘  │
└──────────────┘               └───────────────────────┘
```

Key points:
- The event is persisted and processed by the rule engine on the server
- All matching rules are evaluated before the response is returned
- The returned `RulesEvent` includes a server-assigned `id` and `timestamp`
- Events without `data` are valid — the topic alone can carry meaning

## rules.emit()

The basic form takes a topic and optional data:

```typescript
const event = await client.rules.emit('order.created', { orderId: '100' });
console.log(event.id);        // server-assigned unique ID
console.log(event.timestamp); // server-assigned timestamp
console.log(event.topic);     // 'order.created'
console.log(event.data);      // { orderId: '100' }
```

**Signature:**

```typescript
emit(
  topic: string,
  data?: Record<string, unknown>,
  correlationId?: string,
  causationId?: string,
): Promise<RulesEvent>
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| topic | `string` | yes | Event topic (e.g. `'order.created'`, `'user.login'`) |
| data | `Record<string, unknown>` | no | Arbitrary event payload |
| correlationId | `string` | no | Correlation ID for tracing related events |
| causationId | `string` | no | ID of the causing event (requires `correlationId`) |

Returns `Promise<RulesEvent>` — the server-created event.

## RulesEvent

Every emitted event returns a `RulesEvent` object:

```typescript
interface RulesEvent {
  readonly id: string;
  readonly topic: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly source: string;
}
```

| Field | Description |
|-------|-------------|
| `id` | Server-assigned unique identifier |
| `topic` | The topic the event was emitted to |
| `data` | The payload passed to `emit()` (empty object `{}` if omitted) |
| `timestamp` | Server-assigned timestamp (Unix ms) |
| `correlationId` | Correlation ID if provided |
| `causationId` | Causation ID if provided |
| `source` | Identifier of the event source (e.g. client connection) |

## Emitting Without Data

The `data` parameter is optional. A topic-only event is useful for simple signals:

```typescript
const ping = await client.rules.emit('system.ping');
console.log(ping.topic); // 'system.ping'
```

## Correlation and Causation

When events form a chain — e.g. an order triggers a payment which triggers a shipment — you can trace the chain with `correlationId` and `causationId`:

```
Order placed ──────> Payment processed ──────> Shipment created
correlationId: 'tx-1'   correlationId: 'tx-1'    correlationId: 'tx-1'
causationId: —           causationId: order.id     causationId: payment.id
```

```typescript
// Step 1: Start the chain with a correlationId
const order = await client.rules.emit(
  'order.placed',
  { orderId: 'ORD-42', total: 99.90 },
  'tx-1',
);

// Step 2: Continue the chain — reference the order as the cause
const payment = await client.rules.emit(
  'payment.processed',
  { orderId: 'ORD-42', amount: 99.90 },
  'tx-1',
  order.id,
);

// Step 3: Complete the chain — reference the payment as the cause
const shipment = await client.rules.emit(
  'shipment.created',
  { orderId: 'ORD-42', carrier: 'DHL' },
  'tx-1',
  payment.id,
);

// All three share correlationId 'tx-1'
// Each points to the previous event via causationId
```

The `causationId` parameter requires `correlationId` to be set — you cannot have a causation without a correlation context.

## Error Handling

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await client.rules.emit('order.created', { orderId: '100' });
} catch (err) {
  if (err instanceof NoexClientError) {
    // VALIDATION_ERROR — empty topic, invalid data
    // RULES_NOT_AVAILABLE — server has no rule engine configured
    console.log(err.code, err.message);
  }
  if (err instanceof TimeoutError) {
    console.log('Server did not respond in time');
  }
  if (err instanceof DisconnectedError) {
    console.log('Not connected to server');
  }
}
```

The `RULES_NOT_AVAILABLE` error occurs when the server is started without a rule engine. Your client code should handle this case if the rule engine is an optional component in your architecture.

## Complete Working Example

An order processing pipeline with correlated events:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Emit an order event
  const order = await client.rules.emit('order.placed', {
    orderId: 'ORD-1',
    items: ['widget', 'gadget'],
    total: 49.99,
  });

  console.log(`Order event: ${order.id} at ${new Date(order.timestamp).toISOString()}`);

  // Emit a correlated payment event
  const payment = await client.rules.emit(
    'payment.completed',
    { orderId: 'ORD-1', method: 'card' },
    order.id, // use the order event ID as correlation ID
    order.id, // the order event caused this payment
  );

  console.log(`Payment event: ${payment.id}`);
  console.log(`  correlationId: ${payment.correlationId}`);
  console.log(`  causationId: ${payment.causationId}`);

  // Emit a simple signal — no data needed
  await client.rules.emit('system.health-check');

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Emits a `user.registered` event with `{ userId: 'u1', name: 'Alice' }`
2. Emits a `welcome.email.sent` event correlated to the registration, using the registration event's `id` as both `correlationId` and `causationId`
3. Logs both events' `id`, `topic`, and `correlationId`

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const registration = await client.rules.emit('user.registered', {
    userId: 'u1',
    name: 'Alice',
  });

  console.log(`Registration: id=${registration.id}, topic=${registration.topic}`);

  const welcome = await client.rules.emit(
    'welcome.email.sent',
    { userId: 'u1', email: 'alice@example.com' },
    registration.id,
    registration.id,
  );

  console.log(`Welcome: id=${welcome.id}, topic=${welcome.topic}`);
  console.log(`  correlationId: ${welcome.correlationId}`);

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `rules.emit(topic, data?, correlationId?, causationId?)` publishes an event to the rule engine
- The returned `RulesEvent` contains a server-assigned `id`, `timestamp`, and `source`
- `data` is optional — topic-only events are valid for simple signals
- Use `correlationId` to group related events and `causationId` to build causation chains
- `causationId` requires `correlationId` to be set
- The server evaluates all matching rules before returning the response
- `RULES_NOT_AVAILABLE` is thrown when the server has no rule engine configured

---

Next: [Facts](./02-facts.md)
