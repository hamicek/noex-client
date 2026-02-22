# Logic API

The `LogicAPI` class provides access to the server-side logic engine — computed fields, derived views, constraints, and expression evaluation. It is available as the `logic` property on `NoexClient`.

## Import

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const logic = client.logic;
```

Relevant types:

```typescript
import type {
  ComputedFieldDefinition,
  ComputedFieldsConfig,
  DerivedViewDefinition,
  DerivedViewInfo,
  DerivedViewExplanation,
  ConstraintDefinition,
  Expression,
  Unsubscribe,
} from '@hamicek/noex-client';
```

---

## Computed Fields

### defineComputed()

```typescript
defineComputed(
  bucket: string,
  fields: Record<string, ComputedFieldDefinition>,
): Promise<void>
```

Defines computed fields on a bucket. Computed fields are automatically calculated when records are inserted or updated.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| bucket | `string` | yes | Bucket name. Must be a defined bucket in the store. |
| fields | `Record<string, ComputedFieldDefinition>` | yes | Map of field name to definition. Each definition has `depends` (source fields) and `expr` (expression to evaluate). |

**Returns:** `Promise<void>`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `bucket` or `fields` is missing
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
await logic.defineComputed('items', {
  total: {
    depends: ['qty', 'price'],
    expr: expr.multiply(expr.f('qty'), expr.f('price')),
  },
});

// After insert, the computed field is automatically calculated
const items = client.store.bucket('items');
const item = await items.insert({ qty: 3, price: 10 });
const stored = await items.get(item.id);
console.log(stored.total); // 30
```

---

### dropComputed()

```typescript
dropComputed(bucket: string): Promise<boolean>
```

Removes computed field definitions from a bucket. Returns `true` if the definitions existed and were removed, `false` otherwise.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| bucket | `string` | yes | Bucket name. |

**Returns:** `Promise<boolean>` — `true` if dropped, `false` if no definitions existed

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `bucket` is missing
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const dropped = await logic.dropComputed('items');
console.log(dropped); // true
```

---

### listComputed()

```typescript
listComputed(): Promise<ComputedFieldsConfig[]>
```

Returns all computed field configurations.

**Returns:** `Promise<ComputedFieldsConfig[]>` — array of configurations, or empty array if none defined

**Throws:**
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const configs = await logic.listComputed();
for (const config of configs) {
  console.log(`Bucket: ${config.bucket}, Fields: ${Object.keys(config.fields).join(', ')}`);
}
```

---

## Derived Views

### defineView()

```typescript
defineView(definition: DerivedViewDefinition): Promise<void>
```

Defines a derived view — a cross-bucket query with joins, filters, grouping, and expressions.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| definition | `DerivedViewDefinition` | yes | View definition (see [Types](#derivedviewdefinition) below). |

**Returns:** `Promise<void>`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `definition` is missing or invalid (empty `from`, missing `select`, etc.)
- `NoexClientError` with code `ALREADY_EXISTS` if a view with this name already exists
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
await logic.defineView({
  name: 'invoice_details',
  from: { i: 'invoices', c: 'customers' },
  join: { 'i.customerId': 'c.id' },
  select: {
    invoiceId: 'i.id',
    customerName: 'c.name',
    total: 'i.total',
  },
});
```

---

### queryView()

```typescript
queryView(name: string): Promise<Record<string, unknown>[]>
```

Queries the current data of a defined view.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | yes | View name. |

**Returns:** `Promise<Record<string, unknown>[]>` — array of result records, or empty array if no records match

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `name` is missing or view does not exist
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const rows = await logic.queryView('invoice_details');
for (const row of rows) {
  console.log(`${row.customerName}: ${row.total}`);
}
```

---

### explainView()

```typescript
explainView(name: string): Promise<DerivedViewExplanation>
```

Returns a detailed explanation of a view's structure — sources, joins, filters, and dependencies.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | yes | View name. |

**Returns:** `Promise<DerivedViewExplanation>` — structural explanation of the view

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `name` is missing or view does not exist
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const explanation = await logic.explainView('invoice_details');
console.log('Sources:', explanation.sources);
console.log('Joins:', explanation.joins);
console.log('Dependencies:', explanation.dependencies);
```

---

### listViews()

```typescript
listViews(): Promise<DerivedViewInfo[]>
```

Returns a list of all defined views with summary information.

**Returns:** `Promise<DerivedViewInfo[]>` — array of view summaries, or empty array if none defined

**Throws:**
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const views = await logic.listViews();
for (const view of views) {
  console.log(`${view.name}: ${view.resultCount} rows (reactive: ${view.reactive})`);
}
```

---

### dropView()

```typescript
dropView(name: string): Promise<boolean>
```

Removes a view definition. Returns `true` if the view existed and was removed, `false` otherwise.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | yes | View name. |

**Returns:** `Promise<boolean>` — `true` if dropped, `false` if the view did not exist

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `name` is missing
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const dropped = await logic.dropView('invoice_details');
console.log(dropped); // true
```

---

## Constraints

### defineConstraint()

```typescript
defineConstraint(constraint: ConstraintDefinition): Promise<void>
```

Defines an integrity constraint on a bucket. Constraints are automatically enforced on store `insert` and `update` operations — a record that violates a constraint will be rejected with `VALIDATION_ERROR`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| constraint | `ConstraintDefinition` | yes | Constraint definition (see [Types](#constraintdefinition) below). |

**Returns:** `Promise<void>`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `constraint` is missing or invalid
- `NoexClientError` with code `ALREADY_EXISTS` if a constraint with this name already exists
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
await logic.defineConstraint({
  name: 'positive_balance',
  on: 'accounts',
  expr: expr.gte(expr.f('balance'), 0),
  message: 'Balance must be non-negative',
});

// This insert will be rejected:
const accounts = client.store.bucket('accounts');
try {
  await accounts.insert({ balance: -100 });
} catch (err) {
  console.log(err.code); // 'VALIDATION_ERROR'
}
```

---

### dropConstraint()

```typescript
dropConstraint(name: string): Promise<boolean>
```

Removes a constraint definition. After dropping, the constraint is no longer enforced. Returns `true` if the constraint existed and was removed, `false` otherwise.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | yes | Constraint name. |

**Returns:** `Promise<boolean>` — `true` if dropped, `false` if the constraint did not exist

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `name` is missing
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const dropped = await logic.dropConstraint('positive_balance');
console.log(dropped); // true
```

---

### listConstraints()

```typescript
listConstraints(): Promise<ConstraintDefinition[]>
```

Returns all defined constraints.

**Returns:** `Promise<ConstraintDefinition[]>` — array of constraint definitions, or empty array if none defined

**Throws:**
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const constraints = await logic.listConstraints();
for (const c of constraints) {
  console.log(`${c.name} on ${c.on}: ${c.message}`);
}
```

---

## Expressions

### evaluateExpr()

```typescript
evaluateExpr(
  expr: Expression,
  record?: Record<string, unknown>,
): Promise<unknown>
```

Evaluates an expression standalone, without defining a computed field. Useful for one-off calculations.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| expr | `Expression` | yes | Expression to evaluate. Can be a literal, field reference (`$fieldName`), or operator object. |
| record | `Record<string, unknown>` | no | Record providing field values for `$fieldName` references. Defaults to `{}`. |

**Returns:** `Promise<unknown>` — the evaluation result

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `expr` is missing
- `NoexClientError` with code `INTERNAL_ERROR` if expression evaluation fails (e.g. invalid operator)
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
import { expr } from '@hamicek/noex-client';

const result = await logic.evaluateExpr(
  expr.multiply(expr.f('price'), expr.f('qty')),
  { price: 15, qty: 4 },
);
console.log(result); // 60
```

---

## View Subscriptions

### subscribeView()

```typescript
subscribeView(
  name: string,
  callback: (data: Record<string, unknown>[]) => void,
): Promise<Unsubscribe>
```

Subscribes to a reactive view. The callback receives the current view data immediately (initial delivery), and is called again whenever the source data changes and the view is recomputed.

The view must have been defined with `reactive: true`.

Unlike `rules.subscribe` (which has no initial state), `logic.subscribeView` delivers initial data — similar to `store.subscribe`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | yes | Name of a reactive view. |
| callback | `(data: Record<string, unknown>[]) => void` | yes | Called with the complete view result (full snapshot) on initial delivery and each update. |

**Returns:** `Promise<Unsubscribe>` — resolves to a synchronous unsubscribe function `() => void`

**Throws:**
- `NoexClientError` with code `VALIDATION_ERROR` if `name` is missing or view does not exist
- `NoexClientError` with code `LOGIC_NOT_AVAILABLE` if the logic engine is not configured
- `TimeoutError` if the server does not respond within the request timeout
- `DisconnectedError` if the client is not connected

**Example:**

```typescript
const unsubscribe = await logic.subscribeView('order_summary', (rows) => {
  console.log('View data:', rows);
});

// Mutating source data triggers the callback with updated view results
// ...

// Stop receiving updates
unsubscribe();
```

### Unsubscribe function

```typescript
const unsubscribe: Unsubscribe = await logic.subscribeView('order_summary', callback);
unsubscribe(); // synchronous, returns void
```

The `Unsubscribe` function returned by `subscribeView()`:

1. Removes the subscription from the local `SubscriptionManager`
2. Sends a `logic.unsubscribeView` request to the server (fire-and-forget)
3. Returns `void` synchronously — does not wait for server confirmation

Calling the function multiple times is safe — the second call is a no-op on the server side.

---

### unsubscribeView()

```typescript
unsubscribeView(subscriptionId: string): Promise<void>
```

Unsubscribes by server-assigned subscription ID. This is an advanced method — prefer the `Unsubscribe` function returned by `subscribeView()` for normal use.

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

## `expr` Helper

The `expr` helper provides a type-safe, composable way to build expressions without writing raw JSON operator objects. Import it directly from the package:

```typescript
import { expr } from '@hamicek/noex-client';
```

### Field References

```typescript
expr.f('price')  // → '$price'
expr.f('qty')    // → '$qty'
```

### Arithmetic

| Method | Description | Example |
|--------|-------------|---------|
| `expr.add(a, b)` | Addition | `expr.add(expr.f('a'), expr.f('b'))` → `{ $add: ['$a', '$b'] }` |
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
| `expr.gte(a, b)` | Greater than or equal | `expr.gte(expr.f('balance'), 0)` |
| `expr.lt(a, b)` | Less than | `expr.lt(expr.f('stock'), 10)` |
| `expr.lte(a, b)` | Less than or equal | `expr.lte(expr.f('attempts'), 3)` |
| `expr.between(a, min, max)` | Between (inclusive) | `expr.between(expr.f('age'), 18, 65)` |
| `expr.isIn(a, list)` | In list | `expr.isIn(expr.f('status'), ['active', 'pending'])` |

### Logical

| Method | Description | Example |
|--------|-------------|---------|
| `expr.and(...conds)` | Logical AND | `expr.and(expr.gt(expr.f('age'), 18), expr.eq(expr.f('active'), true))` |
| `expr.or(...conds)` | Logical OR | `expr.or(expr.eq(expr.f('role'), 'admin'), expr.eq(expr.f('role'), 'mod'))` |
| `expr.not(a)` | Logical NOT | `expr.not(expr.eq(expr.f('deleted'), true))` |
| `expr.cond(condition, then, otherwise)` | Conditional (if/else) | `expr.cond(expr.gt(expr.f('score'), 50), 'pass', 'fail')` |

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
| `expr.daysBetween(a, b)` | Days between two dates | `expr.daysBetween(expr.f('start'), expr.f('end'))` |
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

---

## Push Message Protocol

Logic view push messages use the `logic` channel:

```typescript
// Server → Client
{
  type: 'push',
  subscriptionId: string,  // server-assigned ID
  channel: 'logic',        // distinguishes logic pushes from store and rules pushes
  data: Record<string, unknown>[]  // complete recomputed view result (full snapshot)
}
```

The `PushRouter` inspects incoming messages. If `type === 'push'` and `channel === 'logic'`, the message is routed to the `SubscriptionManager`, which invokes the registered callback with the `data` array.

---

## Reconnect Recovery

Logic view subscriptions are automatically restored when the client reconnects. The `SubscriptionManager.resubscribeAll()` method re-sends the original `logic.subscribeView` request with the same view name, and the server assigns a new `subscriptionId`.

Like store subscriptions (and unlike rules subscriptions), logic resubscription delivers initial data — the callback receives the current view result immediately after reconnect.

If a resubscription fails, that subscription is silently removed from the local registry and logged to `console.error`.

**Example:**

```typescript
client.on('reconnected', () => {
  console.log('Reconnected — logic subscriptions restored automatically');
});

const unsub = await logic.subscribeView('order_summary', (rows) => {
  // Invoked with initial data and on each update, including after reconnect.
  renderOrderSummary(rows);
});
```

---

## Types

### Expression

```typescript
type Expression =
  | number
  | string
  | boolean
  | null
  | ExpressionOperator;

type ExpressionOperator = {
  readonly [key: `$${string}`]: Expression | readonly Expression[];
};
```

### ComputedFieldDefinition

```typescript
interface ComputedFieldDefinition {
  readonly depends: readonly string[];
  readonly expr: Expression;
}
```

### ComputedFieldsConfig

```typescript
interface ComputedFieldsConfig {
  readonly bucket: string;
  readonly fields: Record<string, ComputedFieldDefinition>;
}
```

### DerivedViewDefinition

```typescript
interface DerivedViewDefinition {
  readonly name: string;
  readonly from: Record<string, string>;
  readonly join?: Record<string, string>;
  readonly where?: Record<string, unknown>;
  readonly groupBy?: string | readonly string[];
  readonly select: Record<string, string | Expression>;
  readonly reactive?: boolean;
  readonly orderBy?: readonly OrderBySpec[];
  readonly limit?: number;
}
```

### DerivedViewInfo

```typescript
interface DerivedViewInfo {
  readonly name: string;
  readonly from: Record<string, string>;
  readonly reactive: boolean;
  readonly resultCount: number;
}
```

### DerivedViewExplanation

```typescript
interface DerivedViewExplanation {
  readonly name: string;
  readonly sources: Record<string, string>;
  readonly joins: Record<string, string>;
  readonly filters: Record<string, unknown>;
  readonly groupBy: readonly string[];
  readonly select: Record<string, string | Expression>;
  readonly dependencies: readonly string[];
}
```

### ConstraintDefinition

```typescript
interface ConstraintDefinition {
  readonly name: string;
  readonly on: string;
  readonly expr: Expression;
  readonly message: string;
  readonly scope?: 'record' | 'group';
  readonly groupBy?: string;
  readonly operations?: readonly ('insert' | 'update' | 'delete')[];
}
```

### OrderBySpec

```typescript
interface OrderBySpec {
  readonly field: string;
  readonly direction?: 'asc' | 'desc';
}
```

---

## See Also

- [NoexClient](./01-noex-client.md) — connection lifecycle, `logic` property, `on()` events
- [Store Subscriptions](./05-store-subscriptions.md) — store subscription lifecycle (for comparison with logic subscriptions)
- [Rules API](./06-rules-api.md) — rule engine API (for comparison)
- [Transport](./08-transport.md) — reconnect strategy, exponential backoff
- [Configuration](./02-configuration.md) — `requestTimeoutMs`, `reconnect` options
- [Types](./09-types.md) — `Expression`, `ComputedFieldDefinition`, `DerivedViewDefinition`, `ConstraintDefinition`, `Unsubscribe`
- [Errors](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
- [noex-logic documentation](https://github.com/nicvisual/noex-logic) — Full logic engine documentation
