# Pohledy a omezení

Tvorba odvozených pohledů, které kombinují data z více bucketů s joiny, filtry a agregací. Definice omezení, která automaticky vynucují business pravidla při store zápisech.

## Co se naučíte

- Jak definovat odvozené pohledy s `logic.defineView()`
- Struktura `DerivedViewDefinition` — `from`, `join`, `where`, `select` a další
- Jak dotazovat, inspektovat, vypsat a odebrat pohledy
- Jak definovat omezení s `logic.defineConstraint()`
- Jak se porušení omezení projevuje jako chyba při store operacích
- Jak spravovat omezení s `dropConstraint()` a `listConstraints()`

## Odvozené pohledy

### logic.defineView()

Definice odvozeného pohledu. Pohledy mohou odkazovat na jeden nebo více bucketů, propojit je, filtrovat, seskupovat, agregovat a řadit:

```typescript
await client.logic.defineView({
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

**Signatura:**

```typescript
defineView(definition: DerivedViewDefinition): Promise<void>
```

**DerivedViewDefinition:**

| Pole | Typ | Povinné | Popis |
|------|-----|---------|-------|
| `name` | `string` | ano | Unikátní název pohledu |
| `from` | `Record<string, string>` | ano | Mapování alias-na-bucket (alespoň jeden záznam) |
| `select` | `Record<string, string \| Expression>` | ano | Mapování výstupních polí |
| `join` | `Record<string, string>` | ne | Podmínky joinu (např. `{ 'o.customerId': 'c.id' }`) |
| `where` | `Record<string, unknown>` | ne | Filtrační výraz |
| `groupBy` | `string \| readonly string[]` | ne | Seskupovací pole |
| `orderBy` | `readonly OrderBySpec[]` | ne | Specifikace řazení |
| `limit` | `number` | ne | Max počet řádků |
| `reactive` | `boolean` | ne | Povolení reaktivních aktualizací pro odběry (výchozí: `false`) |

### logic.queryView()

Dotaz na aktuální data pohledu:

```typescript
const rows = await client.logic.queryView('invoice_details');
for (const row of rows) {
  console.log(`${row.customerName}: ${row.total}`);
}
```

Vrátí prázdné pole, pokud žádné záznamy neodpovídají.

### logic.explainView()

Získání exekučního plánu pohledu — užitečné pro ladění:

```typescript
const explanation = await client.logic.explainView('invoice_details');
console.log('Zdroje:', explanation.sources);
console.log('Joiny:', explanation.joins);
console.log('Závislosti:', explanation.dependencies);
```

### logic.listViews()

Výpis všech definovaných pohledů se souhrnnými informacemi:

```typescript
const views = await client.logic.listViews();
for (const view of views) {
  console.log(`${view.name}: ${view.resultCount} řádků (reactive: ${view.reactive})`);
}
```

### logic.dropView()

Odebrání definice pohledu. Vrátí `true` pokud pohled existoval a byl odebrán:

```typescript
const dropped = await client.logic.dropView('invoice_details');
console.log(dropped); // true

const again = await client.logic.dropView('invoice_details');
console.log(again); // false (už odebráno)
```

## Omezení

### logic.defineConstraint()

Definice integritního omezení na bucketu. Omezení se automaticky vynucují při `store.insert` a `store.update` — záznamy porušující omezení jsou odmítnuty s `VALIDATION_ERROR`:

```typescript
import { expr } from '@hamicek/noex-client';

await client.logic.defineConstraint({
  name: 'positive_balance',
  on: 'accounts',
  expr: expr.gte(expr.f('balance'), 0),
  message: 'Zůstatek musí být nezáporný',
});
```

**Signatura:**

```typescript
defineConstraint(constraint: ConstraintDefinition): Promise<void>
```

**ConstraintDefinition:**

| Pole | Typ | Povinné | Popis |
|------|-----|---------|-------|
| `name` | `string` | ano | Unikátní název omezení |
| `on` | `string` | ano | Cílový bucket |
| `expr` | `Expression` | ano | Validační výraz — musí se vyhodnotit na `true` pro platné záznamy |
| `message` | `string` | ano | Chybová zpráva při porušení |
| `scope` | `'record' \| 'group'` | ne | Rozsah vyhodnocení |
| `groupBy` | `string` | ne | Seskupovací pole (pro `scope: 'group'`) |
| `operations` | `readonly ('insert' \| 'update' \| 'delete')[]` | ne | Které operace kontrolovat (výchozí: insert a update) |

### Vynucení omezení

Po definici se omezení kontroluje při každém vložení a aktualizaci na cílovém bucketu:

```typescript
const accounts = client.store.bucket('accounts');

// Tento insert splňuje omezení
await accounts.insert({ id: 'a1', balance: 100 }); // OK

// Tento insert porušuje omezení
try {
  await accounts.insert({ id: 'a2', balance: -50 });
} catch (err) {
  console.log(err.code);    // 'VALIDATION_ERROR'
  console.log(err.message); // 'Zůstatek musí být nezáporný'
}
```

### logic.dropConstraint()

Odebrání omezení. Po odebrání se validace již nevynucuje:

```typescript
const dropped = await client.logic.dropConstraint('positive_balance');
console.log(dropped); // true

// Po odebrání je záporný zůstatek povolen
await accounts.insert({ id: 'a3', balance: -50 }); // OK
```

### logic.listConstraints()

Výpis všech definovaných omezení:

```typescript
const constraints = await client.logic.listConstraints();
for (const c of constraints) {
  console.log(`${c.name} na ${c.on}: ${c.message}`);
}
```

## Chybové kódy

| Chybový kód | Příčina |
|-------------|---------|
| `VALIDATION_ERROR` | Chybějící/neplatné parametry, neexistující pohled nebo porušení omezení |
| `ALREADY_EXISTS` | Pohled nebo omezení se stejným názvem již existuje |
| `LOGIC_NOT_AVAILABLE` | Logic engine není na serveru nakonfigurován |

## Kompletní příklad

Systém správy objednávek s pohledy a omezeními:

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const customers = client.store.bucket('customers');
  const invoices = client.store.bucket('invoices');

  // Vložení dat
  await customers.insert({ id: 'c1', name: 'Alice' });
  await invoices.insert({ id: 'inv1', customerId: 'c1', total: 200, status: 'paid' });
  await invoices.insert({ id: 'inv2', customerId: 'c1', total: 50, status: 'pending' });

  // Definice join pohledu
  await client.logic.defineView({
    name: 'customer_invoices',
    from: { i: 'invoices', c: 'customers' },
    join: { 'i.customerId': 'c.id' },
    select: {
      customerName: 'c.name',
      invoiceId: 'i.id',
      total: 'i.total',
      status: 'i.status',
    },
  });

  // Dotaz na pohled
  const rows = await client.logic.queryView('customer_invoices');
  console.log('Faktury:');
  for (const row of rows) {
    console.log(`  ${row.customerName} — ${row.invoiceId}: ${row.total} Kč (${row.status})`);
  }

  // Definice omezení: celková částka faktury musí být kladná
  await client.logic.defineConstraint({
    name: 'positive_total',
    on: 'invoices',
    expr: expr.gt(expr.f('total'), 0),
    message: 'Celková částka faktury musí být kladná',
  });

  // Toto selže
  try {
    await invoices.insert({ id: 'inv3', customerId: 'c1', total: 0, status: 'draft' });
  } catch (err) {
    console.log(`Odmítnuto: ${err.message}`);
  }

  // Úklid
  await client.logic.dropConstraint('positive_total');
  await client.logic.dropView('customer_invoices');

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Vloží zákazníky a objednávky do příslušných bucketů
2. Definuje join pohled `customer_orders` zobrazující jméno zákazníka a částku objednávky
3. Dotáže se na pohled a vypíše všechny řádky
4. Definuje omezení `min_order` vyžadující `amount >= 1`
5. Ověří, že vložení objednávky s `amount: 0` vyhodí `VALIDATION_ERROR`
6. Odebere omezení a ověří, že stejné vložení nyní uspěje

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient, expr, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const customers = client.store.bucket('customers');
  const orders = client.store.bucket('orders');

  // 1. Vložení dat
  await customers.insert({ id: 'c1', name: 'Alice' });
  await orders.insert({ id: 'o1', customerId: 'c1', amount: 150 });

  // 2. Definice join pohledu
  await client.logic.defineView({
    name: 'customer_orders',
    from: { o: 'orders', c: 'customers' },
    join: { 'o.customerId': 'c.id' },
    select: {
      customerName: 'c.name',
      amount: 'o.amount',
    },
  });

  // 3. Dotaz a výpis
  const rows = await client.logic.queryView('customer_orders');
  for (const row of rows) {
    console.log(`${row.customerName}: ${row.amount}`);
  }

  // 4. Definice omezení
  await client.logic.defineConstraint({
    name: 'min_order',
    on: 'orders',
    expr: expr.gte(expr.f('amount'), 1),
    message: 'Částka objednávky musí být alespoň 1',
  });

  // 5. Ověření porušení
  try {
    await orders.insert({ id: 'o2', customerId: 'c1', amount: 0 });
  } catch (err) {
    if (err instanceof NoexClientError) {
      console.log(`Odmítnuto: ${err.code}`); // VALIDATION_ERROR
    }
  }

  // 6. Odebrání omezení, pak insert uspěje
  await client.logic.dropConstraint('min_order');
  await orders.insert({ id: 'o2', customerId: 'c1', amount: 0 });
  console.log('Insert uspěl po odebrání omezení');

  await client.logic.dropView('customer_orders');
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `logic.defineView(definition)` vytváří odvozené pohledy — podporuje joiny, filtry, seskupení, agregaci, řazení a limity
- `logic.queryView(name)` vrátí aktuální data, `logic.explainView(name)` vrátí exekuční plán
- `logic.listViews()` vypíše všechny pohledy, `logic.dropView(name)` odebere jeden — vrátí `true/false`
- `logic.defineConstraint(constraint)` vynucuje validační pravidla při store zápisech
- Porušení omezení vyhodí `NoexClientError` s kódem `VALIDATION_ERROR` a zprávou omezení
- `logic.dropConstraint(name)` odebere omezení — inserty/updaty se již nekontrolují
- `logic.listConstraints()` vrátí všechna definovaná omezení
- `ALREADY_EXISTS` se vyhodí při definici pohledu nebo omezení s názvem, který je již obsazený

---

Další: [Odběry pohledů](./04-odbery-pohledu.md)
