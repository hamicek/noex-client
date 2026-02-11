# Přihlášení a odhlášení

Noex server může vyžadovat autentizaci před povolením přístupu k store a rules operacím. Klientské SDK poskytuje tři metody: `auth.login()` pro ověření tokenem, `auth.whoami()` pro inspekci aktuální relace a `auth.logout()` pro její ukončení. Autentizace je per-connection — každé nové připojení začíná neověřené.

## Co se naučíte

- Jak zjistit, zda server vyžaduje autentizaci
- Jak se autentizovat pomocí `auth.login()` a inspektovat relaci
- Jak dotazovat aktuální relaci pomocí `auth.whoami()`
- Jak ukončit relaci pomocí `auth.logout()`
- Struktura `AuthSession` (userId, roles, expiresAt, metadata)
- Jak autentizace řídí přístup ke store a rules operacím

## Průběh autentizace

```
Klient                              Server
┌──────────────┐   connect()       ┌──────────────────────────┐
│              │──────────────────>│ WebSocket otevřen         │
│              │   welcome         │                          │
│              │<──────────────────│ { requiresAuth: true }   │
│              │                   │                          │
│              │   auth.login()    │                          │
│ auth.login() │──────────────────>│ Validace tokenu          │
│              │   AuthSession     │                          │
│              │<──────────────────│ { userId, roles, ... }   │
│              │                   │                          │
│              │   store / rules   │                          │
│   operace    │──────────────────>│ Povoleno (ověřeno)       │
└──────────────┘                   └──────────────────────────┘
```

Server signalizuje, zda je autentizace vyžadována, prostřednictvím pole `requiresAuth` ve welcome zprávě. Když je `requiresAuth` nastaveno na `true`, všechny store a rules operace jsou odmítnuty, dokud `auth.login()` neuspěje.

## Kontrola requiresAuth

Metoda `connect()` vrací objekt `WelcomeInfo`, který obsahuje příznak `requiresAuth`:

```typescript
const welcome = await client.connect();

if (welcome.requiresAuth) {
  console.log('Server vyžaduje autentizaci');
  await client.auth.login('my-token');
} else {
  console.log('Autentizace není vyžadována');
}
```

## auth.login()

Ověří připojení tokenem. Server validuje token a vrací `AuthSession`:

```typescript
const session = await client.auth.login('my-secret-token');
console.log(session.userId); // 'user-1'
console.log(session.roles);  // ['user']
```

**Signatura:**

```typescript
login(token: string): Promise<AuthSession>
```

| Parametr | Typ | Popis |
|----------|-----|-------|
| token | `string` | Autentizační token (např. JWT, API klíč) |

Vrací `Promise<AuthSession>` — ověřenou relaci.

**Vyhazuje:**
- `NoexClientError` s kódem `UNAUTHORIZED` pokud je token neplatný nebo expirovaný
- `NoexClientError` s kódem `VALIDATION_ERROR` pokud je token prázdný
- `TimeoutError` pokud server neodpoví včas
- `DisconnectedError` pokud klient není připojen

### Opětovné ověření

Volání `login()` při již aktivní autentizaci **nahradí** aktuální relaci. To je užitečné pro přepínání uživatelů nebo eskalaci oprávnění bez odpojení:

```typescript
// Přihlášení jako běžný uživatel
await client.auth.login('user-token');
let session = await client.auth.whoami();
console.log(session!.userId); // 'user-1'

// Přepnutí na admina
await client.auth.login('admin-token');
session = await client.auth.whoami();
console.log(session!.userId); // 'admin-1'
```

## AuthSession

Objekt relace vrácený z `login()` a `whoami()`:

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
| roles | `readonly string[]` | Role přiřazené uživateli (např. `['admin', 'editor']`) |
| metadata | `Record<string, unknown>` | Volitelná metadata připojená serverovou funkcí `validate` |
| expiresAt | `number` | Volitelný Unix timestamp (ms) expirace relace |

## auth.whoami()

Vrací aktuální relaci nebo `null` pokud není ověřen:

```typescript
const session = await client.auth.whoami();

if (session) {
  console.log(`Přihlášen jako ${session.userId}`);
  console.log(`Role: ${session.roles.join(', ')}`);

  if (session.expiresAt) {
    const remaining = session.expiresAt - Date.now();
    console.log(`Vyprší za ${Math.round(remaining / 1000)}s`);
  }
} else {
  console.log('Neověřen');
}
```

**Signatura:**

```typescript
whoami(): Promise<AuthSession | null>
```

Server kontroluje expiraci — pokud relace od posledního požadavku vypršela, `whoami()` vrátí `null`, přestože `login()` dříve uspěl.

## auth.logout()

Ukončí aktuální relaci:

```typescript
await client.auth.logout();
```

**Signatura:**

```typescript
logout(): Promise<void>
```

Logout je **idempotentní** — volání při neověřeném stavu tiše uspěje. Po odhlášení jsou store a rules operace opět odmítány (pokud je `requiresAuth` nastaveno na `true`).

## Životní cyklus relace

```
┌─────────────┐      login()       ┌───────────────┐
│  Bez relace  │ ────────────────> │ Ověřeno        │
│  whoami→null │                   │ whoami→session │
└─────────────┘                   └───────────────┘
       ▲                                 │
       │           logout()              │
       │<────────────────────────────────│
       │                                 │
       │      relace vypršela            │
       │<────────────────────────────────│
       │                                 │
       │      ztráta spojení             │
       │<────────────────────────────────│
```

Klíčové body:
- **Per-connection**: každé nové připojení (včetně po reconnectu) začíná neověřené
- **Opětovné přihlášení**: zavolejte `login()` znovu pro přepnutí relace
- **Idempotentní logout**: bezpečné volání i při neověřeném stavu
- **Serverová expirace**: expirované relace vrací `null` z `whoami()`

## Operace chráněné autentizací

Když server vyžaduje autentizaci, store a rules operace jsou odmítnuty s `NoexClientError`, dokud se klient neověří:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
const welcome = await client.connect();

if (welcome.requiresAuth) {
  // Toto selže — zatím není ověřeno
  try {
    await client.store.bucket('items').insert({ value: 42 });
  } catch (err) {
    if (err instanceof NoexClientError) {
      console.log(err.code); // chyba související s autentizací
    }
  }

  // Nejprve se ověřit
  await client.auth.login('valid-token');

  // Nyní to funguje
  const record = await client.store.bucket('items').insert({ value: 42 });
  console.log(record['value']); // 42
}
```

Po odhlášení jsou operace opět odmítány:

```typescript
await client.auth.logout();

// Toto selže — relace ukončena
try {
  await client.store.bucket('items').insert({ value: 1 });
} catch (err) {
  console.log('Odmítnuto po odhlášení');
}
```

## Kompletní funkční příklad

```typescript
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  const welcome = await client.connect();

  console.log(`Vyžaduje autentizaci: ${welcome.requiresAuth}`);

  if (!welcome.requiresAuth) {
    console.log('Server nevyžaduje autentizaci — přihlášení přeskočeno');
    await client.disconnect();
    return;
  }

  // Přihlášení
  try {
    const session = await client.auth.login('my-api-key');
    console.log(`Přihlášen jako ${session.userId}`);
    console.log(`Role: ${session.roles.join(', ')}`);
  } catch (err) {
    if (err instanceof NoexClientError && err.code === 'UNAUTHORIZED') {
      console.log('Neplatný token — autentizace selhala');
      await client.disconnect();
      return;
    }
    throw err;
  }

  // Kontrola aktuální relace
  const who = await client.auth.whoami();
  console.log(`Aktuální uživatel: ${who?.userId}`);

  // Provádění ověřených operací
  const items = client.store.bucket('items');
  const record = await items.insert({ name: 'Widget', price: 10 });
  console.log(`Vytvořena položka: ${record['name']}`);

  // Odhlášení
  await client.auth.logout();
  const afterLogout = await client.auth.whoami();
  console.log(`Po odhlášení: ${afterLogout}`); // null

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Připojí se k serveru a zkontroluje `welcome.requiresAuth`
2. Pokud je autentizace vyžadována, přihlásí se tokenem
3. Pomocí `whoami()` zobrazí role uživatele
4. Provede jednu store operaci (insert do bucketu `tasks`)
5. Odhlásí se a ověří, že `whoami()` vrací `null`
6. Pokusí se o další insert po odhlášení a zachytí chybu

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  const welcome = await client.connect();

  // 1. Kontrola requiresAuth
  console.log(`Vyžaduje autentizaci: ${welcome.requiresAuth}`);

  if (welcome.requiresAuth) {
    // 2. Přihlášení
    const session = await client.auth.login('valid-token');
    console.log(`Přihlášen jako ${session.userId}`);

    // 3. Zobrazení rolí
    const who = await client.auth.whoami();
    console.log(`Role: ${who!.roles.join(', ')}`);

    // 4. Provedení store operace
    const record = await client.store.bucket('tasks').insert({
      title: 'Review PR',
      done: false,
    });
    console.log(`Vytvořen úkol: ${record['title']}`);

    // 5. Odhlášení a ověření
    await client.auth.logout();
    const afterLogout = await client.auth.whoami();
    console.log(`Po odhlášení: ${afterLogout}`); // null

    // 6. Pokus o insert po odhlášení
    try {
      await client.store.bucket('tasks').insert({ title: 'Mělo by selhat' });
    } catch (err) {
      if (err instanceof NoexClientError) {
        console.log(`Odmítnuto: ${err.code}`);
      }
    }
  }

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `auth.login(token)` ověří připojení a vrátí `AuthSession`
- `auth.whoami()` vrací aktuální relaci nebo `null` pokud není ověřen
- `auth.logout()` ukončí relaci — idempotentní, bezpečné volání při neověřeném stavu
- Autentizace je per-connection — nová připojení začínají neověřená
- Opětovné přihlášení nahradí aktuální relaci bez odpojení
- `welcome.requiresAuth` indikuje, zda server vyžaduje autentizaci
- Když je `requiresAuth` nastaveno na `true`, store a rules operace jsou odmítány, dokud se klient neověří
- Expirace relace je kontrolována na straně serveru — `whoami()` vrací `null` pro expirované relace

---

Další: [Automatické přihlášení](./02-automaticke-prihlaseni.md)
