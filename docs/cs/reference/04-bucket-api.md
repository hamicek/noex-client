# Bucket API

Typovaný přístup k jednomu bucketu — CRUD operace, dotazy, agregace a hromadné operace. Získává se přes `store.bucket<T>(name)`.

`BucketAPI<T>` je generická třída — typový parametr `T` popisuje tvar vašich záznamů (bez serverem spravovaných metadat). Všechny metody vracející záznamy produkují `T & RecordMeta`, což přidává pole `id`, `_version`, `_createdAt` a `_updatedAt`.

## Import

Instance `BucketAPI` se nevytvářejí přímo. Použijte `StoreAPI.bucket()`:

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

interface User {
  name: string;
  email: string;
  age: number;
}

const users = client.store.bucket<User>('users');
```

`BucketAPI` je také exportován pro typové anotace:

```typescript
import type { BucketAPI } from '@hamicek/noex-client';
```

---

## CRUD metody

### insert()

```typescript
insert(data: Omit<T, keyof RecordMeta>): Promise<T & RecordMeta>
```

Vytvoří nový záznam v bucketu. Server automaticky generuje `id`, `_version`, `_createdAt` a `_updatedAt`.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| data | `Omit<T, keyof RecordMeta>` | ano | Data záznamu (bez polí metadat) |

**Návratová hodnota:** `Promise<T & RecordMeta>` — vytvořený záznam včetně serverem generovaných metadat

**Vyhazuje:**
- `NoexClientError` pokud server odmítne vložení (např. chyba validace)
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const user = await users.insert({ name: 'Alice', email: 'alice@example.com', age: 30 });
console.log(user.id);         // '550e8400-...'
console.log(user._version);   // 1
console.log(user._createdAt); // 1700000000000
```

---

### get()

```typescript
get(key: unknown): Promise<(T & RecordMeta) | null>
```

Získá jeden záznam podle klíče. Vrací `null`, pokud záznam neexistuje.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| key | `unknown` | ano | Klíč záznamu (typicky `id`) |

**Návratová hodnota:** `Promise<(T & RecordMeta) | null>` — záznam, nebo `null` pokud nebyl nalezen

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const user = await users.get('550e8400-...');
if (user) {
  console.log(user.name); // 'Alice'
}
```

---

### update()

```typescript
update(key: unknown, data: Partial<Omit<T, keyof RecordMeta>>): Promise<T & RecordMeta>
```

Aktualizuje existující záznam. Mění se pouze zadaná pole — vynechaná pole si zachovají své aktuální hodnoty. Server inkrementuje `_version` a aktualizuje `_updatedAt`.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| key | `unknown` | ano | Klíč záznamu (typicky `id`) |
| data | `Partial<Omit<T, keyof RecordMeta>>` | ano | Pole k aktualizaci |

**Návratová hodnota:** `Promise<T & RecordMeta>` — aktualizovaný záznam s novými metadaty

**Vyhazuje:**
- `NoexClientError` pokud záznam neexistuje nebo server odmítne aktualizaci
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const updated = await users.update('550e8400-...', { age: 31 });
console.log(updated._version);   // 2
console.log(updated._updatedAt); // 1700000060000
```

---

### delete()

```typescript
delete(key: unknown): Promise<void>
```

Smaže záznam podle klíče.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| key | `unknown` | ano | Klíč záznamu (typicky `id`) |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `NoexClientError` pokud záznam neexistuje nebo server odmítne smazání
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
await users.delete('550e8400-...');
```

---

## Metody dotazů

### all()

```typescript
all(): Promise<(T & RecordMeta)[]>
```

Vrací všechny záznamy v bucketu.

**Návratová hodnota:** `Promise<(T & RecordMeta)[]>` — pole všech záznamů

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const allUsers = await users.all();
console.log(allUsers.length); // 42
```

---

### where()

```typescript
where(filter: Partial<T>): Promise<(T & RecordMeta)[]>
```

Vrací všechny záznamy odpovídající filtru. Pole filtru se porovnávají rovností.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| filter | `Partial<T>` | ano | Pole pro porovnání |

**Návratová hodnota:** `Promise<(T & RecordMeta)[]>` — odpovídající záznamy

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const admins = await users.where({ age: 30 });
```

---

### findOne()

```typescript
findOne(filter: Partial<T>): Promise<(T & RecordMeta) | null>
```

Vrací první záznam odpovídající filtru, nebo `null` pokud nebyl nalezen žádný.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| filter | `Partial<T>` | ano | Pole pro porovnání |

**Návratová hodnota:** `Promise<(T & RecordMeta) | null>` — první odpovídající záznam, nebo `null`

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const alice = await users.findOne({ email: 'alice@example.com' });
```

---

### count()

```typescript
count(filter?: Partial<T>): Promise<number>
```

Vrací počet záznamů v bucketu. Pokud je zadán filtr, počítá pouze odpovídající záznamy.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| filter | `Partial<T>` | ne | Pole pro porovnání; vynechte pro počet všech |

**Návratová hodnota:** `Promise<number>` — počet záznamů

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const total = await users.count();
const over30 = await users.count({ age: 30 });
```

---

### first()

```typescript
first(n: number): Promise<(T & RecordMeta)[]>
```

Vrací prvních `n` záznamů v pořadí vložení.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| n | `number` | ano | Počet záznamů k vrácení |

**Návratová hodnota:** `Promise<(T & RecordMeta)[]>` — až `n` záznamů od začátku

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const newest = await users.first(5);
```

---

### last()

```typescript
last(n: number): Promise<(T & RecordMeta)[]>
```

Vrací posledních `n` záznamů v pořadí vložení.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| n | `number` | ano | Počet záznamů k vrácení |

**Návratová hodnota:** `Promise<(T & RecordMeta)[]>` — až `n` záznamů od konce

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const recent = await users.last(10);
```

---

### paginate()

```typescript
paginate(options: { limit: number; after?: unknown }): Promise<PaginatedResult<T>>
```

Vrací stránku záznamů s kurzorovou paginací. Použijte `nextCursor` z výsledku pro načtení dalších stránek.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| options.limit | `number` | ano | Maximální počet záznamů na stránku |
| options.after | `unknown` | ne | Kurzor z předchozího `PaginatedResult.nextCursor`; vynechte pro první stránku |

**Návratová hodnota:** `Promise<PaginatedResult<T>>` — záznamy, příznak `hasMore` a volitelný `nextCursor`

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
// První stránka
const page1 = await users.paginate({ limit: 20 });
console.log(page1.records.length); // až 20
console.log(page1.hasMore);        // true

// Další stránka
if (page1.hasMore) {
  const page2 = await users.paginate({ limit: 20, after: page1.nextCursor });
}
```

---

## Agregační metody

### sum()

```typescript
sum(field: string, filter?: Partial<T>): Promise<number>
```

Vrací součet numerického pole přes všechny záznamy, nebo přes záznamy odpovídající filtru.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| field | `string` | ano | Název numerického pole k sečtení |
| filter | `Partial<T>` | ne | Pole pro porovnání; vynechte pro agregaci všech |

**Návratová hodnota:** `Promise<number>` — součet hodnot pole

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const totalAge = await users.sum('age');
const totalAgeOver30 = await users.sum('age', { age: 30 });
```

---

### avg()

```typescript
avg(field: string, filter?: Partial<T>): Promise<number>
```

Vrací průměr numerického pole přes všechny záznamy, nebo přes záznamy odpovídající filtru.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| field | `string` | ano | Název numerického pole pro průměr |
| filter | `Partial<T>` | ne | Pole pro porovnání; vynechte pro agregaci všech |

**Návratová hodnota:** `Promise<number>` — průměr hodnot pole

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const averageAge = await users.avg('age');
```

---

### min()

```typescript
min(field: string, filter?: Partial<T>): Promise<number | null>
```

Vrací minimální hodnotu numerického pole. Vrací `null`, pokud je bucket prázdný (nebo žádné záznamy neodpovídají filtru).

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| field | `string` | ano | Název numerického pole |
| filter | `Partial<T>` | ne | Pole pro porovnání; vynechte pro agregaci všech |

**Návratová hodnota:** `Promise<number | null>` — minimální hodnota, nebo `null` pokud žádné záznamy

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const youngest = await users.min('age');
```

---

### max()

```typescript
max(field: string, filter?: Partial<T>): Promise<number | null>
```

Vrací maximální hodnotu numerického pole. Vrací `null`, pokud je bucket prázdný (nebo žádné záznamy neodpovídají filtru).

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| field | `string` | ano | Název numerického pole |
| filter | `Partial<T>` | ne | Pole pro porovnání; vynechte pro agregaci všech |

**Návratová hodnota:** `Promise<number | null>` — maximální hodnota, nebo `null` pokud žádné záznamy

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const oldest = await users.max('age');
```

---

## Hromadné metody

### clear()

```typescript
clear(): Promise<void>
```

Smaže všechny záznamy v bucketu.

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
await users.clear();
const count = await users.count(); // 0
```

---

## Typy

### RecordMeta

Serverem spravovaná pole metadat přidaná ke každému uloženému záznamu:

```typescript
interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}
```

### PaginatedResult

```typescript
interface PaginatedResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly records: (T & RecordMeta)[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}
```

---

## Viz také

- [Store API](./03-store-api.md) — metoda `store.bucket()` vytvářející instance `BucketAPI`
- [Store Subscriptions](./05-store-subscriptions.md) — reaktivní subscripce na dotazy úložiště
- [Typy](./09-types.md) — RecordMeta, PaginatedResult, StoreRecord
- [Chyby](./10-errors.md) — NoexClientError, TimeoutError, DisconnectedError
