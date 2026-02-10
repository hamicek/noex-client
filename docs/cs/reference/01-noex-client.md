# NoexClient

Hlavní vstupní bod pro připojení k instanci noex-server. Spravuje WebSocket spojení, automatické znovupřipojení a zpřístupňuje API jmenné prostory `store`, `rules` a `auth`.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';
```

---

## Konstruktor

```typescript
new NoexClient(url: string, options?: ClientOptions)
```

Vytvoří novou instanci klienta. **Nepřipojuje se automaticky** — pro navázání spojení zavolejte `connect()`.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| url | `string` | ano | URL WebSocket serveru (např. `'ws://localhost:3000'`) |
| options | `ClientOptions` | ne | Konfigurace klienta — viz [Konfigurace](./02-configuration.md) |

Pokud `globalThis` neobsahuje konstruktor `WebSocket` (např. v Node.js), musíte jej předat přes `options.WebSocket`. Jinak dojde k runtime chybě.

**Příklad:**

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:3000', {
  auth: { token: 'secret' },
  WebSocket,
});
```

---

## Vlastnosti

| Název | Typ | Popis |
|-------|-----|-------|
| url | `string` | URL serveru předané konstruktoru (readonly) |
| store | `StoreAPI` | Operace úložiště — buckety, dotazy, subscripce, transakce |
| rules | `RulesAPI` | Operace rules enginu — události, fakta, subscripce |
| auth | `AuthAPI` | Operace autentizace — login, logout, whoami |
| state | `ConnectionState` | Aktuální stav spojení (readonly getter) |
| isConnected | `boolean` | `true` když `state === 'connected'` (readonly getter) |

---

## Životní cyklus

### connect()

```typescript
connect(): Promise<WelcomeInfo>
```

Otevře WebSocket spojení a počká na welcome zprávu ze serveru. Pokud je nastaven `options.auth.token` a server vyžaduje autentizaci, `auth.login(token)` se zavolá automaticky před vyřešením promise.

**Návratová hodnota:** `Promise<WelcomeInfo>` — welcome payload ze serveru

**Vyhazuje:**
- `Error` při vypršení časového limitu spojení (řízen `connectTimeoutMs`, výchozí 5 000 ms)
- `Error` pokud se WebSocket uzavře během handshake

**Příklad:**

```typescript
const welcome = await client.connect();
console.log(welcome.version);      // verze serveru
console.log(welcome.serverTime);   // timestamp serveru (ms)
console.log(welcome.requiresAuth); // zda je vyžadována autentizace
```

---

### disconnect()

```typescript
disconnect(): Promise<void>
```

Ukončí spojení. Zruší probíhající reconnect smyčku, odmítne všechny čekající požadavky s `DisconnectedError`, vymaže všechny subscripce a zavře WebSocket (kód `1000`).

**Příklad:**

```typescript
await client.disconnect();
console.log(client.state); // 'disconnected'
```

---

## Události

### on()

```typescript
on<K extends keyof ClientEventMap>(event: K, handler: ClientEventMap[K]): Unsubscribe
```

Zaregistruje posluchač události. Vrací funkci pro odhlášení.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| event | `string` | ano | Název události — viz tabulka níže |
| handler | `function` | ano | Callback odpovídající signatuře události |

**Návratová hodnota:** `Unsubscribe` (`() => void`) — zavolejte pro odebrání posluchače

**Mapa událostí:**

| Událost | Signatura handleru | Popis |
|---------|-------------------|-------|
| `connected` | `() => void` | Emitováno po úspěšném spojení (počátečním i reconnect) |
| `disconnected` | `(reason: string) => void` | Emitováno při ztrátě spojení, pokud nenásleduje reconnect |
| `reconnecting` | `(attempt: number) => void` | Emitováno před každým pokusem o reconnect (`attempt` začíná od 1) |
| `reconnected` | `() => void` | Emitováno po úspěšném reconnectu (subscripce již obnoveny) |
| `error` | `(error: Error) => void` | Emitováno při chybách transportu nebo vyčerpání max. pokusů o reconnect |
| `welcome` | `(info: WelcomeInfo) => void` | Emitováno při přijetí welcome zprávy ze serveru |

**Příklad:**

```typescript
const unsub = client.on('reconnecting', (attempt) => {
  console.log(`Pokus o reconnect #${attempt}`);
});

client.on('error', (err) => {
  console.error('Chyba klienta:', err.message);
});

// Později — odebrání posluchače
unsub();
```

---

## Stavový automat spojení

```
                  connect()
disconnected ──────────────► connecting
     ▲                           │
     │                      success / fail
     │                           │
     │  disconnect()         ┌───▼───┐
     ├───────────────────────┤connected│
     │                       └───┬───┘
     │                   connection lost
     │                           │
     │   max retries         ┌───▼────────┐
     ├───────────────────────┤reconnecting │
     │                       └─────────────┘
```

Možné hodnoty `ConnectionState`: `'connecting'`, `'connected'`, `'reconnecting'`, `'disconnected'`.

---

## Chování při znovupřipojení

Automatické znovupřipojení je **ve výchozím stavu zapnuto** (nastavte `reconnect: false` pro vypnutí). Při neočekávaném přerušení spojení:

1. Stav přejde na `'reconnecting'` a emituje se událost `reconnecting`.
2. Klient čeká na backoff prodlevu vypočtenou `ReconnectStrategy` (exponenciální backoff s jitterem — viz [Konfigurace](./02-configuration.md#reconnectoptions)).
3. Pokusí se o nové WebSocket spojení.
4. Při úspěchu:
   - Pokud je nastaven `options.auth.token` a server vyžaduje autentizaci, klient se znovu automaticky přihlásí.
   - Všechny aktivní subscripce se obnoví přes server (`resubscribeAll`). Store subscripce dostanou aktuální data; rules subscripce se znovu zaregistrují.
   - Emitují se události `connected`, `reconnected` a `welcome`.
5. Při neúspěchu: `attempt` se zvýší a smyčka pokračuje od kroku 1.
6. Při dosažení `maxRetries` stav přejde na `'disconnected'` a emitují se události `disconnected` a `error`.

Volání `disconnect()` v jakémkoli bodě okamžitě zruší reconnect smyčku.

---

## Viz také

- [Konfigurace](./02-configuration.md) — ClientOptions, ReconnectOptions, výchozí hodnoty
- [Store API](./03-store-api.md) — metody `client.store`
- [Rules API](./06-rules-api.md) — metody `client.rules`
- [Auth API](./07-auth-api.md) — metody `client.auth`
- [Transport](./08-transport.md) — WebSocket transport, interní detaily a heartbeat
- [Typy](./09-types.md) — ConnectionState, WelcomeInfo, Unsubscribe
- [Chyby](./10-errors.md) — DisconnectedError, TimeoutError
