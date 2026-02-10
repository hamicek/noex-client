# Store API

Jmenný prostor pro všechny operace s úložištěm — přístup k bucketům, reaktivní subscripce, atomické transakce a metadata úložiště. Dostupný jako `client.store` po připojení.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const store = client.store;
```

`StoreAPI` je také exportován přímo pro typové anotace:

```typescript
import type { StoreAPI } from '@hamicek/noex-client';
```

---

## Metody

### bucket()

```typescript
bucket<T extends Record<string, unknown> = Record<string, unknown>>(name: string): BucketAPI<T>
```

Vrací `BucketAPI` zaměřený na daný bucket. Vrácený objekt je lehký wrapper — žádné volání serveru se neprovádí. Opakovaná volání se stejným názvem vytváří nezávislé instance.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| name | `string` | ano | Název bucketu |

**Návratová hodnota:** `BucketAPI<T>` — typovaný přístup k bucketu

**Příklad:**

```typescript
interface User {
  name: string;
  email: string;
}

const users = store.bucket<User>('users');
const record = await users.insert({ name: 'Alice', email: 'alice@example.com' });
```

---

### subscribe()

```typescript
subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>
subscribe(query: string, params: Record<string, unknown>, callback: (data: unknown) => void): Promise<Unsubscribe>
```

Přihlásí se k odběru serverového reaktivního dotazu. Server vyhodnotí dotaz okamžitě a odešle počáteční výsledek, poté odesílá aktualizované výsledky při každé změně podkladových dat.

`callback` je zavolán **synchronně** s počátečními daty ještě před vyřešením vráceného promise. Následné aktualizace volají callback asynchronně.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| query | `string` | ano | Název serverového dotazu |
| params | `Record<string, unknown>` | ne | Parametry dotazu předané serveru |
| callback | `(data: unknown) => void` | ano | Voláno s počátečními daty a při každé další aktualizaci |

**Návratová hodnota:** `Promise<Unsubscribe>` — asynchronní; vyřeší se na synchronní funkci pro odhlášení `() => void`

**Vyhazuje:**
- `NoexClientError` pokud je název dotazu neplatný nebo server subscripci odmítne
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen
- Znovu vyhodí jakoukoli chybu vyhozenou `callback` během doručení počátečních dat (subscripce je v takovém případě automaticky vyčištěna)

**Příklad:**

```typescript
const unsubscribe = await store.subscribe('activeUsers', (data) => {
  console.log('Aktivní uživatelé:', data);
});

// S parametry
const unsub = await store.subscribe(
  'usersByRole',
  { role: 'admin' },
  (data) => {
    console.log('Administrátoři:', data);
  },
);

// Později — ukončení odběru
unsubscribe();
```

**Chování při reconnectu:** Aktivní subscripce jsou po reconnectu automaticky obnoveny. Server přiřadí nové `subscriptionId` a doručí aktuální data do callbacku.

---

### unsubscribe()

```typescript
unsubscribe(subscriptionId: string): Promise<void>
```

Odhlásí se od store subscripce podle jejího serverem přiděleného ID. Ve většině případů byste měli použít funkci `Unsubscribe` vrácenou metodou `subscribe()` — tato metoda je k dispozici pro pokročilé scénáře, kde spravujete ID subscripcí ručně.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| subscriptionId | `string` | ano | Serverem přidělené ID subscripce |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

---

### transaction()

```typescript
transaction(operations: TransactionOp[]): Promise<TransactionResult>
```

Provede více operací úložiště atomicky. Buď všechny uspějí, nebo všechny selžou. Operace jsou vykonány v pořadí a mohou na serveru odkazovat na výsledky dřívějších operací v rámci téže transakce.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| operations | `TransactionOp[]` | ano | Pole operací k atomickému provedení |

**Návratová hodnota:** `Promise<TransactionResult>` — výsledky indexované pozicí operace

**Vyhazuje:**
- `NoexClientError` pokud jakákoli operace selže (celá transakce je vrácena zpět)
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const result = await store.transaction([
  { op: 'insert', bucket: 'orders', data: { product: 'Widget', qty: 5 } },
  { op: 'update', bucket: 'inventory', key: 'widget-1', data: { qty: 95 } },
  { op: 'count', bucket: 'orders' },
]);

// result.results[0].data — vložený záznam objednávky
// result.results[1].data — aktualizovaný záznam skladu
// result.results[2].data — celkový počet objednávek
```

---

### buckets()

```typescript
buckets(): Promise<BucketsInfo>
```

Vrací metadata o všech bucketech v úložišti.

**Návratová hodnota:** `Promise<BucketsInfo>` — počet a názvy bucketů

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const info = await store.buckets();
console.log(info.count);  // 3
console.log(info.names);  // ['users', 'orders', 'inventory']
```

---

### stats()

```typescript
stats(): Promise<StoreStats>
```

Vrací podrobné statistiky úložiště — počty bucketů, záznamů, indexů, aktivní dotazy, persistenci a TTL konfiguraci.

**Návratová hodnota:** `Promise<StoreStats>` — kompletní statistiky úložiště

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const stats = await store.stats();
console.log(stats.buckets.count);              // počet bucketů
console.log(stats.records.total);              // celkový počet záznamů
console.log(stats.queries.activeSubscriptions); // počet aktivních subscripcí
```

---

## Typy

### TransactionOp

Diskriminovaný union popisující jednu operaci v rámci transakce:

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

### TransactionResult

```typescript
interface TransactionResult {
  readonly results: ReadonlyArray<{ readonly index: number; readonly data: unknown }>;
}
```

### BucketsInfo

```typescript
interface BucketsInfo {
  readonly count: number;
  readonly names: readonly string[];
}
```

### StoreStats

```typescript
interface StoreStats {
  readonly name: string;
  readonly buckets: BucketsInfo;
  readonly records: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly indexes: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly queries: {
    readonly defined: number;
    readonly activeSubscriptions: number;
  };
  readonly persistence: {
    readonly enabled: boolean;
  };
  readonly ttl: {
    readonly enabled: boolean;
    readonly checkIntervalMs: number;
  };
}
```

---

## Viz také

- [NoexClient](./01-noex-client.md) — vlastnost `client.store`
- [Bucket API](./04-bucket-api.md) — CRUD, dotazy a agregace nad jedním bucketem
- [Store Subscriptions](./05-store-subscriptions.md) — podrobný životní cyklus subscripcí a obnova při reconnectu
- [Konfigurace](./02-configuration.md) — nastavení časového limitu požadavků
- [Typy](./09-types.md) — Unsubscribe, TransactionOp, TransactionResult, BucketsInfo, StoreStats
- [Chyby](./10-errors.md) — NoexClientError, TimeoutError, DisconnectedError
