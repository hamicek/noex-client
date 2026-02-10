# Errors

Error classes thrown by `noex-client`. All errors extend the base `NoexClientError` class which carries a machine-readable `code` alongside the human-readable `message`.

## Import

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@anthropic/noex-client';
```

---

## NoexClientError

```typescript
class NoexClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown);
}
```

Base class for all noex-client errors. Also used directly for server-originated errors — the `code` field carries the server error code and `details` carries optional structured data from the server response.

**Properties:**

| Name | Type | Description |
|------|------|-------------|
| code | `string` | Machine-readable error code |
| message | `string` | Human-readable error description |
| details | `unknown` | Optional structured error data from the server |
| name | `string` | Always `'NoexClientError'` |

**Example:**

```typescript
try {
  await client.store.bucket('users').get('non-existent');
} catch (err) {
  if (err instanceof NoexClientError) {
    console.error(err.code);    // 'NOT_FOUND'
    console.error(err.message); // 'Record not found'
  }
}
```

---

## TimeoutError

```typescript
class TimeoutError extends NoexClientError {
  constructor(message: string);
}
```

Thrown when a request does not receive a server response within the configured `requestTimeoutMs`. The `code` is always `'TIMEOUT'`.

**Properties:**

| Name | Type | Description |
|------|------|-------------|
| code | `string` | Always `'TIMEOUT'` |
| name | `string` | Always `'TimeoutError'` |

**Example:**

```typescript
import { TimeoutError } from '@anthropic/noex-client';

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error('Server did not respond in time');
  }
}
```

---

## DisconnectedError

```typescript
class DisconnectedError extends NoexClientError {
  constructor(message?: string);
}
```

Thrown when an operation is attempted while the client is not in the `'connected'` state, or when a pending request is rejected because the connection was lost. The `code` is always `'DISCONNECTED'`. Default message: `'Not connected'`.

**Properties:**

| Name | Type | Description |
|------|------|-------------|
| code | `string` | Always `'DISCONNECTED'` |
| name | `string` | Always `'DisconnectedError'` |

**Example:**

```typescript
import { DisconnectedError } from '@anthropic/noex-client';

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    console.error('Not connected to server');
  }
}
```

---

## Server Error Codes

When the server rejects a request, the client throws a `NoexClientError` with one of the following codes:

| Code | Description |
|------|-------------|
| `PARSE_ERROR` | Server could not parse the incoming message |
| `INVALID_REQUEST` | Message structure is invalid (missing `type` or `id`) |
| `UNKNOWN_OPERATION` | The requested operation type is not recognized |
| `VALIDATION_ERROR` | Request payload failed validation (missing/invalid fields) |
| `NOT_FOUND` | Requested record or resource does not exist |
| `ALREADY_EXISTS` | Resource already exists (e.g. duplicate insert) |
| `CONFLICT` | Operation conflicts with current state (e.g. version mismatch) |
| `UNAUTHORIZED` | Authentication required or credentials invalid |
| `FORBIDDEN` | Authenticated but insufficient permissions |
| `RATE_LIMITED` | Request rejected due to rate limiting |
| `BACKPRESSURE` | Server is under load, client should retry later |
| `INTERNAL_ERROR` | Unexpected server-side error |
| `BUCKET_NOT_DEFINED` | Referenced bucket is not defined in the store |
| `QUERY_NOT_DEFINED` | Referenced query is not defined in the store |
| `RULES_NOT_AVAILABLE` | Rules engine is not configured on the server |

**Example:**

```typescript
try {
  await client.store.bucket('orders').insert({ total: -1 });
} catch (err) {
  if (err instanceof NoexClientError) {
    switch (err.code) {
      case 'VALIDATION_ERROR':
        console.error('Invalid data:', err.details);
        break;
      case 'UNAUTHORIZED':
        console.error('Please log in first');
        break;
      case 'RATE_LIMITED':
        console.error('Too many requests, slow down');
        break;
    }
  }
}
```

---

## Error Hierarchy

```
Error
 └─ NoexClientError          (code, message, details)
     ├─ TimeoutError          (code = 'TIMEOUT')
     └─ DisconnectedError     (code = 'DISCONNECTED')
```

All three classes are exported from the package. Server errors arrive as plain `NoexClientError` instances — use the `code` property to distinguish them.

---

## See Also

- [Types](./09-types.md) — Shared type definitions
- [Configuration](./02-configuration.md) — Timeout settings that affect error behavior
- [NoexClient](./01-noex-client.md) — Client lifecycle and connection events
