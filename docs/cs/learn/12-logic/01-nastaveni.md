# Nastavení

Přístup k serverovému logic enginu přes namespace `client.logic` a tvorba výrazů s helperem `expr`.

## Co se naučíte

- Jak přistupovat k logic enginu přes `client.logic`
- Helper `expr` pro tvorbu výrazů bez surového JSON
- Co se stane, když server nemá nakonfigurovaný logic engine
- Přehled všech dostupných logic operací

## Namespace `logic`

`LogicAPI` je dostupné jako vlastnost `logic` na `NoexClient`:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const logic = client.logic;
```

Server musí mít nakonfigurovaný logic engine — předejte instanci `Logic` do `NoexServer.start({ store, logic })`. Viz [nastavení serveru](../../../noex-server/docs/cs/learn/14-logic/01-nastaveni.md) pro detaily.

## Architektura

```
┌────────────────┐       ┌──────────────┐       ┌─────────────┐
│  NoexClient    │──────>│  noex-server │──────>│  noex-logic │
│  client.logic  │<──────│  (proxy)     │<──────│  (engine)   │
└────────────────┘       └──────────────┘       └─────────────┘
                              │                       │
                              v                       v
                         ┌──────────────┐        (používá stejný
                         │  noex-store  │         store)
                         └──────────────┘
```

Každé volání `client.logic.*` odešle požadavek na server, který ho přepošle logic enginu. Push zprávy z odběrů pohledů přicházejí na kanálu `logic`.

## Bez logic

Když server nemá nakonfigurovaný logic engine, všechna volání `client.logic.*` vyhodí `NoexClientError` s kódem `LOGIC_NOT_AVAILABLE`:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

try {
  await client.logic.listComputed();
} catch (err) {
  if (err instanceof NoexClientError && err.code === 'LOGIC_NOT_AVAILABLE') {
    console.log('Logic engine není na serveru nakonfigurován');
  }
}
```

## Helper `expr`

Helper `expr` poskytuje typově bezpečný způsob tvorby výrazů. Importujte ho přímo z balíčku:

```typescript
import { expr } from '@hamicek/noex-client';
```

Místo psaní surových JSON operátorů:

```typescript
// Surový JSON — náchylný k chybám, bez autocomplete
{ $multiply: ['$qty', '$price'] }
```

Použijte helper:

```typescript
// Typově bezpečné, kompozitní, čitelné
expr.multiply(expr.f('qty'), expr.f('price'))
```

`expr.f('fieldName')` je zkratka pro referenci na pole — vytvoří `'$fieldName'`.

### Kategorie výrazů

| Kategorie | Příklady |
|-----------|----------|
| Aritmetické | `add`, `subtract`, `multiply`, `divide`, `mod`, `abs`, `round`, `floor`, `ceil` |
| Porovnávací | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `isIn` |
| Logické | `and`, `or`, `not`, `cond` |
| Řetězcové | `concat`, `upper`, `lower`, `length`, `trim`, `substring` |
| Datumové | `now`, `year`, `month`, `day`, `daysBetween`, `dateAdd` |
| Agregační | `sum`, `avg`, `min`, `max`, `count` |

Výrazy jsou kompozitní — můžete je vnořovat:

```typescript
// (qty * price) - discount
expr.subtract(
  expr.multiply(expr.f('qty'), expr.f('price')),
  expr.f('discount'),
)
```

## Dostupné operace

| Metoda | Popis |
|--------|-------|
| `logic.defineComputed(bucket, fields)` | Definice vypočítaných položek pro bucket |
| `logic.dropComputed(bucket)` | Odebrání vypočítaných položek z bucketu |
| `logic.listComputed()` | Výpis všech konfigurací vypočítaných položek |
| `logic.defineView(definition)` | Definice odvozeného pohledu |
| `logic.dropView(name)` | Odebrání odvozeného pohledu |
| `logic.queryView(name)` | Dotaz na aktuální data pohledu |
| `logic.explainView(name)` | Získání exekučního plánu pohledu |
| `logic.listViews()` | Výpis všech definovaných pohledů |
| `logic.defineConstraint(constraint)` | Definice validačního omezení |
| `logic.dropConstraint(name)` | Odebrání omezení |
| `logic.listConstraints()` | Výpis všech omezení |
| `logic.subscribeView(name, callback)` | Přihlášení k odběru reaktivních aktualizací pohledu |
| `logic.evaluateExpr(expr, record?)` | Samostatné vyhodnocení výrazu |

## Cvičení

Připojte se k serveru s logic enginem a ověřte, že je dostupný:
1. Zavolejte `logic.listComputed()` — mělo by vrátit prázdné pole
2. Zavolejte `logic.listViews()` — mělo by vrátit prázdné pole
3. Zkuste použít `expr` helper pro sestavení jednoduchého výrazu: `expr.add(1, 2)`

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // 1. Ověření dostupnosti logic
  const computed = await client.logic.listComputed();
  console.log('Computed:', computed); // []

  // 2. Výpis pohledů
  const views = await client.logic.listViews();
  console.log('Views:', views); // []

  // 3. Sestavení výrazu (jen vytvoří JSON objekt, žádné volání serveru)
  const expression = expr.add(1, 2);
  console.log('Expression:', expression); // { $add: [1, 2] }

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- Logic engine je dostupný přes `client.logic` na `NoexClient`
- Server musí mít nakonfigurovanou instanci `Logic` — jinak všechna volání vyhodí `LOGIC_NOT_AVAILABLE`
- Importujte `expr` z `@hamicek/noex-client` pro typově bezpečnou tvorbu výrazů
- `expr.f('fieldName')` vytvoří referenci na pole (`'$fieldName'`)
- Výrazy jsou kompozitní — vnořujte je pro složité výpočty
- K dispozici je čtrnáct operací v kategoriích: vypočítané položky, pohledy, omezení, odběry a výrazy

---

Další: [Vypočítané položky](./02-vypocitane-polozky.md)
