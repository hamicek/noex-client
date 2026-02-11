# Správa odběrů

Každý odběr spotřebovává zdroje — paměť na klientu, sledovaný dotaz na serveru a kanál pro push zprávy. Tato kapitola pokrývá správné odhlášení odběru, běžné cleanup vzory a chování odběrů při reconnect a disconnect.

## Co se naučíte

- Jak funguje funkce `Unsubscribe`
- Rozdíl mezi vrácenou funkcí a `store.unsubscribe()`
- Cleanup vzory pro různé aplikační kontexty
- Jak se odběry chovají při reconnect a disconnect
- Jak se vyhnout únikům zdrojů

## Funkce unsubscribe

`store.subscribe()` vrací funkci, která zastaví odběr:

```typescript
const unsubscribe = await client.store.subscribe('all-users', (data) => {
  renderUsers(data);
});

// Později, když už aktualizace nepotřebujete:
unsubscribe();
```

Klíčové vlastnosti funkce unsubscribe:

| Vlastnost | Hodnota |
|-----------|---------|
| Návratový typ | `() => void` |
| Synchronní? | Ano — není potřeba `await` |
| Čeká na server? | Ne — fire-and-forget |
| Bezpečné volat dvakrát? | Ano — druhé volání nedělá nic |

Pod kapotou volání `unsubscribe()`:
1. Odebere odběr z interního `SubscriptionManager` klienta
2. Odešle požadavek `store.unsubscribe` na server (fire-and-forget, chyby se tiše ignorují)

Po volání `unsubscribe()` žádné další push aktualizace nedorazí do callbacku — i když server ještě nezpracoval požadavek na odhlášení.

## store.unsubscribe() — explicitní metoda

K dispozici je také explicitní metoda `store.unsubscribe()`, která pracuje se subscription ID přiděleným serverem:

```typescript
store.unsubscribe(subscriptionId: string): Promise<void>
```

Na rozdíl od vrácené funkce tato metoda **čeká** na odpověď serveru. Jde o pokročilé API — ve většině případů je vrácená funkce unsubscribe jednodušší a dostačující.

## Ověření fungování unsubscribe

Po odhlášení odběru žádné další push nedorazí:

```typescript
const received: unknown[] = [];

const unsub = await client.store.subscribe('all-users', (data) => {
  received.push(data);
});

// Počáteční data doručena
console.log(received.length); // 1

// Zastavení odběru
unsub();

// Tento insert nespustí push do našeho callbacku
await client.store.bucket('users').insert({ name: 'Ghost' });
await new Promise((r) => setTimeout(r, 200));

console.log(received.length); // Stále 1
```

## Cleanup vzory

### Vzor: Jeden odběr

Uložte funkci unsubscribe a zavolejte ji, až budete hotovi:

```typescript
let unsub: (() => void) | null = null;

async function startWatching() {
  unsub = await client.store.subscribe('all-users', (data) => {
    renderUsers(data);
  });
}

function stopWatching() {
  unsub?.();
  unsub = null;
}
```

### Vzor: Více odběrů

Sbírejte všechny funkce unsubscribe a zavolejte je dohromady:

```typescript
const unsubscribes: Array<() => void> = [];

async function setup() {
  unsubscribes.push(
    await client.store.subscribe('all-users', renderUsers),
  );
  unsubscribes.push(
    await client.store.subscribe('user-count', renderCount),
  );
  unsubscribes.push(
    await client.store.subscribe('users-by-role', { role: 'admin' }, renderAdmins),
  );
}

function teardown() {
  for (const unsub of unsubscribes) {
    unsub();
  }
  unsubscribes.length = 0;
}
```

### Vzor: Integrace s AbortController

Použijte `AbortController` pro koordinaci cleanup odběrů s další zrušitelnou prací:

```typescript
const controller = new AbortController();

async function start() {
  const unsub = await client.store.subscribe('all-users', (data) => {
    renderUsers(data);
  });

  // Uklidit při vyslání signálu abort
  controller.signal.addEventListener('abort', () => {
    unsub();
  });
}

// Zrušení všeho
controller.abort();
```

## Nezávislé odběry

Odhlášení jednoho odběru neovlivní ostatní:

```typescript
const unsubUsers = await client.store.subscribe('all-users', renderUsers);
const unsubCount = await client.store.subscribe('user-count', renderCount);

// Zastavení sledování uživatelů — odběr počtu pokračuje
unsubUsers();

// Počet stále přijímá push
await client.store.bucket('users').insert({ name: 'New' });
// renderCount se zavolá s aktualizovaným počtem
```

## Chování při disconnect

Při volání `client.disconnect()` se všechny odběry okamžitě zruší:

```typescript
await client.store.subscribe('all-users', renderUsers);
await client.store.subscribe('user-count', renderCount);

// Oba odběry jsou pryč — není potřeba odesílat požadavky na odhlášení na server
// (server uklidí při zavření WebSocket spojení)
await client.disconnect();
```

Nemusíte ručně odhlašovat odběry před odpojením. Pokud se ale budete později **znovu připojovat**, odběry se zachovají a obnoví (viz níže).

## Chování při reconnect

Když se klient automaticky znovu připojí po výpadku spojení, všechny aktivní odběry se **obnoví**:

1. Klient znovu odešle původní subscribe požadavek pro každý aktivní odběr
2. Server přidělí nová subscription ID
3. Každý callback obdrží čerstvá data (aktuální výsledek dotazu)
4. Existující funkce unsubscribe nadále fungují s novými ID

```typescript
const unsub = await client.store.subscribe('all-users', (data) => {
  // Voláno při počátečním subscribe
  // Voláno znovu po reconnect s čerstvými daty
  renderUsers(data);
});

// Později, i po reconnect, toto stále funguje:
unsub();
```

Pokud se odběr nepodaří obnovit při reconnect (např. dotaz byl ze serveru odstraněn), tiše se zahodí a zaloguje do `console.error`.

## Kompletní funkční příklad

Řízený životní cyklus odběrů se setup a teardown:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

class Dashboard {
  private unsubscribes: Array<() => void> = [];
  private client: NoexClient;

  constructor(url: string) {
    this.client = new NoexClient(url, { WebSocket });
  }

  async start() {
    await this.client.connect();

    this.unsubscribes.push(
      await this.client.store.subscribe('all-users', (data) => {
        const users = data as Array<{ name: string }>;
        console.log(`Uživatelé: ${users.length}`);
      }),
    );

    this.unsubscribes.push(
      await this.client.store.subscribe(
        'users-by-role',
        { role: 'admin' },
        (data) => {
          const admins = data as Array<{ name: string }>;
          console.log(`Administrátoři: ${admins.length}`);
        },
      ),
    );

    console.log('Dashboard spuštěn');
  }

  async stop() {
    // Odhlášení od všech dotazů
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes.length = 0;

    await this.client.disconnect();
    console.log('Dashboard zastaven');
  }
}

async function main() {
  const dashboard = new Dashboard('ws://localhost:8080');
  await dashboard.start();

  // Běží po nějakou dobu...
  await new Promise((r) => setTimeout(r, 5000));

  await dashboard.stop();
}

main().catch(console.error);
```

## Cvičení

Napište funkci `watchBucket`, která:
1. Přijímá klienta, název dotazu a prefix pro logování
2. Odebírá dotaz a při každém zavolání callbacku loguje `${prefix}: ${data}`
3. Vrací objekt `{ unsub: () => void, count: () => number }`, kde `count()` vrací kolikrát byl callback zavolán

<details>
<summary>Řešení</summary>

```typescript
async function watchBucket(
  client: NoexClient,
  query: string,
  prefix: string,
): Promise<{ unsub: () => void; count: () => number }> {
  let callCount = 0;

  const unsub = await client.store.subscribe(query, (data) => {
    callCount++;
    console.log(`${prefix}:`, data);
  });

  return {
    unsub,
    count: () => callCount,
  };
}

// Použití:
const users = await watchBucket(client, 'all-users', 'Uživatelé');
const count = await watchBucket(client, 'user-count', 'Počet');

await client.store.bucket('users').insert({ name: 'Alice' });
await new Promise((r) => setTimeout(r, 500));

console.log('Zavolání callbacku uživatelů:', users.count()); // 2 (počáteční + push)
console.log('Zavolání callbacku počtu:', count.count()); // 2 (počáteční + push)

users.unsub();
count.unsub();
```

</details>

## Shrnutí

- `subscribe()` vrací `() => void` — synchronní, fire-and-forget funkci pro odhlášení
- Vrácenou funkci je bezpečné volat vícekrát
- `store.unsubscribe(id)` je pokročilá alternativa, která čeká na potvrzení ze serveru
- Odhlášení jednoho odběru neovlivní ostatní
- Sbírejte funkce unsubscribe do pole pro hromadný cleanup
- `client.disconnect()` automaticky zruší všechny odběry
- Při reconnect se aktivní odběry obnoví se stejným dotazem a parametry
- Vždy odhlašujte odběry, když je již nepotřebujete, abyste předešli únikům zdrojů

---

Další: [Atomické operace](../05-transakce/01-atomicke-operace.md)
