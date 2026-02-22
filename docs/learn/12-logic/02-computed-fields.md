# Computed Fields

Define fields that are automatically computed from other fields whenever records are inserted or updated. The client SDK provides `defineComputed()`, `dropComputed()`, and `listComputed()` on the `logic` namespace.

## What You'll Learn

- How to define computed fields with `logic.defineComputed()`
- The `ComputedFieldDefinition` structure — `depends` and `expr`
- Auto-recomputation on `store.insert` and `store.update`
- How to remove and list computed field configurations
- Using the `expr` helper to build field expressions

## logic.defineComputed()

Define computed fields on a bucket. Each field specifies which source fields it depends on and an expression to compute its value:

```typescript
import { expr } from '@hamicek/noex-client';

await client.logic.defineComputed('items', {
  total: {
    depends: ['qty', 'price'],
    expr: expr.multiply(expr.f('qty'), expr.f('price')),
  },
});
```

**Signature:**

```typescript
defineComputed(
  bucket: string,
  fields: Record<string, ComputedFieldDefinition>,
): Promise<void>
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| bucket | `string` | yes | Target bucket name |
| fields | `Record<string, ComputedFieldDefinition>` | yes | Map of field name to definition |

**ComputedFieldDefinition:**

```typescript
interface ComputedFieldDefinition {
  readonly depends: readonly string[];
  readonly expr: Expression;
}
```

| Field | Description |
|-------|-------------|
| `depends` | Array of source field names the computation reads from |
| `expr` | Expression using `$fieldName` references to compute the value |

## Auto-Recomputation

Once defined, computed fields are automatically calculated when records are inserted or updated through the store:

```typescript
import { expr } from '@hamicek/noex-client';

// Define: total = qty * price
await client.logic.defineComputed('items', {
  total: {
    depends: ['qty', 'price'],
    expr: expr.multiply(expr.f('qty'), expr.f('price')),
  },
});

// Insert a record
const items = client.store.bucket('items');
await items.insert({ id: 'i1', qty: 3, price: 10 });

// The computed field is available
const record = await items.get('i1');
console.log(record.total); // 30
```

Updating a dependency field triggers recomputation:

```typescript
await items.update('i1', { qty: 5 });
const updated = await items.get('i1');
console.log(updated.total); // 50
```

## logic.dropComputed()

Remove all computed fields from a bucket. Returns `true` if definitions existed and were removed, `false` otherwise:

```typescript
const dropped = await client.logic.dropComputed('items');
console.log(dropped); // true

const again = await client.logic.dropComputed('items');
console.log(again); // false (already removed)
```

**Signature:**

```typescript
dropComputed(bucket: string): Promise<boolean>
```

After dropping, new inserts and updates no longer compute the fields.

## logic.listComputed()

List all computed field configurations:

```typescript
const configs = await client.logic.listComputed();
for (const config of configs) {
  console.log(`Bucket: ${config.bucket}`);
  console.log(`Fields: ${Object.keys(config.fields).join(', ')}`);
}
```

**Signature:**

```typescript
listComputed(): Promise<ComputedFieldsConfig[]>
```

Returns an empty array when no computed fields are defined.

**ComputedFieldsConfig:**

```typescript
interface ComputedFieldsConfig {
  readonly bucket: string;
  readonly fields: Record<string, ComputedFieldDefinition>;
}
```

## Error Handling

```typescript
import { NoexClientError } from '@hamicek/noex-client';

try {
  await client.logic.defineComputed('items', {
    total: {
      depends: ['qty', 'price'],
      expr: expr.multiply(expr.f('qty'), expr.f('price')),
    },
  });
} catch (err) {
  if (err instanceof NoexClientError) {
    // VALIDATION_ERROR — missing bucket or fields
    // LOGIC_NOT_AVAILABLE — server has no logic engine
    console.log(err.code, err.message);
  }
}
```

## Complete Working Example

An order line management system with computed totals:

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const items = client.store.bucket('items');

  // Define computed field: total = qty * price
  await client.logic.defineComputed('items', {
    total: {
      depends: ['qty', 'price'],
      expr: expr.multiply(expr.f('qty'), expr.f('price')),
    },
  });

  // Insert items — computed field is auto-calculated
  await items.insert({ id: 'widget', qty: 3, price: 10 });
  await items.insert({ id: 'gadget', qty: 1, price: 25 });

  // Verify computed values
  const widget = await items.get('widget');
  console.log(`Widget total: ${widget.total}`); // 30

  const gadget = await items.get('gadget');
  console.log(`Gadget total: ${gadget.total}`); // 25

  // Update triggers recomputation
  await items.update('widget', { qty: 5 });
  const updated = await items.get('widget');
  console.log(`Widget total after update: ${updated.total}`); // 50

  // List configurations
  const configs = await client.logic.listComputed();
  console.log(`Configurations: ${configs.length}`); // 1
  console.log(`Bucket: ${configs[0].bucket}`); // 'items'

  // Clean up
  await client.logic.dropComputed('items');

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Defines a computed field `discountedPrice` on a bucket, calculated as `price * (1 - discountRate)` — use `expr.multiply(expr.f('price'), expr.subtract(1, expr.f('discountRate')))`
2. Inserts a product with `price: 100` and `discountRate: 0.2`
3. Reads the product back and verifies `discountedPrice` is `80`
4. Lists computed configs to confirm the definition exists
5. Drops the computed fields

<details>
<summary>Solution</summary>

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const products = client.store.bucket('products');

  // 1. Define computed field
  await client.logic.defineComputed('products', {
    discountedPrice: {
      depends: ['price', 'discountRate'],
      expr: expr.multiply(
        expr.f('price'),
        expr.subtract(1, expr.f('discountRate')),
      ),
    },
  });

  // 2. Insert product
  await products.insert({ id: 'p1', price: 100, discountRate: 0.2 });

  // 3. Verify
  const product = await products.get('p1');
  console.log(`Discounted price: ${product.discountedPrice}`); // 80

  // 4. List configs
  const configs = await client.logic.listComputed();
  console.log(`Configs: ${configs.length}`); // 1

  // 5. Drop
  const dropped = await client.logic.dropComputed('products');
  console.log(`Dropped: ${dropped}`); // true

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `logic.defineComputed(bucket, fields)` defines computed fields — each field has `depends` (source fields) and `expr` (expression)
- Computed fields are automatically recalculated on `store.insert` and `store.update`
- Use `expr` helper for type-safe expressions: `expr.multiply(expr.f('qty'), expr.f('price'))`
- `logic.dropComputed(bucket)` removes definitions — returns `true` if removed, `false` if nothing existed
- `logic.listComputed()` returns all configurations as `ComputedFieldsConfig[]`
- `LOGIC_NOT_AVAILABLE` is thrown when the server has no logic engine configured

---

Next: [Views and Constraints](./03-views-and-constraints.md)
