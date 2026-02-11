# Todo aplikace

Vytvořte real-time todo aplikaci, kde se změny provedené jedním klientem okamžitě projeví u všech připojených klientů. Tento projekt kombinuje store CRUD operace s reaktivními odběry — dva nejzákladnější stavební kameny noex-client.

## Co se naučíte

- Nastavení noex-serveru s typovaným bucketem a reaktivními dotazy
- Provádění CRUD operací přes klientské SDK
- Odběr dotazů pro živé aktualizace seznamu úkolů
- Synchronizace více klientů prostřednictvím push notifikací
- Správný cleanup pomocí unsubscribe a disconnect

## Přehled architektury

```
┌─────────────────────────────────────────────────────────┐
│                     noex-server                          │
│                                                          │
│  Bucket: todos                Dotazy                     │
│  ┌─────────────────────┐      ┌────────────────────┐    │
│  │ id: string (uuid)   │      │ all-todos           │    │
│  │ title: string        │      │ active-todos        │    │
│  │ completed: boolean   │      │ completed-count     │    │
│  └─────────────────────┘      └────────────────────┘    │
│                                                          │
│          push ↓              push ↓                      │
│  ┌──────────────┐      ┌──────────────┐                 │
│  │   Klient A   │      │   Klient B   │                 │
│  │   mění       │      │   odebírá    │                 │
│  │   úkoly      │      │   přijímá    │                 │
│  │              │      │   živý list  │                 │
│  └──────────────┘      └──────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

Když Klient A vloží, aktualizuje nebo smaže úkol, server přehodnotí všechny aktivní dotazy. Klient B (a všichni další odběratelé) obdrží push s aktualizovaným výsledkem — žádný polling není potřeba.

## Část 1: Nastavení serveru

Server definuje bucket `todos`, tři reaktivní dotazy a spustí naslouchání:

```typescript
// server.ts
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';

async function main() {
  const store = await Store.start({ name: 'todo-app' });

  await store.defineBucket('todos', {
    key: 'id',
    schema: {
      id:        { type: 'string', generated: 'uuid' },
      title:     { type: 'string', required: true },
      completed: { type: 'boolean', default: false },
    },
  });

  // Všechny úkoly
  store.defineQuery('all-todos', async (ctx) => {
    return ctx.bucket('todos').all();
  });

  // Pouze nedokončené úkoly
  store.defineQuery('active-todos', async (ctx) => {
    return ctx.bucket('todos').where({ completed: false });
  });

  // Skalár: kolik je hotových
  store.defineQuery('completed-count', async (ctx) => {
    return ctx.bucket('todos').count({ completed: true });
  });

  const server = await NoexServer.start({ store, port: 8080 });
  console.log(`Todo server naslouchá na ws://localhost:${server.port}`);
}

main();
```

## Část 2: Klient — CRUD operace

Připojení a správa úkolů přes SDK:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const todos = client.store.bucket('todos');

// Vytvoření
const buyMilk = await todos.insert({ title: 'Koupit mléko' });
console.log(buyMilk.id);        // "a1b2c3..."
console.log(buyMilk.completed); // false (výchozí)

const walkDog = await todos.insert({ title: 'Venčit psa' });

// Čtení
const all = await todos.all();
console.log(all.length); // 2

const found = await todos.findOne({ title: 'Koupit mléko' });
console.log(found?.id === buyMilk.id); // true

// Aktualizace — označit jako dokončené
const updated = await todos.update(buyMilk.id, { completed: true });
console.log(updated.completed); // true

// Smazání
await todos.delete(walkDog.id);

// Počet
const remaining = await todos.count({ completed: false });
console.log(remaining); // 0
```

Každá metoda vrací kompletní záznam včetně polí `RecordMeta` (`id`, `_version`, `_createdAt`, `_updatedAt`).

## Část 3: Reaktivní odběry

Odběry promění jednorázový dotaz v živý datový proud. Callback se zavolá jednou s aktuálním výsledkem (initial data) a znovu pokaždé, když se výsledek změní:

```typescript
const snapshots: unknown[] = [];

const unsubAll = await client.store.subscribe('all-todos', (data) => {
  snapshots.push(data);
  console.log('Seznam úkolů:', data);
});

// snapshots[0] = [] (počáteční: žádné úkoly)

await todos.insert({ title: 'Koupit mléko' });
// Server přehodnotí → push dorazí
// snapshots[1] = [{ id: "...", title: "Koupit mléko", completed: false, ... }]

await todos.insert({ title: 'Venčit psa' });
// snapshots[2] = [{ ... "Koupit mléko" ... }, { ... "Venčit psa" ... }]
```

### Skalární odběry

Dotaz `completed-count` vrací číslo, ne pole:

```typescript
let completedCount = 0;

const unsubCount = await client.store.subscribe('completed-count', (data) => {
  completedCount = data as number;
  console.log(`Dokončeno: ${completedCount}`);
});

// completedCount = 0

await todos.update(buyMilk.id, { completed: true });
// completedCount = 1
```

### Filtrované odběry

Odběr `active-todos` pushne pouze tehdy, když se změní filtrovaný výsledek:

```typescript
const activeSnapshots: unknown[] = [];

await client.store.subscribe('active-todos', (data) => {
  activeSnapshots.push(data);
});

// activeSnapshots[0] = [{ ... "Venčit psa" ... }] (Koupit mléko je dokončené)

await todos.insert({ title: 'Přečíst knihu' });
// activeSnapshots[1] = [{ ... "Venčit psa" ... }, { ... "Přečíst knihu" ... }]
```

## Část 4: Synchronizace více klientů

Síla reaktivních odběrů se projeví, když se připojí více klientů. Jeden klient mění data; všichni ostatní automaticky dostávají aktualizace.

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

// Klient A — zapisovatel
const clientA = new NoexClient('ws://localhost:8080', { WebSocket });
await clientA.connect();

// Klient B — čtenář
const clientB = new NoexClient('ws://localhost:8080', { WebSocket });
await clientB.connect();

// Klient B odebírá all-todos
const liveTodos: unknown[] = [];
const unsub = await clientB.store.subscribe('all-todos', (data) => {
  liveTodos.push(data);
});

// liveTodos[0] = [] (počáteční)

// Klient A vloží úkol
await clientA.store.bucket('todos').insert({ title: 'Koupit mléko' });

// Callback Klienta B se zavolá s aktualizovaným seznamem
// liveTodos[1] = [{ id: "...", title: "Koupit mléko", ... }]

// Klient A ho dokončí
const all = await clientA.store.bucket('todos').all();
await clientA.store.bucket('todos').update(all[0]!.id, { completed: true });

// Klient B obdrží aktualizaci
// liveTodos[2] = [{ id: "...", title: "Koupit mléko", completed: true, ... }]

// Cleanup
unsub();
await clientA.disconnect();
await clientB.disconnect();
```

```
  Klient A                   Server                    Klient B
    │                          │                          │
    │  insert("Koupit mléko") │                          │
    ├─────────────────────────►│                          │
    │                          │  přehodnocení dotazů     │
    │                          │  výsledek se změnil      │
    │                          ├─────────────────────────►│
    │                          │                  callback(data)
    │                          │                          │
    │  update(id, completed)  │                          │
    ├─────────────────────────►│                          │
    │                          │  přehodnocení dotazů     │
    │                          │  výsledek se změnil      │
    │                          ├─────────────────────────►│
    │                          │                  callback(data)
```

## Kompletní funkční příklad

Celý Node.js skript, který nastaví server, připojí dva klienty a demonstruje real-time synchronizaci:

```typescript
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  // ── Server ─────────────────────────────────────────────────────
  const store = await Store.start({ name: 'todo-demo' });

  await store.defineBucket('todos', {
    key: 'id',
    schema: {
      id:        { type: 'string', generated: 'uuid' },
      title:     { type: 'string', required: true },
      completed: { type: 'boolean', default: false },
    },
  });

  store.defineQuery('all-todos', async (ctx) => ctx.bucket('todos').all());
  store.defineQuery('completed-count', async (ctx) => {
    return ctx.bucket('todos').count({ completed: true });
  });

  const server = await NoexServer.start({ store, port: 0, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${server.port}`;

  // ── Klienti ────────────────────────────────────────────────────
  const writer = new NoexClient(url, { WebSocket: WebSocket as never });
  const viewer = new NoexClient(url, { WebSocket: WebSocket as never });
  await writer.connect();
  await viewer.connect();

  // Čtenář odebírá
  const todoList: unknown[] = [];
  let completed = 0;

  const unsubTodos = await viewer.store.subscribe('all-todos', (data) => {
    todoList.length = 0;
    (data as unknown[]).forEach((t) => todoList.push(t));
    console.log(`Úkoly (${todoList.length}):`);
    for (const t of todoList) {
      const todo = t as Record<string, unknown>;
      const mark = todo['completed'] ? 'x' : ' ';
      console.log(`  [${mark}] ${todo['title']}`);
    }
  });

  const unsubCount = await viewer.store.subscribe('completed-count', (data) => {
    completed = data as number;
    console.log(`Dokončeno: ${completed}`);
  });

  // Zapisovatel přidává úkoly
  const milk = await writer.store.bucket('todos').insert({ title: 'Koupit mléko' });
  await store.settle();

  const dog = await writer.store.bucket('todos').insert({ title: 'Venčit psa' });
  await store.settle();

  // Zapisovatel dokončí jeden
  await writer.store.bucket('todos').update(milk.id, { completed: true });
  await store.settle();

  // Zapisovatel smaže jeden
  await writer.store.bucket('todos').delete(dog.id);
  await store.settle();

  // ── Cleanup ────────────────────────────────────────────────────
  unsubTodos();
  unsubCount();
  await writer.disconnect();
  await viewer.disconnect();
  await server.stop();
  await store.stop();

  console.log('Hotovo.');
}

main();
```

## Cvičení

Vytvořte vylepšenou todo aplikaci s těmito funkcemi:

1. Přidejte pole `priority` do úkolů (`'low' | 'medium' | 'high'`)
2. Definujte serverový dotaz `high-priority-active`, který vrací pouze nedokončené úkoly s vysokou prioritou
3. Odebírejte z jednoho klienta jak `all-todos`, tak `high-priority-active`
4. Vložte tři úkoly: jeden s nízkou, jeden se střední a jeden s vysokou prioritou
5. Ověřte, že odběr `high-priority-active` zobrazuje pouze úkol s vysokou prioritou
6. Dokončete úkol s vysokou prioritou a ověřte, že filtrovaný odběr nyní vrací prázdné pole

<details>
<summary>Řešení</summary>

**Doplnění serveru:**

```typescript
await store.defineBucket('todos', {
  key: 'id',
  schema: {
    id:        { type: 'string', generated: 'uuid' },
    title:     { type: 'string', required: true },
    completed: { type: 'boolean', default: false },
    priority:  { type: 'string', default: 'medium' },
  },
});

store.defineQuery('high-priority-active', async (ctx) => {
  return ctx.bucket('todos').where({ completed: false, priority: 'high' });
});
```

**Klientský kód:**

```typescript
const client = new NoexClient(url, { WebSocket: WebSocket as never });
await client.connect();
const todos = client.store.bucket('todos');

const allResults: unknown[] = [];
const highResults: unknown[] = [];

await client.store.subscribe('all-todos', (data) => {
  allResults.push(data);
});

await client.store.subscribe('high-priority-active', (data) => {
  highResults.push(data);
});

// Počáteční: oboje prázdné
// allResults[0] = [], highResults[0] = []

await todos.insert({ title: 'Uklidit stůl', priority: 'low' });
await todos.insert({ title: 'Napsat šéfovi', priority: 'medium' });
const urgent = await todos.insert({ title: 'Opravit produkční bug', priority: 'high' });

// allResults obsahuje 3 úkoly
// highResults obsahuje pouze [{ title: 'Opravit produkční bug', ... }]

await todos.update(urgent.id, { completed: true });

// highResults nyní má prázdné pole — jediný úkol s vysokou prioritou je dokončen
```

</details>

## Shrnutí

- **Bucket operace** — `insert`, `get`, `update`, `delete`, `all`, `where`, `findOne`, `count` poskytují kompletní CRUD a dotazovací schopnosti
- **Reaktivní odběry** — `store.subscribe(query, callback)` doručí počáteční data synchronně a push aktualizace při každé změně
- **Skalární dotazy** — odběry fungují s jakýmkoliv návratovým typem (pole, čísla, objekty)
- **Filtrované dotazy** — push notifikace jsou selektivní; aktualizaci dostanou pouze odběry, jejichž výsledek se skutečně změnil
- **Synchronizace více klientů** — mutace z jednoho připojení spustí push pro všechna ostatní připojení s aktivními odběry
- **Cleanup** — zavolejte funkci `unsubscribe` (synchronní) a `disconnect()` pro uvolnění zdrojů

---

Další: [Dashboard v reálném čase](./02-dashboard-v-realnem-case.md)
