# Odběry pohledů

Odběr reaktivních pohledů pro živé aktualizace a samostatné vyhodnocení výrazů. Logic odběry doručují initial data a push aktualizace — podobně jako store odběry, ale na kanálu `logic`.

## Co se naučíte

- Jak odebírat reaktivní pohled s `logic.subscribeView()`
- Doručení initial data a push aktualizace
- Vzory pro odhlášení
- Jak vyhodnocovat výrazy s `logic.evaluateExpr()`
- Helper `expr` detailně — všechny operátory podle kategorie
- Rozdíl mezi store, rules a logic odběry
- Reconnect recovery pro logic odběry

## logic.subscribeView()

Odběr reaktivního pohledu. Callback dostane aktuální data pohledu okamžitě (initial delivery) a je volán znovu při každé změně zdrojových dat:

```typescript
const unsubscribe = await client.logic.subscribeView('order_summary', (rows) => {
  console.log('Data pohledu:', rows);
});
```

**Signatura:**

```typescript
subscribeView(
  name: string,
  callback: (data: Record<string, unknown>[]) => void,
): Promise<Unsubscribe>
```

| Parametr | Typ | Povinný | Popis |
|----------|-----|---------|-------|
| name | `string` | ano | Název reaktivního pohledu (definovaný s `reactive: true`) |
| callback | `(data: Record<string, unknown>[]) => void` | ano | Volán s kompletním výsledkem pohledu při initial delivery a každé aktualizaci |

Vrací `Promise<Unsubscribe>` — resolvuje na synchronní funkci `() => void`.

### Initial data

Na rozdíl od rules odběrů (které nemají initial stav), logic odběry doručují aktuální výsledek pohledu okamžitě:

```typescript
const received: Array<Record<string, unknown>[]> = [];

const unsub = await client.logic.subscribeView('my_view', (data) => {
  received.push(data);
});

// V tomto bodě má received jeden záznam — initial data
console.log(received.length); // 1
```

### Push aktualizace

Při změně zdrojových dat (insert, update, delete) server přepočítá pohled a pushne plný aktualizovaný výsledek:

```typescript
const snapshots: Array<Record<string, unknown>[]> = [];

const unsub = await client.logic.subscribeView('items_view', (data) => {
  snapshots.push(data);
});

// snapshots[0] je initial data (např. prázdné pole)

await client.store.bucket('items').insert({ id: 'i1', val: 42 });
// Po push: snapshots[1] obsahuje [{ id: 'i1', val: 42 }]
```

Každý push doručuje **plný snapshot** pohledu — ne diff.

## Odhlášení

Funkce `Unsubscribe` vrácená z `subscribeView()` je synchronní:

```typescript
const unsubscribe = await client.logic.subscribeView('my_view', callback);

// Později — přestat přijímat aktualizace
unsubscribe();
```

Při volání:
1. Odběr je okamžitě odebrán z lokálního `SubscriptionManager`
2. Požadavek `logic.unsubscribeView` je odeslán na server (fire-and-forget)
3. Žádné další aktualizace nejsou doručovány callbacku

Opakované volání `unsubscribe()` je bezpečné — následná volání jsou no-ops.

## logic.evaluateExpr()

Vyhodnocení výrazu bez definice vypočítaných položek. Užitečné pro jednorázové výpočty:

```typescript
import { expr } from '@hamicek/noex-client';

// Jednoduchá aritmetika
const sum = await client.logic.evaluateExpr(expr.add(2, 3));
console.log(sum); // 5

// S referencemi na pole
const total = await client.logic.evaluateExpr(
  expr.multiply(expr.f('price'), expr.f('qty')),
  { price: 15, qty: 4 },
);
console.log(total); // 60

// Vnořené výrazy
const result = await client.logic.evaluateExpr(
  expr.add(expr.multiply(expr.f('a'), expr.f('b')), expr.f('c')),
  { a: 3, b: 4, c: 5 },
);
console.log(result); // 17
```

**Signatura:**

```typescript
evaluateExpr(
  expr: Expression,
  record?: Record<string, unknown>,
): Promise<unknown>
```

| Parametr | Typ | Povinný | Popis |
|----------|-----|---------|-------|
| expr | `Expression` | ano | Výraz k vyhodnocení |
| record | `Record<string, unknown>` | ne | Záznam poskytující hodnoty pro reference `$fieldName` |

## Reference helperu `expr`

### Reference na pole

```typescript
expr.f('price')  // → '$price'
expr.f('qty')    // → '$qty'
```

### Aritmetické

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.add(a, b)` | Sčítání | `expr.add(expr.f('a'), expr.f('b'))` |
| `expr.subtract(a, b)` | Odčítání | `expr.subtract(expr.f('total'), expr.f('discount'))` |
| `expr.multiply(a, b)` | Násobení | `expr.multiply(expr.f('qty'), expr.f('price'))` |
| `expr.divide(a, b)` | Dělení | `expr.divide(expr.f('total'), expr.f('count'))` |
| `expr.mod(a, b)` | Modulo | `expr.mod(expr.f('value'), 2)` |
| `expr.abs(a)` | Absolutní hodnota | `expr.abs(expr.f('balance'))` |
| `expr.round(a, decimals?)` | Zaokrouhlení (výchozí 0 míst) | `expr.round(expr.f('price'), 2)` |
| `expr.floor(a)` | Dolní celá část | `expr.floor(expr.f('score'))` |
| `expr.ceil(a)` | Horní celá část | `expr.ceil(expr.f('score'))` |

### Porovnávací

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.eq(a, b)` | Rovná se | `expr.eq(expr.f('status'), 'active')` |
| `expr.neq(a, b)` | Nerovná se | `expr.neq(expr.f('role'), 'guest')` |
| `expr.gt(a, b)` | Větší než | `expr.gt(expr.f('age'), 18)` |
| `expr.gte(a, b)` | Větší nebo rovno | `expr.gte(expr.f('balance'), 0)` |
| `expr.lt(a, b)` | Menší než | `expr.lt(expr.f('stock'), 10)` |
| `expr.lte(a, b)` | Menší nebo rovno | `expr.lte(expr.f('attempts'), 3)` |
| `expr.between(a, min, max)` | Mezi (včetně) | `expr.between(expr.f('age'), 18, 65)` |
| `expr.isIn(a, list)` | V seznamu | `expr.isIn(expr.f('status'), ['active', 'pending'])` |

### Logické

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.and(...conds)` | Logické AND | `expr.and(expr.gt(expr.f('age'), 18), expr.eq(expr.f('active'), true))` |
| `expr.or(...conds)` | Logické OR | `expr.or(expr.eq(expr.f('role'), 'admin'), expr.eq(expr.f('role'), 'mod'))` |
| `expr.not(a)` | Logické NOT | `expr.not(expr.eq(expr.f('deleted'), true))` |
| `expr.cond(cond, then, else)` | Podmínka | `expr.cond(expr.gt(expr.f('score'), 50), 'pass', 'fail')` |

### Řetězcové

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.concat(...parts)` | Zřetězení | `expr.concat(expr.f('first'), ' ', expr.f('last'))` |
| `expr.upper(a)` | Velká písmena | `expr.upper(expr.f('name'))` |
| `expr.lower(a)` | Malá písmena | `expr.lower(expr.f('email'))` |
| `expr.length(a)` | Délka řetězce | `expr.length(expr.f('name'))` |
| `expr.trim(a)` | Oříznutí bílých znaků | `expr.trim(expr.f('input'))` |
| `expr.substring(a, start, len?)` | Podřetězec | `expr.substring(expr.f('code'), 0, 3)` |

### Datumové

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.now()` | Aktuální timestamp | `expr.now()` |
| `expr.year(a)` | Extrakce roku | `expr.year(expr.f('createdAt'))` |
| `expr.month(a)` | Extrakce měsíce | `expr.month(expr.f('createdAt'))` |
| `expr.day(a)` | Extrakce dne | `expr.day(expr.f('createdAt'))` |
| `expr.daysBetween(a, b)` | Dny mezi daty | `expr.daysBetween(expr.f('start'), expr.f('end'))` |
| `expr.dateAdd(date, n, unit)` | Přidání času k datu | `expr.dateAdd(expr.f('date'), 30, 'day')` |

### Agregační

Agregační výrazy se používají v definicích pohledů s `groupBy`:

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.sum(field)` | Součet | `expr.sum('amount')` |
| `expr.avg(field)` | Průměr | `expr.avg('price')` |
| `expr.min(field)` | Minimum | `expr.min('createdAt')` |
| `expr.max(field)` | Maximum | `expr.max('score')` |
| `expr.count(field?)` | Počet (`'*'` bez pole) | `expr.count()` |

## Store vs Rules vs Logic odběry

| | Store | Rules | Logic |
|---|---|---|---|
| **Odběr** | `store.subscribe(name, cb)` | `rules.subscribe(pattern, cb)` | `logic.subscribeView(name, cb)` |
| **Initial data** | Ano | Ne | Ano |
| **Push kanál** | `subscription` | `event` | `logic` |
| **Obsah push** | Výsledek dotazu | Jednotlivý event | Plný snapshot pohledu |
| **Odhlášení** | Synchronní `() => void` | Synchronní `() => void` | Synchronní `() => void` |
| **Reconnect** | Resubscribe + initial data | Resubscribe (bez replay) | Resubscribe + initial data |

Všechny tři typy sdílejí limit odběrů na připojení (výchozí: 100).

## Reconnect recovery

Logic odběry pohledů se automaticky obnoví při reconnectu klienta. SDK znovu odešle požadavek `logic.subscribeView` a server přiřadí nové `subscriptionId`. Podobně jako store odběry, callback dostane čerstvá initial data po reconnectu:

```typescript
client.on('reconnected', () => {
  console.log('Reconnected — logic odběry automaticky obnoveny');
});

const unsub = await client.logic.subscribeView('order_summary', (rows) => {
  // Voláno s initial data a při každé aktualizaci, včetně po reconnectu.
  renderOrderSummary(rows);
});
```

Události, které proběhly za odpojení, se promítnou do initial dat po reconnectu — callback dostane aktuální stav pohledu.

## Kompletní příklad

Reaktivní dashboard sledující položky v reálném čase:

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const items = client.store.bucket('items');

  // Definice reaktivního pohledu
  await client.logic.defineView({
    name: 'item_dashboard',
    from: { i: 'items' },
    select: { id: 'i.id', qty: 'i.qty', price: 'i.price' },
    reactive: true,
  });

  // Odběr — initial data + živé aktualizace
  const unsub = await client.logic.subscribeView('item_dashboard', (rows) => {
    console.log(`Dashboard: ${rows.length} položek`);
    for (const row of rows) {
      console.log(`  ${row.id}: qty=${row.qty}, price=${row.price}`);
    }
  });

  // Vložení položek — každá spustí push
  await items.insert({ id: 'widget', qty: 5, price: 10 });
  await items.insert({ id: 'gadget', qty: 2, price: 25 });

  // Vyhodnocení výrazu
  const total = await client.logic.evaluateExpr(
    expr.multiply(expr.f('qty'), expr.f('price')),
    { qty: 5, price: 10 },
  );
  console.log(`Vypočtený total: ${total}`); // 50

  // Čekání na push
  await new Promise((r) => setTimeout(r, 500));

  // Úklid
  unsub();
  await client.logic.dropView('item_dashboard');
  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Definuje reaktivní pohled na bucketu
2. Přihlásí se k odběru pohledu a sbírá všechny snapshoty do pole
3. Vloží dva záznamy a počká na push
4. Ověří, že pole má 3 záznamy (1 initial + 2 push)
5. Použije `evaluateExpr` k výpočtu `(10 + 20) * 3` — mělo by vrátit `90`
6. Odhlásí se a odebere pohled

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const items = client.store.bucket('items');

  // 1. Definice reaktivního pohledu
  await client.logic.defineView({
    name: 'tracked_items',
    from: { i: 'items' },
    select: { id: 'i.id', val: 'i.val' },
    reactive: true,
  });

  // 2. Odběr a sběr snapshotů
  const snapshots: Array<Record<string, unknown>[]> = [];
  const unsub = await client.logic.subscribeView('tracked_items', (data) => {
    snapshots.push(data);
  });

  // 3. Vložení dvou záznamů
  await items.insert({ id: 'i1', val: 10 });
  await items.insert({ id: 'i2', val: 20 });

  // Čekání na push
  await new Promise((r) => setTimeout(r, 500));

  // 4. Ověření
  console.log(`Snapshoty: ${snapshots.length}`); // 3
  console.log(`Initial položky: ${snapshots[0].length}`);       // 0
  console.log(`Po prvním insertu: ${snapshots[1].length}`);      // 1
  console.log(`Po druhém insertu: ${snapshots[2].length}`);      // 2

  // 5. Vyhodnocení výrazu
  const result = await client.logic.evaluateExpr(
    expr.multiply(expr.add(10, 20), 3),
  );
  console.log(`Výsledek: ${result}`); // 90

  // 6. Úklid
  unsub();
  await client.logic.dropView('tracked_items');
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `logic.subscribeView(name, callback)` odebírá reaktivní pohled — doručuje initial data + push aktualizace
- Každý push obsahuje **plný snapshot** pohledu (ne diff)
- Vrácená funkce `Unsubscribe` je synchronní — odebere lokální odběr a notifikuje server
- `logic.evaluateExpr(expr, record?)` vyhodnocuje výraz samostatně — užitečné pro jednorázové výpočty
- Helper `expr` pokrývá aritmetické, porovnávací, logické, řetězcové, datumové a agregační operace
- `expr.f('fieldName')` vytvoří referenci na pole (`'$fieldName'`)
- Logic odběry sdílejí limit na připojení se store a rules odběry
- Odběry se automaticky obnoví při reconnectu s čerstvými initial daty

---

Další: [Todo aplikace](../11-projekty/01-todo-aplikace.md)
