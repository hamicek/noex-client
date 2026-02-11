# Facts

Facts are persistent key-value pairs stored in the rule engine. Rules can reference facts when evaluating conditions, and your client code can read, write, and query them through the `rules` API. Unlike events (which are transient messages), facts represent **current state** — they persist until explicitly deleted or overwritten.

## What You'll Learn

- How to create and update facts with `setFact()`
- How to read facts with `getFact()` and delete them with `deleteFact()`
- How to query facts by pattern with `queryFacts()` and `getAllFacts()`
- The `Fact` object structure including versioning
- Key naming conventions using `:` as a segment separator

## Facts vs Events

| | Events | Facts |
|---|--------|-------|
| **Lifetime** | Transient — processed once | Persistent — exist until deleted |
| **Purpose** | Signal that something happened | Represent current state |
| **Versioning** | No | Yes — `version` increments on update |
| **API** | `emit()` | `setFact()`, `getFact()`, `deleteFact()`, `queryFacts()` |

The rule engine uses both: events trigger rule evaluation, facts provide context for rule conditions. For example, a rule might say "when `order.placed` event arrives, check the `user:*:tier` fact to decide the discount."

## setFact()

Creates or updates a fact. If the key already exists, the value is replaced and the version is incremented:

```typescript
const fact = await client.rules.setFact('user:1:role', 'admin');
console.log(fact.key);       // 'user:1:role'
console.log(fact.value);     // 'admin'
console.log(fact.version);   // 1
console.log(fact.timestamp); // server-assigned timestamp
```

Updating an existing fact:

```typescript
const updated = await client.rules.setFact('user:1:role', 'superadmin');
console.log(updated.version); // 2
```

**Signature:**

```typescript
setFact(key: string, value: unknown): Promise<Fact>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| key | `string` | Fact key (e.g. `'user:1:role'`) |
| value | `unknown` | Any JSON-serializable value |

Values can be primitives, arrays, or objects:

```typescript
await client.rules.setFact('counter', 42);
await client.rules.setFact('tags', ['urgent', 'vip']);
await client.rules.setFact('user:1:profile', {
  name: 'Alice',
  roles: ['admin', 'user'],
});
```

## Fact Object

Every `setFact()` call returns a `Fact` object:

```typescript
interface Fact {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly source: string;
  readonly version: number;
}
```

| Field | Description |
|-------|-------------|
| `key` | The fact key |
| `value` | The current value |
| `timestamp` | Last update time (Unix ms) |
| `source` | Identifier of the client that set the fact |
| `version` | Starts at 1, increments on each update |

## getFact()

Reads a fact's value by key. Returns `null` if the fact does not exist:

```typescript
const role = await client.rules.getFact('user:1:role');
if (role !== null) {
  console.log('Role:', role); // 'admin'
}

const missing = await client.rules.getFact('nonexistent');
console.log(missing); // null
```

**Signature:**

```typescript
getFact(key: string): Promise<unknown | null>
```

Note that `getFact()` returns only the **value**, not the full `Fact` object. If you need metadata (version, timestamp), use `queryFacts()` with the exact key or `getAllFacts()`.

## deleteFact()

Removes a fact by key. Returns `true` if the fact existed and was deleted, `false` if it didn't exist:

```typescript
await client.rules.setFact('temp', 42);

const deleted = await client.rules.deleteFact('temp');
console.log(deleted); // true

const again = await client.rules.deleteFact('temp');
console.log(again); // false (already deleted)

const value = await client.rules.getFact('temp');
console.log(value); // null
```

**Signature:**

```typescript
deleteFact(key: string): Promise<boolean>
```

## Key Naming Conventions

Facts use `:` as a segment separator in keys. This enables pattern-based querying with `queryFacts()`. The convention is `entity:id:attribute`:

```
user:1:role       → role of user 1
user:1:name       → name of user 1
user:2:role       → role of user 2
config:theme      → global theme setting
order:100:status  → status of order 100
```

This hierarchical naming lets you query all attributes of a user (`user:1:*`), all roles (`user:*:role`), or all config values (`config:*`).

## queryFacts()

Finds all facts matching a glob-like pattern. The `*` wildcard matches exactly one segment (delimited by `:`):

```typescript
await client.rules.setFact('user:1:name', 'Alice');
await client.rules.setFact('user:2:name', 'Bob');
await client.rules.setFact('user:1:role', 'admin');
await client.rules.setFact('product:1:title', 'Widget');

const names = await client.rules.queryFacts('user:*:name');
// Returns Fact[] — two facts: user:1:name and user:2:name
for (const fact of names) {
  console.log(`${fact.key} = ${fact.value}`);
}
```

**Signature:**

```typescript
queryFacts(pattern: string): Promise<Fact[]>
```

**Pattern matching rules:**

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `user:*` | `user:1`, `user:42` | `user:1:role` |
| `user:*:role` | `user:1:role`, `user:42:role` | `user:1`, `user:1:name` |
| `config:*` | `config:theme`, `config:lang` | `config:ui:theme` |

The `*` matches exactly one segment — `user:*` matches `user:1` but not `user:1:role` (that has three segments). To match three-segment keys, use `user:*:role` or `user:*:*`.

Returns an empty array when no facts match:

```typescript
const empty = await client.rules.queryFacts('nonexistent:*');
console.log(empty); // []
```

## getAllFacts()

Returns every fact currently in the engine:

```typescript
const facts = await client.rules.getAllFacts();
console.log(`Total facts: ${facts.length}`);

for (const fact of facts) {
  console.log(`${fact.key} (v${fact.version}) = ${JSON.stringify(fact.value)}`);
}
```

**Signature:**

```typescript
getAllFacts(): Promise<Fact[]>
```

Returns an empty array when no facts exist.

## Complete Working Example

A user profile management system using facts:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Store user profiles as facts
  await client.rules.setFact('user:1:name', 'Alice');
  await client.rules.setFact('user:1:role', 'admin');
  await client.rules.setFact('user:2:name', 'Bob');
  await client.rules.setFact('user:2:role', 'editor');
  await client.rules.setFact('user:3:name', 'Charlie');
  await client.rules.setFact('user:3:role', 'viewer');

  // Query all user names
  const names = await client.rules.queryFacts('user:*:name');
  console.log('All users:');
  for (const fact of names) {
    console.log(`  ${fact.key} = ${fact.value}`);
  }

  // Query all admins
  const roles = await client.rules.queryFacts('user:*:role');
  const admins = roles.filter((f) => f.value === 'admin');
  console.log(`\nAdmins: ${admins.map((f) => f.key).join(', ')}`);

  // Update a role
  const updated = await client.rules.setFact('user:3:role', 'editor');
  console.log(`\nCharlie promoted to editor (version ${updated.version})`);

  // Delete a user's data
  await client.rules.deleteFact('user:2:name');
  await client.rules.deleteFact('user:2:role');

  // Verify deletion
  const bobName = await client.rules.getFact('user:2:name');
  console.log(`\nBob's name after delete: ${bobName}`); // null

  // Check remaining facts
  const remaining = await client.rules.getAllFacts();
  console.log(`\nTotal facts remaining: ${remaining.length}`);

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Write a script that:
1. Stores configuration facts: `config:app:name` = `'MyApp'`, `config:app:version` = `'2.0'`, `config:db:host` = `'localhost'`
2. Queries all `config:app:*` facts and logs them
3. Updates `config:app:version` to `'2.1'` and verifies the version field incremented
4. Deletes `config:db:host` and confirms it returns `true`
5. Calls `getAllFacts()` and logs the total count

<details>
<summary>Solution</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // 1. Store config facts
  await client.rules.setFact('config:app:name', 'MyApp');
  const v1 = await client.rules.setFact('config:app:version', '2.0');
  await client.rules.setFact('config:db:host', 'localhost');

  // 2. Query app config
  const appConfig = await client.rules.queryFacts('config:app:*');
  console.log('App config:');
  for (const fact of appConfig) {
    console.log(`  ${fact.key} = ${fact.value}`);
  }
  // config:app:name = MyApp
  // config:app:version = 2.0

  // 3. Update version and check version field
  const v2 = await client.rules.setFact('config:app:version', '2.1');
  console.log(`\nVersion before: ${v1.version}, after: ${v2.version}`);
  // Version before: 1, after: 2

  // 4. Delete db host
  const deleted = await client.rules.deleteFact('config:db:host');
  console.log(`\nDeleted config:db:host: ${deleted}`); // true

  // 5. Count remaining facts
  const all = await client.rules.getAllFacts();
  console.log(`\nTotal facts: ${all.length}`); // 2

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Summary

- `setFact(key, value)` creates or updates a fact, incrementing `version` on each update
- `getFact(key)` returns the value or `null` — not the full `Fact` object
- `deleteFact(key)` returns `true` if deleted, `false` if the key didn't exist
- `queryFacts(pattern)` finds facts matching a glob pattern where `*` matches one `:` segment
- `getAllFacts()` returns every fact in the engine
- Use `:` as a segment separator in keys: `entity:id:attribute`
- Pattern `user:*` matches `user:1` but **not** `user:1:role` — segments are exact
- Values can be any JSON-serializable type: primitives, arrays, objects

---

Next: [Rules Subscriptions](./03-rules-subscriptions.md)
