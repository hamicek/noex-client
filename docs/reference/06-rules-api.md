# Rules API

The `RulesAPI` class provides access to the server-side rule engine — emitting events, managing facts, and subscribing to real-time event notifications. It is available as the `rules` property on `NoexClient`.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const rules = client.rules;
```

Relevant types:

```typescript
import type {
  RulesEvent,
  Fact,
  RulesStats,
  Unsubscribe,
} from '@hamicek/noex-client';
```

---

## Events

### emit()

```typescript
emit(
  topic: string,
  data?: Record<string, unknown>,
  correlationId?: string,
  causationId?: string,
): Promise<RulesEvent>
```

Emits an event into the rule engine. The server evaluates all matching rules and returns the created event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| topic | `string` | yes | Event topic (e.g. `'user.login'`, `'order.placed'`) |
| data | `Record<string, unknown>` | no | Arbitrary event payload |
| correlationId | `string` | no | Correlation ID for tracing related events |
| causationId | `string` | no | ID of the event that caused this one (requires `correlationId`) |

**Returns:** `Promise<RulesEvent>` — the server-created event with assigned `id`, `timestamp`, and `source`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `topic` is empty or `data` is not an object
- `NoexClientError` with code `RULES_NOT_AVAILABLE` if the rule engine is not running
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example — basic event:**

```typescript
const event = await rules.emit('user.login', { userId: '42' });
console.log(event.id, event.timestamp);
```

**Example — correlated events:**

```typescript
const order = await rules.emit('order.placed', { orderId: '100' }, 'corr-1');
await rules.emit('payment.processed', { orderId: '100' }, 'corr-1', order.id);
```

---

## Facts

### setFact()

```typescript
setFact(key: string, value: unknown): Promise<Fact>
```

Sets a fact in the rule engine's fact store. If a fact with the given key already exists, its value and version are updated.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| key | `string` | yes | Fact key (e.g. `'user:42:role'`) |
| value | `unknown` | yes | Fact value (any JSON-serializable value) |

**Returns:** `Promise<Fact>` — the created or updated fact with `key`, `value`, `timestamp`, `source`, and `version`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `key` is empty or `value` is missing
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const fact = await rules.setFact('user:42:role', 'admin');
console.log(fact.version); // 1 (increments on each update)
```

---

### getFact()

```typescript
getFact(key: string): Promise<unknown | null>
```

Retrieves the value of a fact by key. Returns `null` if the fact does not exist.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| key | `string` | yes | Fact key |

**Returns:** `Promise<unknown | null>` — the fact value, or `null` if not found

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `key` is empty
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const role = await rules.getFact('user:42:role');
if (role !== null) {
  console.log('User role:', role);
}
```

---

### deleteFact()

```typescript
deleteFact(key: string): Promise<boolean>
```

Deletes a fact by key. Returns `true` if the fact existed and was deleted, `false` otherwise.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| key | `string` | yes | Fact key to delete |

**Returns:** `Promise<boolean>` — `true` if deleted, `false` if the fact did not exist

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `key` is empty
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const deleted = await rules.deleteFact('user:42:role');
console.log(deleted); // true
```

---

### queryFacts()

```typescript
queryFacts(pattern: string): Promise<Fact[]>
```

Queries facts matching a glob-like pattern. The pattern uses `:` as a segment separator, where `*` matches a single segment.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| pattern | `string` | yes | Glob pattern (e.g. `'user:*:role'`) |

**Returns:** `Promise<Fact[]>` — array of matching facts

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `pattern` is empty
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Pattern matching rules:**

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `user:*` | `user:1`, `user:42` | `user:1:role` |
| `user:*:role` | `user:1:role`, `user:42:role` | `user:1`, `user:1:name` |
| `config:*` | `config:theme`, `config:lang` | `config:ui:theme` |

**Example:**

```typescript
const roles = await rules.queryFacts('user:*:role');
for (const fact of roles) {
  console.log(`${fact.key} = ${fact.value}`);
}
```

---

### getAllFacts()

```typescript
getAllFacts(): Promise<Fact[]>
```

Returns all facts currently stored in the rule engine.

**Returns:** `Promise<Fact[]>` — array of all facts

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const facts = await rules.getAllFacts();
console.log(`Total facts: ${facts.length}`);
```

---

## Subscriptions

### subscribe()

```typescript
subscribe(
  pattern: string,
  callback: (event: RulesEvent, topic: string) => void,
): Promise<Unsubscribe>
```

Subscribes to rule engine events matching a topic pattern. The callback is invoked whenever the server processes an event whose topic matches the given pattern.

Unlike store subscriptions, rules subscriptions do **not** deliver initial data — the callback is only called on future events.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| pattern | `string` | yes | Topic pattern to match (e.g. `'order.*'`) |
| callback | `(event: RulesEvent, topic: string) => void` | yes | Called with the event and its topic on each match |

**Returns:** `Promise<Unsubscribe>` — resolves to a synchronous unsubscribe function `() => void`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `pattern` is empty
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const unsubscribe = await rules.subscribe('order.*', (event, topic) => {
  console.log(`Event on ${topic}:`, event.data);
});

// Trigger an event — the callback above will be invoked
await rules.emit('order.placed', { orderId: '100' });

// Stop receiving events
unsubscribe();
```

### Unsubscribe function

```typescript
const unsubscribe: Unsubscribe = await rules.subscribe('order.*', callback);
unsubscribe(); // synchronous, returns void
```

The `Unsubscribe` function returned by `subscribe()`:

1. Removes the subscription from the local `SubscriptionManager`
2. Sends a `rules.unsubscribe` request to the server (fire-and-forget)
3. Returns `void` synchronously — does not wait for server confirmation

Calling the function multiple times is safe — the second call is a no-op on the server side.

---

### unsubscribe()

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
- `NoexClientError` with code `NOT_FOUND` if the subscription does not exist
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

---

## Stats

### stats()

```typescript
stats(): Promise<RulesStats>
```

Returns runtime statistics from the rule engine.

**Returns:** `Promise<RulesStats>` — engine statistics including rule count, fact count, events processed, and optional tracing/profiling/audit/versioning/baseline sections

**Throws:**
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const stats = await rules.stats();
console.log(`Rules: ${stats.rulesCount}, Facts: ${stats.factsCount}`);
console.log(`Events processed: ${stats.eventsProcessed}`);
```

---

## Push Message Protocol

Rules event push messages use the `event` channel:

```typescript
// Server → Client
{
  type: 'push',
  subscriptionId: string,  // server-assigned ID
  channel: 'event',        // distinguishes rules pushes from store subscription pushes
  data: {
    topic: string,         // the event topic that matched the pattern
    event: RulesEvent      // the full event object
  }
}
```

The `PushRouter` inspects incoming messages. If `type === 'push'` and `channel === 'event'`, the message is routed to the `SubscriptionManager`, which extracts `topic` and `event` from `data` and invokes the registered callback as `callback(event, topic)`.

---

## Reconnect Recovery

Rules subscriptions are automatically restored when the client reconnects. The `SubscriptionManager.resubscribeAll()` method re-sends the original `rules.subscribe` request with the same pattern, and the server assigns a new `subscriptionId`.

Unlike store subscriptions, rules resubscription does **not** deliver initial data — the callback will only be invoked on new events after the reconnect.

If a resubscription fails, that subscription is silently removed from the local registry and logged to `console.error`.

**Example:**

```typescript
client.on('reconnected', () => {
  console.log('Reconnected — rules subscriptions restored automatically');
});

const unsub = await rules.subscribe('order.*', (event, topic) => {
  // Invoked on new events during normal operation and after reconnect.
  handleOrderEvent(event, topic);
});
```

---

## Types

### RulesEvent

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

### Fact

```typescript
interface Fact {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly source: string;
  readonly version: number;
}
```

### RulesStats

```typescript
interface RulesStats {
  readonly rulesCount: number;
  readonly factsCount: number;
  readonly timersCount: number;
  readonly eventsProcessed: number;
  readonly rulesExecuted: number;
  readonly avgProcessingTimeMs: number;
  readonly tracing?: {
    readonly enabled: boolean;
    readonly entriesCount: number;
    readonly maxEntries: number;
  };
  readonly profiling?: {
    readonly totalRulesProfiled: number;
    readonly totalTriggers: number;
    readonly totalExecutions: number;
    readonly totalTimeMs: number;
    readonly avgRuleTimeMs: number;
    readonly slowestRule: { readonly ruleId: string; readonly ruleName: string; readonly avgTimeMs: number } | null;
    readonly hottestRule: { readonly ruleId: string; readonly ruleName: string; readonly triggerCount: number } | null;
  };
  readonly audit?: {
    readonly totalEntries: number;
    readonly memoryEntries: number;
    readonly oldestEntry: number | null;
    readonly newestEntry: number | null;
    readonly entriesByCategory: Readonly<Record<string, number>>;
    readonly subscribersCount: number;
  };
  readonly versioning?: {
    readonly trackedRules: number;
    readonly totalVersions: number;
    readonly dirtyRules: number;
    readonly oldestEntry: number | null;
    readonly newestEntry: number | null;
  };
  readonly baseline?: {
    readonly metricsCount: number;
    readonly totalRecalculations: number;
    readonly anomaliesDetected: number;
  };
}
```

---

## See Also

- [NoexClient](./01-noex-client.md) — connection lifecycle, `rules` property, `on()` events
- [Store Subscriptions](./05-store-subscriptions.md) — store subscription lifecycle (for comparison with rules subscriptions)
- [Transport](./08-transport.md) — reconnect strategy, exponential backoff
- [Configuration](./02-configuration.md) — `requestTimeoutMs`, `reconnect` options
- [Types](./09-types.md) — `RulesEvent`, `Fact`, `RulesStats`, `Unsubscribe`
- [Errors](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
