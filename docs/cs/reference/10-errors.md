# Chyby

Třídy chyb vyhazované knihovnou `noex-client`. Všechny chyby rozšiřují základní třídu `NoexClientError`, která nese strojově čitelný `code` vedle lidsky čitelného `message`.

## Import

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@anthropic/noex-client';
```

---

## NoexClientError

```typescript
class NoexClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown);
}
```

Základní třída pro všechny chyby noex-client. Používá se i přímo pro chyby ze serveru — pole `code` obsahuje kód chyby serveru a `details` nese volitelná strukturovaná data ze serverové odpovědi.

**Vlastnosti:**

| Název | Typ | Popis |
|-------|-----|-------|
| code | `string` | Strojově čitelný kód chyby |
| message | `string` | Lidsky čitelný popis chyby |
| details | `unknown` | Volitelná strukturovaná data ze serveru |
| name | `string` | Vždy `'NoexClientError'` |

**Příklad:**

```typescript
try {
  await client.store.bucket('users').get('non-existent');
} catch (err) {
  if (err instanceof NoexClientError) {
    console.error(err.code);    // 'NOT_FOUND'
    console.error(err.message); // 'Record not found'
  }
}
```

---

## TimeoutError

```typescript
class TimeoutError extends NoexClientError {
  constructor(message: string);
}
```

Vyhozena, pokud server neodpoví na požadavek v nastaveném limitu `requestTimeoutMs`. Kód je vždy `'TIMEOUT'`.

**Vlastnosti:**

| Název | Typ | Popis |
|-------|-----|-------|
| code | `string` | Vždy `'TIMEOUT'` |
| name | `string` | Vždy `'TimeoutError'` |

**Příklad:**

```typescript
import { TimeoutError } from '@anthropic/noex-client';

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error('Server neodpověděl včas');
  }
}
```

---

## DisconnectedError

```typescript
class DisconnectedError extends NoexClientError {
  constructor(message?: string);
}
```

Vyhozena při pokusu o operaci, když klient není ve stavu `'connected'`, nebo když je čekající požadavek odmítnut kvůli ztrátě spojení. Kód je vždy `'DISCONNECTED'`. Výchozí zpráva: `'Not connected'`.

**Vlastnosti:**

| Název | Typ | Popis |
|-------|-----|-------|
| code | `string` | Vždy `'DISCONNECTED'` |
| name | `string` | Vždy `'DisconnectedError'` |

**Příklad:**

```typescript
import { DisconnectedError } from '@anthropic/noex-client';

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    console.error('Nejsme připojeni k serveru');
  }
}
```

---

## Chybové kódy serveru

Když server odmítne požadavek, klient vyhodí `NoexClientError` s jedním z následujících kódů:

| Kód | Popis |
|-----|-------|
| `PARSE_ERROR` | Server nedokázal zparsovat příchozí zprávu |
| `INVALID_REQUEST` | Struktura zprávy je neplatná (chybí `type` nebo `id`) |
| `UNKNOWN_OPERATION` | Požadovaný typ operace není rozpoznán |
| `VALIDATION_ERROR` | Payload požadavku neprošel validací (chybějící/neplatná pole) |
| `NOT_FOUND` | Požadovaný záznam nebo zdroj neexistuje |
| `ALREADY_EXISTS` | Zdroj již existuje (např. duplicitní insert) |
| `CONFLICT` | Operace je v konfliktu s aktuálním stavem (např. nesouhlasí verze) |
| `UNAUTHORIZED` | Vyžadována autentizace nebo neplatné přihlašovací údaje |
| `FORBIDDEN` | Autentizován, ale nedostatečná oprávnění |
| `RATE_LIMITED` | Požadavek odmítnut kvůli rate limitingu |
| `BACKPRESSURE` | Server je přetížen, klient by měl zkusit znovu později |
| `INTERNAL_ERROR` | Neočekávaná chyba na straně serveru |
| `BUCKET_NOT_DEFINED` | Odkazovaný bucket není definován ve store |
| `QUERY_NOT_DEFINED` | Odkazovaný query není definován ve store |
| `RULES_NOT_AVAILABLE` | Rules engine není nakonfigurován na serveru |

**Příklad:**

```typescript
try {
  await client.store.bucket('orders').insert({ total: -1 });
} catch (err) {
  if (err instanceof NoexClientError) {
    switch (err.code) {
      case 'VALIDATION_ERROR':
        console.error('Neplatná data:', err.details);
        break;
      case 'UNAUTHORIZED':
        console.error('Nejprve se přihlaste');
        break;
      case 'RATE_LIMITED':
        console.error('Příliš mnoho požadavků, zpomalte');
        break;
    }
  }
}
```

---

## Hierarchie chyb

```
Error
 └─ NoexClientError          (code, message, details)
     ├─ TimeoutError          (code = 'TIMEOUT')
     └─ DisconnectedError     (code = 'DISCONNECTED')
```

Všechny tři třídy jsou exportovány z balíčku. Serverové chyby přicházejí jako prosté instance `NoexClientError` — rozlišujte je pomocí vlastnosti `code`.

---

## Viz také

- [Typy](./09-types.md) — Sdílené typové definice
- [Konfigurace](./02-configuration.md) — Nastavení timeoutů ovlivňující chování chyb
- [NoexClient](./01-noex-client.md) — Životní cyklus klienta a události spojení
