# Atomické operace

Jednotlivé store operace (`insert`, `update`, `delete`) se vykonávají nezávisle. Pokud potřebujete, aby více operací uspělo nebo selhalo jako celek, použijte **transakce**. Transakce odešle pole operací na server, který je vykoná atomicky — buď všechny uspějí, nebo se žádná neaplikuje.

## Co se naučíte

- Proč jsou atomické operace důležité v prostředí s více klienty
- Jak sestavit transakci pomocí `store.transaction()`
- Všech sedm podporovaných typů operací
- Jak jsou výsledky indexovány podle pozice operace
- Zpracování chyb při selhání transakcí

## Problém: Neatomické sekvence

Bez transakcí mohou sekvenční operace zanechat data v nekonzistentním stavu, pokud jedna selže:

```typescript
// Nebezpečí: pokud druhá operace selže, kredity jsou
// odečteny, ale žádný záznam v logu neexistuje
await users.update(userId, { credits: newBalance });
await logs.insert({ action: 'purchase', userId, amount });
// ↑ Co když toto selže? Kredity už jsou odečteny.
```

V prostředí s více klienty může jiný klient přečíst data mezi těmito dvěma operacemi a vidět nekonzistentní stav.

## store.transaction()

`store.transaction()` odešle pole operací na server pro atomické vykonání:

```typescript
const result = await client.store.transaction([
  { op: 'update', bucket: 'users', key: userId, data: { credits: newBalance } },
  { op: 'insert', bucket: 'logs', data: { action: 'purchase', userId, amount } },
]);
```

**Signatura:**

```typescript
transaction(operations: TransactionOp[]): Promise<TransactionResult>
```

| Parametr | Typ | Popis |
|----------|-----|-------|
| operations | `TransactionOp[]` | Pole operací k atomickému vykonání |

Vrací `Promise<TransactionResult>` — obsahuje výsledky indexované podle pozice operace.

## Typy TransactionOp

Podporováno je sedm typů operací, odpovídajících jednotlivým metodám `BucketAPI`:

### get

Čtení jednoho záznamu podle klíče.

```typescript
{ op: 'get', bucket: 'users', key: 'user-1' }
// Výsledek: záznam, nebo null pokud nebyl nalezen
```

### insert

Vytvoření nového záznamu.

```typescript
{ op: 'insert', bucket: 'users', data: { name: 'Alice', credits: 100 } }
// Výsledek: vytvořený záznam s RecordMeta
```

### update

Aktualizace existujícího záznamu.

```typescript
{ op: 'update', bucket: 'users', key: 'user-1', data: { credits: 200 } }
// Výsledek: aktualizovaný záznam s RecordMeta
```

### delete

Smazání záznamu.

```typescript
{ op: 'delete', bucket: 'users', key: 'user-1' }
// Výsledek: { deleted: true }
```

### where

Nalezení záznamů odpovídajících filtru.

```typescript
{ op: 'where', bucket: 'users', filter: { role: 'admin' } }
// Výsledek: pole odpovídajících záznamů
```

### findOne

Nalezení prvního záznamu odpovídajícího filtru.

```typescript
{ op: 'findOne', bucket: 'users', filter: { name: 'Alice' } }
// Výsledek: záznam, nebo null pokud nebyl nalezen
```

### count

Počet záznamů, volitelně s filtrem.

```typescript
{ op: 'count', bucket: 'users' }
// Výsledek: číslo

{ op: 'count', bucket: 'users', filter: { role: 'admin' } }
// Výsledek: číslo
```

## Definice typu

Kompletní union typ `TransactionOp`:

```typescript
type TransactionOp =
  | { op: 'get'; bucket: string; key: unknown }
  | { op: 'insert'; bucket: string; data: Record<string, unknown> }
  | { op: 'update'; bucket: string; key: unknown; data: Record<string, unknown> }
  | { op: 'delete'; bucket: string; key: unknown }
  | { op: 'where'; bucket: string; filter: Record<string, unknown> }
  | { op: 'findOne'; bucket: string; filter: Record<string, unknown> }
  | { op: 'count'; bucket: string; filter?: Record<string, unknown> };
```

## TransactionResult

Výsledek obsahuje pole výsledků, kde každý je indexován podle pozice odpovídající operace:

```typescript
interface TransactionResult {
  readonly results: ReadonlyArray<{
    readonly index: number;
    readonly data: unknown;
  }>;
}
```

Výsledky jsou seřazeny podle `index` (počínaje 0), odpovídající pořadí operací ve vstupním poli:

```typescript
const result = await client.store.transaction([
  { op: 'insert', bucket: 'users', data: { name: 'Alice' } },  // index 0
  { op: 'insert', bucket: 'users', data: { name: 'Bob' } },    // index 1
  { op: 'count', bucket: 'users' },                              // index 2
]);

const alice = result.results[0].data; // záznam Alice
const bob = result.results[1].data;   // záznam Bob
const count = result.results[2].data; // 2

console.log(result.results[0].index); // 0
console.log(result.results[1].index); // 1
console.log(result.results[2].index); // 2
```

## Kombinování čtení a zápisu

Transakce mohou kombinovat čtení a zápisy. Operace se vykonávají v pořadí, takže pozdější operace vidí efekty předchozích:

```typescript
const bob = await client.store.bucket('users').insert({ name: 'Bob', credits: 200 });

const result = await client.store.transaction([
  // Čtení aktuálního stavu
  { op: 'get', bucket: 'users', key: bob.id },
  // Modifikace
  { op: 'update', bucket: 'users', key: bob.id, data: { credits: 500 } },
  // Zalogování akce
  { op: 'insert', bucket: 'logs', data: { action: 'credit_update', userId: bob.id } },
]);

const before = result.results[0].data as Record<string, unknown>;
console.log(before['credits']); // 200

const after = result.results[1].data as Record<string, unknown>;
console.log(after['credits']); // 500
```

## Zpracování chyb

Transakce selhávají jako celek. Pokud je jakákoli operace neplatná, celá transakce se zamítne:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

// Prázdné pole operací
try {
  await client.store.transaction([]);
} catch (err) {
  // Zamítnuto — je vyžadována alespoň jedna operace
}

// Neplatná data (chybí povinné pole)
try {
  await client.store.transaction([
    { op: 'insert', bucket: 'users', data: {} },
  ]);
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // kód validační chyby
    console.log(err.message); // popis toho, co se pokazilo
  }
}

// Neexistující bucket
try {
  await client.store.transaction([
    { op: 'insert', bucket: 'nonexistent', data: { name: 'test' } },
  ]);
} catch (err) {
  // Zamítnuto — bucket neexistuje
}
```

## Kompletní funkční příklad

Atomický převod kreditů mezi dvěma uživateli:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { TransactionOp } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const users = client.store.bucket('users');

  // Nastavení počátečních dat
  const alice = await users.insert({ name: 'Alice', credits: 1000 });
  const bob = await users.insert({ name: 'Bob', credits: 500 });

  const transferAmount = 200;

  // Atomický převod: odečíst od Alice, přičíst Bobovi, zalogovat převod
  const ops: TransactionOp[] = [
    {
      op: 'update',
      bucket: 'users',
      key: alice.id,
      data: { credits: (alice['credits'] as number) - transferAmount },
    },
    {
      op: 'update',
      bucket: 'users',
      key: bob.id,
      data: { credits: (bob['credits'] as number) + transferAmount },
    },
    {
      op: 'insert',
      bucket: 'logs',
      data: {
        action: 'transfer',
        from: alice.id,
        to: bob.id,
        amount: transferAmount,
      },
    },
  ];

  const result = await client.store.transaction(ops);

  const updatedAlice = result.results[0].data as Record<string, unknown>;
  const updatedBob = result.results[1].data as Record<string, unknown>;

  console.log(`Kredity Alice: ${updatedAlice['credits']}`); // 800
  console.log(`Kredity Boba: ${updatedBob['credits']}`);     // 700

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Vloží tři produkty do bucketu `products`
2. V jedné transakci: smaže první produkt, aktualizuje cenu druhého produktu a spočítá zbývající produkty
3. Ověří, že výsledek count se rovná 2

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const products = client.store.bucket('products');
  const p1 = await products.insert({ name: 'Widget', price: 10 });
  const p2 = await products.insert({ name: 'Gadget', price: 25 });
  const p3 = await products.insert({ name: 'Doohickey', price: 15 });

  const result = await client.store.transaction([
    { op: 'delete', bucket: 'products', key: p1.id },
    { op: 'update', bucket: 'products', key: p2.id, data: { price: 30 } },
    { op: 'count', bucket: 'products' },
  ]);

  const deleteResult = result.results[0].data;
  console.log('Smazáno:', deleteResult); // { deleted: true }

  const updated = result.results[1].data as Record<string, unknown>;
  console.log('Aktualizovaná cena:', updated['price']); // 30

  const count = result.results[2].data;
  console.log('Zbývající produkty:', count); // 2

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `store.transaction(operations)` vykoná pole operací atomicky
- Sedm typů operací: `get`, `insert`, `update`, `delete`, `where`, `findOne`, `count`
- Vše nebo nic: buď každá operace uspěje, nebo celá transakce selže
- Výsledky jsou indexovány podle pozice operace v `result.results[i].data`
- Operace se vykonávají v pořadí — pozdější operace vidí efekty předchozích
- Prázdné pole operací je zamítnuto
- Importujte `TransactionOp` pro typově bezpečné sestavování operací

---

Další: [Vzory transakcí](./02-vzory.md)
