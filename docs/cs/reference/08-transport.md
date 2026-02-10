# Transport

Interní WebSocket transportní vrstva používaná třídou `NoexClient`. Tento dokument popisuje architekturu a chování transportního subsystému — tyto třídy **nejsou součástí veřejného API** a nelze je importovat přímo.

## Přehled architektury

```
NoexClient
 ├─ WebSocketTransport    spravuje raw WebSocket spojení
 ├─ ReconnectStrategy     vypočítává backoff prodlevy
 ├─ RequestManager        koreluje request/response páry
 └─ PushRouter            směruje push zprávy ze serveru na subscripce
```

---

## WebSocketTransport

Nízkoúrovňový WebSocket wrapper se správou životního cyklu spojení, systémem událostí a automatickým heartbeat zpracováním.

### Konstruktor

```typescript
new WebSocketTransport(url: string, options: TransportOptions)
```

**TransportOptions:**

| Název | Typ | Popis |
|-------|-----|-------|
| connectTimeoutMs | `number` | Timeout pro WebSocket `open` událost (ms) |
| WebSocket | `WebSocketConstructor` | Konstruktor WebSocket k použití |
| heartbeat | `boolean` | Zda automaticky odpovídat na serverové `ping` zprávy |

### Stav

```typescript
get state(): TransportState
get isConnected(): boolean
```

`TransportState` je jeden z: `'idle'`, `'connecting'`, `'connected'`, `'disconnected'`.

Počáteční stav je `'idle'` (před prvním voláním `connect()`). Po uzavření spojení se stav změní na `'disconnected'`.

### connect()

```typescript
connect(): Promise<void>
```

Otevře nové WebSocket spojení. Promise se vyřeší při události `open`, nebo se odmítne pokud:
- Spojení vyprší (po `connectTimeoutMs`)
- WebSocket se uzavře během handshake

Pokud je transport již `'connected'` nebo `'connecting'`, volání se vyřeší okamžitě (no-op).

### disconnect()

```typescript
disconnect(code?: number, reason?: string): Promise<void>
```

Uzavře WebSocket. Výchozí kód `1000` a důvod `'Client disconnect'`. Vyřeší se při události `close`. No-op pokud je již `'disconnected'` nebo `'idle'`.

### send()

```typescript
send(data: string): void
```

Odešle textovou zprávu přes WebSocket. Vyhodí výjimku, pokud transport není připojen.

### on()

```typescript
on<K extends keyof TransportEventMap>(event: K, handler: TransportEventMap[K]): Unsubscribe
```

Zaregistruje posluchač události na úrovni transportu.

**Události transportu:**

| Událost | Signatura handleru | Popis |
|---------|-------------------|-------|
| `open` | `() => void` | WebSocket spojení otevřeno |
| `close` | `(code: number, reason: string) => void` | WebSocket spojení uzavřeno |
| `message` | `(data: string) => void` | Přijata zpráva (heartbeat pingy jsou odfiltrovány) |
| `error` | `(error: Error) => void` | Došlo k chybě WebSocket |

---

## Heartbeat

Když je `heartbeat` povolen (výchozí stav), transport automaticky zpracovává serverový heartbeat protokol:

1. Server odešle `{ "type": "ping", "timestamp": <number> }`.
2. Transport odpoví `{ "type": "pong", "timestamp": <stejné číslo> }`.
3. Ping zpráva **není** předána posluchačům události `message`.

Tímto se udržuje spojení aktivní a server může detekovat neaktivní připojení. Heartbeat zpracování je transparentní pro zbytek klienta — není potřeba žádný aplikační kód.

---

## ReconnectStrategy

Vypočítává backoff prodlevy pro automatickou reconnect smyčku v `NoexClient`.

### Konstruktor

```typescript
new ReconnectStrategy(options?: ReconnectOptions)
```

Všechny parametry jsou volitelné a používají výchozí hodnoty z [Konfigurace](./02-configuration.md#reconnectoptions).

### getDelay()

```typescript
getDelay(attempt: number): number | null
```

Vrací prodlevu v milisekundách před daným pokusem, nebo `null` pokud byl dosažen `maxRetries` (signál pro ukončení reconnect smyčky).

**Parametry:**

| Název | Typ | Popis |
|-------|-----|-------|
| attempt | `number` | Index pokusu (začíná od nuly) |

**Vzorec:**

```
base  = initialDelayMs * backoffMultiplier ^ attempt
delay = min(base, maxDelayMs) + random(0, jitterMs)
```

**Výchozí progrese** (s výchozí konfigurací):

| Pokus | Základní prodleva | Max omezení | + Jitter (0–500 ms) |
|-------|------------------|-------------|---------------------|
| 0 | 1 000 ms | 1 000 ms | 1 000 – 1 500 ms |
| 1 | 2 000 ms | 2 000 ms | 2 000 – 2 500 ms |
| 2 | 4 000 ms | 4 000 ms | 4 000 – 4 500 ms |
| 3 | 8 000 ms | 8 000 ms | 8 000 – 8 500 ms |
| 4 | 16 000 ms | 16 000 ms | 16 000 – 16 500 ms |
| 5+ | 32 000+ ms | 30 000 ms | 30 000 – 30 500 ms |

---

## Životní cyklus spojení

Kompletní životní cyklus spojení spravovaný třídou `NoexClient`:

```
1. client.connect()
   ├─ transport.connect()          — otevřít WebSocket
   ├─ waitForWelcome()             — parsovat { type: 'welcome', ... }
   ├─ auth.login() (pokud nastaven)— automatická autentizace
   └─ emit 'connected', 'welcome'

2. Normální provoz
   ├─ requestManager.send()        — odeslat typovaný request, čekat na odpověď
   ├─ pushRouter.handleMessage()   — směrovat push zprávy na subscripce
   └─ transport heartbeat          — auto pong na server ping

3. Ztráta spojení (neočekávané uzavření)
   ├─ requestManager.rejectAll()   — odmítnout čekající requesty
   ├─ state → 'reconnecting'
   └─ reconnect smyčka:
       ├─ reconnectStrategy.getDelay(attempt)
       ├─ sleep (s podporou přerušení)
       ├─ transport.connect() + waitForWelcome()
       ├─ auth.login() (pokud potřeba)
       ├─ subscriptionManager.resubscribeAll()
       └─ emit 'connected', 'reconnected', 'welcome'

4. client.disconnect()
   ├─ přerušit reconnect smyčku (pokud běží)
   ├─ requestManager.rejectAll()
   ├─ subscriptionManager.clear()
   └─ transport.disconnect(1000)
```

---

## Kompatibilita WebSocket

Transport přijímá jakýkoli objekt vyhovující rozhraní `WebSocketLike` — díky tomu je kompatibilní jak s nativním `WebSocket` v prohlížeči, tak s Node.js balíčkem `ws`:

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

type WebSocketConstructor = new (url: string) => WebSocketLike;
```

V prohlížečích je `globalThis.WebSocket` detekován automaticky. V Node.js předejte balíček `ws`:

```typescript
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:3000', { WebSocket });
```

---

## Viz také

- [NoexClient](./01-noex-client.md) — Životní cyklus klienta a chování při reconnectu
- [Konfigurace](./02-configuration.md) — ReconnectOptions a nastavení timeoutů
- [Typy](./09-types.md) — WebSocketLike, WebSocketConstructor, ConnectionState
- [Chyby](./10-errors.md) — DisconnectedError, TimeoutError
