# Typed Buckets

So far we've used `bucket('name')` without a type parameter, which means every record is `Record<string, unknown>`. This works, but you lose TypeScript's ability to catch mistakes at compile time. This chapter shows how to use `BucketAPI<T>` generics for full type safety.

## What You'll Learn

- How to define a record type and pass it to `bucket<T>()`
- How `T & RecordMeta` works in return types
- What the compiler checks on `insert()` and `update()` payloads
- Best practices for structuring record types

## The Problem: Untyped Records

Without generics, you get `Record<string, unknown>`:

```typescript
const users = client.store.bucket('users');
const alice = await users.insert({ name: 'Alice', role: 'admin' });

// No type safety — TypeScript doesn't know what fields exist
console.log(alice.name);  // type: unknown
console.log(alice.roles); // no error — typo goes undetected
```

The compiler can't help you because it doesn't know the shape of your data.

## The Solution: BucketAPI\<T\>

Define an interface for your record and pass it as a type parameter:

```typescript
interface User {
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  email: string;
}

const users = client.store.bucket<User>('users');
```

Now every operation is type-aware:

```typescript
// insert() — must provide all User fields (except RecordMeta)
const alice = await users.insert({
  name: 'Alice',
  role: 'admin',
  email: 'alice@example.com',
});

// The return type is User & RecordMeta
alice.name;        // string ✓
alice.role;        // 'admin' | 'editor' | 'viewer' ✓
alice.email;       // string ✓
alice.id;          // string ✓ (from RecordMeta)
alice._version;    // number ✓ (from RecordMeta)
alice._createdAt;  // number ✓ (from RecordMeta)
alice._updatedAt;  // number ✓ (from RecordMeta)
```

### Compile-Time Error Detection

```typescript
// Missing required field — compile error
await users.insert({
  name: 'Bob',
  role: 'editor',
  // ✗ Property 'email' is missing
});

// Wrong type — compile error
await users.insert({
  name: 'Bob',
  role: 'superadmin', // ✗ Type '"superadmin"' is not assignable to type '"admin" | "editor" | "viewer"'
  email: 'bob@example.com',
});

// Typo in field access — compile error
const user = await users.get('user-1');
if (user) {
  console.log(user.emial); // ✗ Property 'emial' does not exist
}
```

## How T & RecordMeta Works

Every method that returns records uses the intersection type `T & RecordMeta`:

```typescript
interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}

// When T = User, the return type is:
// {
//   name: string;
//   role: 'admin' | 'editor' | 'viewer';
//   email: string;
//   id: string;
//   _version: number;
//   _createdAt: number;
//   _updatedAt: number;
// }
```

The `insert()` parameter type is `Omit<T, keyof RecordMeta>` — your fields minus the server-managed metadata:

```typescript
// You provide:
{ name: string; role: string; email: string }

// Server returns:
{ name: string; role: string; email: string; id: string; _version: number; _createdAt: number; _updatedAt: number }
```

The `update()` parameter type is `Partial<Omit<T, keyof RecordMeta>>` — optional versions of your fields:

```typescript
// All of these are valid update payloads:
await users.update(id, { name: 'New Name' });
await users.update(id, { role: 'viewer' });
await users.update(id, { name: 'New Name', email: 'new@example.com' });
```

## Typed Queries

Query methods are also type-aware:

```typescript
interface Product {
  name: string;
  category: string;
  price: number;
  inStock: boolean;
}

const products = client.store.bucket<Product>('products');

// all() returns (Product & RecordMeta)[]
const all = await products.all();
all[0].price; // number ✓

// where() filter is Partial<Product>
const electronics = await products.where({ category: 'electronics' });
electronics[0].name; // string ✓

// findOne() returns (Product & RecordMeta) | null
const cheapest = await products.findOne({ inStock: true });
if (cheapest) {
  cheapest.price; // number ✓
}

// count() accepts Partial<Product>
const outOfStockCount = await products.count({ inStock: false });
```

## Typed Pagination

Pagination results are also generic:

```typescript
const page = await products.paginate({ limit: 10 });
// page.records: (Product & RecordMeta)[]

for (const product of page.records) {
  console.log(product.name, product.price); // fully typed
}
```

## Structuring Record Types

### Do: Define Interfaces

```typescript
interface Task {
  title: string;
  completed: boolean;
  priority: number;
  assignee: string | null;
}

const tasks = client.store.bucket<Task>('tasks');
```

### Do: Use Union Types for Constrained Fields

```typescript
interface Ticket {
  title: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

### Don't: Include RecordMeta in Your Type

```typescript
// ✗ Don't do this — RecordMeta is added automatically
interface User {
  id: string;          // conflict with RecordMeta.id
  _version: number;    // conflict with RecordMeta._version
  name: string;
}

// ✓ Do this — only your data fields
interface User {
  name: string;
  email: string;
}
```

### Don't: Use Overly Broad Types

```typescript
// ✗ Defeats the purpose of generics
const users = client.store.bucket<Record<string, unknown>>('users');

// ✓ Define specific fields
const users = client.store.bucket<{ name: string; email: string }>('users');
```

## Complete Working Example

A fully typed task management system:

```typescript
import { NoexClient, RecordMeta } from '@hamicek/noex-client';
import WebSocket from 'ws';

interface Task {
  title: string;
  completed: boolean;
  priority: number;
  tags: string[];
}

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const tasks = client.store.bucket<Task>('tasks');

  // Insert — all Task fields required
  const task = await tasks.insert({
    title: 'Write typed bucket docs',
    completed: false,
    priority: 1,
    tags: ['docs', 'typescript'],
  });

  // Return type: Task & RecordMeta
  console.log(`${task.title} (id: ${task.id}, v${task._version})`);

  // Update — partial Task fields
  const updated = await tasks.update(task.id, { completed: true });
  console.log(`Completed: ${updated.completed}, v${updated._version}`);

  // Query — typed results
  const pending = await tasks.where({ completed: false });
  console.log(`Pending tasks: ${pending.length}`);

  const highPriority = await tasks.findOne({ priority: 1 });
  if (highPriority) {
    console.log(`High priority: ${highPriority.title}`);
    console.log(`Tags: ${highPriority.tags.join(', ')}`);
  }

  // Aggregation — works on typed fields
  const avgPriority = await tasks.avg('priority');
  console.log(`Average priority: ${avgPriority}`);

  await client.disconnect();
}

main().catch(console.error);
```

## Exercise

Define types for a blog system with two buckets:
1. `posts` with fields: `title` (string), `body` (string), `published` (boolean), `authorId` (string)
2. `comments` with fields: `postId` (string), `text` (string), `authorName` (string)

Then write a function that:
1. Creates a typed bucket handle for each
2. Inserts a post and two comments
3. Queries comments by `postId`
4. Returns the post with its typed comments

<details>
<summary>Solution</summary>

```typescript
interface Post {
  title: string;
  body: string;
  published: boolean;
  authorId: string;
}

interface Comment {
  postId: string;
  text: string;
  authorName: string;
}

async function createPostWithComments(client: NoexClient) {
  const posts = client.store.bucket<Post>('posts');
  const comments = client.store.bucket<Comment>('comments');

  // Insert a post — all Post fields required, RecordMeta returned
  const post = await posts.insert({
    title: 'TypeScript Generics',
    body: 'Generics enable type-safe reusable code...',
    published: true,
    authorId: 'author-1',
  });

  // Insert comments — postId links to the post
  await comments.insert({
    postId: post.id,
    text: 'Great article!',
    authorName: 'Alice',
  });

  await comments.insert({
    postId: post.id,
    text: 'Very helpful, thanks.',
    authorName: 'Bob',
  });

  // Query comments by postId — typed as (Comment & RecordMeta)[]
  const postComments = await comments.where({ postId: post.id });

  return {
    post,
    comments: postComments,
  };
}
```

The `where({ postId: post.id })` filter is type-checked: if you misspell `postId`, TypeScript catches it at compile time.

</details>

## Summary

- `client.store.bucket<T>('name')` creates a typed bucket handle where all operations use `T`
- Return types are `T & RecordMeta` — your fields plus server-generated `id`, `_version`, `_createdAt`, `_updatedAt`
- `insert()` accepts `Omit<T, keyof RecordMeta>` — all your fields, no metadata
- `update()` accepts `Partial<Omit<T, keyof RecordMeta>>` — any subset of your fields
- Query methods (`where`, `findOne`, `count`) accept `Partial<T>` for type-safe filtering
- Define record types as interfaces without `RecordMeta` fields — they're added automatically
- Use union types for constrained values (roles, statuses) to get compile-time validation

---

Next: [Subscribing to Queries](../04-subscriptions/01-subscribing.md)
