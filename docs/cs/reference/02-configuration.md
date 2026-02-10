# Konfigurace

Konfigurační možnosti klienta a jejich výchozí hodnoty. Konfigurace se předává jako druhý argument konstruktoru `NoexClient`.

## Import

```typescript
import type { ClientOptions, ReconnectOptions } from '@anthropic/noex-client';
```

---

## ClientOptions

```typescript
interface ClientOptions {
  readonly auth?: {
    readonly token: string;
  };
  readonly reconnect?: boolean | ReconnectOptions;
  readonly requestTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly WebSocket?: WebSocketConstructor;
  readonly heartbeat?: boolean;
}
```

**Pole:**

| Název | Typ | Výchozí | Popis |
|-------|-----|---------|-------|
| auth | `{ token: string }` | — | Automatické přihlášení. Pokud je nastaveno a server vyžaduje autentizaci, `auth.login(token)` se zavolá automaticky po připojení |
| reconnect | `boolean \| ReconnectOptions` | `true` | Automatické znovupřipojení. `true` použije výchozí hodnoty, `false` zakáže, nebo předejte `ReconnectOptions` pro jemné ladění |
| requestTimeoutMs | `number` | `10000` | Timeout pro jednotlivé požadavky (ms). `TimeoutError` je vyhozena, pokud server neodpoví v tomto okně |
| connectTimeoutMs | `number` | `5000` | Timeout pro počáteční WebSocket spojení a welcome zprávu (ms) |
| WebSocket | `WebSocketConstructor` | `globalThis.WebSocket` | Vlastní konstruktor WebSocket. Povinný v Node.js — předejte balíček `ws` |
| heartbeat | `boolean` | `true` | Automatické heartbeat (pong) odpovědi. Nastavte na `false` pro vypnutí |

**Příklad:**

```typescript
import { NoexClient } from '@anthropic/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:3000', {
  auth: { token: 'my-secret-token' },
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 500,
  },
  requestTimeoutMs: 15_000,
  connectTimeoutMs: 8_000,
  WebSocket,
});
```

---

## ReconnectOptions

```typescript
interface ReconnectOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly jitterMs?: number;
}
```

Jemné nastavení strategie exponenciálního backoff pro znovupřipojení.

**Pole:**

| Název | Typ | Výchozí | Popis |
|-------|-----|---------|-------|
| maxRetries | `number` | `Infinity` | Maximální počet pokusů o znovupřipojení |
| initialDelayMs | `number` | `1000` | Prodleva před prvním pokusem o znovupřipojení (ms) |
| maxDelayMs | `number` | `30000` | Horní limit prodlevy backoff (ms) |
| backoffMultiplier | `number` | `2` | Násobič aplikovaný na prodlevu po každém neúspěšném pokusu |
| jitterMs | `number` | `500` | Náhodný jitter přidaný ke každé prodlevě pro prevenci thundering herd efektu (ms) |

Efektivní prodleva pro pokus `n` je:

```
delay = min(initialDelayMs * backoffMultiplier^n, maxDelayMs) + random(0, jitterMs)
```

**Příklad:**

```typescript
const client = new NoexClient('ws://localhost:3000', {
  reconnect: {
    maxRetries: 20,
    initialDelayMs: 500,
    maxDelayMs: 60_000,
    backoffMultiplier: 1.5,
    jitterMs: 200,
  },
});
```

---

## Výchozí hodnoty

Souhrn všech výchozích hodnot definovaných v klientovi:

| Konstanta | Hodnota | Použito v |
|-----------|---------|-----------|
| `DEFAULT_REQUEST_TIMEOUT_MS` | `10000` | `ClientOptions.requestTimeoutMs` |
| `DEFAULT_CONNECT_TIMEOUT_MS` | `5000` | `ClientOptions.connectTimeoutMs` |
| `DEFAULT_RECONNECT.maxRetries` | `Infinity` | `ReconnectOptions.maxRetries` |
| `DEFAULT_RECONNECT.initialDelayMs` | `1000` | `ReconnectOptions.initialDelayMs` |
| `DEFAULT_RECONNECT.maxDelayMs` | `30000` | `ReconnectOptions.maxDelayMs` |
| `DEFAULT_RECONNECT.backoffMultiplier` | `2` | `ReconnectOptions.backoffMultiplier` |
| `DEFAULT_RECONNECT.jitterMs` | `500` | `ReconnectOptions.jitterMs` |

---

## Viz také

- [NoexClient](./01-noex-client.md) — Konstruktor klienta a životní cyklus
- [Transport](./08-transport.md) — WebSocket transport a detaily znovupřipojení
- [Chyby](./10-errors.md) — TimeoutError a DisconnectedError
- [Typy](./09-types.md) — WebSocketConstructor a WebSocketLike
