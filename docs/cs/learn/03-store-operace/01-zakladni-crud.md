# Základní CRUD

Store je primární datová vrstva noex-serveru. Pracujete s ním prostřednictvím **bucketů** — pojmenovaných kolekcí záznamů, podobných databázovým tabulkám. Tato kapitola pokrývá čtyři základní operace: vytvoření, čtení, aktualizaci a smazání.

## Co se naučíte

- Jak získat handle na bucket pomocí `client.store.bucket()`
- Jak vytvářet záznamy pomocí `insert()`
- Jak číst záznamy pomocí `get()`
- Jak aktualizovat záznamy pomocí `update()`
- Jak mazat záznamy pomocí `delete()`
- Jaká pole `RecordMeta` server přidává ke každému záznamu

## Buckety

Bucket je pojmenovaná kolekce záznamů na serveru. Přistupujete k němu přes store API:

```typescript
const users = client.store.bucket('users');
```

`bucket()` neprovádí síťový požadavek. Vrací lehký handle `BucketAPI`, který připojí název bucketu ke každé následující operaci. Buckety se na serveru vytvářejí implicitně při prvním vložení záznamu.

```typescript
// Jedná se o stejný bucket — žádná duplikace
const a = client.store.bucket('users');
const b = client.store.bucket('users');
```

## RecordMeta

Každý záznam uložený v bucketu dostane serverem generovaná metadata:

```typescript
interface RecordMeta {
  readonly id: string;         // unikátní identifikátor (generovaný serverem)
  readonly _version: number;   // inkrementuje se při každé aktualizaci
  readonly _createdAt: number; // Unix timestamp (ms) při vložení
  readonly _updatedAt: number; // Unix timestamp (ms) poslední aktualizace
}
```

Všechny CRUD operace, které vracejí záznamy, obsahují tato pole společně s vašimi daty. Například pokud vložíte `{ name: 'Alice' }`, server vrátí `{ id: 'rec-1', name: 'Alice', _version: 1, _createdAt: 1706745600000, _updatedAt: 1706745600000 }`.

## insert()

Vytvoří nový záznam v bucketu. Server generuje `id` a pole metadat.

```typescript
const users = client.store.bucket('users');

const alice = await users.insert({ name: 'Alice', role: 'admin' });

console.log(alice.id);          // např. 'rec-abc123'
console.log(alice.name);        // 'Alice'
console.log(alice.role);        // 'admin'
console.log(alice._version);    // 1
console.log(alice._createdAt);  // 1706745600000
console.log(alice._updatedAt);  // 1706745600000
```

**Signatura:**

```typescript
insert(data: Record<string, unknown>): Promise<Record<string, unknown> & RecordMeta>
```

Zadáte datová pole. Server vrátí vaše data sloučená s `RecordMeta`.

## get()

Načte jeden záznam podle klíče (typicky `id`). Vrátí `null`, pokud záznam neexistuje.

```typescript
const users = client.store.bucket('users');

const alice = await users.get('rec-abc123');

if (alice) {
  console.log(alice.name); // 'Alice'
} else {
  console.log('Not found');
}
```

**Signatura:**

```typescript
get(key: unknown): Promise<(Record<string, unknown> & RecordMeta) | null>
```

Vždy kontrolujte `null` — záznam mohl být smazán jiným klientem.

## update()

Aktualizuje existující záznam. Zadáváte pouze pole, která chcete změnit — vynechaná pole si ponechají své stávající hodnoty. Server inkrementuje `_version` a aktualizuje `_updatedAt`.

```typescript
const users = client.store.bucket('users');

const updated = await users.update('rec-abc123', { role: 'editor' });

console.log(updated.name);       // 'Alice' (beze změny)
console.log(updated.role);       // 'editor' (aktualizováno)
console.log(updated._version);   // 2
console.log(updated._updatedAt); // novější timestamp
```

**Signatura:**

```typescript
update(key: unknown, data: Record<string, unknown>): Promise<Record<string, unknown> & RecordMeta>
```

Vrácený záznam obsahuje kompletní aktuální stav — jak změněná, tak nezměněná pole.

## delete()

Odstraní záznam z bucketu. Vrací `void` — žádný potvrzovací payload.

```typescript
const users = client.store.bucket('users');

await users.delete('rec-abc123');

const gone = await users.get('rec-abc123');
console.log(gone); // null
```

**Signatura:**

```typescript
delete(key: unknown): Promise<void>
```

## clear()

Odstraní všechny záznamy z bucketu:

```typescript
const users = client.store.bucket('users');
await users.clear();
```

Používejte opatrně — tato operace je nevratná.

## Kompletní funkční příklad

Úplný CRUD lifecycle: vytvoření, čtení, aktualizace, ověření, smazání, ověření:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const tasks = client.store.bucket('tasks');

  // Vytvoření
  const task = await tasks.insert({
    title: 'Write documentation',
    completed: false,
    priority: 1,
  });
  console.log('Created:', task.id, task.title);

  // Čtení
  const fetched = await tasks.get(task.id);
  console.log('Read:', fetched?.title, 'completed:', fetched?.completed);

  // Aktualizace
  const updated = await tasks.update(task.id, { completed: true });
  console.log('Updated:', updated.title, 'completed:', updated.completed);
  console.log('Version:', updated._version); // 2

  // Smazání
  await tasks.delete(task.id);
  const gone = await tasks.get(task.id);
  console.log('Deleted:', gone === null); // true

  await client.disconnect();
}

main().catch(console.error);
```

## Ošetření chyb

CRUD operace mohou vyhodit chybu:

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await users.update('nonexistent-id', { name: 'Bob' });
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // např. 'NOT_FOUND'
    console.log(err.message); // popis čitelný pro člověka
  }
  if (err instanceof TimeoutError) {
    console.log('Server did not respond in time');
  }
  if (err instanceof DisconnectedError) {
    console.log('Not connected to server');
  }
}
```

## Cvičení

Napište skript, který spravuje jednoduchý inventář:
1. Vytvořte bucket `products`
2. Vložte tři produkty s poli `name` a `price`
3. Aktualizujte cenu druhého produktu
4. Smažte třetí produkt
5. Načtěte první produkt a vypište všechna jeho pole včetně metadat

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const products = client.store.bucket('products');

  // Vložení tří produktů
  const laptop = await products.insert({ name: 'Laptop', price: 999 });
  const mouse = await products.insert({ name: 'Mouse', price: 29 });
  const keyboard = await products.insert({ name: 'Keyboard', price: 79 });

  console.log('Created:', laptop.id, mouse.id, keyboard.id);

  // Aktualizace ceny druhého produktu
  const updatedMouse = await products.update(mouse.id, { price: 24.99 });
  console.log('Updated mouse price:', updatedMouse.price); // 24.99

  // Smazání třetího produktu
  await products.delete(keyboard.id);

  // Načtení prvního produktu se všemi metadaty
  const fetched = await products.get(laptop.id);
  if (fetched) {
    console.log('Product:', {
      id: fetched.id,
      name: fetched.name,
      price: fetched.price,
      _version: fetched._version,
      _createdAt: new Date(fetched._createdAt as number).toISOString(),
      _updatedAt: new Date(fetched._updatedAt as number).toISOString(),
    });
  }

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- Buckety jsou pojmenované kolekce záznamů přístupné přes `client.store.bucket('name')`
- `bucket()` je líný přístupový bod — žádný síťový požadavek, pouze handle
- `insert(data)` vytvoří záznam a vrátí ho se serverem generovanými `RecordMeta` (`id`, `_version`, `_createdAt`, `_updatedAt`)
- `get(key)` vrací záznam nebo `null`
- `update(key, data)` sloučí částečná data do existujícího záznamu a inkrementuje `_version`
- `delete(key)` odstraní záznam
- `clear()` odstraní všechny záznamy z bucketu
- Všechny operace jsou `async` a vyhazují typované chyby (`NoexClientError`, `TimeoutError`, `DisconnectedError`)

---

Další: [Dotazy](./02-dotazy.md)
