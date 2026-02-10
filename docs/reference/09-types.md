# Types

Shared type definitions exported by `noex-client`. All types listed here are available as named exports from the package.

## Import

```typescript
import type {
  ConnectionState,
  Unsubscribe,
  WelcomeInfo,
  StoreRecord,
  RecordMeta,
  PaginatedResult,
  TransactionOp,
  TransactionResult,
  BucketsInfo,
  StoreStats,
  RulesEvent,
  RulesStats,
  Fact,
  AuthSession,
} from '@anthropic/noex-client';
```

---

## Connection

### ConnectionState

```typescript
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
```

Represents the current state of the client connection.

| Value | Description |
|-------|-------------|
| `'connecting'` | Initial connection in progress |
| `'connected'` | Connected and ready to send requests |
| `'reconnecting'` | Connection lost, automatic reconnect in progress |
| `'disconnected'` | Not connected (initial state or after `disconnect()`) |

### Unsubscribe

```typescript
type Unsubscribe = () => void;
```

Function returned by subscription methods. Call it to cancel the subscription. Synchronous — does not return a Promise.

### WelcomeInfo

```typescript
interface WelcomeInfo {
  readonly version: string;
  readonly serverTime: number;
  readonly requiresAuth: boolean;
}
```

Information received from the server upon successful connection.

| Field | Type | Description |
|-------|------|-------------|
| version | `string` | Server protocol version |
| serverTime | `number` | Server timestamp (ms since epoch) |
| requiresAuth | `boolean` | Whether the server requires authentication |

---

## Store

### StoreRecord

```typescript
type StoreRecord = Record<string, unknown>;
```

Base type for store records. All records are plain objects with string keys.

### RecordMeta

```typescript
interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}
```

Metadata automatically attached to every stored record by the server.

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Unique record identifier |
| _version | `number` | Monotonically increasing version number |
| _createdAt | `number` | Creation timestamp (ms since epoch) |
| _updatedAt | `number` | Last update timestamp (ms since epoch) |

### PaginatedResult

```typescript
interface PaginatedResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly records: (T & RecordMeta)[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}
```

Result of a paginated query.

| Field | Type | Description |
|-------|------|-------------|
| records | `(T & RecordMeta)[]` | Records for the current page |
| hasMore | `boolean` | Whether more records exist beyond this page |
| nextCursor | `unknown` | Opaque cursor to pass for the next page |

---

## Transactions

### TransactionOp

```typescript
type TransactionOp =
  | { readonly op: 'get'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'insert'; readonly bucket: string; readonly data: Record<string, unknown> }
  | { readonly op: 'update'; readonly bucket: string; readonly key: unknown; readonly data: Record<string, unknown> }
  | { readonly op: 'delete'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'where'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'findOne'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'count'; readonly bucket: string; readonly filter?: Record<string, unknown> };
```

A single operation within a transaction batch.

| Op | Fields | Description |
|----|--------|-------------|
| `'get'` | `bucket`, `key` | Retrieve a record by key |
| `'insert'` | `bucket`, `data` | Insert a new record |
| `'update'` | `bucket`, `key`, `data` | Update an existing record |
| `'delete'` | `bucket`, `key` | Delete a record |
| `'where'` | `bucket`, `filter` | Query records matching filter |
| `'findOne'` | `bucket`, `filter` | Find first record matching filter |
| `'count'` | `bucket`, `filter?` | Count records (optionally filtered) |

### TransactionResult

```typescript
interface TransactionResult {
  readonly results: ReadonlyArray<{ readonly index: number; readonly data: unknown }>;
}
```

Result of a transaction. Each entry corresponds to one operation from the batch.

| Field | Type | Description |
|-------|------|-------------|
| results | `Array<{ index, data }>` | Ordered results keyed by operation index |

---

## Store Stats

### BucketsInfo

```typescript
interface BucketsInfo {
  readonly count: number;
  readonly names: readonly string[];
}
```

Summary of defined buckets in the store.

| Field | Type | Description |
|-------|------|-------------|
| count | `number` | Number of buckets |
| names | `string[]` | List of bucket names |

### StoreStats

```typescript
interface StoreStats {
  readonly name: string;
  readonly buckets: BucketsInfo;
  readonly records: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly indexes: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly queries: {
    readonly defined: number;
    readonly activeSubscriptions: number;
  };
  readonly persistence: {
    readonly enabled: boolean;
  };
  readonly ttl: {
    readonly enabled: boolean;
    readonly checkIntervalMs: number;
  };
}
```

Comprehensive store statistics returned by `store.stats()`.

| Field | Type | Description |
|-------|------|-------------|
| name | `string` | Store name |
| buckets | `BucketsInfo` | Bucket summary |
| records.total | `number` | Total record count across all buckets |
| records.perBucket | `Record<string, number>` | Record count per bucket |
| indexes.total | `number` | Total index count |
| indexes.perBucket | `Record<string, number>` | Index count per bucket |
| queries.defined | `number` | Number of defined queries |
| queries.activeSubscriptions | `number` | Number of active query subscriptions |
| persistence.enabled | `boolean` | Whether persistence is enabled |
| ttl.enabled | `boolean` | Whether TTL is enabled |
| ttl.checkIntervalMs | `number` | TTL check interval in milliseconds |

---

## Rules

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

An event received from the rules engine via subscription.

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Unique event identifier |
| topic | `string` | Event topic |
| data | `Record<string, unknown>` | Event payload |
| timestamp | `number` | Timestamp (ms since epoch) |
| correlationId | `string?` | Optional correlation ID for tracing |
| causationId | `string?` | Optional causation ID for tracing |
| source | `string` | Event source identifier |

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

A fact from the rules engine fact store.

| Field | Type | Description |
|-------|------|-------------|
| key | `string` | Fact key (hierarchical, e.g. `user:123:status`) |
| value | `unknown` | Fact value |
| timestamp | `number` | Last update timestamp (ms since epoch) |
| source | `string` | Source that set the fact |
| version | `number` | Fact version number |

### RulesStats

```typescript
interface RulesStats {
  readonly rulesCount: number;
  readonly factsCount: number;
  readonly timersCount: number;
  readonly eventsProcessed: number;
  readonly rulesExecuted: number;
  readonly avgProcessingTimeMs: number;
  readonly tracing?: { enabled: boolean; entriesCount: number; maxEntries: number };
  readonly profiling?: { totalRulesProfiled: number; totalTriggers: number; totalExecutions: number; totalTimeMs: number; avgRuleTimeMs: number; slowestRule: { ruleId: string; ruleName: string; avgTimeMs: number } | null; hottestRule: { ruleId: string; ruleName: string; triggerCount: number } | null };
  readonly audit?: { totalEntries: number; memoryEntries: number; oldestEntry: number | null; newestEntry: number | null; entriesByCategory: Readonly<Record<string, number>>; subscribersCount: number };
  readonly versioning?: { trackedRules: number; totalVersions: number; dirtyRules: number; oldestEntry: number | null; newestEntry: number | null };
  readonly baseline?: { metricsCount: number; totalRecalculations: number; anomaliesDetected: number };
}
```

Rules engine statistics returned by `rules.stats()`. Core fields are always present; optional sections depend on server configuration.

| Field | Type | Description |
|-------|------|-------------|
| rulesCount | `number` | Number of registered rules |
| factsCount | `number` | Number of stored facts |
| timersCount | `number` | Number of active timers |
| eventsProcessed | `number` | Total events processed |
| rulesExecuted | `number` | Total rule executions |
| avgProcessingTimeMs | `number` | Average event processing time |
| tracing | `object?` | Tracing stats (if enabled) |
| profiling | `object?` | Profiling stats (if enabled) |
| audit | `object?` | Audit log stats (if configured) |
| versioning | `object?` | Rule versioning stats (if configured) |
| baseline | `object?` | Anomaly detection stats (if configured) |

---

## Auth

### AuthSession

```typescript
interface AuthSession {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly expiresAt?: number;
}
```

Session information returned after successful authentication.

| Field | Type | Description |
|-------|------|-------------|
| userId | `string` | Authenticated user identifier |
| roles | `string[]` | Assigned roles |
| metadata | `Record<string, unknown>?` | Optional session metadata |
| expiresAt | `number?` | Session expiration timestamp (ms since epoch) |

---

## WebSocket Abstraction

### WebSocketLike

```typescript
interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
```

Minimal WebSocket interface that the transport expects. Both the browser `WebSocket` and the `ws` npm package satisfy this interface.

### WebSocketConstructor

```typescript
type WebSocketConstructor = new (url: string) => WebSocketLike;
```

Constructor for a WebSocket-like object. Pass via `ClientOptions.WebSocket` to provide a custom implementation (e.g. `ws` in Node.js).

---

## See Also

- [Errors](./10-errors.md) — Error classes and server error codes
- [Configuration](./02-configuration.md) — ClientOptions and ReconnectOptions
- [Store API](./03-store-api.md) — Store operations using these types
- [Rules API](./06-rules-api.md) — Rules operations using these types
- [Auth API](./07-auth-api.md) — Authentication using AuthSession
