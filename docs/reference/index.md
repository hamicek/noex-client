# API Reference

Complete API reference for `@hamicek/noex-client`. Every class, method, type, and configuration option documented with signatures and examples.

## Client

| Module | Description |
|--------|-------------|
| [NoexClient](./01-noex-client.md) | Main entry point — connect, disconnect, events, connection state, API namespaces |
| [Configuration](./02-configuration.md) | `ClientOptions`, `ReconnectOptions`, and all default values |
| [Transport](./08-transport.md) | WebSocket transport internals — reconnect strategy, heartbeat, connection lifecycle |

## APIs

| Module | Description |
|--------|-------------|
| [Store API](./03-store-api.md) | Bucket access, reactive subscriptions, atomic transactions, store metadata |
| [Bucket API](./04-bucket-api.md) | Typed CRUD, queries, aggregations, and bulk operations on a single bucket |
| [Store Subscriptions](./05-store-subscriptions.md) | Reactive query subscriptions — initial data, push updates, reconnect recovery |
| [Rules API](./06-rules-api.md) | Rule engine — events, facts, real-time event subscriptions |
| [Auth API](./07-auth-api.md) | Authentication — login, logout, session query, auto-login |
| [Logic API](./11-logic-api.md) | Logic engine — computed fields, views, constraints, expressions, `expr` helper |

## Infrastructure

| Module | Description |
|--------|-------------|
| [Types](./09-types.md) | All exported types and interfaces |
| [Errors](./10-errors.md) | `NoexClientError`, `TimeoutError`, `DisconnectedError`, server error codes |

## Quick Links

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { ClientOptions, ConnectionState, AuthSession } from '@hamicek/noex-client';
```

### Connect to a Server

```typescript
const client = new NoexClient('ws://localhost:3000');
await client.connect();
```

### CRUD on a Bucket

```typescript
const users = client.store.bucket<{ name: string }>('users');
const user = await users.insert({ name: 'Alice' });
const all = await users.all();
```

### Subscribe to Changes

```typescript
const unsub = await client.store.subscribe('activeUsers', (data) => {
  console.log('Active users:', data);
});
```

### Disconnect

```typescript
await client.disconnect();
```
