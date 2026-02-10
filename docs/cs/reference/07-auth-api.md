# Auth API

Třída `AuthAPI` poskytuje metody pro autentizaci — přihlášení tokenem, odhlášení a dotaz na aktuální session. Je dostupná jako vlastnost `auth` na `NoexClient`.

## Import

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:3000');
await client.connect();

const auth = client.auth;
```

Relevantní typy:

```typescript
import type { AuthSession } from '@hamicek/noex-client';
```

---

## Metody

### login()

```typescript
login(token: string): Promise<AuthSession>
```

Autentizuje spojení daným tokenem. Server token zvaliduje a v případě úspěchu přiřadí spojení session. Pokud je spojení již autentizováno, opětovné volání `login()` nahradí aktuální session.

**Parametry:**

| Název | Typ | Povinný | Popis |
|-------|-----|---------|-------|
| token | `string` | ano | Autentizační token (např. JWT, API klíč) |

**Návratová hodnota:** `Promise<AuthSession>` — autentizovaná session s `userId`, `roles` a volitelným `expiresAt`

**Vyhazuje:**
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je `token` prázdný nebo není řetězec
- `NoexClientError` s kódem `UNAUTHORIZED` pokud je token neplatný nebo expirovaný
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const session = await auth.login('my-secret-token');
console.log(`Přihlášen jako ${session.userId}`);
console.log(`Role: ${session.roles.join(', ')}`);
```

---

### logout()

```typescript
logout(): Promise<void>
```

Ukončí aktuální session. Server vymaže stav autentizace pro toto spojení. Volání `logout()` bez aktivní session je bezpečné — proběhne tiše bez chyby.

**Návratová hodnota:** `Promise<void>`

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
await auth.logout();
```

---

### whoami()

```typescript
whoami(): Promise<AuthSession | null>
```

Vrátí aktuální session pokud je klient autentizován, nebo `null` pokud není. Tato metoda také detekuje expirované session — pokud session vypršela od posledního požadavku, server vymaže stav a vrátí `null`.

**Návratová hodnota:** `Promise<AuthSession | null>` — aktuální session, nebo `null` pokud klient není autentizován

**Vyhazuje:**
- `TimeoutError` pokud server neodpoví v rámci časového limitu požadavku
- `DisconnectedError` pokud klient není připojen

**Příklad:**

```typescript
const session = await auth.whoami();
if (session) {
  console.log(`Autentizován jako ${session.userId}`);
  if (session.expiresAt) {
    const remaining = session.expiresAt - Date.now();
    console.log(`Session vyprší za ${Math.round(remaining / 1000)}s`);
  }
} else {
  console.log('Neautentizován');
}
```

---

## Automatické přihlášení

Pokud je nastaven `ClientOptions.auth.token`, `NoexClient` automaticky zavolá `auth.login()` během `connect()`, pokud server vyžaduje autentizaci (indikováno `welcome.requiresAuth === true`).

```typescript
const client = new NoexClient('ws://localhost:3000', {
  auth: { token: 'my-secret-token' },
});

// connect() automaticky zavolá auth.login() pokud server vyžaduje autentizaci
const welcome = await client.connect();
```

Automatické přihlášení probíhá i při reconnectu — klient se znovu autentizuje stejným tokenem před obnovením subscripcí.

**Sekvence při connect:**

1. WebSocket spojení je navázáno
2. Server odešle zprávu `welcome` s příznakem `requiresAuth`
3. Pokud `requiresAuth === true` a je nastaven `options.auth.token`, zavolá se `auth.login(token)`
4. Jsou emitovány eventy `connected` a `welcome`

**Sekvence při reconnectu:**

1. WebSocket spojení je znovu navázáno
2. Server odešle zprávu `welcome`
3. Pokud `requiresAuth === true` a je nastaven `options.auth.token`, zavolá se `auth.login(token)`
4. Aktivní subscripce jsou obnoveny přes `SubscriptionManager.resubscribeAll()`
5. Jsou emitovány eventy `connected`, `reconnected` a `welcome`

Pokud automatické přihlášení selže (např. token vypršel), pokus o reconnect je považován za neúspěšný a klient pokus opakuje podle strategie reconnectu.

---

## Životní cyklus session

```
┌─────────────┐      login()       ┌───────────────┐
│ Bez session  │ ────────────────▶  │ Autentizováno  │
│ whoami→null  │                    │ whoami→session │
└─────────────┘                    └───────────────┘
       ▲                                  │
       │           logout()               │
       │◀──────────────────────────────────│
       │                                  │
       │      session vypršela            │
       │◀──────────────────────────────────│
       │                                  │
       │      spojení ztraceno            │
       │◀──────────────────────────────────│
```

- **Autentizace** je per-connection — nové spojení začíná neautentizované
- **Opětovná autentizace** je možná kdykoli opětovným voláním `login()`
- **Odhlášení** je idempotentní — volání v neautentizovaném stavu je bezpečné
- **Expirace** je kontrolována na straně serveru — když session vyprší, následné `whoami()` vrátí `null`
- **Reconnect** vytváří nové spojení, takže je nutná opětovná autentizace (řešeno automaticky pokud je nastaven `auth.token`)

---

## Typy

### AuthSession

```typescript
interface AuthSession {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly expiresAt?: number;
}
```

| Pole | Typ | Popis |
|------|-----|-------|
| userId | `string` | Unikátní identifikátor uživatele |
| roles | `readonly string[]` | Pole názvů rolí přidělených uživateli |
| metadata | `Record<string, unknown>` | Volitelná metadata přiřazená k session |
| expiresAt | `number` | Volitelný Unix timestamp (ms) kdy session vyprší |

---

## Viz také

- [NoexClient](./01-noex-client.md) — životní cyklus připojení, vlastnost `auth`, automatické přihlášení v `connect()`
- [Konfigurace](./02-configuration.md) — `ClientOptions.auth`, `requestTimeoutMs`
- [Transport](./08-transport.md) — strategie reconnectu, opětovná autentizace při reconnectu
- [Typy](./09-types.md) — `AuthSession`
- [Chyby](./10-errors.md) — `NoexClientError`, `TimeoutError`, `DisconnectedError`
