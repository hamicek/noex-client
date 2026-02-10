# Typy

Sdílené typové definice exportované balíčkem `noex-client`. Všechny zde uvedené typy jsou dostupné jako pojmenované exporty.

## Import

```typescript
import type {
  ConnectionState,
  Unsubscribe,
  WelcomeInfo,
  StoreRecord,
  RecordMeta,
  PaginatedResult,
  TransactionOp,
  TransactionResult,
  BucketsInfo,
  StoreStats,
  RulesEvent,
  RulesStats,
  Fact,
  AuthSession,
} from '@anthropic/noex-client';
```

---

## Spojení

### ConnectionState

```typescript
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
```

Aktuální stav připojení klienta.

| Hodnota | Popis |
|---------|-------|
| `'connecting'` | Probíhá počáteční připojování |
| `'connected'` | Připojeno, připraveno odesílat požadavky |
| `'reconnecting'` | Spojení ztraceno, probíhá automatické znovupřipojení |
| `'disconnected'` | Nepřipojeno (počáteční stav nebo po `disconnect()`) |

### Unsubscribe

```typescript
type Unsubscribe = () => void;
```

Funkce vrácená metodami pro subscribování. Zavolejte ji pro zrušení odběru. Synchronní — nevrací Promise.

### WelcomeInfo

```typescript
interface WelcomeInfo {
  readonly version: string;
  readonly serverTime: number;
  readonly requiresAuth: boolean;
}
```

Informace přijaté ze serveru po úspěšném připojení.

| Pole | Typ | Popis |
|------|-----|-------|
| version | `string` | Verze protokolu serveru |
| serverTime | `number` | Timestamp serveru (ms od epochy) |
| requiresAuth | `boolean` | Zda server vyžaduje autentizaci |

---

## Store

### StoreRecord

```typescript
type StoreRecord = Record<string, unknown>;
```

Základní typ pro záznamy ve store. Všechny záznamy jsou prosté objekty se string klíči.

### RecordMeta

```typescript
interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}
```

Metadata automaticky připojená ke každému uloženému záznamu serverem.

| Pole | Typ | Popis |
|------|-----|-------|
| id | `string` | Unikátní identifikátor záznamu |
| _version | `number` | Monotónně rostoucí číslo verze |
| _createdAt | `number` | Timestamp vytvoření (ms od epochy) |
| _updatedAt | `number` | Timestamp poslední aktualizace (ms od epochy) |

### PaginatedResult

```typescript
interface PaginatedResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly records: (T & RecordMeta)[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}
```

Výsledek stránkovaného dotazu.

| Pole | Typ | Popis |
|------|-----|-------|
| records | `(T & RecordMeta)[]` | Záznamy pro aktuální stránku |
| hasMore | `boolean` | Zda existují další záznamy za touto stránkou |
| nextCursor | `unknown` | Neprůhledný kurzor pro načtení další stránky |

---

## Transakce

### TransactionOp

```typescript
type TransactionOp =
  | { readonly op: 'get'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'insert'; readonly bucket: string; readonly data: Record<string, unknown> }
  | { readonly op: 'update'; readonly bucket: string; readonly key: unknown; readonly data: Record<string, unknown> }
  | { readonly op: 'delete'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'where'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'findOne'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'count'; readonly bucket: string; readonly filter?: Record<string, unknown> };
```

Jednotlivá operace v rámci transakčního batche.

| Op | Pole | Popis |
|----|------|-------|
| `'get'` | `bucket`, `key` | Načtení záznamu podle klíče |
| `'insert'` | `bucket`, `data` | Vložení nového záznamu |
| `'update'` | `bucket`, `key`, `data` | Aktualizace existujícího záznamu |
| `'delete'` | `bucket`, `key` | Smazání záznamu |
| `'where'` | `bucket`, `filter` | Dotaz na záznamy odpovídající filtru |
| `'findOne'` | `bucket`, `filter` | Nalezení prvního záznamu odpovídajícího filtru |
| `'count'` | `bucket`, `filter?` | Počet záznamů (volitelně filtrovaný) |

### TransactionResult

```typescript
interface TransactionResult {
  readonly results: ReadonlyArray<{ readonly index: number; readonly data: unknown }>;
}
```

Výsledek transakce. Každá položka odpovídá jedné operaci z batche.

| Pole | Typ | Popis |
|------|-----|-------|
| results | `Array<{ index, data }>` | Seřazené výsledky indexované pořadím operace |

---

## Statistiky store

### BucketsInfo

```typescript
interface BucketsInfo {
  readonly count: number;
  readonly names: readonly string[];
}
```

Souhrn definovaných bucketů ve store.

| Pole | Typ | Popis |
|------|-----|-------|
| count | `number` | Počet bucketů |
| names | `string[]` | Seznam názvů bucketů |

### StoreStats

```typescript
interface StoreStats {
  readonly name: string;
  readonly buckets: BucketsInfo;
  readonly records: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly indexes: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly queries: {
    readonly defined: number;
    readonly activeSubscriptions: number;
  };
  readonly persistence: {
    readonly enabled: boolean;
  };
  readonly ttl: {
    readonly enabled: boolean;
    readonly checkIntervalMs: number;
  };
}
```

Kompletní statistiky store vrácené metodou `store.stats()`.

| Pole | Typ | Popis |
|------|-----|-------|
| name | `string` | Název store |
| buckets | `BucketsInfo` | Souhrn bucketů |
| records.total | `number` | Celkový počet záznamů napříč všemi buckety |
| records.perBucket | `Record<string, number>` | Počet záznamů na bucket |
| indexes.total | `number` | Celkový počet indexů |
| indexes.perBucket | `Record<string, number>` | Počet indexů na bucket |
| queries.defined | `number` | Počet definovaných queries |
| queries.activeSubscriptions | `number` | Počet aktivních query subscriptions |
| persistence.enabled | `boolean` | Zda je persistence povolena |
| ttl.enabled | `boolean` | Zda je TTL povoleno |
| ttl.checkIntervalMs | `number` | Interval kontroly TTL v milisekundách |

---

## Rules

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

Událost přijatá z rules engine přes subscription.

| Pole | Typ | Popis |
|------|-----|-------|
| id | `string` | Unikátní identifikátor události |
| topic | `string` | Topic události |
| data | `Record<string, unknown>` | Payload události |
| timestamp | `number` | Timestamp (ms od epochy) |
| correlationId | `string?` | Volitelné korelační ID pro trasování |
| causationId | `string?` | Volitelné kauzační ID pro trasování |
| source | `string` | Identifikátor zdroje události |

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

Fakt z fact store rules engine.

| Pole | Typ | Popis |
|------|-----|-------|
| key | `string` | Klíč faktu (hierarchický, např. `user:123:status`) |
| value | `unknown` | Hodnota faktu |
| timestamp | `number` | Timestamp poslední aktualizace (ms od epochy) |
| source | `string` | Zdroj, který fakt nastavil |
| version | `number` | Číslo verze faktu |

### RulesStats

```typescript
interface RulesStats {
  readonly rulesCount: number;
  readonly factsCount: number;
  readonly timersCount: number;
  readonly eventsProcessed: number;
  readonly rulesExecuted: number;
  readonly avgProcessingTimeMs: number;
  readonly tracing?: { enabled: boolean; entriesCount: number; maxEntries: number };
  readonly profiling?: { totalRulesProfiled: number; totalTriggers: number; totalExecutions: number; totalTimeMs: number; avgRuleTimeMs: number; slowestRule: { ruleId: string; ruleName: string; avgTimeMs: number } | null; hottestRule: { ruleId: string; ruleName: string; triggerCount: number } | null };
  readonly audit?: { totalEntries: number; memoryEntries: number; oldestEntry: number | null; newestEntry: number | null; entriesByCategory: Readonly<Record<string, number>>; subscribersCount: number };
  readonly versioning?: { trackedRules: number; totalVersions: number; dirtyRules: number; oldestEntry: number | null; newestEntry: number | null };
  readonly baseline?: { metricsCount: number; totalRecalculations: number; anomaliesDetected: number };
}
```

Statistiky rules engine vrácené metodou `rules.stats()`. Základní pole jsou vždy přítomna; volitelné sekce závisí na konfiguraci serveru.

| Pole | Typ | Popis |
|------|-----|-------|
| rulesCount | `number` | Počet registrovaných pravidel |
| factsCount | `number` | Počet uložených faktů |
| timersCount | `number` | Počet aktivních časovačů |
| eventsProcessed | `number` | Celkový počet zpracovaných událostí |
| rulesExecuted | `number` | Celkový počet vyhodnocení pravidel |
| avgProcessingTimeMs | `number` | Průměrný čas zpracování události |
| tracing | `object?` | Statistiky tracingu (pokud povolen) |
| profiling | `object?` | Statistiky profilingu (pokud povolen) |
| audit | `object?` | Statistiky audit logu (pokud nakonfigurován) |
| versioning | `object?` | Statistiky verzování pravidel (pokud nakonfigurováno) |
| baseline | `object?` | Statistiky detekce anomálií (pokud nakonfigurována) |

---

## Auth

### AuthSession

```typescript
interface AuthSession {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly expiresAt?: number;
}
```

Informace o relaci vrácené po úspěšné autentizaci.

| Pole | Typ | Popis |
|------|-----|-------|
| userId | `string` | Identifikátor autentizovaného uživatele |
| roles | `string[]` | Přiřazené role |
| metadata | `Record<string, unknown>?` | Volitelná metadata relace |
| expiresAt | `number?` | Timestamp expirace relace (ms od epochy) |

---

## Abstrakce WebSocket

### WebSocketLike

```typescript
interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
```

Minimální rozhraní WebSocket, které transport očekává. Jak prohlížečový `WebSocket`, tak npm balíček `ws` toto rozhraní splňují.

### WebSocketConstructor

```typescript
type WebSocketConstructor = new (url: string) => WebSocketLike;
```

Konstruktor pro WebSocket-like objekt. Předejte přes `ClientOptions.WebSocket` pro vlastní implementaci (např. `ws` v Node.js).

---

## Viz také

- [Chyby](./10-errors.md) — Třídy chyb a chybové kódy serveru
- [Konfigurace](./02-configuration.md) — ClientOptions a ReconnectOptions
- [Store API](./03-store-api.md) — Operace store používající tyto typy
- [Rules API](./06-rules-api.md) — Operace rules používající tyto typy
- [Auth API](./07-auth-api.md) — Autentizace pomocí AuthSession
