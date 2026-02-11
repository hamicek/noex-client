# Error Types

The SDK uses a typed error hierarchy so you can catch and classify errors precisely. Every error from the server or the SDK itself is an instance of one of three classes, and server errors carry a machine-readable `code` for programmatic handling.

## What You'll Learn

- The three error classes: `NoexClientError`, `TimeoutError`, `DisconnectedError`
- All server error codes and when they occur
- How to catch errors by class and code
- How errors flow through the request/response pipeline

## Error Hierarchy

```
Error
 └─ NoexClientError          code: string, details?: unknown
     ├─ TimeoutError          code: 'TIMEOUT'
     └─ DisconnectedError     code: 'DISCONNECTED'
```

All three are exported from the package:

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';
```

## NoexClientError

The base class for all SDK errors. Every error from the server is wrapped in a `NoexClientError` with the server's error code and message:

```typescript
class NoexClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown);
}
```

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | Machine-readable error code (e.g. `'VALIDATION_ERROR'`, `'NOT_FOUND'`) |
| `message` | `string` | Human-readable error description |
| `details` | `unknown` | Optional structured data (e.g. validation error details) |
| `name` | `string` | Always `'NoexClientError'` |

```typescript
try {
  await client.store.bucket('nonexistent').all();
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // 'BUCKET_NOT_DEFINED'
    console.log(err.message); // 'Bucket "nonexistent" is not defined'
    console.log(err.details); // undefined or structured info
  }
}
```

## TimeoutError

Thrown when a request does not receive a response within `requestTimeoutMs` (default: 10,000ms):

```typescript
class TimeoutError extends NoexClientError {
  // code is always 'TIMEOUT'
  constructor(message: string);
}
```

```typescript
import { TimeoutError } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  requestTimeoutMs: 5_000, // 5 seconds
});

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof TimeoutError) {
    // err.code === 'TIMEOUT'
    // err.message === 'Request store.bucket.all (id=1) timed out after 5000ms'
    console.log('Request timed out');
  }
}
```

`TimeoutError` is a subclass of `NoexClientError`, so catching `NoexClientError` also catches timeouts.

## DisconnectedError

Thrown when you try to send a request while the client is not connected, or when the connection drops while a request is in-flight:

```typescript
class DisconnectedError extends NoexClientError {
  // code is always 'DISCONNECTED'
  constructor(message?: string); // default: 'Not connected'
}
```

This error appears in two scenarios:

**1. Sending a request while disconnected or reconnecting:**

```typescript
import { DisconnectedError } from '@hamicek/noex-client';

// Client is not connected
try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    // err.code === 'DISCONNECTED'
    // err.message === 'Cannot send request — client is disconnected'
    console.log('Not connected');
  }
}
```

**2. Connection drops while a request is pending:**

```typescript
// The connection drops after this request is sent but before the response arrives
try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    // err.code === 'DISCONNECTED'
    // err.message === 'Connection lost'
    console.log('Connection lost during request');
  }
}
```

## Server Error Codes

When the server rejects a request, the SDK wraps the response in a `NoexClientError` with the server's error code. Here are all defined codes:

| Code | Description | Common Cause |
|------|-------------|-------------|
| `PARSE_ERROR` | Server could not parse the message | Malformed JSON (should not happen with the SDK) |
| `INVALID_REQUEST` | Message structure is invalid | Missing required fields (should not happen with the SDK) |
| `UNKNOWN_OPERATION` | The request type is not recognized | Typo in request type or unsupported operation |
| `VALIDATION_ERROR` | Input data failed validation | Missing required fields, wrong types, schema violations |
| `NOT_FOUND` | The requested resource does not exist | Getting a record by key that doesn't exist |
| `ALREADY_EXISTS` | A record with this key already exists | Inserting a duplicate key |
| `CONFLICT` | Version conflict during update | Optimistic concurrency violation |
| `UNAUTHORIZED` | Authentication required but not provided | Operating without logging in on a protected server |
| `FORBIDDEN` | Authenticated but insufficient permissions | Role-based access denied |
| `RATE_LIMITED` | Too many requests | Exceeding server rate limits |
| `BACKPRESSURE` | Server is overloaded | Too many concurrent operations, server pushes back |
| `INTERNAL_ERROR` | Unexpected server error | Server-side bug or infrastructure issue |
| `BUCKET_NOT_DEFINED` | Bucket does not exist | Accessing an undefined bucket name |
| `QUERY_NOT_DEFINED` | Query does not exist | Subscribing to an undefined query name |
| `RULES_NOT_AVAILABLE` | Rules engine is not configured | Calling rules API on a server without rules |

## Client-Side Error Codes

These codes are generated by the SDK itself, not by the server:

| Code | Error Class | Description |
|------|-------------|-------------|
| `TIMEOUT` | `TimeoutError` | Request timed out (no response within `requestTimeoutMs`) |
| `DISCONNECTED` | `DisconnectedError` | Not connected or connection lost during request |

## Catching Errors by Class

Use `instanceof` to catch errors at the right level of specificity:

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';

try {
  await client.store.bucket('users').insert({ name: 'Alice' });
} catch (err) {
  if (err instanceof DisconnectedError) {
    // Connection issue — can't send the request
    console.log('Not connected');
  } else if (err instanceof TimeoutError) {
    // Server didn't respond in time
    console.log('Request timed out');
  } else if (err instanceof NoexClientError) {
    // Server returned an error
    switch (err.code) {
      case 'VALIDATION_ERROR':
        console.log('Invalid data:', err.message);
        break;
      case 'ALREADY_EXISTS':
        console.log('Record already exists');
        break;
      case 'UNAUTHORIZED':
        console.log('Need to log in first');
        break;
      default:
        console.log(`Server error [${err.code}]: ${err.message}`);
    }
  } else {
    // Unexpected error (not from the SDK)
    throw err;
  }
}
```

Order matters — check subclasses first, then the base class:

```typescript
// Wrong order — NoexClientError catches everything, TimeoutError never reached
catch (err) {
  if (err instanceof NoexClientError) { ... }
  else if (err instanceof TimeoutError) { ... }  // Never reached!
}

// Correct order — specific subclasses first
catch (err) {
  if (err instanceof TimeoutError) { ... }        // Most specific
  else if (err instanceof DisconnectedError) { ... }
  else if (err instanceof NoexClientError) { ... } // Catch-all for server errors
}
```

## How Errors Flow

```
Client sends request
  │
  ├─ Not connected? ───────────────────► throw DisconnectedError
  │
  ├─ Request sent, waiting...
  │   │
  │   ├─ Connection drops ─────────────► reject with DisconnectedError
  │   │
  │   ├─ Timeout elapsed ─────────────► reject with TimeoutError
  │   │
  │   ├─ Server responds { type: 'error', code, message }
  │   │   └──────────────────────────► reject with NoexClientError(code, message)
  │   │
  │   └─ Server responds { type: 'result', data }
  │       └──────────────────────────► resolve with data
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
    reconnect: false,
  });

  await client.connect();

  const bucket = client.store.bucket('users');

  // Example 1: Server validation error
  try {
    await bucket.insert({}); // Missing required 'name' field
  } catch (err) {
    if (err instanceof NoexClientError && err.code === 'VALIDATION_ERROR') {
      console.log('Validation failed:', err.message);
    }
  }

  // Example 2: Bucket not defined
  try {
    await client.store.bucket('nonexistent').all();
  } catch (err) {
    if (err instanceof NoexClientError && err.code === 'BUCKET_NOT_DEFINED') {
      console.log('Bucket does not exist:', err.message);
    }
  }

  // Example 3: DisconnectedError after disconnect
  await client.disconnect();
  try {
    await bucket.all();
  } catch (err) {
    if (err instanceof DisconnectedError) {
      console.log('Cannot operate:', err.message); // 'Cannot send request — client is disconnected'
    }
  }
}

main().catch(console.error);
```

## Exercise

Write a function `classifyError(err: unknown)` that:
1. Returns `'disconnected'` for `DisconnectedError`
2. Returns `'timeout'` for `TimeoutError`
3. Returns the error code (e.g. `'VALIDATION_ERROR'`) for other `NoexClientError` instances
4. Returns `'unknown'` for anything else

Then test it with each error type.

<details>
<summary>Solution</summary>

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';

function classifyError(err: unknown): string {
  if (err instanceof DisconnectedError) return 'disconnected';
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof NoexClientError) return err.code;
  return 'unknown';
}

// Test it
console.log(classifyError(new DisconnectedError()));           // 'disconnected'
console.log(classifyError(new TimeoutError('timed out')));     // 'timeout'
console.log(classifyError(
  new NoexClientError('VALIDATION_ERROR', 'bad input'),
));                                                             // 'VALIDATION_ERROR'
console.log(classifyError(
  new NoexClientError('NOT_FOUND', 'missing'),
));                                                             // 'NOT_FOUND'
console.log(classifyError(new Error('random')));               // 'unknown'
console.log(classifyError('not an error'));                     // 'unknown'
```

</details>

## Summary

- **`NoexClientError`** — base class for all SDK errors; carries `code`, `message`, and optional `details`
- **`TimeoutError`** — request timed out (`code: 'TIMEOUT'`); subclass of `NoexClientError`
- **`DisconnectedError`** — not connected or connection lost (`code: 'DISCONNECTED'`); subclass of `NoexClientError`
- Server errors use 15 distinct codes covering validation, auth, rate limiting, and more
- Always catch subclasses (`TimeoutError`, `DisconnectedError`) before the base class (`NoexClientError`)
- Use `err.code` to switch on specific server error codes
- `DisconnectedError` is thrown synchronously when sending requests in non-connected states

---

Next: [Recovery Strategies](./02-recovery-strategies.md)
