# Views and Constraints

Create derived views that combine data from multiple buckets with joins, filters, and aggregation. Define constraints that automatically enforce business rules on store writes.

## What You'll Learn

- How to define derived views with `logic.defineView()`
- The `DerivedViewDefinition` structure — `from`, `join`, `where`, `select`, and more
- How to query, explain, list, and drop views
- How to define constraints with `logic.defineConstraint()`
- How constraint violations appear as errors on store operations
- How to manage constraints with `dropConstraint()` and `listConstraints()`

## Derived Views

### logic.defineView()

Define a derived view. Views can reference one or more buckets, join them, filter, group, aggregate, and sort:

```typescript
await client.logic.defineView({
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

**Signature:**

```typescript
defineView(definition: DerivedViewDefinition): Promise<void>
```

**DerivedViewDefinition:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique view name |
| `from` | `Record<string, string>` | yes | Alias-to-bucket mapping (at least one entry) |
| `select` | `Record<string, string \| Expression>` | yes | Output field mapping |
| `join` | `Record<string, string>` | no | Join conditions (e.g. `{ 'o.customerId': 'c.id' }`) |
| `where` | `Record<string, unknown>` | no | Filter expression |
| `groupBy` | `string \| readonly string[]` | no | Grouping fields |
| `orderBy` | `readonly OrderBySpec[]` | no | Sort specification |
| `limit` | `number` | no | Max rows returned |
| `reactive` | `boolean` | no | Enable reactive updates for subscriptions (default: `false`) |

### logic.queryView()

Query a view's current data:

```typescript
const rows = await client.logic.queryView('invoice_details');
for (const row of rows) {
  console.log(`${row.customerName}: ${row.total}`);
}
```

Returns an empty array when no records match.

### logic.explainView()

Get a view's execution plan — useful for debugging:

```typescript
const explanation = await client.logic.explainView('invoice_details');
console.log('Sources:', explanation.sources);
console.log('Joins:', explanation.joins);
console.log('Dependencies:', explanation.dependencies);
```

### logic.listViews()

List all defined views with summary information:

```typescript
const views = await client.logic.listViews();
for (const view of views) {
  console.log(`${view.name}: ${view.resultCount} rows (reactive: ${view.reactive})`);
}
```

### logic.dropView()

Remove a view definition. Returns `true` if the view existed and was removed:

```typescript
const dropped = await client.logic.dropView('invoice_details');
console.log(dropped); // true

const again = await client.logic.dropView('invoice_details');
console.log(again); // false (already removed)
```

## Constraints

### logic.defineConstraint()

Define an integrity constraint on a bucket. Constraints are automatically enforced on `store.insert` and `store.update` — records that violate a constraint are rejected with `VALIDATION_ERROR`:

```typescript
import { expr } from '@hamicek/noex-client';

await client.logic.defineConstraint({
  name: 'positive_balance',
  on: 'accounts',
  expr: expr.gte(expr.f('balance'), 0),
  message: 'Balance must be non-negative',
});
```

**Signature:**

```typescript
defineConstraint(constraint: ConstraintDefinition): Promise<void>
```

**ConstraintDefinition:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique constraint name |
| `on` | `string` | yes | Target bucket |
| `expr` | `Expression` | yes | Validation expression — must evaluate to `true` for valid records |
| `message` | `string` | yes | Error message shown on violation |
| `scope` | `'record' \| 'group'` | no | Evaluation scope |
| `groupBy` | `string` | no | Grouping field (for `scope: 'group'`) |
| `operations` | `readonly ('insert' \| 'update' \| 'delete')[]` | no | Which operations to check (default: insert and update) |

### Constraint Enforcement

Once defined, the constraint is checked on every insert and update to the target bucket:

```typescript
const accounts = client.store.bucket('accounts');

// This insert satisfies the constraint
await accounts.insert({ id: 'a1', balance: 100 }); // OK

// This insert violates the constraint
try {
  await accounts.insert({ id: 'a2', balance: -50 });
} catch (err) {
  console.log(err.code);    // 'VALIDATION_ERROR'
  console.log(err.message); // 'Balance must be non-negative'
}
```

### logic.dropConstraint()

Remove a constraint. After dropping, the validation is no longer enforced:

```typescript
const dropped = await client.logic.dropConstraint('positive_balance');
console.log(dropped); // true

// After dropping, negative balance is allowed
await accounts.insert({ id: 'a3', balance: -50 }); // OK now
```

### logic.listConstraints()

List all defined constraints:

```typescript
const constraints = await client.logic.listConstraints();
for (const c of constraints) {
  console.log(`${c.name} on ${c.on}: ${c.message}`);
}
```

## Error Codes

| Error Code | Cause |
|-----------|-------|
| `VALIDATION_ERROR` | Missing/invalid parameters, non-existent view, or constraint violation |
| `ALREADY_EXISTS` | View or constraint with the same name already exists |
| `LOGIC_NOT_AVAILABLE` | Logic engine not configured on the server |

## Complete Working Example

An order management system with views and constraints:

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const customers = client.store.bucket('customers');
  const invoices = client.store.bucket('invoices');

  // Insert data
  await customers.insert({ id: 'c1', name: 'Alice' });
  await invoices.insert({ id: 'inv1', customerId: 'c1', total: 200, status: 'paid' });
  await invoices.insert({ id: 'inv2', customerId: 'c1', total: 50, status: 'pending' });

  // Define a join view
  await client.logic.defineView({
    name: 'customer_invoices',
    from: { i: 'invoices', c: 'customers' },
    join: { 'i.customerId': 'c.id' },
    select: {
      customerName: 'c.name',
      invoiceId: 'i.id',
      total: 'i.total',
      status: 'i.status',
    },
  });

  // Query the view
  const rows = await client.logic.queryView('customer_invoices');
  console.log('Invoices:');
  for (const row of rows) {
    console.log(`  ${row.customerName} — ${row.invoiceId}: $${row.total} (${row.status})`);
  }

  // Define a constraint: invoice total must be positive
  await client.logic.defineConstraint({
    name: 'positive_total',
    on: 'invoices',
    expr: expr.gt(expr.f('total'), 0),
    message: 'Invoice total must be positive',
  });

  // This fails
  try {
    await invoices.insert({ id: 'inv3', customerId: 'c1', total: 0, status: 'draft' });
  } catch (err) {
    console.log(`Rejected: ${err.message}`);
  }

  // Clean up
  await client.logic.dropConstraint('positive_total');
  await client.logic.dropView('customer_invoices');

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Inserts customers and orders into their respective buckets
2. Defines a join view `customer_orders` showing customer name and order amount
3. Queries the view and logs all rows
4. Defines a constraint `min_order` requiring `amount >= 1`
5. Verifies that inserting an order with `amount: 0` throws `VALIDATION_ERROR`
6. Drops the constraint and verifies the same insert now succeeds

<details>
<summary>Solution</summary>

```typescript
import { NoexClient, expr, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const customers = client.store.bucket('customers');
  const orders = client.store.bucket('orders');

  // 1. Insert data
  await customers.insert({ id: 'c1', name: 'Alice' });
  await orders.insert({ id: 'o1', customerId: 'c1', amount: 150 });

  // 2. Define join view
  await client.logic.defineView({
    name: 'customer_orders',
    from: { o: 'orders', c: 'customers' },
    join: { 'o.customerId': 'c.id' },
    select: {
      customerName: 'c.name',
      amount: 'o.amount',
    },
  });

  // 3. Query and log
  const rows = await client.logic.queryView('customer_orders');
  for (const row of rows) {
    console.log(`${row.customerName}: ${row.amount}`);
  }

  // 4. Define constraint
  await client.logic.defineConstraint({
    name: 'min_order',
    on: 'orders',
    expr: expr.gte(expr.f('amount'), 1),
    message: 'Order amount must be at least 1',
  });

  // 5. Verify violation
  try {
    await orders.insert({ id: 'o2', customerId: 'c1', amount: 0 });
  } catch (err) {
    if (err instanceof NoexClientError) {
      console.log(`Rejected: ${err.code}`); // VALIDATION_ERROR
    }
  }

  // 6. Drop constraint, then insert succeeds
  await client.logic.dropConstraint('min_order');
  await orders.insert({ id: 'o2', customerId: 'c1', amount: 0 });
  console.log('Insert succeeded after dropping constraint');

  await client.logic.dropView('customer_orders');
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `logic.defineView(definition)` creates derived views — supports joins, filters, grouping, aggregation, sorting, and limits
- `logic.queryView(name)` returns the current data, `logic.explainView(name)` returns the execution plan
- `logic.listViews()` lists all views, `logic.dropView(name)` removes one — returns `true/false`
- `logic.defineConstraint(constraint)` enforces validation rules on store writes
- Constraint violations throw `NoexClientError` with code `VALIDATION_ERROR` and the constraint's message
- `logic.dropConstraint(name)` removes a constraint — inserts/updates are no longer checked
- `logic.listConstraints()` returns all defined constraints
- `ALREADY_EXISTS` is thrown when defining a view or constraint with a name that's already taken

---

Next: [View Subscriptions](./04-view-subscriptions.md)
