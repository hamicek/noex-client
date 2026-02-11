# Vzory transakcí

Předchozí kapitola pokryla mechaniku `store.transaction()`. Tato kapitola ukazuje praktické vzory pro aplikaci transakcí na reálné scénáře — cross-bucket operace, sekvence read-modify-write a robustní zpracování chyb.

## Co se naučíte

- Cross-bucket transakce pro data rozprostřená přes více kolekcí
- Vzor read-modify-write pro bezpečné souběžné aktualizace
- Hromadná inicializace se zárukami transakcí
- Strategie zpracování chyb při selhání transakcí
- Kdy použít transakce vs jednotlivé operace

## Cross-bucket operace

Transakce mohou přesahovat více bucketů. To je zásadní, když logická operace zahrnuje data v různých kolekcích:

### Vytvoření uživatele s audit logem

```typescript
import type { TransactionOp } from '@hamicek/noex-client';

async function createUserWithLog(
  client: NoexClient,
  name: string,
  role: string,
) {
  const result = await client.store.transaction([
    { op: 'insert', bucket: 'users', data: { name, role } },
    { op: 'insert', bucket: 'audit', data: { action: 'user_created', name, timestamp: Date.now() } },
  ]);

  const user = result.results[0].data as Record<string, unknown>;
  return user;
}
```

Oba záznamy se vytvoří atomicky — pokud selže insert audit logu, uživatel se nevytvoří.

### Vytvoření objednávky

```typescript
async function placeOrder(
  client: NoexClient,
  userId: string,
  items: Array<{ productId: string; quantity: number }>,
  total: number,
) {
  const ops: TransactionOp[] = [
    {
      op: 'insert',
      bucket: 'orders',
      data: { userId, items, total, status: 'pending' },
    },
    {
      op: 'insert',
      bucket: 'logs',
      data: { action: 'order_placed', userId, total },
    },
  ];

  const result = await client.store.transaction(ops);
  return result.results[0].data;
}
```

## Read-modify-write

Když potřebujete přečíst aktuální stav, vypočítat novou hodnotu a zapsat ji zpět, transakce zaručí, že žádný jiný klient nemodifikuje data mezi vaším čtením a zápisem:

### Převod kreditů

```typescript
async function transferCredits(
  client: NoexClient,
  fromId: string,
  toId: string,
  amount: number,
) {
  // Krok 1: Čtení aktuálních zůstatků
  const readResult = await client.store.transaction([
    { op: 'get', bucket: 'users', key: fromId },
    { op: 'get', bucket: 'users', key: toId },
  ]);

  const sender = readResult.results[0].data as Record<string, unknown> | null;
  const receiver = readResult.results[1].data as Record<string, unknown> | null;

  if (!sender || !receiver) {
    throw new Error('Uživatel nenalezen');
  }

  const senderBalance = sender['credits'] as number;
  if (senderBalance < amount) {
    throw new Error('Nedostatek kreditů');
  }

  // Krok 2: Atomická aplikace převodu
  const writeResult = await client.store.transaction([
    { op: 'update', bucket: 'users', key: fromId, data: { credits: senderBalance - amount } },
    { op: 'update', bucket: 'users', key: toId, data: { credits: (receiver['credits'] as number) + amount } },
    { op: 'insert', bucket: 'transfers', data: { from: fromId, to: toId, amount, timestamp: Date.now() } },
  ]);

  return {
    sender: writeResult.results[0].data,
    receiver: writeResult.results[1].data,
    transfer: writeResult.results[2].data,
  };
}
```

### Snížení stavu skladu

```typescript
async function decrementStock(
  client: NoexClient,
  productId: string,
  quantity: number,
) {
  // Čtení aktuálního stavu skladu
  const readResult = await client.store.transaction([
    { op: 'get', bucket: 'products', key: productId },
  ]);

  const product = readResult.results[0].data as Record<string, unknown> | null;
  if (!product) throw new Error('Produkt nenalezen');

  const currentStock = product['stock'] as number;
  if (currentStock < quantity) throw new Error('Nedostatek na skladě');

  // Atomické snížení
  return client.store.transaction([
    { op: 'update', bucket: 'products', key: productId, data: { stock: currentStock - quantity } },
  ]);
}
```

## Hromadná inicializace

Transakce jsou užitečné pro nastavení počátečních dat, která musí být konzistentní:

```typescript
async function seedDatabase(client: NoexClient) {
  const ops: TransactionOp[] = [
    { op: 'insert', bucket: 'config', data: { key: 'version', value: '1.0.0' } },
    { op: 'insert', bucket: 'config', data: { key: 'maxUsers', value: 100 } },
    { op: 'insert', bucket: 'users', data: { name: 'Admin', role: 'admin' } },
    { op: 'insert', bucket: 'logs', data: { action: 'database_seeded', timestamp: Date.now() } },
  ];

  return client.store.transaction(ops);
}
```

Všechny čtyři záznamy se vytvoří společně, nebo vůbec.

## Dotazy uvnitř transakcí

Použijte operace `where`, `findOne` a `count` společně se zápisy pro atomické čtení kontextových dat:

```typescript
async function archiveCompletedTasks(client: NoexClient) {
  // Nalezení dokončených úkolů
  const result = await client.store.transaction([
    { op: 'where', bucket: 'tasks', filter: { status: 'completed' } },
    { op: 'count', bucket: 'tasks', filter: { status: 'completed' } },
  ]);

  const completed = result.results[0].data as Array<Record<string, unknown>>;
  const count = result.results[1].data as number;

  console.log(`Nalezeno ${count} dokončených úkolů k archivaci`);

  if (completed.length === 0) return;

  // Archivace každého dokončeného úkolu
  const archiveOps: TransactionOp[] = completed.flatMap((task) => [
    { op: 'insert', bucket: 'archive', data: { ...task, archivedAt: Date.now() } } as TransactionOp,
    { op: 'delete', bucket: 'tasks', key: task['id'] } as TransactionOp,
  ]);

  await client.store.transaction(archiveOps);
  console.log(`Archivováno ${count} úkolů`);
}
```

## Strategie zpracování chyb

### Zachycení a inspekce

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

async function safeTransaction(client: NoexClient, ops: TransactionOp[]) {
  try {
    return await client.store.transaction(ops);
  } catch (err) {
    if (err instanceof DisconnectedError) {
      console.error('Transakci nelze vykonat — nepřipojeno');
      throw err;
    }
    if (err instanceof TimeoutError) {
      console.error('Transakce vypršela — stav je neznámý');
      throw err;
    }
    if (err instanceof NoexClientError) {
      console.error(`Transakce selhala: [${err.code}] ${err.message}`);
      throw err;
    }
    throw err;
  }
}
```

### Opakování při timeout

```typescript
async function transactionWithRetry(
  client: NoexClient,
  ops: TransactionOp[],
  maxRetries = 3,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.store.transaction(ops);
    } catch (err) {
      if (err instanceof TimeoutError && attempt < maxRetries) {
        console.warn(`Pokus o transakci ${attempt} vypršel, opakuji...`);
        continue;
      }
      throw err;
    }
  }
}
```

## Kdy použít transakce

| Scénář | Použít transakci? | Proč |
|--------|-------------------|------|
| Vložení jednoho záznamu | Ne | Jedna operace, už je atomická |
| Vložení záznamu + audit log | Ano | Dva buckety musí zůstat konzistentní |
| Aktualizace jednoho pole jednoho záznamu | Ne | Jedna operace, už je atomická |
| Převod hodnoty mezi záznamy | Ano | Obě aktualizace musí uspět společně |
| Čtení více záznamů pro zobrazení | Možná | Transakce dá konzistentní snapshot |
| Naplnění více počátečních záznamů | Ano | Inicializace vše-nebo-nic |

## Kompletní funkční příklad

Mini e-commerce průběh: kontrola skladu, vytvoření objednávky, snížení skladu, zalogování:

```typescript
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import type { TransactionOp } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Naplnění produktů
  const products = client.store.bucket('products');
  const laptop = await products.insert({ name: 'Laptop', price: 999, stock: 5 });

  // Kontrola skladu
  const checkResult = await client.store.transaction([
    { op: 'get', bucket: 'products', key: laptop.id },
  ]);

  const current = checkResult.results[0].data as Record<string, unknown>;
  const stock = current['stock'] as number;

  if (stock < 1) {
    console.log('Vyprodáno!');
    await client.disconnect();
    return;
  }

  // Atomické vytvoření objednávky
  try {
    const orderResult = await client.store.transaction([
      { op: 'update', bucket: 'products', key: laptop.id, data: { stock: stock - 1 } },
      { op: 'insert', bucket: 'orders', data: { productId: laptop.id, quantity: 1, total: 999 } },
      { op: 'insert', bucket: 'logs', data: { action: 'order_placed', productId: laptop.id } },
      { op: 'get', bucket: 'products', key: laptop.id },
    ]);

    const order = orderResult.results[1].data as Record<string, unknown>;
    const updatedProduct = orderResult.results[3].data as Record<string, unknown>;

    console.log('Objednávka vytvořena:', order['id']);
    console.log('Zbývající sklad:', updatedProduct['stock']); // 4
  } catch (err) {
    if (err instanceof NoexClientError) {
      console.error(`Objednávka selhala: ${err.message}`);
    }
  }

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Sestavte funkci `swapRoles`, která atomicky prohodí pole `role` mezi dvěma uživateli:
1. Přečtěte oba uživatele v transakci
2. Ověřte, že oba existují
3. Prohoďte jejich role v druhé transakci
4. Vraťte aktualizované záznamy

<details>
<summary>Řešení</summary>

```typescript
async function swapRoles(client: NoexClient, userAId: string, userBId: string) {
  // Atomické čtení obou uživatelů
  const readResult = await client.store.transaction([
    { op: 'get', bucket: 'users', key: userAId },
    { op: 'get', bucket: 'users', key: userBId },
  ]);

  const userA = readResult.results[0].data as Record<string, unknown> | null;
  const userB = readResult.results[1].data as Record<string, unknown> | null;

  if (!userA || !userB) {
    throw new Error('Jeden nebo oba uživatelé nebyli nalezeni');
  }

  const roleA = userA['role'];
  const roleB = userB['role'];

  // Atomické prohození
  const swapResult = await client.store.transaction([
    { op: 'update', bucket: 'users', key: userAId, data: { role: roleB } },
    { op: 'update', bucket: 'users', key: userBId, data: { role: roleA } },
    { op: 'insert', bucket: 'logs', data: {
      action: 'role_swap',
      users: [userAId, userBId],
      timestamp: Date.now(),
    }},
  ]);

  return {
    userA: swapResult.results[0].data,
    userB: swapResult.results[1].data,
  };
}

// Použití:
const { userA, userB } = await swapRoles(client, 'user-1', 'user-2');
console.log('Role uživatele A:', (userA as Record<string, unknown>)['role']);
console.log('Role uživatele B:', (userB as Record<string, unknown>)['role']);
```

</details>

## Shrnutí

- **Cross-bucket**: transakce přesahují více bucketů pro logicky propojené zápisy
- **Read-modify-write**: čtení stavu, validace, zápis zpět — vše atomicky
- **Hromadná inicializace**: naplnění více kolekcí v jedné atomické operaci
- **Dotazovací operace** (`where`, `findOne`, `count`) fungují uvnitř transakcí společně se zápisy
- Zpracovávejte `NoexClientError`, `TimeoutError` a `DisconnectedError` pro robustní obnovu po chybách
- Použijte transakce, když více operací musí uspět nebo selhat společně
- Pracovní postupy s jednou operací transakce nepotřebují — jsou už atomické

---

Další: [Eventy](../06-rules/01-eventy.md)
