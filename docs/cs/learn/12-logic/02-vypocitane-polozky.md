# Vypočítané položky

Definice položek, které se automaticky počítají z jiných položek při každém vložení nebo aktualizaci záznamu. Klientské SDK poskytuje `defineComputed()`, `dropComputed()` a `listComputed()` na namespace `logic`.

## Co se naučíte

- Jak definovat vypočítané položky s `logic.defineComputed()`
- Struktura `ComputedFieldDefinition` — `depends` a `expr`
- Automatický přepočet při `store.insert` a `store.update`
- Jak odebrat a vypsat konfigurace vypočítaných položek
- Použití `expr` helperu pro tvorbu výrazů

## logic.defineComputed()

Definice vypočítaných položek pro bucket. Každá položka specifikuje, na kterých zdrojových polích závisí a výraz pro výpočet hodnoty:

```typescript
import { expr } from '@hamicek/noex-client';

await client.logic.defineComputed('items', {
  total: {
    depends: ['qty', 'price'],
    expr: expr.multiply(expr.f('qty'), expr.f('price')),
  },
});
```

**Signatura:**

```typescript
defineComputed(
  bucket: string,
  fields: Record<string, ComputedFieldDefinition>,
): Promise<void>
```

| Parametr | Typ | Povinný | Popis |
|----------|-----|---------|-------|
| bucket | `string` | ano | Cílový název bucketu |
| fields | `Record<string, ComputedFieldDefinition>` | ano | Mapa názvu položky na definici |

**ComputedFieldDefinition:**

```typescript
interface ComputedFieldDefinition {
  readonly depends: readonly string[];
  readonly expr: Expression;
}
```

| Pole | Popis |
|------|-------|
| `depends` | Pole názvů zdrojových polí, ze kterých výpočet čte |
| `expr` | Výraz s referencemi `$fieldName` pro výpočet hodnoty |

## Automatický přepočet

Po definici jsou vypočítané položky automaticky spočítány při vkládání nebo aktualizaci záznamů přes store:

```typescript
import { expr } from '@hamicek/noex-client';

// Definice: total = qty * price
await client.logic.defineComputed('items', {
  total: {
    depends: ['qty', 'price'],
    expr: expr.multiply(expr.f('qty'), expr.f('price')),
  },
});

// Vložení záznamu
const items = client.store.bucket('items');
await items.insert({ id: 'i1', qty: 3, price: 10 });

// Vypočítaná položka je dostupná
const record = await items.get('i1');
console.log(record.total); // 30
```

Aktualizace závislé položky spustí přepočet:

```typescript
await items.update('i1', { qty: 5 });
const updated = await items.get('i1');
console.log(updated.total); // 50
```

## logic.dropComputed()

Odebrání všech vypočítaných položek z bucketu. Vrátí `true` pokud definice existovaly a byly odebrány, `false` jinak:

```typescript
const dropped = await client.logic.dropComputed('items');
console.log(dropped); // true

const again = await client.logic.dropComputed('items');
console.log(again); // false (už odebráno)
```

**Signatura:**

```typescript
dropComputed(bucket: string): Promise<boolean>
```

Po odebrání nové vkládání a aktualizace již nevypočítávají položky.

## logic.listComputed()

Výpis všech konfigurací vypočítaných položek:

```typescript
const configs = await client.logic.listComputed();
for (const config of configs) {
  console.log(`Bucket: ${config.bucket}`);
  console.log(`Položky: ${Object.keys(config.fields).join(', ')}`);
}
```

**Signatura:**

```typescript
listComputed(): Promise<ComputedFieldsConfig[]>
```

Vrátí prázdné pole, pokud nejsou definovány žádné vypočítané položky.

**ComputedFieldsConfig:**

```typescript
interface ComputedFieldsConfig {
  readonly bucket: string;
  readonly fields: Record<string, ComputedFieldDefinition>;
}
```

## Zpracování chyb

```typescript
import { NoexClientError } from '@hamicek/noex-client';

try {
  await client.logic.defineComputed('items', {
    total: {
      depends: ['qty', 'price'],
      expr: expr.multiply(expr.f('qty'), expr.f('price')),
    },
  });
} catch (err) {
  if (err instanceof NoexClientError) {
    // VALIDATION_ERROR — chybějící bucket nebo fields
    // LOGIC_NOT_AVAILABLE — server nemá logic engine
    console.log(err.code, err.message);
  }
}
```

## Kompletní příklad

Systém správy objednávkových řádků s vypočítanými součty:

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const items = client.store.bucket('items');

  // Definice vypočítané položky: total = qty * price
  await client.logic.defineComputed('items', {
    total: {
      depends: ['qty', 'price'],
      expr: expr.multiply(expr.f('qty'), expr.f('price')),
    },
  });

  // Vložení položek — vypočítaná položka se automaticky spočítá
  await items.insert({ id: 'widget', qty: 3, price: 10 });
  await items.insert({ id: 'gadget', qty: 1, price: 25 });

  // Ověření vypočítaných hodnot
  const widget = await items.get('widget');
  console.log(`Widget total: ${widget.total}`); // 30

  const gadget = await items.get('gadget');
  console.log(`Gadget total: ${gadget.total}`); // 25

  // Aktualizace spustí přepočet
  await items.update('widget', { qty: 5 });
  const updated = await items.get('widget');
  console.log(`Widget total po aktualizaci: ${updated.total}`); // 50

  // Výpis konfigurací
  const configs = await client.logic.listComputed();
  console.log(`Konfigurace: ${configs.length}`); // 1
  console.log(`Bucket: ${configs[0].bucket}`); // 'items'

  // Úklid
  await client.logic.dropComputed('items');

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Definuje vypočítanou položku `discountedPrice` na bucketu, počítanou jako `price * (1 - discountRate)` — použijte `expr.multiply(expr.f('price'), expr.subtract(1, expr.f('discountRate')))`
2. Vloží produkt s `price: 100` a `discountRate: 0.2`
3. Přečte produkt zpět a ověří, že `discountedPrice` je `80`
4. Vypíše konfigurace computed pro potvrzení existence definice
5. Odebere vypočítané položky

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient, expr } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const products = client.store.bucket('products');

  // 1. Definice vypočítané položky
  await client.logic.defineComputed('products', {
    discountedPrice: {
      depends: ['price', 'discountRate'],
      expr: expr.multiply(
        expr.f('price'),
        expr.subtract(1, expr.f('discountRate')),
      ),
    },
  });

  // 2. Vložení produktu
  await products.insert({ id: 'p1', price: 100, discountRate: 0.2 });

  // 3. Ověření
  const product = await products.get('p1');
  console.log(`Zlevněná cena: ${product.discountedPrice}`); // 80

  // 4. Výpis konfigurací
  const configs = await client.logic.listComputed();
  console.log(`Konfigurace: ${configs.length}`); // 1

  // 5. Odebrání
  const dropped = await client.logic.dropComputed('products');
  console.log(`Odebráno: ${dropped}`); // true

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `logic.defineComputed(bucket, fields)` definuje vypočítané položky — každá má `depends` (zdrojová pole) a `expr` (výraz)
- Vypočítané položky se automaticky přepočítávají při `store.insert` a `store.update`
- Použijte `expr` helper pro typově bezpečné výrazy: `expr.multiply(expr.f('qty'), expr.f('price'))`
- `logic.dropComputed(bucket)` odebere definice — vrátí `true` pokud odebráno, `false` pokud nic neexistovalo
- `logic.listComputed()` vrátí všechny konfigurace jako `ComputedFieldsConfig[]`
- `LOGIC_NOT_AVAILABLE` se vyhodí, když server nemá nakonfigurovaný logic engine

---

Další: [Pohledy a omezení](./03-pohledy-a-omezeni.md)
