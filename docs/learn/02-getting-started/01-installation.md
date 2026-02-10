# Installation

This chapter gets the SDK installed in your project. The setup differs slightly between Node.js and browser environments because of WebSocket availability.

## What You'll Learn

- How to install the `@hamicek/noex-client` package
- Why Node.js needs the `ws` package and the browser doesn't
- How to verify the installation with a minimal import

## Installing the Package

```bash
npm install @hamicek/noex-client
```

The package is ESM-only and has zero runtime dependencies. It targets Node.js 20+ and modern browsers.

## Node.js Setup

Node.js does not have a built-in `WebSocket` global. You need the `ws` package:

```bash
npm install ws
npm install -D @types/ws   # TypeScript types
```

When creating a client, pass the `ws` constructor via the `WebSocket` option:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
});
```

If you forget to pass `WebSocket` and `globalThis.WebSocket` is not available, the client throws a runtime error when you call `connect()`.

### Why a Separate Package?

The SDK is designed to work in both Node.js and the browser with zero dependencies. Bundling a WebSocket implementation would add unnecessary weight for browser users (who already have `WebSocket` built in). By accepting a `WebSocket` constructor via options, the SDK stays small and environment-agnostic.

## Browser Setup

Browsers have `WebSocket` built in. No extra packages needed:

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080');
// WebSocket is picked up from globalThis automatically
```

### Bundler Configuration

The SDK ships as ESM (`import`/`export`). Modern bundlers (Vite, esbuild, webpack 5) handle this natively. No special configuration required.

If you use TypeScript, ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

## Verifying the Installation

After installation, verify that imports work:

```typescript
import { NoexClient, NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

console.log(typeof NoexClient);           // 'function'
console.log(typeof NoexClientError);       // 'function'
console.log(typeof TimeoutError);          // 'function'
console.log(typeof DisconnectedError);     // 'function'
```

If any import fails, check that:
1. Your `package.json` has `"type": "module"` (for ESM in Node.js)
2. Your TypeScript config uses `"moduleResolution": "bundler"` or `"node16"`

## What's in the Package?

The SDK exports the following:

| Export | Kind | Purpose |
|--------|------|---------|
| `NoexClient` | class | Main client — connection, lifecycle, API access |
| `StoreAPI` | class | Store operations namespace |
| `BucketAPI` | class | Typed bucket operations |
| `RulesAPI` | class | Rules engine operations |
| `AuthAPI` | class | Authentication operations |
| `NoexClientError` | class | Base error for all server errors |
| `TimeoutError` | class | Request timed out |
| `DisconnectedError` | class | Operation attempted while disconnected |
| `ClientOptions` | type | Configuration for the client constructor |
| `ReconnectOptions` | type | Configuration for reconnect behavior |
| `ConnectionState` | type | `'connecting' \| 'connected' \| 'reconnecting' \| 'disconnected'` |
| `WelcomeInfo` | type | Server welcome message: `{ version, serverTime, requiresAuth }` |
| `RecordMeta` | type | Server-generated record metadata: `{ id, _version, _createdAt, _updatedAt }` |
| `Unsubscribe` | type | `() => void` — synchronous cleanup function |
| `PaginatedResult<T>` | type | `{ records, hasMore, nextCursor? }` |
| `TransactionOp` | type | Discriminated union for transaction operations |
| `TransactionResult` | type | `{ results: Array<{ index, data }> }` |

## Exercise

Set up a new Node.js project with TypeScript and install both `@hamicek/noex-client` and `ws`. Create a file that imports `NoexClient` and logs its type.

<details>
<summary>Solution</summary>

```bash
mkdir noex-test && cd noex-test
npm init -y
npm install @hamicek/noex-client ws
npm install -D typescript @types/ws @types/node
npx tsc --init --module ESNext --moduleResolution bundler --target ES2022
```

Add `"type": "module"` to `package.json`, then create `index.ts`:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

console.log('NoexClient:', typeof NoexClient); // 'function'
console.log('WebSocket:', typeof WebSocket);   // 'function'

// Ready to connect — we'll do that in the next chapter
```

Run with `npx tsx index.ts` or compile with `npx tsc && node dist/index.js`.

</details>

## Summary

- Install with `npm install @hamicek/noex-client`
- Node.js also needs `npm install ws` for WebSocket support — pass it as `{ WebSocket }` in client options
- Browsers use the native `WebSocket` automatically — no extra setup
- The SDK is ESM-only with zero runtime dependencies
- All classes, types, and error classes are exported from the package root

---

Next: [First Connection](./02-first-connection.md)
