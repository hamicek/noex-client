# Logic API

Třída `LogicAPI` poskytuje přístup k serverovému logic enginu — vypočítané položky, odvozené pohledy, omezení a vyhodnocování výrazů. Je dostupná jako vlastnost `logic` na `NoexClient`.

## Import

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const logic = client.logic;
```

Relevantní typy:

```typescript
import type {
  ComputedFieldDefinition,
  ComputedFieldsConfig,
  DerivedViewDefinition,
  DerivedViewInfo,
  DerivedViewExplanation,
  ConstraintDefinition,
  Expression,
  Unsubscribe,
} from '@hamicek/noex-client';
```

---

## Vypočítané položky

### defineComputed()

```typescript
defineComputed(
  bucket: string,
  fields: Record<string, ComputedFieldDefinition>,
): Promise<void>
```

Definuje vypočítané položky na bucketu. Vypočítané položky se automaticky spočítají při vkládání nebo aktualizaci záznamů.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| bucket | `string` | ano | Název bucketu. Musí být definovaný bucket ve store. |
| fields | `Record<string, ComputedFieldDefinition>` | ano | Mapa název pole → definice. Každá definice má `depends` (zdrojová pole) a `expr` (výraz k vyhodnocení). |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `bucket` nebo `fields`
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
await logic.defineComputed('items', {
  total: {
    depends: ['qty', 'price'],
    expr: expr.multiply(expr.f('qty'), expr.f('price')),
  },
});

// Po insertu je vypočítaná položka automaticky spočítána
const items = client.store.bucket('items');
const item = await items.insert({ qty: 3, price: 10 });
const stored = await items.get(item.id);
console.log(stored.total); // 30
```

---

### dropComputed()

```typescript
dropComputed(bucket: string): Promise<boolean>
```

Odstraní definice vypočítaných položek z bucketu. Vrátí `true`, pokud definice existovaly a byly odstraněny, `false` jinak.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| bucket | `string` | ano | Název bucketu. |

**Návratová hodnota:** `Promise<boolean>` — `true` pokud odstraněno, `false` pokud definice neexistovaly

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `bucket`
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const dropped = await logic.dropComputed('items');
console.log(dropped); // true
```

---

### listComputed()

```typescript
listComputed(): Promise<ComputedFieldsConfig[]>
```

Vrátí všechny konfigurace vypočítaných položek.

**Návratová hodnota:** `Promise<ComputedFieldsConfig[]>` — pole konfigurací, nebo prázdné pole pokud nejsou definovány

**Vyhazuje:**
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const configs = await logic.listComputed();
for (const config of configs) {
  console.log(`Bucket: ${config.bucket}, Položky: ${Object.keys(config.fields).join(', ')}`);
}
```

---

## Odvozené pohledy

### defineView()

```typescript
defineView(definition: DerivedViewDefinition): Promise<void>
```

Definuje odvozený pohled — dotaz přes více bucketů s joiny, filtry, seskupením a výrazy.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| definition | `DerivedViewDefinition` | ano | Definice pohledu (viz [Typy](#derivedviewdefinition) níže). |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `definition` nebo je neplatná (prázdné `from`, chybí `select` atd.)
- `NoexClientError` s kódem `ALREADY_EXISTS` pokud pohled s tímto názvem již existuje
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
await logic.defineView({
  name: 'invoice_details',
  from: { i: 'invoices', c: 'customers' },
  join: { 'i.customerId': 'c.id' },
  select: {
    invoiceId: 'i.id',
    customerName: 'c.name',
    total: 'i.total',
  },
});
```

---

### queryView()

```typescript
queryView(name: string): Promise<Record<string, unknown>[]>
```

Dotáže se na aktuální data definovaného pohledu.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| name | `string` | ano | Název pohledu. |

**Návratová hodnota:** `Promise<Record<string, unknown>[]>` — pole výsledných záznamů, nebo prázdné pole pokud žádné záznamy neodpovídají

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `name` nebo pohled neexistuje
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const rows = await logic.queryView('invoice_details');
for (const row of rows) {
  console.log(`${row.customerName}: ${row.total}`);
}
```

---

### explainView()

```typescript
explainView(name: string): Promise<DerivedViewExplanation>
```

Vrátí detailní vysvětlení struktury pohledu — zdroje, joiny, filtry a závislosti.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| name | `string` | ano | Název pohledu. |

**Návratová hodnota:** `Promise<DerivedViewExplanation>` — strukturální vysvětlení pohledu

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `name` nebo pohled neexistuje
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const explanation = await logic.explainView('invoice_details');
console.log('Zdroje:', explanation.sources);
console.log('Joiny:', explanation.joins);
console.log('Závislosti:', explanation.dependencies);
```

---

### listViews()

```typescript
listViews(): Promise<DerivedViewInfo[]>
```

Vrátí seznam všech definovaných pohledů se souhrnnými informacemi.

**Návratová hodnota:** `Promise<DerivedViewInfo[]>` — pole souhrnů pohledů, nebo prázdné pole pokud nejsou definovány

**Vyhazuje:**
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const views = await logic.listViews();
for (const view of views) {
  console.log(`${view.name}: ${view.resultCount} řádků (reactive: ${view.reactive})`);
}
```

---

### dropView()

```typescript
dropView(name: string): Promise<boolean>
```

Odstraní definici pohledu. Vrátí `true`, pokud pohled existoval a byl odstraněn, `false` jinak.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| name | `string` | ano | Název pohledu. |

**Návratová hodnota:** `Promise<boolean>` — `true` pokud odstraněn, `false` pokud pohled neexistoval

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `name`
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const dropped = await logic.dropView('invoice_details');
console.log(dropped); // true
```

---

## Omezení

### defineConstraint()

```typescript
defineConstraint(constraint: ConstraintDefinition): Promise<void>
```

Definuje integritní omezení na bucketu. Omezení se automaticky vynucují při operacích store `insert` a `update` — záznam, který poruší omezení, bude odmítnut s `VALIDATION_ERROR`.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| constraint | `ConstraintDefinition` | ano | Definice omezení (viz [Typy](#constraintdefinition) níže). |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `constraint` nebo je neplatný
- `NoexClientError` s kódem `ALREADY_EXISTS` pokud omezení s tímto názvem již existuje
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
await logic.defineConstraint({
  name: 'positive_balance',
  on: 'accounts',
  expr: expr.gte(expr.f('balance'), 0),
  message: 'Zůstatek musí být nezáporný',
});

// Tento insert bude odmítnut:
const accounts = client.store.bucket('accounts');
try {
  await accounts.insert({ balance: -100 });
} catch (err) {
  console.log(err.code); // 'VALIDATION_ERROR'
}
```

---

### dropConstraint()

```typescript
dropConstraint(name: string): Promise<boolean>
```

Odstraní definici omezení. Po odstranění se omezení již nevynucuje. Vrátí `true`, pokud omezení existovalo a bylo odstraněno, `false` jinak.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| name | `string` | ano | Název omezení. |

**Návratová hodnota:** `Promise<boolean>` — `true` pokud odstraněno, `false` pokud omezení neexistovalo

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `name`
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const dropped = await logic.dropConstraint('positive_balance');
console.log(dropped); // true
```

---

### listConstraints()

```typescript
listConstraints(): Promise<ConstraintDefinition[]>
```

Vrátí všechna definovaná omezení.

**Návratová hodnota:** `Promise<ConstraintDefinition[]>` — pole definic omezení, nebo prázdné pole pokud nejsou definována

**Vyhazuje:**
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const constraints = await logic.listConstraints();
for (const c of constraints) {
  console.log(`${c.name} na ${c.on}: ${c.message}`);
}
```

---

## Výrazy

### evaluateExpr()

```typescript
evaluateExpr(
  expr: Expression,
  record?: Record<string, unknown>,
): Promise<unknown>
```

Vyhodnotí výraz samostatně, bez definice vypočítaných položek. Užitečné pro jednorázové výpočty.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| expr | `Expression` | ano | Výraz k vyhodnocení. Může být literál, reference na pole (`$fieldName`) nebo operátorový objekt. |
| record | `Record<string, unknown>` | ne | Záznam poskytující hodnoty polí pro reference `$fieldName`. Výchozí `{}`. |

**Návratová hodnota:** `Promise<unknown>` — výsledek vyhodnocení

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `expr`
- `NoexClientError` s kódem `INTERNAL_ERROR` pokud vyhodnocení výrazu selže (např. neplatný operátor)
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
import { expr } from '@hamicek/noex-client';

const result = await logic.evaluateExpr(
  expr.multiply(expr.f('price'), expr.f('qty')),
  { price: 15, qty: 4 },
);
console.log(result); // 60
```

---

## Odběry pohledů

### subscribeView()

```typescript
subscribeView(
  name: string,
  callback: (data: Record<string, unknown>[]) => void,
): Promise<Unsubscribe>
```

Přihlásí se k odběru reaktivního pohledu. Callback obdrží aktuální data pohledu okamžitě (počáteční doručení) a je zavolán znovu, kdykoli se změní zdrojová data a pohled se přepočítá.

Pohled musí být definován s `reactive: true`.

Na rozdíl od `rules.subscribe` (který nemá počáteční stav), `logic.subscribeView` doručuje počáteční data — podobně jako `store.subscribe`.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| name | `string` | ano | Název reaktivního pohledu. |
| callback | `(data: Record<string, unknown>[]) => void` | ano | Voláno s kompletním výsledkem pohledu (celý snapshot) při počátečním doručení a každé aktualizaci. |

**Návratová hodnota:** `Promise<Unsubscribe>` — vyřeší se na synchronní funkci pro odhlášení `() => void`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud chybí `name` nebo pohled neexistuje
- `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE` pokud není nakonfigurován logic engine
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const unsubscribe = await logic.subscribeView('order_summary', (rows) => {
  console.log('Data pohledu:', rows);
});

// Mutace zdrojových dat spustí callback s aktualizovanými výsledky pohledu
// ...

// Ukončení odběru
unsubscribe();
```

### Funkce Unsubscribe

```typescript
const unsubscribe: Unsubscribe = await logic.subscribeView('order_summary', callback);
unsubscribe(); // synchronní, vrací void
```

Funkce `Unsubscribe` vrácená metodou `subscribeView()`:

1. Odstraní subscripci z lokálního `SubscriptionManager`
2. Odešle požadavek `logic.unsubscribeView` na server (fire-and-forget)
3. Vrací `void` synchronně — nečeká na potvrzení ze serveru

Opakované volání je bezpečné — druhé volání je na straně serveru no-op.

---

### unsubscribeView()

```typescript
unsubscribeView(subscriptionId: string): Promise<void>
```

Odhlásí subscripci podle serverem přiděleného ID. Toto je pokročilá metoda — pro běžné použití preferujte funkci `Unsubscribe` vrácenou metodou `subscribeView()`.

Na rozdíl od funkce `Unsubscribe` tato metoda čeká na odpověď serveru.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| subscriptionId | `string` | ano | Serverem přidělené ID subscripce |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `NoexClientError` s kódem `NOT_FOUND` pokud subscripce neexistuje
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

---

## `expr` helper

Helper `expr` poskytuje typově bezpečný, skládatelný způsob stavění výrazů bez psaní surových JSON operátorových objektů. Importujte ho přímo z balíčku:

```typescript
import { expr } from '@hamicek/noex-client';
```

### Reference na pole

```typescript
expr.f('price')  // → '$price'
expr.f('qty')    // → '$qty'
```

### Aritmetické

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.add(a, b)` | Sčítání | `expr.add(expr.f('a'), expr.f('b'))` → `{ $add: ['$a', '$b'] }` |
| `expr.subtract(a, b)` | Odčítání | `expr.subtract(expr.f('total'), expr.f('discount'))` |
| `expr.multiply(a, b)` | Násobení | `expr.multiply(expr.f('qty'), expr.f('price'))` |
| `expr.divide(a, b)` | Dělení | `expr.divide(expr.f('total'), expr.f('count'))` |
| `expr.mod(a, b)` | Modulo | `expr.mod(expr.f('value'), 2)` |
| `expr.abs(a)` | Absolutní hodnota | `expr.abs(expr.f('balance'))` |
| `expr.round(a, decimals?)` | Zaokrouhlení (výchozí 0 desetin) | `expr.round(expr.f('price'), 2)` |
| `expr.floor(a)` | Zaokrouhlení dolů | `expr.floor(expr.f('score'))` |
| `expr.ceil(a)` | Zaokrouhlení nahoru | `expr.ceil(expr.f('score'))` |

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
| `expr.cond(condition, then, otherwise)` | Podmínka (if/else) | `expr.cond(expr.gt(expr.f('score'), 50), 'pass', 'fail')` |

### Řetězcové

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.concat(...parts)` | Spojení | `expr.concat(expr.f('first'), ' ', expr.f('last'))` |
| `expr.upper(a)` | Velká písmena | `expr.upper(expr.f('name'))` |
| `expr.lower(a)` | Malá písmena | `expr.lower(expr.f('email'))` |
| `expr.length(a)` | Délka řetězce | `expr.length(expr.f('name'))` |
| `expr.trim(a)` | Oříznutí mezer | `expr.trim(expr.f('input'))` |
| `expr.substring(a, start, len?)` | Podřetězec | `expr.substring(expr.f('code'), 0, 3)` |

### Datumové

| Metoda | Popis | Příklad |
|--------|-------|---------|
| `expr.now()` | Aktuální časové razítko | `expr.now()` |
| `expr.year(a)` | Extrakce roku | `expr.year(expr.f('createdAt'))` |
| `expr.month(a)` | Extrakce měsíce | `expr.month(expr.f('createdAt'))` |
| `expr.day(a)` | Extrakce dne | `expr.day(expr.f('createdAt'))` |
| `expr.daysBetween(a, b)` | Dny mezi dvěma daty | `expr.daysBetween(expr.f('start'), expr.f('end'))` |
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

---

## Protokol push zpráv

Logic view push zprávy používají kanál `logic`:

```typescript
// Server → Klient
{
  type: 'push',
  subscriptionId: string,  // serverem přidělené ID
  channel: 'logic',        // odlišuje logic push od store a rules push
  data: Record<string, unknown>[]  // kompletní přepočítaný výsledek pohledu (celý snapshot)
}
```

`PushRouter` kontroluje příchozí zprávy. Pokud `type === 'push'` a `channel === 'logic'`, zpráva je směrována do `SubscriptionManager`, který zavolá registrovaný callback s polem `data`.

---

## Obnova při reconnectu

Logic view subscripce jsou automaticky obnoveny při reconnectu klienta. Metoda `SubscriptionManager.resubscribeAll()` znovu odešle původní požadavek `logic.subscribeView` se stejným názvem pohledu a server přidělí nové `subscriptionId`.

Podobně jako store subscripce (a na rozdíl od rules subscripcí) resubscripce logic doručuje počáteční data — callback obdrží aktuální výsledek pohledu okamžitě po reconnectu.

Pokud resubscripce selže, daná subscripce je tiše odstraněna z lokálního registru a zalogována do `console.error`.

**Příklad:**

```typescript
client.on('reconnected', () => {
  console.log('Znovu připojeno — logic subscripce obnoveny automaticky');
});

const unsub = await logic.subscribeView('order_summary', (rows) => {
  // Voláno s počátečními daty a při každé aktualizaci, včetně po reconnectu.
  renderOrderSummary(rows);
});
```

---

## Typy

### Expression

```typescript
type Expression =
  | number
  | string
  | boolean
  | null
  | ExpressionOperator;

type ExpressionOperator = {
  readonly [key: `$${string}`]: Expression | readonly Expression[];
};
```

### ComputedFieldDefinition

```typescript
interface ComputedFieldDefinition {
  readonly depends: readonly string[];
  readonly expr: Expression;
}
```

### ComputedFieldsConfig

```typescript
interface ComputedFieldsConfig {
  readonly bucket: string;
  readonly fields: Record<string, ComputedFieldDefinition>;
}
```

### DerivedViewDefinition

```typescript
interface DerivedViewDefinition {
  readonly name: string;
  readonly from: Record<string, string>;
  readonly join?: Record<string, string>;
  readonly where?: Record<string, unknown>;
  readonly groupBy?: string | readonly string[];
  readonly select: Record<string, string | Expression>;
  readonly reactive?: boolean;
  readonly orderBy?: readonly OrderBySpec[];
  readonly limit?: number;
}
```

### DerivedViewInfo

```typescript
interface DerivedViewInfo {
  readonly name: string;
  readonly from: Record<string, string>;
  readonly reactive: boolean;
  readonly resultCount: number;
}
```

### DerivedViewExplanation

```typescript
interface DerivedViewExplanation {
  readonly name: string;
  readonly sources: Record<string, string>;
  readonly joins: Record<string, string>;
  readonly filters: Record<string, unknown>;
  readonly groupBy: readonly string[];
  readonly select: Record<string, string | Expression>;
  readonly dependencies: readonly string[];
}
```

### ConstraintDefinition

```typescript
interface ConstraintDefinition {
  readonly name: string;
  readonly on: string;
  readonly expr: Expression;
  readonly message: string;
  readonly scope?: 'record' | 'group';
  readonly groupBy?: string;
  readonly operations?: readonly ('insert' | 'update' | 'delete')[];
}
```

### OrderBySpec

```typescript
interface OrderBySpec {
  readonly field: string;
  readonly direction?: 'asc' | 'desc';
}
```

---

## Viz také

- [NoexClient](./01-noex-client.md) — životní cyklus připojení, vlastnost `logic`, `on()` eventy
- [Store Subscriptions](./05-store-subscriptions.md) — životní cyklus store subscripcí (pro srovnání s logic subscripcemi)
- [Rules API](./06-rules-api.md) — API pravidlového enginu (pro srovnání)
- [Transport](./08-transport.md) — strategie reconnectu, exponenciální backoff
- [Konfigurace](./02-configuration.md) — `requestTimeoutMs`, nastavení `reconnect`
- [Typy](./09-types.md) — `Expression`, `ComputedFieldDefinition`, `DerivedViewDefinition`, `ConstraintDefinition`, `Unsubscribe`
- [Chyby](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
- [Dokumentace noex-logic](https://github.com/nicvisual/noex-logic) — Kompletní dokumentace logic enginu
