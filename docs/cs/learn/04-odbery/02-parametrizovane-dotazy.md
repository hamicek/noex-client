# Parametrizované dotazy

Mnoho reaktivních dotazů potřebuje dynamický vstup — filtrování podle role, vyhledávání podle kategorie, omezení na konkrétního uživatele. Místo definování samostatného dotazu pro každou možnou hodnotu filtru přijímají serverové dotazy **parametry**. Klient tyto parametry předává při subscribe.

## Co se naučíte

- Jak odebírat s parametry pomocí `store.subscribe(query, params, callback)`
- Jak parametry proudí od klienta na server
- Typické případy použití parametrizovaných dotazů
- Jak stejný název dotazu může obsluhovat různé odběratele s různými parametry

## Tří-argumentová forma

Parametrizovaný přetížený tvar přidává objekt `params` mezi název dotazu a callback:

```typescript
subscribe(
  query: string,
  params: Record<string, unknown>,
  callback: (data: unknown) => void,
): Promise<Unsubscribe>
```

| Parametr | Typ | Popis |
|----------|-----|-------|
| query | `string` | Název serverového dotazu |
| params | `Record<string, unknown>` | Dvojice klíč-hodnota předané do funkce dotazu |
| callback | `(data: unknown) => void` | Volán s počátečními daty a při každém push |

## Základní použití

Předpokládejme, že server definuje dotaz `users-by-role`, který filtruje uživatele podle pole `role`:

```typescript
// Odběr pouze administrátorů
const unsub = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (data) => {
    const admins = data as Array<{ name: string; role: string }>;
    console.log('Administrátoři:', admins.map((u) => u.name));
  },
);
```

Objekt `{ role: 'admin' }` se odešle na server, který ho použije při vyhodnocení dotazu. Callback obdrží pouze odpovídající záznamy.

## Jak parametry proudí

```
Klient                              Server
┌──────────────────┐                ┌────────────────────────────────────────┐
│ store.subscribe(  │   request     │ defineQuery('users-by-role',           │
│   'users-by-role',│──────────────>│   async (ctx, params) => {             │
│   { role:'admin'},│               │     return ctx.bucket('users')         │
│   callback        │               │       .where({ role: params.role });   │
│ )                 │               │   }                                    │
└──────────────────┘                │ )                                      │
                                    └────────────────────────────────────────┘
```

Objekt `params` je součástí payloadu subscribe požadavku. Serverová funkce dotazu ho obdrží jako svůj druhý argument a použije ho pro filtrování, řazení nebo transformaci dat.

## Více odběratelů, stejný dotaz

Různí klienti (nebo tentýž klient) mohou odebírat stejný dotaz s různými parametry. Každý odběr je nezávislý:

```typescript
// Odběr A: administrátoři
const unsubAdmins = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (data) => {
    console.log('Administrátoři:', data);
  },
);

// Odběr B: editoři
const unsubEditors = await client.store.subscribe(
  'users-by-role',
  { role: 'editor' },
  (data) => {
    console.log('Editoři:', data);
  },
);

// Vložení admina — push dostane pouze odběr A
await client.store.bucket('users').insert({ name: 'Alice', role: 'admin' });

// Vložení editora — push dostane pouze odběr B
await client.store.bucket('users').insert({ name: 'Bob', role: 'editor' });
```

Každý odběr sleduje svůj výsledek nezávisle. Push se odešle pouze tehdy, když se změní výsledek *daného konkrétního odběru*.

## Složité parametry

Parametry mohou obsahovat libovolné JSON-serializovatelné hodnoty:

```typescript
// Více kritérií filtru
await client.store.subscribe(
  'filtered-products',
  { category: 'electronics', minPrice: 100, inStock: true },
  (data) => {
    console.log('Produkty:', data);
  },
);

// Parametry ve stylu stránkování
await client.store.subscribe(
  'recent-orders',
  { userId: 'user-42', limit: 10 },
  (data) => {
    console.log('Nedávné objednávky:', data);
  },
);
```

Struktura `params` závisí výhradně na tom, co serverový dotaz očekává. Klient objekt jednoduše předá dál.

## Porovnání s parametry a bez nich

| Scénář | Přístup |
|--------|---------|
| Všechny záznamy v bucketu | `subscribe('all-users', callback)` |
| Záznamy odpovídající podmínce | `subscribe('users-by-role', { role: 'admin' }, callback)` |
| Vypočítaná hodnota (count, sum) | `subscribe('user-count', callback)` |
| Omezená vypočítaná hodnota | `subscribe('user-count-by-role', { role: 'admin' }, callback)` |

## Chování při reconnect

Když se klient automaticky znovu připojí po výpadku spojení, parametrizované odběry se obnoví automaticky se **stejnými parametry**, které byly původně zadány. Server přehodnotí dotaz a doručí čerstvá data do vašeho callbacku:

```typescript
const unsub = await client.store.subscribe(
  'users-by-role',
  { role: 'admin' },
  (data) => {
    // Voláno při počátečním subscribe, při každém push
    // a znovu po reconnect s čerstvými daty
    renderAdminList(data);
  },
);
```

Nemusíte ručně řešit obnovu při reconnect — subscription manager uchovává původní název dotazu a parametry a po připojení je znovu odešle.

## Kompletní funkční příklad

Dashboard sledující více skupin uživatelů v reálném čase:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const unsubscribes: Array<() => void> = [];

  // Sledování administrátorů
  const unsubAdmins = await client.store.subscribe(
    'users-by-role',
    { role: 'admin' },
    (data) => {
      const admins = data as Array<{ name: string }>;
      console.log(`Administrátoři (${admins.length}):`, admins.map((u) => u.name));
    },
  );
  unsubscribes.push(unsubAdmins);

  // Sledování editorů
  const unsubEditors = await client.store.subscribe(
    'users-by-role',
    { role: 'editor' },
    (data) => {
      const editors = data as Array<{ name: string }>;
      console.log(`Editoři (${editors.length}):`, editors.map((u) => u.name));
    },
  );
  unsubscribes.push(unsubEditors);

  // Sledování celkového počtu
  const unsubCount = await client.store.subscribe(
    'user-count',
    (data) => {
      console.log('Celkem uživatelů:', data);
    },
  );
  unsubscribes.push(unsubCount);

  // Simulace aktivity
  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'editor' });
  await users.insert({ name: 'Carol', role: 'admin' });

  await new Promise((r) => setTimeout(r, 500));

  // Ukončení všech odběrů
  for (const unsub of unsubscribes) {
    unsub();
  }
  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Odebírá `users-by-role` s `{ role: 'admin' }` a sbírá snapshoty
2. Odebírá `users-by-role` s `{ role: 'viewer' }` a sbírá snapshoty
3. Vloží jednoho admina a jednoho viewera
4. Krátce počká a pak ověří, že každý odběr obdržel push pouze relevantní pro svůj filtr

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const adminSnapshots: unknown[] = [];
  const viewerSnapshots: unknown[] = [];

  const unsubAdmin = await client.store.subscribe(
    'users-by-role',
    { role: 'admin' },
    (data) => { adminSnapshots.push(data); },
  );

  const unsubViewer = await client.store.subscribe(
    'users-by-role',
    { role: 'viewer' },
    (data) => { viewerSnapshots.push(data); },
  );

  // Oba mají počáteční data (prázdná pole)
  console.log('Admin počáteční:', adminSnapshots[0]);   // []
  console.log('Viewer počáteční:', viewerSnapshots[0]); // []

  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'viewer' });

  await new Promise((r) => setTimeout(r, 500));

  // Odběr administrátorů: počáteční [] + push s [Alice]
  console.log('Admin snapshotů:', adminSnapshots.length);  // 2
  // Odběr viewerů: počáteční [] + push s [Bob]
  console.log('Viewer snapshotů:', viewerSnapshots.length); // 2

  unsubAdmin();
  unsubViewer();
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- Použijte `store.subscribe(query, params, callback)` pro předání dynamických parametrů do serverových dotazů
- Parametry jsou `Record<string, unknown>` — libovolné JSON-serializovatelné dvojice klíč-hodnota
- Serverová funkce dotazu obdrží parametry jako svůj druhý argument
- Více odběrů se stejným dotazem ale různými parametry je nezávislých
- Každý odběr přijímá push pouze tehdy, když se změní jeho vlastní výsledek
- Parametry se uchovávají při reconnect — opětovný odběr automaticky použije původní parametry

---

Další: [Správa odběrů](./03-sprava-odberu.md)
