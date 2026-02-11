# Konfigurace

SDK poskytuje rozumné výchozí hodnoty pro vše, ale každý aspekt spojení lze vyladit. Tato kapitola pokrývá všechna pole v `ClientOptions` a `ReconnectOptions`.

## Co se naučíte

- Každé pole `ClientOptions`, jeho typ, výchozí hodnotu a kdy ho změnit
- Jak `ReconnectOptions` řídí exponenciální backoff
- Vzorec backoff a jak jitter zabraňuje problému thundering herd
- Jak vypnout reconnect a heartbeat

## ClientOptions

Volby předejte jako druhý argument konstruktoru `NoexClient`:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-jwt-token' },
  reconnect: true,
  requestTimeoutMs: 10_000,
  connectTimeoutMs: 5_000,
  heartbeat: true,
});
```

### Všechna pole

| Pole | Typ | Výchozí | Popis |
|------|-----|---------|-------|
| `WebSocket` | `WebSocketConstructor` | `globalThis.WebSocket` | Konstruktor WebSocket. Povinný v Node.js (předejte `ws`). Prohlížeče ho mají vestavěný. |
| `auth` | `{ token: string }` | — | Token pro automatické přihlášení. Pokud je nastaven a server vyžaduje autentizaci, `auth.login(token)` se zavolá po připojení a po každém reconnectu. |
| `reconnect` | `boolean \| ReconnectOptions` | `true` | `true` aktivuje reconnect s výchozím nastavením. `false` ho zcela vypne. Pro detailní řízení předejte objekt `ReconnectOptions`. |
| `requestTimeoutMs` | `number` | `10000` | Maximální doba čekání (ms) na odpověď serveru pro jakýkoliv požadavek. Při překročení vyhodí `TimeoutError`. |
| `connectTimeoutMs` | `number` | `5000` | Maximální doba (ms) pro počáteční WebSocket připojení a welcome zprávu. Při překročení se `connect()` rejectne. |
| `heartbeat` | `boolean` | `true` | Když je `true`, klient automaticky odpovídá na ping zprávy serveru pomocí pong. Vypněte pouze pokud heartbeaty řešíte sami. |

### auth

Když je `auth.token` nastaven, klient automaticky zavolá `auth.login(token)` po přijetí welcome zprávy — jak při počátečním připojení, tak po každém reconnectu. To zajišťuje, že session je vždy autentizovaná bez manuálního zásahu.

```typescript
// Auto-login: SDK řeší autentizaci transparentně
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
});

const welcome = await client.connect();
// Pokud welcome.requiresAuth je true, auth.login byl již zavolán
```

Pokud server nevyžaduje autentizaci (`requiresAuth: false`), krok auto-login se přeskočí i v případě, že je token poskytnut.

### requestTimeoutMs

Každý požadavek (insert, get, subscribe atd.) spustí timeout timer. Pokud server neodpoví v rámci `requestTimeoutMs`, promise se rejectne s `TimeoutError`.

```typescript
import { TimeoutError } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  requestTimeoutMs: 5_000, // 5 sekund místo výchozích 10
});

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof TimeoutError) {
    console.log('Server odpovídal příliš dlouho');
  }
}
```

Nastavte nižší hodnotu pro aplikace citlivé na latenci nebo vyšší pro operace zpracovávající velké datasety.

### connectTimeoutMs

Řídí, jak dlouho `connect()` čeká na otevření WebSocket **a** přijetí welcome zprávy.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  connectTimeoutMs: 3_000, // rychlé selhání pokud je server nedostupný
});
```

### heartbeat

Server posílá periodické ping zprávy. Když je `heartbeat` nastaven na `true` (výchozí), SDK automaticky odpovídá pong. Pokud server neobdrží pong v rámci svého timeout okna, spojení ukončí.

```typescript
// Vypněte pokud heartbeaty řešíte externě (neobvyklé)
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: false,
});
```

## ReconnectOptions

Když je `reconnect` nastaven na `true`, SDK používá výchozí hodnoty. Pro detailní řízení předejte objekt `ReconnectOptions`:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: {
    maxRetries: 20,
    initialDelayMs: 500,
    maxDelayMs: 15_000,
    backoffMultiplier: 2,
    jitterMs: 300,
  },
});
```

### Všechna pole

| Pole | Typ | Výchozí | Popis |
|------|-----|---------|-------|
| `maxRetries` | `number` | `Infinity` | Maximální počet pokusů o reconnect. Po tolika selháních se klient vzdá a přejde do stavu `'disconnected'`. |
| `initialDelayMs` | `number` | `1000` | Prodleva před prvním pokusem o reconnect (ms). |
| `maxDelayMs` | `number` | `30000` | Horní limit pro prodlevu backoff (ms). Prodleva nikdy nepřekročí tuto hodnotu. |
| `backoffMultiplier` | `number` | `2` | Násobitel aplikovaný na prodlevu po každém neúspěšném pokusu. |
| `jitterMs` | `number` | `500` | Náhodný jitter přidaný ke každé prodlevě, aby se zabránilo reconnectu více klientů ve stejný okamžik. |

### Vzorec backoff

Prodleva před pokusem *n* (indexováno od 0) je:

```text
delay = min(initialDelayMs × backoffMultiplier^n, maxDelayMs) + random(0, jitterMs)
```

S výchozími hodnotami:

| Pokus | Základní prodleva | + Jitter (max) | Efektivní rozsah |
|-------|-------------------|-----------------|------------------|
| 0 | 1000 ms | 500 ms | 1000–1500 ms |
| 1 | 2000 ms | 500 ms | 2000–2500 ms |
| 2 | 4000 ms | 500 ms | 4000–4500 ms |
| 3 | 8000 ms | 500 ms | 8000–8500 ms |
| 4 | 16000 ms | 500 ms | 16000–16500 ms |
| 5+ | 30000 ms | 500 ms | 30000–30500 ms |

Jitter zabraňuje **problému thundering herd** — když se server restartuje, všichni klienti by se bez jitter znovu připojovali ve zcela stejných intervalech, což by způsobilo špičku simultánních připojení.

### Vypnutí reconnectu

```typescript
// Žádný automatický reconnect — ztráta spojení je trvalá
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: false,
});
```

Když je reconnect vypnutý, ztráta spojení přesune klienta přímo do stavu `'disconnected'`. Musíte znovu zavolat `connect()` ručně.

### Co se stane po úspěšném reconnectu

1. Provede se auto-login (pokud je nakonfigurován `auth.token`)
2. Všechny aktivní odběry jsou obnoveny na serveru
3. Každý callback odběru obdrží čerstvá data
4. Emituje se událost `'reconnected'`

## Kompletní příklad konfigurace

Produkční konfigurace se všemi volbami:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('wss://api.example.com/ws', {
  WebSocket,

  // Auth: auto-login při připojení a reconnectu
  auth: { token: process.env.API_TOKEN! },

  // Reconnect: agresivní opakování s rozumnými limity
  reconnect: {
    maxRetries: 50,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    backoffMultiplier: 1.5,
    jitterMs: 200,
  },

  // Timeouty
  requestTimeoutMs: 15_000,
  connectTimeoutMs: 10_000,

  // Heartbeat: udržení spojení
  heartbeat: true,
});

client.on('reconnecting', (attempt) => {
  console.log(`Pokus o reconnect ${attempt}/50`);
});

client.on('error', (err) => {
  console.error('Chyba klienta:', err.message);
});

await client.connect();
```

## Cvičení

Máte mobilní aplikaci s nespolehlivým připojením k síti. Navrhněte konfiguraci `ReconnectOptions`, která:

1. Zkusí až 100 pokusů
2. Začne s prodlevou 200 ms
3. Omezí prodlevu na 60 sekund
4. Používá násobitel 1.5 (mírnější křivka než výchozí)
5. Má 1 sekundu jitter

Vypočítejte prodlevu pro pokusy 0, 1, 2, 5 a 10.

<details>
<summary>Řešení</summary>

```typescript
const client = new NoexClient('wss://mobile-api.example.com/ws', {
  reconnect: {
    maxRetries: 100,
    initialDelayMs: 200,
    maxDelayMs: 60_000,
    backoffMultiplier: 1.5,
    jitterMs: 1_000,
  },
});
```

Výpočet prodlevy: `min(200 × 1.5^n, 60000) + random(0, 1000)`

| Pokus | Základ (200 × 1.5^n) | Omezeno | + Jitter | Rozsah |
|-------|----------------------|---------|----------|--------|
| 0 | 200 ms | 200 ms | 0–1000 ms | 200–1200 ms |
| 1 | 300 ms | 300 ms | 0–1000 ms | 300–1300 ms |
| 2 | 450 ms | 450 ms | 0–1000 ms | 450–1450 ms |
| 5 | 1519 ms | 1519 ms | 0–1000 ms | 1519–2519 ms |
| 10 | 11533 ms | 11533 ms | 0–1000 ms | 11533–12533 ms |

Mírnější násobitel 1.5x znamená pomalejší růst, což je lepší pro mobilní zařízení, kde jsou krátké výpadky běžné a chcete se rychle znovu připojit.

</details>

## Shrnutí

- `ClientOptions` řídí autentizaci, reconnect, timeouty, heartbeat a konstruktor WebSocket
- Všechny volby mají rozumné výchozí hodnoty — v Node.js stačí nastavit pouze `WebSocket`
- `ReconnectOptions` používá exponenciální backoff s jitter pro prevenci thundering herd
- Vzorec backoff je `min(initialDelayMs × multiplier^n, maxDelayMs) + random(0, jitterMs)`
- Nastavte `reconnect: false` pro úplné vypnutí automatického reconnectu
- Po úspěšném reconnectu se automaticky provede auto-login a obnova odběrů

---

Další: [Základní CRUD](../03-store-operace/01-zakladni-crud.md)
