# Obnova odběrů

Když spojení vypadne a SDK se reconnectne, všechny aktivní odběry jsou **automaticky obnoveny**. Server přidělí nová subscription ID, SDK aktualizuje svá interní mapování a vaše callbacky pokračují v přijímání dat -- žádný manuální zásah není potřeba.

## Co se naučíte

- Jak SDK obnovuje odběry po reconnectu
- Co se stane se subscription ID, callbacky a daty
- Rozdíl mezi obnovou store a rules odběrů
- Jak se zachází se selháním resubscripce
- Osvědčené postupy pro psaní kódu odolného vůči reconnectu

## Jak to funguje

`SubscriptionManager` udržuje registr všech aktivních odběrů. Každý záznam uchovává:

- Aktuální `id` (serverem přidělené subscription ID)
- Kanál `channel` (`'subscription'` pro store, `'event'` pro rules)
- Funkci `callback`
- Payload pro `resubscribe` (typ požadavku + parametry potřebné k opětovnému vytvoření odběru)

Po úspěšném reconnectu SDK zavolá `resubscribeAll()`, která přehraje každý registrovaný odběr proti novému spojení:

```
Spojení obnoveno
   │
   ├─ Re-autentizace (pokud je nakonfigurován auth.token)
   │
   └─ Pro každý aktivní odběr:
       ├─ Odeslání původního subscribe požadavku (store.subscribe nebo rules.subscribe)
       ├─ Server vrátí nové subscriptionId
       ├─ SDK aktualizuje interní ID mapování (staré → nové)
       └─ Pokud jsou vrácena úvodní data (store odběry), doručí je do callbacku
```

## Obnova store odběrů

Store odběry při resubscripci obdrží **čerstvá data**. Váš callback se zavolá s aktuálním výsledkem dotazu, stejně jako při počátečním odběru:

```typescript
const received: unknown[] = [];

await client.store.subscribe('all-users', (data) => {
  received.push(data);
  console.log('Uživatelé:', data);
});

// received: [ [...počáteční uživatelé...] ]

// --- Spojení vypadne, SDK se reconnectne ---
// Po reconnectu se callback zavolá znovu s aktuálními daty:
// received: [ [...počáteční uživatelé...], [...aktuální uživatelé...] ]
```

To znamená, že vaše UI nebo datová vrstva po reconnectu vždy dostane konzistentní snapshot. Nemusíte ručně znovu načítat data.

## Obnova rules odběrů

Rules odběry **nemají úvodní data** -- zavolají se pouze tehdy, když jsou emitovány odpovídající eventy. Po reconnectu je odběr znovu zaregistrován se stejným vzorem a callback pokračuje v přijímání budoucích eventů:

```typescript
await client.rules.subscribe('user:*', (event, topic) => {
  console.log(`Event na ${topic}:`, event.data);
});

// --- Spojení vypadne, SDK se reconnectne ---
// Při resubscripci se callback nezavolá (rules nemají úvodní data).
// Budoucí eventy odpovídající 'user:*' budou nadále přicházet.
```

## Aktualizace subscription ID

Server přidělí **nové subscription ID** při každém subscribe požadavku. Když se reconnectnete a proběhne resubscripce, staré ID se stane neplatným a SDK ho transparentně vymění:

```
Před reconnectem:
  Subscription 'abc-123' → callback fn

Po reconnectu:
  Subscription 'abc-123' smazáno
  Subscription 'xyz-789' → stejný callback fn  (nové ID ze serveru)
```

Toto je plně transparentní. Pokud držíte referenci na funkci `unsubscribe` vrácenou z `store.subscribe()`, stále funguje -- odregistruje odběr na základě aktuálního (aktualizovaného) ID.

## Selhání resubscripce

Pokud resubscripce selže (např. server už nedefinuje daný dotaz), odběr je **tiše odebrán** z registru a chyba je zalogována do `console.error`:

```
Failed to resubscribe sub-old-id: NoexClientError: Query 'deleted-query' is not defined
```

Zbývající odběry se nadále obnovují. Jedno selhání nepřeruší obnovu ostatních odběrů.

## Kompletní sekvence reconnectu

Celkový pohled včetně automatického přihlášení:

```
1.  Ztráta spojení
2.  Čekající požadavky zamítnuty (DisconnectedError)
3.  Exponential backoff zpoždění
4.  WebSocket reconnect
5.  Uvítací zpráva ze serveru
6.  Automatické přihlášení (pokud je nakonfigurován auth.token a server vyžaduje auth)
7.  resubscribeAll():
    ├─ Store odběr 1 → nové ID + callback(čerstvá data)
    ├─ Store odběr 2 → nové ID + callback(čerstvá data)
    └─ Rules odběr 1 → nové ID (žádná úvodní data)
8.  Event 'connected'
9.  Event 'reconnected'
10. Event 'welcome'
```

Kroky 6--7 jsou klíčové: autentizace musí uspět před obnovením odběrů, protože server odmítá operace od neautentizovaných spojení.

## Kompletní funkční příklad

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    auth: { token: 'my-service-token' },
    reconnect: {
      maxRetries: Infinity,
      initialDelayMs: 1_000,
    },
  });

  client.on('reconnecting', (attempt) => {
    console.log(`Reconnect (pokus ${attempt})...`);
  });

  client.on('reconnected', () => {
    console.log('Reconnectnuto — odběry automaticky obnoveny');
  });

  await client.connect();

  // Odběr store dotazu
  await client.store.subscribe('active-sessions', (data) => {
    const sessions = data as Array<Record<string, unknown>>;
    console.log(`Aktivní relace: ${sessions.length}`);
    // Tento callback se zavolá:
    // 1. Při počátečním odběru (aktuální data)
    // 2. Při každé push aktualizaci (data se změnila na serveru)
    // 3. Po reconnectu (čerstvý snapshot z resubscripce)
  });

  // Odběr rules eventů
  await client.rules.subscribe('session:*', (event, topic) => {
    console.log(`Session event na ${topic}:`, event.data);
    // Tento callback se zavolá:
    // 1. Při každém odpovídajícím eventu
    // 2. Po reconnectu pokračuje (bez úvodního doručení)
  });

  console.log('Naslouchám aktualizacím... (Ctrl+C pro ukončení)');
}

main().catch(console.error);
```

## Psaní kódu odolného vůči reconnectu

### Callbacky by měly být idempotentní pro store odběry

Po reconnectu váš store subscription callback obdrží kompletní datový snapshot. Ujistěte se, že váš callback s tím správně zachází -- nahraďte data, nepřidávejte k nim:

```typescript
// Správně — nahrazení stavu při každém callbacku
let users: User[] = [];
await client.store.subscribe('all-users', (data) => {
  users = data as User[]; // Kompletní nahrazení
});

// Špatně — hromadění duplicit po reconnectu
const allData: User[] = [];
await client.store.subscribe('all-users', (data) => {
  allData.push(...(data as User[])); // Duplicity po reconnectu!
});
```

### Nespoléhejte se na subscription ID

SDK spravuje subscription ID interně. Používejte funkci `unsubscribe` vrácenou z `subscribe()` místo sledování ID:

```typescript
// Správně — použití vrácené unsubscribe funkce
const unsub = await client.store.subscribe('users', callback);
// Později:
unsub();

// Špatně — ruční sledování ID (mění se při reconnectu)
```

### Ošetřete mezeru mezi odpojením a reconnectem

Během okna reconnectu nebudete přijímat žádné push aktualizace. Změny dat, které se stanou na serveru během této mezery, nejsou ztraceny -- resubscripce doručí čerstvý snapshot. Ale neuvidíte jednotlivé mutace, které mezitím proběhly.

## Cvičení

Napište skript, který:
1. Připojí klienta s rychlým nastavením reconnectu
2. Přihlásí se k odběru store dotazu a rules event vzoru
3. Vloží záznam pro ověření, že store odběr funguje
4. Loguje počet zavolání callbacku každého odběru
5. Po reconnectu ověří, že store callback obdržel čerstvá data a rules callback se při resubscripci nezavolal

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    reconnect: {
      maxRetries: 10,
      initialDelayMs: 200,
      jitterMs: 0,
    },
  });

  await client.connect();

  let storeCallCount = 0;
  let rulesCallCount = 0;

  // Store odběr — callback se zavolá při počátečních datech + push + reconnectu
  await client.store.subscribe('all-users', (data) => {
    storeCallCount++;
    const records = data as Array<Record<string, unknown>>;
    console.log(`[store] Volání #${storeCallCount}: ${records.length} záznamů`);
  });

  // Rules odběr — callback se zavolá pouze při odpovídajících eventech
  await client.rules.subscribe('user:*', (event, topic) => {
    rulesCallCount++;
    console.log(`[rules] Volání #${rulesCallCount}: ${topic}`);
  });

  console.log(`Po počátečním odběru: store=${storeCallCount}, rules=${rulesCallCount}`);
  // store=1 (úvodní data), rules=0 (rules nemají úvodní data)

  // Vložení záznamu — spustí store push
  await client.store.bucket('users').insert({ name: 'Alice' });
  // Chvíli počkat na doručení push
  await new Promise((r) => setTimeout(r, 500));

  console.log(`Po vložení: store=${storeCallCount}, rules=${rulesCallCount}`);
  // store=2 (úvodní + push), rules=0

  // Čekání na reconnect (ručně vypněte server)
  client.on('reconnected', () => {
    // Po reconnectu se storeCallCount zvýšil (doručení čerstvých dat)
    // rulesCallCount se NEzvýšil (rules nemají úvodní data)
    console.log(`Po reconnectu: store=${storeCallCount}, rules=${rulesCallCount}`);
  });

  console.log('Vypněte server pro test reconnectu...');
}

main().catch(console.error);
```

</details>

## Shrnutí

- Všechny aktivní odběry jsou po reconnectu automaticky obnoveny -- žádný manuální kód není potřeba
- SDK přehraje původní subscribe požadavek pro každý odběr
- Store odběry při resubscripci obdrží čerstvá data (callback se zavolá s aktuálním snapshotem)
- Rules odběry pokračují bez úvodních dat (callback se zavolá pouze při budoucích eventech)
- Subscription ID se při reconnectu mění -- SDK transparentně aktualizuje svá interní mapování
- Selhání resubscripce jsou tiše odebrána a zalogována do `console.error`
- Autentizace proběhne před obnovou odběrů, aby server požadavky přijal
- Pište idempotentní callbacky -- store odběry doručují kompletní snapshoty, ne diffy

---

Další: [Heartbeat](./03-heartbeat.md)
