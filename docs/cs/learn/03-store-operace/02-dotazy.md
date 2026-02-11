# Dotazy

Kromě CRUD operací nad jednotlivými záznamy nabízí bucket API dotazovací metody pro načítání více záznamů najednou. Tato kapitola pokrývá čtyři dotazovací operace: `all()`, `where()`, `findOne()` a `count()`.

## Co se naučíte

- Jak načíst všechny záznamy z bucketu pomocí `all()`
- Jak filtrovat záznamy pomocí `where()` s porovnáním na rovnost
- Jak najít jeden záznam pomocí `findOne()`
- Jak počítat záznamy pomocí `count()` s volitelným filtrem

## all()

Vrátí všechny záznamy v bucketu:

```typescript
const users = client.store.bucket('users');

const allUsers = await users.all();
console.log(`Total users: ${allUsers.length}`);

for (const user of allUsers) {
  console.log(user.id, user.name);
}
```

**Signatura:**

```typescript
all(): Promise<(Record<string, unknown> & RecordMeta)[]>
```

Vrací pole, které může být prázdné, pokud bucket neobsahuje žádné záznamy. Každý prvek obsahuje data záznamu plus `RecordMeta`.

### Kdy použít `all()`

`all()` je přímočará metoda, ale vrací vše. Pro buckety s mnoha záznamy zvažte `where()` s filtrem, `paginate()` pro postupný přístup nebo `first()`/`last()` pro omezené výsledky.

## where()

Filtruje záznamy na základě rovnosti jednoho nebo více polí:

```typescript
const users = client.store.bucket('users');

// Filtr podle jednoho pole
const admins = await users.where({ role: 'admin' });
console.log(`Admins: ${admins.length}`);

// Filtr podle více polí (AND — všechna pole musí odpovídat)
const activeAdmins = await users.where({ role: 'admin', active: true });
console.log(`Active admins: ${activeAdmins.length}`);
```

**Signatura:**

```typescript
where(filter: Record<string, unknown>): Promise<(Record<string, unknown> & RecordMeta)[]>
```

### Chování filtru

- Každý pár klíč-hodnota ve filtru musí přesně odpovídat
- Více polí funguje jako AND — záznam musí odpovídat všem
- Vrací prázdné pole, pokud žádný záznam neodpovídá
- Filtr kontroluje striktní rovnost hodnot polí

```typescript
// Obojí vrátí záznamy, kde role je 'admin' A department je 'engineering'
const results = await users.where({ role: 'admin', department: 'engineering' });
```

## findOne()

Vrátí první záznam odpovídající filtru, nebo `null` pokud nic neodpovídá:

```typescript
const users = client.store.bucket('users');

const admin = await users.findOne({ role: 'admin' });

if (admin) {
  console.log('Found admin:', admin.name);
} else {
  console.log('No admin found');
}
```

**Signatura:**

```typescript
findOne(filter: Record<string, unknown>): Promise<(Record<string, unknown> & RecordMeta) | null>
```

`findOne()` je efektivnější než `where()`, když potřebujete pouze jeden výsledek — server může přestat hledat po prvním nalezeném záznamu.

## count()

Vrátí počet záznamů, volitelně filtrovaný:

```typescript
const users = client.store.bucket('users');

// Počet všech záznamů
const total = await users.count();
console.log(`Total users: ${total}`);

// Počet s filtrem
const adminCount = await users.count({ role: 'admin' });
console.log(`Admins: ${adminCount}`);
```

**Signatura:**

```typescript
count(filter?: Record<string, unknown>): Promise<number>
```

`count()` je efektivnější než `all().length` nebo `where(filter).length`, protože po síti se přenáší pouze číslo, nikoli celé záznamy.

## Kombinování dotazů

Dotazy jsou nezávislé požadavky. Můžete je spouštět paralelně pomocí `Promise.all`:

```typescript
const users = client.store.bucket('users');

const [total, adminCount, firstAdmin] = await Promise.all([
  users.count(),
  users.count({ role: 'admin' }),
  users.findOne({ role: 'admin' }),
]);

console.log(`${adminCount} of ${total} users are admins`);
if (firstAdmin) {
  console.log('First admin:', firstAdmin.name);
}
```

## Kompletní funkční příklad

Skript, který naplní bucket a demonstruje všechny čtyři dotazovací metody:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const users = client.store.bucket('users');

  // Naplnění testovacími daty
  await users.insert({ name: 'Alice', role: 'admin', department: 'engineering' });
  await users.insert({ name: 'Bob', role: 'editor', department: 'marketing' });
  await users.insert({ name: 'Carol', role: 'admin', department: 'marketing' });
  await users.insert({ name: 'Dave', role: 'viewer', department: 'engineering' });

  // all() — všechny záznamy
  const everyone = await users.all();
  console.log('All users:', everyone.map((u) => u.name));
  // ['Alice', 'Bob', 'Carol', 'Dave']

  // where() — filtrování podle pole
  const admins = await users.where({ role: 'admin' });
  console.log('Admins:', admins.map((u) => u.name));
  // ['Alice', 'Carol']

  // where() — více polí
  const marketingAdmins = await users.where({ role: 'admin', department: 'marketing' });
  console.log('Marketing admins:', marketingAdmins.map((u) => u.name));
  // ['Carol']

  // findOne() — jeden výsledek
  const editor = await users.findOne({ role: 'editor' });
  console.log('Editor:', editor?.name);
  // 'Bob'

  // count() — celkový a filtrovaný počet
  const total = await users.count();
  const engineeringCount = await users.count({ department: 'engineering' });
  console.log(`${engineeringCount} of ${total} users in engineering`);
  // 2 of 4

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Máte bucket `products` se záznamy typu `{ name, category, price, inStock }`. Napište funkci, která:
1. Spočítá celkový počet produktů a počet produktů skladem
2. Najde všechny produkty v kategorii `'electronics'`
3. Najde jeden produkt, který není skladem (pokud existuje)
4. Vrátí souhrnný objekt se všemi výsledky

<details>
<summary>Řešení</summary>

```typescript
async function productSummary(client: NoexClient) {
  const products = client.store.bucket('products');

  const [total, inStockCount, electronics, outOfStock] = await Promise.all([
    products.count(),
    products.count({ inStock: true }),
    products.where({ category: 'electronics' }),
    products.findOne({ inStock: false }),
  ]);

  return {
    total,
    inStock: inStockCount,
    outOfStock: total - inStockCount,
    electronics: electronics.map((p) => ({ name: p.name, price: p.price })),
    firstOutOfStock: outOfStock ? outOfStock.name : null,
  };
}
```

Použití `Promise.all` spustí všechny čtyři dotazy souběžně, čímž se celková latence sníží na dobu jednoho round-tripu místo čtyř sekvenčních požadavků.

</details>

## Shrnutí

- `all()` vrací všechny záznamy v bucketu — u velkých datasetů používejte s rozmyslem
- `where(filter)` vrací záznamy odpovídající všem polím filtru (logika AND, porovnání na rovnost)
- `findOne(filter)` vrací první odpovídající záznam nebo `null` — efektivnější než `where()`, když potřebujete jeden výsledek
- `count(filter?)` vrací počet odpovídajících záznamů bez přenosu samotných záznamů
- Všechny dotazovací metody jsou nezávislé — použijte `Promise.all` pro jejich paralelní spuštění

---

Další: [Agregace a stránkování](./03-agregace-a-strankovani.md)
