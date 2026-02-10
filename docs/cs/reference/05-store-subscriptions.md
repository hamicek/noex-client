# Store Subscriptions

Reaktivní subscripce dotazů umožňují klientovi přijímat aktualizace v reálném čase, kdykoli se změní data na serveru. Tento dokument pokrývá celý životní cyklus subscripce — od jejího založení přes doručení počátečních dat, push aktualizace, odhlášení až po automatickou obnovu při reconnectu.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const store = client.store;
```

Relevantní typy:

```typescript
import type { Unsubscribe } from '@hamicek/noex-client';
```

---

## Životní cyklus subscripce

### 1. Přihlášení k odběru

Volání `store.subscribe()` odešle požadavek `store.subscribe` na server. Server zaregistruje subscripci, okamžitě vyhodnotí dotaz a vrátí počáteční výsledek společně s unikátním `subscriptionId`.

### 2. Doručení počátečních dat

Callback je zavolán **synchronně** s počátečními daty ještě před vyřešením promise z `subscribe()`. To zaručuje, že v okamžiku dokončení `await` už callback zpracoval první výsledek.

Pokud callback při doručení počátečních dat vyhodí chybu, subscripce je automaticky vyčištěna — lokálně i na serveru — a chyba je znovu vyhozena volajícímu.

### 3. Push aktualizace

Kdykoli se podkladová data změní, server odešle push zprávu:

```json
{
  "type": "push",
  "subscriptionId": "sub_abc123",
  "channel": "subscription",
  "data": { ... }
}
```

`PushRouter` směruje zprávu do `SubscriptionManager`, který zavolá registrovaný callback s novými daty. Pokud callback vyhodí chybu, je zalogována do `console.error`, ale subscripce zůstává aktivní.

### 4. Odhlášení z odběru

Volání vrácené funkce `Unsubscribe` odstraní lokální registraci a odešle fire-and-forget požadavek `store.unsubscribe` na server. Funkce je synchronní — nečeká na potvrzení ze serveru.

### 5. Odpojení

Při záměrném odpojení klienta přes `client.disconnect()` jsou všechny subscripce okamžitě vyčištěny. Žádné požadavky na odhlášení se na server neposílají — server vyčistí subscripce při uzavření WebSocketu.

---

## Metody

### store.subscribe()

```typescript
subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>
subscribe(query: string, params: Record<string, unknown>, callback: (data: unknown) => void): Promise<Unsubscribe>
```

Přihlásí se k odběru serverového reaktivního dotazu.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| query | `string` | ano | Název serverového dotazu |
| params | `Record<string, unknown>` | ne | Parametry dotazu předané serveru |
| callback | `(data: unknown) => void` | ano | Voláno s počátečními daty a při každé další aktualizaci |

**Návratová hodnota:** `Promise<Unsubscribe>` — vyřeší se na synchronní funkci pro odhlášení `() => void`

**Vyhazuje:**
- `NoexClientError` pokud je název dotazu neplatný nebo server subscripci odmítne
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen
- Znovu vyhodí jakoukoli chybu vyhozenou `callback` během doručení počátečních dat (subscripce je automaticky vyčištěna)

**Příklad — základní subscripce:**

```typescript
const unsubscribe = await store.subscribe('activeUsers', (data) => {
  console.log('Aktivní uživatelé:', data);
});

// Ukončení odběru
unsubscribe();
```

**Příklad — subscripce s parametry:**

```typescript
const unsub = await store.subscribe(
  'usersByRole',
  { role: 'admin' },
  (data) => {
    console.log('Administrátoři:', data);
  },
);
```

**Příklad — ošetření chyb v callbacku:**

```typescript
try {
  await store.subscribe('query', (data) => {
    // Pokud toto vyhodí chybu během počátečního doručení,
    // subscripce je vyčištěna a chyba se propaguje volajícímu.
    processData(data);
  });
} catch (err) {
  console.error('Subscripce selhala:', err);
}
```

---

### Funkce Unsubscribe

```typescript
const unsubscribe: Unsubscribe = await store.subscribe('query', callback);
unsubscribe(); // synchronní, vrací void
```

Funkce `Unsubscribe` vrácená metodou `subscribe()`:

1. Odstraní subscripci z lokálního `SubscriptionManager`
2. Odešle požadavek `store.unsubscribe` na server (fire-and-forget)
3. Vrací `void` synchronně — nečeká na potvrzení ze serveru

Opakované volání je bezpečné — druhé volání je na straně serveru no-op.

---

### store.unsubscribe()

```typescript
unsubscribe(subscriptionId: string): Promise<void>
```

Odhlásí subscripci podle serverem přiděleného ID. Toto je pokročilá metoda — pro běžné použití preferujte funkci `Unsubscribe` vrácenou metodou `subscribe()`.

Na rozdíl od funkce `Unsubscribe` tato metoda čeká na odpověď serveru.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| subscriptionId | `string` | ano | Serverem přidělené ID subscripce |

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

---

## Obnova při reconnectu

Když se klient znovu připojí po výpadku spojení, všechny aktivní subscripce jsou automaticky obnoveny prostřednictvím `SubscriptionManager.resubscribeAll()`.

### Sekvence obnovy

1. WebSocket spojení je znovu navázáno
2. Pokud je nakonfigurován auto-login a server vyžaduje autentizaci, klient se znovu přihlásí
3. `resubscribeAll()` iteruje přes všechny registrované subscripce a pro každou z nich:
   - Odešle původní požadavek `store.subscribe` (stejný dotaz a parametry)
   - Aktualizuje lokální mapování s novým `subscriptionId` přiděleným serverem
   - Doručí aktuální data do callbacku (pokud server vrátí počáteční data)
4. Pokud resubscripce selže, daná subscripce je odstraněna z lokálního registru a zalogována do `console.error`
5. Event `reconnected` je emitován po obnovení všech subscripcí

### Důležité detaily

- Server přidělí **nové `subscriptionId`** při každé resubscripci — staré ID již není platné
- Callback obdrží aktuální data, nikoli diff oproti předchozímu stavu
- Subscripce, které se nepodaří obnovit, jsou tiše odstraněny — žádná chyba není vyhozena uživateli
- Původní funkce `Unsubscribe` zůstává funkční a správně odhlásí novou serverovou subscripci

**Příklad — sledování reconnectu:**

```typescript
client.on('reconnected', () => {
  console.log('Znovu připojeno — subscripce obnoveny automaticky');
});

const unsub = await store.subscribe('liveData', (data) => {
  // Tento callback přijímá data jak během běžného provozu,
  // tak po obnově při reconnectu s aktuálními daty ze serveru.
  renderDashboard(data);
});
```

---

## Protokol push zpráv

Store push zprávy používají kanál `subscription`:

```typescript
// Server → Klient
{
  type: 'push',
  subscriptionId: string,  // serverem přidělené ID
  channel: 'subscription', // odlišuje store push od rules event push
  data: unknown            // výsledek dotazu
}
```

`PushRouter` kontroluje příchozí zprávy. Pokud `type === 'push'`, extrahuje `subscriptionId` a `channel`, a poté deleguje na metodu `SubscriptionManager.handlePush()`, která zavolá registrovaný callback.

---

## Interní typy

### SubscriptionEntry

Interní typ používaný `SubscriptionManager` pro sledování aktivních subscripcí:

```typescript
interface SubscriptionEntry {
  id: string;                              // serverem přidělené subscriptionId (aktualizováno při reconnectu)
  channel: 'subscription' | 'event';       // 'subscription' pro store, 'event' pro rules
  callback: (data: unknown) => void;       // uživatelem poskytnutý callback
  resubscribe: {
    type: string;                          // typ požadavku, např. 'store.subscribe'
    payload: Record<string, unknown>;      // původní payload požadavku (query, params)
  };
}
```

Pole `resubscribe` ukládá původní požadavek, aby bylo možné subscripci transparentně obnovit po reconnectu.

---

## Viz také

- [Store API](./03-store-api.md) — `subscribe()`, `unsubscribe()` a další metody store
- [NoexClient](./01-noex-client.md) — životní cyklus připojení a `on()` eventy
- [Transport](./08-transport.md) — strategie reconnectu, exponenciální backoff, heartbeat
- [Konfigurace](./02-configuration.md) — `requestTimeoutMs`, nastavení `reconnect`
- [Typy](./09-types.md) — `Unsubscribe`
- [Chyby](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
