# Setup

Access the server-side logic engine through the `client.logic` namespace and build expressions with the `expr` helper.

## What You'll Learn

- How to access the logic engine via `client.logic`
- The `expr` helper for building expressions without raw JSON
- What happens when the server has no logic engine configured
- Overview of all available logic operations

## The `logic` Namespace

The `LogicAPI` is available as the `logic` property on `NoexClient`:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const logic = client.logic;
```

The server must have the logic engine configured — pass a `Logic` instance to `NoexServer.start({ store, logic })`. See the [server setup](../../../noex-server/docs/learn/14-logic/01-setup.md) for details.

## Architecture

```
┌────────────────┐       ┌──────────────┐       ┌─────────────┐
│  NoexClient    │──────>│  noex-server │──────>│  noex-logic │
│  client.logic  │<──────│  (proxy)     │<──────│  (engine)   │
└────────────────┘       └──────────────┘       └─────────────┘
                              │                       │
                              v                       v
                         ┌──────────────┐        (uses same
                         │  noex-store  │         store)
                         └──────────────┘
```

Every `client.logic.*` call sends a request to the server, which proxies it to the logic engine. Push messages from view subscriptions arrive on the `logic` channel.

## Without Logic

When the server has no logic engine configured, all `client.logic.*` calls throw `NoexClientError` with code `LOGIC_NOT_AVAILABLE`:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

try {
  await client.logic.listComputed();
} catch (err) {
  if (err instanceof NoexClientError && err.code === 'LOGIC_NOT_AVAILABLE') {
    console.log('Logic engine is not configured on the server');
  }
}
```

## The `expr` Helper

The `expr` helper provides a type-safe way to build expressions. Import it directly from the package:

```typescript
import { expr } from '@hamicek/noex-client';
```

Instead of writing raw JSON operators:

```typescript
// Raw JSON — error-prone, no autocomplete
{ $multiply: ['$qty', '$price'] }
```

Use the helper:

```typescript
// Type-safe, composable, readable
expr.multiply(expr.f('qty'), expr.f('price'))
```

`expr.f('fieldName')` is a shorthand for field references — it produces `'$fieldName'`.

### Expression Categories

| Category | Examples |
|----------|----------|
| Arithmetic | `add`, `subtract`, `multiply`, `divide`, `mod`, `abs`, `round`, `floor`, `ceil` |
| Comparison | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `isIn` |
| Logical | `and`, `or`, `not`, `cond` |
| String | `concat`, `upper`, `lower`, `length`, `trim`, `substring` |
| Date | `now`, `year`, `month`, `day`, `daysBetween`, `dateAdd` |
| Aggregate | `sum`, `avg`, `min`, `max`, `count` |

Expressions are composable — you can nest them:

```typescript
// (qty * price) - discount
expr.subtract(
  expr.multiply(expr.f('qty'), expr.f('price')),
  expr.f('discount'),
)
```

## Available Operations

| Method | Description |
|--------|-------------|
| `logic.defineComputed(bucket, fields)` | Define computed fields for a bucket |
| `logic.dropComputed(bucket)` | Remove computed fields from a bucket |
| `logic.listComputed()` | List all computed field configurations |
| `logic.defineView(definition)` | Define a derived view |
| `logic.dropView(name)` | Remove a derived view |
| `logic.queryView(name)` | Query a view's current data |
| `logic.explainView(name)` | Get a view's execution plan |
| `logic.listViews()` | List all defined views |
| `logic.defineConstraint(constraint)` | Define a validation constraint |
| `logic.dropConstraint(name)` | Remove a constraint |
| `logic.listConstraints()` | List all constraints |
| `logic.subscribeView(name, callback)` | Subscribe to reactive view updates |
| `logic.evaluateExpr(expr, record?)` | Evaluate an expression standalone |

## Exercise

Connect to a server with a logic engine and verify it's available:
1. Call `logic.listComputed()` — it should return an empty array
2. Call `logic.listViews()` — it should return an empty array
3. Try using the `expr` helper to build a simple expression: `expr.add(1, 2)`

<details>
<summary>Solution</summary>

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // 1. Verify logic is available
  const computed = await client.logic.listComputed();
  console.log('Computed:', computed); // []

  // 2. List views
  const views = await client.logic.listViews();
  console.log('Views:', views); // []

  // 3. Build an expression (just creates a JSON object, no server call)
  const expression = expr.add(1, 2);
  console.log('Expression:', expression); // { $add: [1, 2] }

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- The logic engine is available via `client.logic` on `NoexClient`
- The server must have a `Logic` instance configured — otherwise all calls throw `LOGIC_NOT_AVAILABLE`
- Import `expr` from `@hamicek/noex-client` to build expressions with type safety
- `expr.f('fieldName')` creates a field reference (`'$fieldName'`)
- Expressions are composable — nest them to build complex calculations
- Fourteen operations are available across computed fields, views, constraints, subscriptions, and expressions

---

Next: [Computed Fields](./02-computed-fields.md)
