# Typové buckety

Dosud jsme používali `bucket('name')` bez typového parametru, což znamená, že každý záznam je `Record<string, unknown>`. To funguje, ale přicházíte o schopnost TypeScriptu odhalit chyby v době kompilace. Tato kapitola ukazuje, jak použít generika `BucketAPI<T>` pro plnou typovou bezpečnost.

## Co se naučíte

- Jak definovat typ záznamu a předat ho do `bucket<T>()`
- Jak funguje `T & RecordMeta` v návratových typech
- Co kompilátor kontroluje u payloadů `insert()` a `update()`
- Osvědčené postupy pro strukturování typů záznamů

## Problém: Netypované záznamy

Bez generik dostanete `Record<string, unknown>`:

```typescript
const users = client.store.bucket('users');
const alice = await users.insert({ name: 'Alice', role: 'admin' });

// Žádná typová bezpečnost — TypeScript neví, jaká pole existují
console.log(alice.name);  // typ: unknown
console.log(alice.roles); // žádná chyba — překlep zůstane nedetekován
```

Kompilátor vám nemůže pomoci, protože nezná tvar vašich dat.

## Řešení: BucketAPI\<T\>

Definujte rozhraní pro váš záznam a předejte ho jako typový parametr:

```typescript
interface User {
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  email: string;
}

const users = client.store.bucket<User>('users');
```

Nyní jsou všechny operace typově informované:

```typescript
// insert() — musí poskytnout všechna pole User (kromě RecordMeta)
const alice = await users.insert({
  name: 'Alice',
  role: 'admin',
  email: 'alice@example.com',
});

// Návratový typ je User & RecordMeta
alice.name;        // string ✓
alice.role;        // 'admin' | 'editor' | 'viewer' ✓
alice.email;       // string ✓
alice.id;          // string ✓ (z RecordMeta)
alice._version;    // number ✓ (z RecordMeta)
alice._createdAt;  // number ✓ (z RecordMeta)
alice._updatedAt;  // number ✓ (z RecordMeta)
```

### Detekce chyb v době kompilace

```typescript
// Chybějící povinné pole — chyba kompilace
await users.insert({
  name: 'Bob',
  role: 'editor',
  // ✗ Property 'email' is missing
});

// Špatný typ — chyba kompilace
await users.insert({
  name: 'Bob',
  role: 'superadmin', // ✗ Type '"superadmin"' is not assignable to type '"admin" | "editor" | "viewer"'
  email: 'bob@example.com',
});

// Překlep v přístupu k poli — chyba kompilace
const user = await users.get('user-1');
if (user) {
  console.log(user.emial); // ✗ Property 'emial' does not exist
}
```

## Jak funguje T & RecordMeta

Každá metoda, která vrací záznamy, používá průnikový typ `T & RecordMeta`:

```typescript
interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}

// Když T = User, návratový typ je:
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

Parametr `insert()` má typ `Omit<T, keyof RecordMeta>` — vaše pole minus serverem spravovaná metadata:

```typescript
// Vy zadáváte:
{ name: string; role: string; email: string }

// Server vrací:
{ name: string; role: string; email: string; id: string; _version: number; _createdAt: number; _updatedAt: number }
```

Parametr `update()` má typ `Partial<Omit<T, keyof RecordMeta>>` — volitelné verze vašich polí:

```typescript
// Všechny tyto update payloady jsou validní:
await users.update(id, { name: 'New Name' });
await users.update(id, { role: 'viewer' });
await users.update(id, { name: 'New Name', email: 'new@example.com' });
```

## Typové dotazy

Dotazovací metody jsou rovněž typově informované:

```typescript
interface Product {
  name: string;
  category: string;
  price: number;
  inStock: boolean;
}

const products = client.store.bucket<Product>('products');

// all() vrací (Product & RecordMeta)[]
const all = await products.all();
all[0].price; // number ✓

// where() filtr je Partial<Product>
const electronics = await products.where({ category: 'electronics' });
electronics[0].name; // string ✓

// findOne() vrací (Product & RecordMeta) | null
const cheapest = await products.findOne({ inStock: true });
if (cheapest) {
  cheapest.price; // number ✓
}

// count() přijímá Partial<Product>
const outOfStockCount = await products.count({ inStock: false });
```

## Typové stránkování

Výsledky stránkování jsou také generické:

```typescript
const page = await products.paginate({ limit: 10 });
// page.records: (Product & RecordMeta)[]

for (const product of page.records) {
  console.log(product.name, product.price); // plně typované
}
```

## Strukturování typů záznamů

### Správně: Definujte rozhraní

```typescript
interface Task {
  title: string;
  completed: boolean;
  priority: number;
  assignee: string | null;
}

const tasks = client.store.bucket<Task>('tasks');
```

### Správně: Používejte union typy pro omezená pole

```typescript
interface Ticket {
  title: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

### Špatně: Nezahrnujte RecordMeta do svého typu

```typescript
// ✗ Nedělejte toto — RecordMeta se přidává automaticky
interface User {
  id: string;          // konflikt s RecordMeta.id
  _version: number;    // konflikt s RecordMeta._version
  name: string;
}

// ✓ Dělejte toto — pouze vaše datová pole
interface User {
  name: string;
  email: string;
}
```

### Špatně: Nepoužívejte příliš obecné typy

```typescript
// ✗ Maří účel generik
const users = client.store.bucket<Record<string, unknown>>('users');

// ✓ Definujte konkrétní pole
const users = client.store.bucket<{ name: string; email: string }>('users');
```

## Kompletní funkční příklad

Plně typovaný systém pro správu úkolů:

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

  // Insert — všechna pole Task jsou povinná
  const task = await tasks.insert({
    title: 'Write typed bucket docs',
    completed: false,
    priority: 1,
    tags: ['docs', 'typescript'],
  });

  // Návratový typ: Task & RecordMeta
  console.log(`${task.title} (id: ${task.id}, v${task._version})`);

  // Update — částečná pole Task
  const updated = await tasks.update(task.id, { completed: true });
  console.log(`Completed: ${updated.completed}, v${updated._version}`);

  // Query — typované výsledky
  const pending = await tasks.where({ completed: false });
  console.log(`Pending tasks: ${pending.length}`);

  const highPriority = await tasks.findOne({ priority: 1 });
  if (highPriority) {
    console.log(`High priority: ${highPriority.title}`);
    console.log(`Tags: ${highPriority.tags.join(', ')}`);
  }

  // Agregace — funguje na typovaných polích
  const avgPriority = await tasks.avg('priority');
  console.log(`Average priority: ${avgPriority}`);

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Definujte typy pro blogový systém se dvěma buckety:
1. `posts` s poli: `title` (string), `body` (string), `published` (boolean), `authorId` (string)
2. `comments` s poli: `postId` (string), `text` (string), `authorName` (string)

Poté napište funkci, která:
1. Vytvoří typovaný handle pro každý bucket
2. Vloží jeden příspěvek a dva komentáře
3. Dotáže se na komentáře podle `postId`
4. Vrátí příspěvek s jeho typovanými komentáři

<details>
<summary>Řešení</summary>

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

  // Vložení příspěvku — všechna pole Post jsou povinná, RecordMeta se vrátí
  const post = await posts.insert({
    title: 'TypeScript Generics',
    body: 'Generics enable type-safe reusable code...',
    published: true,
    authorId: 'author-1',
  });

  // Vložení komentářů — postId je odkazuje na příspěvek
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

  // Dotaz na komentáře podle postId — typováno jako (Comment & RecordMeta)[]
  const postComments = await comments.where({ postId: post.id });

  return {
    post,
    comments: postComments,
  };
}
```

Filtr `where({ postId: post.id })` je typově kontrolován: pokud uděláte překlep v `postId`, TypeScript ho zachytí v době kompilace.

</details>

## Shrnutí

- `client.store.bucket<T>('name')` vytvoří typovaný handle na bucket, kde všechny operace používají `T`
- Návratové typy jsou `T & RecordMeta` — vaše pole plus serverem generované `id`, `_version`, `_createdAt`, `_updatedAt`
- `insert()` přijímá `Omit<T, keyof RecordMeta>` — všechna vaše pole, bez metadat
- `update()` přijímá `Partial<Omit<T, keyof RecordMeta>>` — libovolnou podmnožinu vašich polí
- Dotazovací metody (`where`, `findOne`, `count`) přijímají `Partial<T>` pro typově bezpečné filtrování
- Definujte typy záznamů jako rozhraní bez polí `RecordMeta` — přidávají se automaticky
- Používejte union typy pro omezené hodnoty (role, stavy) pro validaci v době kompilace

---

Další: [Odběr dotazů](../04-odbery/01-odber-dotazu.md)
