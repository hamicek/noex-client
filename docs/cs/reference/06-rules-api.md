# Rules API

Třída `RulesAPI` poskytuje přístup k serverovému pravidlovému enginu — emitování událostí, správu faktů a přihlášení k odběru notifikací o událostech v reálném čase. Je dostupná jako vlastnost `rules` na `NoexClient`.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const rules = client.rules;
```

Relevantní typy:

```typescript
import type {
  RulesEvent,
  Fact,
  RulesStats,
  Unsubscribe,
} from '@hamicek/noex-client';
```

---

## Události

### emit()

```typescript
emit(
  topic: string,
  data?: Record<string, unknown>,
  correlationId?: string,
  causationId?: string,
): Promise<RulesEvent>
```

Emituje událost do pravidlového enginu. Server vyhodnotí všechna odpovídající pravidla a vrátí vytvořenou událost.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| topic | `string` | ano | Téma události (např. `'user.login'`, `'order.placed'`) |
| data | `Record<string, unknown>` | ne | Libovolný payload události |
| correlationId | `string` | ne | Korelační ID pro trasování souvisejících událostí |
| causationId | `string` | ne | ID události, která tuto způsobila (vyžaduje `correlationId`) |

**Návratová hodnota:** `Promise<RulesEvent>` — serverem vytvořená událost s přiděleným `id`, `timestamp` a `source`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `topic` prázdný nebo `data` není objekt
- `NoexClientError` s kódem `RULES_NOT_AVAILABLE` pokud pravidlový engine neběží
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad — základní událost:**

```typescript
const event = await rules.emit('user.login', { userId: '42' });
console.log(event.id, event.timestamp);
```

**Příklad — korelované události:**

```typescript
const order = await rules.emit('order.placed', { orderId: '100' }, 'corr-1');
await rules.emit('payment.processed', { orderId: '100' }, 'corr-1', order.id);
```

---

## Fakta

### setFact()

```typescript
setFact(key: string, value: unknown): Promise<Fact>
```

Nastaví fakt ve fact store pravidlového enginu. Pokud fakt s daným klíčem již existuje, jeho hodnota a verze jsou aktualizovány.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| key | `string` | ano | Klíč faktu (např. `'user:42:role'`) |
| value | `unknown` | ano | Hodnota faktu (jakákoli JSON-serializovatelná hodnota) |

**Návratová hodnota:** `Promise<Fact>` — vytvořený nebo aktualizovaný fakt s `key`, `value`, `timestamp`, `source` a `version`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `key` prázdný nebo chybí `value`
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const fact = await rules.setFact('user:42:role', 'admin');
console.log(fact.version); // 1 (inkrementuje se při každé aktualizaci)
```

---

### getFact()

```typescript
getFact(key: string): Promise<unknown | null>
```

Získá hodnotu faktu podle klíče. Vrátí `null`, pokud fakt neexistuje.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| key | `string` | ano | Klíč faktu |

**Návratová hodnota:** `Promise<unknown | null>` — hodnota faktu, nebo `null` pokud nebyl nalezen

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `key` prázdný
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const role = await rules.getFact('user:42:role');
if (role !== null) {
  console.log('Role uživatele:', role);
}
```

---

### deleteFact()

```typescript
deleteFact(key: string): Promise<boolean>
```

Smaže fakt podle klíče. Vrátí `true`, pokud fakt existoval a byl smazán, `false` jinak.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| key | `string` | ano | Klíč faktu ke smazání |

**Návratová hodnota:** `Promise<boolean>` — `true` pokud byl smazán, `false` pokud fakt neexistoval

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `key` prázdný
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const deleted = await rules.deleteFact('user:42:role');
console.log(deleted); // true
```

---

### queryFacts()

```typescript
queryFacts(pattern: string): Promise<Fact[]>
```

Vyhledá fakta odpovídající glob-like vzoru. Vzor používá `:` jako oddělovač segmentů, kde `*` odpovídá jednomu segmentu.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| pattern | `string` | ano | Glob vzor (např. `'user:*:role'`) |

**Návratová hodnota:** `Promise<Fact[]>` — pole odpovídajících faktů

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `pattern` prázdný
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Pravidla porovnávání vzorů:**

| Vzor | Odpovídá | Neodpovídá |
|------|----------|------------|
| `user:*` | `user:1`, `user:42` | `user:1:role` |
| `user:*:role` | `user:1:role`, `user:42:role` | `user:1`, `user:1:name` |
| `config:*` | `config:theme`, `config:lang` | `config:ui:theme` |

**Příklad:**

```typescript
const roles = await rules.queryFacts('user:*:role');
for (const fact of roles) {
  console.log(`${fact.key} = ${fact.value}`);
}
```

---

### getAllFacts()

```typescript
getAllFacts(): Promise<Fact[]>
```

Vrátí všechny fakty aktuálně uložené v pravidlovém enginu.

**Návratová hodnota:** `Promise<Fact[]>` — pole všech faktů

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const facts = await rules.getAllFacts();
console.log(`Celkem faktů: ${facts.length}`);
```

---

## Subscripce

### subscribe()

```typescript
subscribe(
  pattern: string,
  callback: (event: RulesEvent, topic: string) => void,
): Promise<Unsubscribe>
```

Přihlásí se k odběru událostí pravidlového enginu odpovídajících vzoru tématu. Callback je zavolán vždy, když server zpracuje událost, jejíž téma odpovídá danému vzoru.

Na rozdíl od store subscripcí rules subscripce **nedoručují** počáteční data — callback je volán pouze při budoucích událostech.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| pattern | `string` | ano | Vzor tématu k porovnání (např. `'order.*'`) |
| callback | `(event: RulesEvent, topic: string) => void` | ano | Voláno s událostí a jejím tématem při každé shodě |

**Návratová hodnota:** `Promise<Unsubscribe>` — vyřeší se na synchronní funkci pro odhlášení `() => void`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `pattern` prázdný
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const unsubscribe = await rules.subscribe('order.*', (event, topic) => {
  console.log(`Událost na ${topic}:`, event.data);
});

// Vyvolání události — výše uvedený callback bude zavolán
await rules.emit('order.placed', { orderId: '100' });

// Ukončení odběru
unsubscribe();
```

### Funkce Unsubscribe

```typescript
const unsubscribe: Unsubscribe = await rules.subscribe('order.*', callback);
unsubscribe(); // synchronní, vrací void
```

Funkce `Unsubscribe` vrácená metodou `subscribe()`:

1. Odstraní subscripci z lokálního `SubscriptionManager`
2. Odešle požadavek `rules.unsubscribe` na server (fire-and-forget)
3. Vrací `void` synchronně — nečeká na potvrzení ze serveru

Opakované volání je bezpečné — druhé volání je na straně serveru no-op.

---

### unsubscribe()

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
- `NoexClientError` s kódem `NOT_FOUND` pokud subscripce neexistuje
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

---

## Statistiky

### stats()

```typescript
stats(): Promise<RulesStats>
```

Vrátí runtime statistiky z pravidlového enginu.

**Návratová hodnota:** `Promise<RulesStats>` — statistiky enginu včetně počtu pravidel, faktů, zpracovaných událostí a volitelných sekcí tracing/profiling/audit/versioning/baseline

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const stats = await rules.stats();
console.log(`Pravidla: ${stats.rulesCount}, Fakta: ${stats.factsCount}`);
console.log(`Zpracované události: ${stats.eventsProcessed}`);
```

---

## Protokol push zpráv

Rules event push zprávy používají kanál `event`:

```typescript
// Server → Klient
{
  type: 'push',
  subscriptionId: string,  // serverem přidělené ID
  channel: 'event',        // odlišuje rules push od store subscription push
  data: {
    topic: string,         // téma události, které odpovídalo vzoru
    event: RulesEvent      // kompletní objekt události
  }
}
```

`PushRouter` kontroluje příchozí zprávy. Pokud `type === 'push'` a `channel === 'event'`, zpráva je směrována do `SubscriptionManager`, který extrahuje `topic` a `event` z `data` a zavolá registrovaný callback jako `callback(event, topic)`.

---

## Obnova při reconnectu

Rules subscripce jsou automaticky obnoveny při reconnectu klienta. Metoda `SubscriptionManager.resubscribeAll()` znovu odešle původní požadavek `rules.subscribe` se stejným vzorem a server přidělí nové `subscriptionId`.

Na rozdíl od store subscripcí resubscripce rules **nedoručuje** počáteční data — callback bude zavolán pouze při nových událostech po reconnectu.

Pokud resubscripce selže, daná subscripce je tiše odstraněna z lokálního registru a zalogována do `console.error`.

**Příklad:**

```typescript
client.on('reconnected', () => {
  console.log('Znovu připojeno — rules subscripce obnoveny automaticky');
});

const unsub = await rules.subscribe('order.*', (event, topic) => {
  // Voláno při nových událostech během běžného provozu i po reconnectu.
  handleOrderEvent(event, topic);
});
```

---

## Typy

### RulesEvent

```typescript
interface RulesEvent {
  readonly id: string;
  readonly topic: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly source: string;
}
```

### Fact

```typescript
interface Fact {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly source: string;
  readonly version: number;
}
```

### RulesStats

```typescript
interface RulesStats {
  readonly rulesCount: number;
  readonly factsCount: number;
  readonly timersCount: number;
  readonly eventsProcessed: number;
  readonly rulesExecuted: number;
  readonly avgProcessingTimeMs: number;
  readonly tracing?: {
    readonly enabled: boolean;
    readonly entriesCount: number;
    readonly maxEntries: number;
  };
  readonly profiling?: {
    readonly totalRulesProfiled: number;
    readonly totalTriggers: number;
    readonly totalExecutions: number;
    readonly totalTimeMs: number;
    readonly avgRuleTimeMs: number;
    readonly slowestRule: { readonly ruleId: string; readonly ruleName: string; readonly avgTimeMs: number } | null;
    readonly hottestRule: { readonly ruleId: string; readonly ruleName: string; readonly triggerCount: number } | null;
  };
  readonly audit?: {
    readonly totalEntries: number;
    readonly memoryEntries: number;
    readonly oldestEntry: number | null;
    readonly newestEntry: number | null;
    readonly entriesByCategory: Readonly<Record<string, number>>;
    readonly subscribersCount: number;
  };
  readonly versioning?: {
    readonly trackedRules: number;
    readonly totalVersions: number;
    readonly dirtyRules: number;
    readonly oldestEntry: number | null;
    readonly newestEntry: number | null;
  };
  readonly baseline?: {
    readonly metricsCount: number;
    readonly totalRecalculations: number;
    readonly anomaliesDetected: number;
  };
}
```

---

## Viz také

- [NoexClient](./01-noex-client.md) — životní cyklus připojení, vlastnost `rules`, `on()` eventy
- [Store Subscriptions](./05-store-subscriptions.md) — životní cyklus store subscripcí (pro srovnání s rules subscripcemi)
- [Transport](./08-transport.md) — strategie reconnectu, exponenciální backoff
- [Konfigurace](./02-configuration.md) — `requestTimeoutMs`, nastavení `reconnect`
- [Typy](./09-types.md) — `RulesEvent`, `Fact`, `RulesStats`, `Unsubscribe`
- [Chyby](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
