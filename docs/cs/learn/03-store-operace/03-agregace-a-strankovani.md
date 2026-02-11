# Agregace a stránkování

Když buckety narostou, potřebujete nástroje pro navigaci a sumarizaci dat, aniž byste tahali vše najednou. Tato kapitola pokrývá řadicí metody (`first`, `last`), stránkování založené na kurzoru a numerické agregační funkce.

## Co se naučíte

- Jak načíst nejstarší a nejnovější záznamy pomocí `first()` a `last()`
- Jak funguje stránkování založené na kurzoru pomocí `paginate()`
- Jak počítat `sum()`, `avg()`, `min()` a `max()` nad numerickými poli
- Jak kombinovat stránkování a agregace pro dotazy ve stylu dashboardu

## first() a last()

Načtení omezeného počtu záznamů od začátku nebo konce bucketu (v pořadí vložení):

```typescript
const logs = client.store.bucket('logs');

// Nejstarších 5 záznamů
const oldest = await logs.first(5);
console.log('Oldest:', oldest.map((l) => l.id));

// Nejnovější 3 záznamy
const newest = await logs.last(3);
console.log('Newest:', newest.map((l) => l.id));
```

**Signatury:**

```typescript
first(n: number): Promise<(Record<string, unknown> & RecordMeta)[]>
last(n: number): Promise<(Record<string, unknown> & RecordMeta)[]>
```

Tyto metody se hodí, když potřebujete jen vzorek záznamů bez nastavování plného stránkování.

## paginate()

Pro větší datasety použijte stránkování založené na kurzoru, které načítá záznamy po částech:

```typescript
const users = client.store.bucket('users');

// První stránka: 10 záznamů
const page1 = await users.paginate({ limit: 10 });
console.log('Page 1:', page1.records.length, 'records');
console.log('Has more:', page1.hasMore);

// Další stránka: použijte kurzor z předchozího výsledku
if (page1.hasMore && page1.nextCursor) {
  const page2 = await users.paginate({ limit: 10, after: page1.nextCursor });
  console.log('Page 2:', page2.records.length, 'records');
}
```

**Signatura:**

```typescript
paginate(options: { limit: number; after?: unknown }): Promise<PaginatedResult<Record<string, unknown>>>
```

**PaginatedResult:**

```typescript
interface PaginatedResult<T> {
  readonly records: (T & RecordMeta)[];  // záznamy pro tuto stránku
  readonly hasMore: boolean;              // true pokud existuje další stránka
  readonly nextCursor?: unknown;          // kurzor k předání jako `after` pro další stránku
}
```

### Iterace přes všechny stránky

Běžný vzor pro zpracování všech záznamů po částech:

```typescript
const products = client.store.bucket('products');
let cursor: unknown = undefined;
let allRecords: Array<Record<string, unknown>> = [];

do {
  const page = await products.paginate({ limit: 50, after: cursor });
  allRecords = allRecords.concat(page.records);
  cursor = page.hasMore ? page.nextCursor : undefined;
} while (cursor !== undefined);

console.log(`Loaded ${allRecords.length} products in chunks of 50`);
```

### Proč stránkování založené na kurzoru?

Stránkování založené na kurzoru je robustnější než stránkování založené na offsetu (`SKIP/LIMIT`):

| Aspekt | Založené na offsetu | Založené na kurzoru |
|--------|---------------------|---------------------|
| **Vložení během stránkování** | Může zobrazit duplikáty nebo přeskočit záznamy | Konzistentní — kurzor označuje přesnou pozici |
| **Smazání během stránkování** | Může přeskočit záznamy | Žádná ztráta dat |
| **Výkon** | Degraduje s velkými offsety | Konstantní čas na stránku |

## Agregační funkce

Výpočet numerických souhrnů nad polem napříč všemi záznamy (nebo filtrovanou podmnožinou):

### sum()

Součet numerického pole:

```typescript
const orders = client.store.bucket('orders');

const totalRevenue = await orders.sum('amount');
console.log('Total revenue:', totalRevenue);

// S filtrem
const vipRevenue = await orders.sum('amount', { customerTier: 'vip' });
console.log('VIP revenue:', vipRevenue);
```

### avg()

Průměr numerického pole:

```typescript
const products = client.store.bucket('products');

const avgPrice = await products.avg('price');
console.log('Average price:', avgPrice);
```

### min() a max()

Minimální a maximální hodnoty. Vrací `null`, pokud je bucket prázdný:

```typescript
const products = client.store.bucket('products');

const cheapest = await products.min('price');
const mostExpensive = await products.max('price');

console.log('Price range:', cheapest, '–', mostExpensive);
// null pokud neexistují žádné produkty
```

**Signatury:**

```typescript
sum(field: string, filter?: Record<string, unknown>): Promise<number>
avg(field: string, filter?: Record<string, unknown>): Promise<number>
min(field: string, filter?: Record<string, unknown>): Promise<number | null>
max(field: string, filter?: Record<string, unknown>): Promise<number | null>
```

### Spuštění více agregací

Použijte `Promise.all` pro výpočet více agregací paralelně:

```typescript
const orders = client.store.bucket('orders');

const [total, average, minimum, maximum, count] = await Promise.all([
  orders.sum('amount'),
  orders.avg('amount'),
  orders.min('amount'),
  orders.max('amount'),
  orders.count(),
]);

console.log(`${count} orders: sum=${total}, avg=${average}, min=${minimum}, max=${maximum}`);
```

## Kompletní funkční příklad

Skript ve stylu dashboardu kombinující stránkování a agregace:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const orders = client.store.bucket('orders');

  // Vložení ukázkových dat
  await orders.insert({ customer: 'Alice', amount: 150, status: 'completed' });
  await orders.insert({ customer: 'Bob', amount: 320, status: 'completed' });
  await orders.insert({ customer: 'Carol', amount: 89, status: 'pending' });
  await orders.insert({ customer: 'Alice', amount: 210, status: 'completed' });
  await orders.insert({ customer: 'Dave', amount: 475, status: 'completed' });

  // Agregace
  const [total, avg, min, max, count] = await Promise.all([
    orders.sum('amount'),
    orders.avg('amount'),
    orders.min('amount'),
    orders.max('amount'),
    orders.count(),
  ]);

  console.log('Dashboard:');
  console.log(`  Orders: ${count}`);
  console.log(`  Revenue: $${total}`);
  console.log(`  Average: $${avg.toFixed(2)}`);
  console.log(`  Range: $${min} – $${max}`);

  // Filtrovaná agregace
  const completedRevenue = await orders.sum('amount', { status: 'completed' });
  const completedCount = await orders.count({ status: 'completed' });
  console.log(`  Completed: ${completedCount} orders, $${completedRevenue} revenue`);

  // Stránkování
  console.log('\nPaginated list:');
  const page = await orders.paginate({ limit: 3 });
  for (const order of page.records) {
    console.log(`  ${order.customer}: $${order.amount} (${order.status})`);
  }
  console.log(`  Has more: ${page.hasMore}`);

  // First a last
  const newest = await orders.last(2);
  console.log('\nNewest 2 orders:');
  for (const order of newest) {
    console.log(`  ${order.customer}: $${order.amount}`);
  }

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Máte bucket `sales` se záznamy `{ product, quantity, unitPrice, region }`. Napište funkci, která:
1. Spočítá celkový prodaný počet kusů a celkový obrat (`quantity × unitPrice` je předpočítán jako pole `revenue`)
2. Najde nejnižší a nejvyšší jednotkovou cenu
3. Prostránkuje všechny prodeje po dávkách po 20 a spočítá, kolik stránek je potřeba

<details>
<summary>Řešení</summary>

```typescript
async function salesReport(client: NoexClient) {
  const sales = client.store.bucket('sales');

  // Agregace paralelně
  const [totalQty, totalRevenue, minPrice, maxPrice] = await Promise.all([
    sales.sum('quantity'),
    sales.sum('revenue'),
    sales.min('unitPrice'),
    sales.max('unitPrice'),
  ]);

  console.log(`Total quantity: ${totalQty}`);
  console.log(`Total revenue: $${totalRevenue}`);
  console.log(`Unit price range: $${minPrice} – $${maxPrice}`);

  // Stránkování a počítání stránek
  let pages = 0;
  let cursor: unknown = undefined;

  do {
    const page = await sales.paginate({ limit: 20, after: cursor });
    pages++;
    console.log(`Page ${pages}: ${page.records.length} records`);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor !== undefined);

  console.log(`Total pages: ${pages}`);
}
```

Agregace běží v jednom `Promise.all` (jeden round-trip), zatímco stránkování vyžaduje sekvenční požadavky, protože každá stránka závisí na kurzoru z předchozí stránky.

</details>

## Shrnutí

- `first(n)` a `last(n)` vrací nejstarší a nejnovější záznamy podle pořadí vložení
- `paginate({ limit, after? })` poskytuje stránkování založené na kurzoru — robustnější než založené na offsetu
- `PaginatedResult` obsahuje `records`, `hasMore` a `nextCursor` pro iteraci přes stránky
- `sum()`, `avg()`, `min()`, `max()` počítají numerické agregace nad polem, volitelně s filtrem
- `min()` a `max()` vrací `null`, pokud je bucket prázdný
- Použijte `Promise.all` pro paralelní spuštění nezávislých agregací

---

Další: [Typové buckety](./04-typove-buckety.md)
