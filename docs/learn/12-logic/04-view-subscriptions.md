# View Subscriptions

Subscribe to reactive views for live updates and evaluate expressions standalone. Logic subscriptions deliver initial data and push updates — similar to store subscriptions, but on the `logic` channel.

## What You'll Learn

- How to subscribe to a reactive view with `logic.subscribeView()`
- Initial data delivery and push updates
- Unsubscribe patterns
- How to evaluate expressions with `logic.evaluateExpr()`
- The `expr` helper in detail — all operators by category
- The difference between store, rules, and logic subscriptions
- Reconnect recovery for logic subscriptions

## logic.subscribeView()

Subscribe to a reactive view. The callback receives the current view data immediately (initial delivery), and is called again whenever the source data changes:

```typescript
const unsubscribe = await client.logic.subscribeView('order_summary', (rows) => {
  console.log('View data:', rows);
});
```

**Signature:**

```typescript
subscribeView(
  name: string,
  callback: (data: Record<string, unknown>[]) => void,
): Promise<Unsubscribe>
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | `string` | yes | Name of a reactive view (defined with `reactive: true`) |
| callback | `(data: Record<string, unknown>[]) => void` | yes | Called with the complete view result on initial delivery and each update |

Returns `Promise<Unsubscribe>` — resolves to a synchronous function `() => void`.

### Initial Data

Unlike rules subscriptions (which have no initial state), logic subscriptions deliver the current view result immediately:

```typescript
const received: Array<Record<string, unknown>[]> = [];

const unsub = await client.logic.subscribeView('my_view', (data) => {
  received.push(data);
});

// At this point, received has one entry — the initial data
console.log(received.length); // 1
```

### Push Updates

When source data changes (insert, update, delete), the server recomputes the view and pushes the full updated result:

```typescript
const snapshots: Array<Record<string, unknown>[]> = [];

const unsub = await client.logic.subscribeView('items_view', (data) => {
  snapshots.push(data);
});

// snapshots[0] is the initial data (e.g. empty array)

await client.store.bucket('items').insert({ id: 'i1', val: 42 });
// After the push: snapshots[1] contains [{ id: 'i1', val: 42 }]
```

Each push delivers a **full snapshot** of the view — not a diff.

## Unsubscribe

The `Unsubscribe` function returned by `subscribeView()` is synchronous:

```typescript
const unsubscribe = await client.logic.subscribeView('my_view', callback);

// Later — stop receiving updates
unsubscribe();
```

When called:
1. The subscription is immediately removed from the local `SubscriptionManager`
2. A `logic.unsubscribeView` request is sent to the server (fire-and-forget)
3. No further updates are delivered to the callback

Calling `unsubscribe()` multiple times is safe — subsequent calls are no-ops.

## logic.evaluateExpr()

Evaluate an expression without defining computed fields. Useful for one-off calculations:

```typescript
import { expr } from '@hamicek/noex-client';

// Simple arithmetic
const sum = await client.logic.evaluateExpr(expr.add(2, 3));
console.log(sum); // 5

// With field references
const total = await client.logic.evaluateExpr(
  expr.multiply(expr.f('price'), expr.f('qty')),
  { price: 15, qty: 4 },
);
console.log(total); // 60

// Nested expressions
const result = await client.logic.evaluateExpr(
  expr.add(expr.multiply(expr.f('a'), expr.f('b')), expr.f('c')),
  { a: 3, b: 4, c: 5 },
);
console.log(result); // 17
```

**Signature:**

```typescript
evaluateExpr(
  expr: Expression,
  record?: Record<string, unknown>,
): Promise<unknown>
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| expr | `Expression` | yes | Expression to evaluate |
| record | `Record<string, unknown>` | no | Record providing values for `$fieldName` references |

## `expr` Helper Reference

### Field References

```typescript
expr.f('price')  // → '$price'
expr.f('qty')    // → '$qty'
```

### Arithmetic

| Method | Description | Example |
|--------|-------------|---------|
| `expr.add(a, b)` | Addition | `expr.add(expr.f('a'), expr.f('b'))` |
| `expr.subtract(a, b)` | Subtraction | `expr.subtract(expr.f('total'), expr.f('discount'))` |
| `expr.multiply(a, b)` | Multiplication | `expr.multiply(expr.f('qty'), expr.f('price'))` |
| `expr.divide(a, b)` | Division | `expr.divide(expr.f('total'), expr.f('count'))` |
| `expr.mod(a, b)` | Modulo | `expr.mod(expr.f('value'), 2)` |
| `expr.abs(a)` | Absolute value | `expr.abs(expr.f('balance'))` |
| `expr.round(a, decimals?)` | Round (default 0 decimals) | `expr.round(expr.f('price'), 2)` |
| `expr.floor(a)` | Floor | `expr.floor(expr.f('score'))` |
| `expr.ceil(a)` | Ceiling | `expr.ceil(expr.f('score'))` |

### Comparison

| Method | Description | Example |
|--------|-------------|---------|
| `expr.eq(a, b)` | Equal | `expr.eq(expr.f('status'), 'active')` |
| `expr.neq(a, b)` | Not equal | `expr.neq(expr.f('role'), 'guest')` |
| `expr.gt(a, b)` | Greater than | `expr.gt(expr.f('age'), 18)` |
| `expr.gte(a, b)` | Greater or equal | `expr.gte(expr.f('balance'), 0)` |
| `expr.lt(a, b)` | Less than | `expr.lt(expr.f('stock'), 10)` |
| `expr.lte(a, b)` | Less or equal | `expr.lte(expr.f('attempts'), 3)` |
| `expr.between(a, min, max)` | Between (inclusive) | `expr.between(expr.f('age'), 18, 65)` |
| `expr.isIn(a, list)` | In list | `expr.isIn(expr.f('status'), ['active', 'pending'])` |

### Logical

| Method | Description | Example |
|--------|-------------|---------|
| `expr.and(...conds)` | Logical AND | `expr.and(expr.gt(expr.f('age'), 18), expr.eq(expr.f('active'), true))` |
| `expr.or(...conds)` | Logical OR | `expr.or(expr.eq(expr.f('role'), 'admin'), expr.eq(expr.f('role'), 'mod'))` |
| `expr.not(a)` | Logical NOT | `expr.not(expr.eq(expr.f('deleted'), true))` |
| `expr.cond(cond, then, else)` | Conditional | `expr.cond(expr.gt(expr.f('score'), 50), 'pass', 'fail')` |

### String

| Method | Description | Example |
|--------|-------------|---------|
| `expr.concat(...parts)` | Concatenation | `expr.concat(expr.f('first'), ' ', expr.f('last'))` |
| `expr.upper(a)` | Uppercase | `expr.upper(expr.f('name'))` |
| `expr.lower(a)` | Lowercase | `expr.lower(expr.f('email'))` |
| `expr.length(a)` | String length | `expr.length(expr.f('name'))` |
| `expr.trim(a)` | Trim whitespace | `expr.trim(expr.f('input'))` |
| `expr.substring(a, start, len?)` | Substring | `expr.substring(expr.f('code'), 0, 3)` |

### Date

| Method | Description | Example |
|--------|-------------|---------|
| `expr.now()` | Current timestamp | `expr.now()` |
| `expr.year(a)` | Extract year | `expr.year(expr.f('createdAt'))` |
| `expr.month(a)` | Extract month | `expr.month(expr.f('createdAt'))` |
| `expr.day(a)` | Extract day | `expr.day(expr.f('createdAt'))` |
| `expr.daysBetween(a, b)` | Days between dates | `expr.daysBetween(expr.f('start'), expr.f('end'))` |
| `expr.dateAdd(date, n, unit)` | Add time to date | `expr.dateAdd(expr.f('date'), 30, 'day')` |

### Aggregate

Aggregate expressions are used in view definitions with `groupBy`:

| Method | Description | Example |
|--------|-------------|---------|
| `expr.sum(field)` | Sum | `expr.sum('amount')` |
| `expr.avg(field)` | Average | `expr.avg('price')` |
| `expr.min(field)` | Minimum | `expr.min('createdAt')` |
| `expr.max(field)` | Maximum | `expr.max('score')` |
| `expr.count(field?)` | Count (`'*'` if no field) | `expr.count()` |

## Store vs Rules vs Logic Subscriptions

| | Store | Rules | Logic |
|---|---|---|---|
| **Subscribe** | `store.subscribe(name, cb)` | `rules.subscribe(pattern, cb)` | `logic.subscribeView(name, cb)` |
| **Initial data** | Yes | No | Yes |
| **Push channel** | `subscription` | `event` | `logic` |
| **Push content** | Query result | Individual event | Full view snapshot |
| **Unsubscribe** | Synchronous `() => void` | Synchronous `() => void` | Synchronous `() => void` |
| **Reconnect** | Resubscribe + initial data | Resubscribe only (no replay) | Resubscribe + initial data |

All three types share the per-connection subscription limit (default: 100).

## Reconnect Recovery

Logic view subscriptions are automatically restored when the client reconnects. The SDK re-sends the `logic.subscribeView` request and the server assigns a new `subscriptionId`. Like store subscriptions, the callback receives fresh initial data after reconnect:

```typescript
client.on('reconnected', () => {
  console.log('Reconnected — logic subscriptions restored automatically');
});

const unsub = await client.logic.subscribeView('order_summary', (rows) => {
  // Invoked with initial data and on each update, including after reconnect.
  renderOrderSummary(rows);
});
```

Events that occurred while disconnected are reflected in the initial data after reconnect — the callback receives the current state of the view.

## Complete Working Example

A reactive dashboard that tracks items in real time:

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const items = client.store.bucket('items');

  // Define a reactive view
  await client.logic.defineView({
    name: 'item_dashboard',
    from: { i: 'items' },
    select: { id: 'i.id', qty: 'i.qty', price: 'i.price' },
    reactive: true,
  });

  // Subscribe — get initial data + live updates
  const unsub = await client.logic.subscribeView('item_dashboard', (rows) => {
    console.log(`Dashboard: ${rows.length} items`);
    for (const row of rows) {
      console.log(`  ${row.id}: qty=${row.qty}, price=${row.price}`);
    }
  });

  // Insert items — each triggers a push
  await items.insert({ id: 'widget', qty: 5, price: 10 });
  await items.insert({ id: 'gadget', qty: 2, price: 25 });

  // Evaluate an expression
  const total = await client.logic.evaluateExpr(
    expr.multiply(expr.f('qty'), expr.f('price')),
    { qty: 5, price: 10 },
  );
  console.log(`Calculated total: ${total}`); // 50

  // Wait for pushes
  await new Promise((r) => setTimeout(r, 500));

  // Clean up
  unsub();
  await client.logic.dropView('item_dashboard');
  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Defines a reactive view on a bucket
2. Subscribes to the view and collects all snapshots in an array
3. Inserts two records and waits for pushes
4. Verifies the array has 3 entries (1 initial + 2 pushes)
5. Uses `evaluateExpr` to compute `(10 + 20) * 3` — should return `90`
6. Unsubscribes and drops the view

<details>
<summary>Solution</summary>

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const items = client.store.bucket('items');

  // 1. Define reactive view
  await client.logic.defineView({
    name: 'tracked_items',
    from: { i: 'items' },
    select: { id: 'i.id', val: 'i.val' },
    reactive: true,
  });

  // 2. Subscribe and collect snapshots
  const snapshots: Array<Record<string, unknown>[]> = [];
  const unsub = await client.logic.subscribeView('tracked_items', (data) => {
    snapshots.push(data);
  });

  // 3. Insert two records
  await items.insert({ id: 'i1', val: 10 });
  await items.insert({ id: 'i2', val: 20 });

  // Wait for pushes
  await new Promise((r) => setTimeout(r, 500));

  // 4. Verify
  console.log(`Snapshots: ${snapshots.length}`); // 3
  console.log(`Initial items: ${snapshots[0].length}`);     // 0
  console.log(`After first insert: ${snapshots[1].length}`); // 1
  console.log(`After second insert: ${snapshots[2].length}`); // 2

  // 5. Evaluate expression
  const result = await client.logic.evaluateExpr(
    expr.multiply(expr.add(10, 20), 3),
  );
  console.log(`Result: ${result}`); // 90

  // 6. Clean up
  unsub();
  await client.logic.dropView('tracked_items');
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `logic.subscribeView(name, callback)` subscribes to a reactive view — delivers initial data + push updates
- Each push contains a **full snapshot** of the view (not a diff)
- The returned `Unsubscribe` function is synchronous — removes the local subscription and notifies the server
- `logic.evaluateExpr(expr, record?)` evaluates an expression standalone — useful for one-off calculations
- The `expr` helper covers arithmetic, comparison, logical, string, date, and aggregate operations
- `expr.f('fieldName')` creates a field reference (`'$fieldName'`)
- Logic subscriptions share the per-connection limit with store and rules subscriptions
- Subscriptions are automatically restored on reconnect with fresh initial data

---

Next: [Todo App](../11-projects/01-todo-app.md)
