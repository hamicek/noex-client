# Typy chyb

SDK používá typovanou hierarchii chyb, takže můžete chyby přesně zachytávat a klasifikovat. Každá chyba ze serveru nebo ze samotného SDK je instancí jedné ze tří tříd a serverové chyby nesou strojově čitelný `code` pro programatické zpracování.

## Co se naučíte

- Tři třídy chyb: `NoexClientError`, `TimeoutError`, `DisconnectedError`
- Všechny serverové chybové kódy a kdy se vyskytují
- Jak zachytávat chyby podle třídy a kódu
- Jak chyby procházejí pipeline požadavek/odpověď

## Hierarchie chyb

```
Error
 └─ NoexClientError          code: string, details?: unknown
     ├─ TimeoutError          code: 'TIMEOUT'
     └─ DisconnectedError     code: 'DISCONNECTED'
```

Všechny tři jsou exportovány z balíčku:

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';
```

## NoexClientError

Základní třída pro všechny chyby SDK. Každá chyba ze serveru je zabalena do `NoexClientError` s chybovým kódem a zprávou serveru:

```typescript
class NoexClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown);
}
```

| Vlastnost | Typ | Popis |
|-----------|-----|-------|
| `code` | `string` | Strojově čitelný chybový kód (např. `'VALIDATION_ERROR'`, `'NOT_FOUND'`) |
| `message` | `string` | Lidsky čitelný popis chyby |
| `details` | `unknown` | Volitelná strukturovaná data (např. detaily validační chyby) |
| `name` | `string` | Vždy `'NoexClientError'` |

```typescript
try {
  await client.store.bucket('nonexistent').all();
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // 'BUCKET_NOT_DEFINED'
    console.log(err.message); // 'Bucket "nonexistent" is not defined'
    console.log(err.details); // undefined nebo strukturovaná informace
  }
}
```

## TimeoutError

Vyhozen, když požadavek nedostane odpověď v rámci `requestTimeoutMs` (výchozí: 10 000 ms):

```typescript
class TimeoutError extends NoexClientError {
  // code je vždy 'TIMEOUT'
  constructor(message: string);
}
```

```typescript
import { TimeoutError } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  requestTimeoutMs: 5_000, // 5 sekund
});

try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof TimeoutError) {
    // err.code === 'TIMEOUT'
    // err.message === 'Request store.bucket.all (id=1) timed out after 5000ms'
    console.log('Požadavku vypršel timeout');
  }
}
```

`TimeoutError` je podtřída `NoexClientError`, takže zachycení `NoexClientError` zachytí i timeouty.

## DisconnectedError

Vyhozen, když se pokusíte odeslat požadavek, zatímco klient není připojen, nebo když spojení vypadne během čekajícího požadavku:

```typescript
class DisconnectedError extends NoexClientError {
  // code je vždy 'DISCONNECTED'
  constructor(message?: string); // výchozí: 'Not connected'
}
```

Tato chyba se objeví ve dvou scénářích:

**1. Odeslání požadavku, když je klient odpojený nebo ve stavu reconnecting:**

```typescript
import { DisconnectedError } from '@hamicek/noex-client';

// Klient není připojen
try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    // err.code === 'DISCONNECTED'
    // err.message === 'Cannot send request — client is disconnected'
    console.log('Nepřipojeno');
  }
}
```

**2. Spojení vypadne, zatímco požadavek čeká:**

```typescript
// Spojení vypadne po odeslání požadavku, ale před příchodem odpovědi
try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    // err.code === 'DISCONNECTED'
    // err.message === 'Connection lost'
    console.log('Spojení ztraceno během požadavku');
  }
}
```

## Serverové chybové kódy

Když server odmítne požadavek, SDK zabalí odpověď do `NoexClientError` s chybovým kódem serveru. Zde jsou všechny definované kódy:

| Kód | Popis | Typická příčina |
|-----|-------|-----------------|
| `PARSE_ERROR` | Server nedokázal zpracovat zprávu | Chybně formátovaný JSON (s SDK by se nemělo stát) |
| `INVALID_REQUEST` | Struktura zprávy je neplatná | Chybějící povinná pole (s SDK by se nemělo stát) |
| `UNKNOWN_OPERATION` | Typ požadavku není rozpoznán | Překlep v typu požadavku nebo nepodporovaná operace |
| `VALIDATION_ERROR` | Vstupní data neprošla validací | Chybějící povinná pole, špatné typy, porušení schématu |
| `NOT_FOUND` | Požadovaný zdroj neexistuje | Hledání záznamu podle klíče, který neexistuje |
| `ALREADY_EXISTS` | Záznam s tímto klíčem už existuje | Vkládání duplicitního klíče |
| `CONFLICT` | Konflikt verzí při aktualizaci | Porušení optimistické souběžnosti |
| `UNAUTHORIZED` | Autentizace vyžadována, ale neposkytnutá | Operace bez přihlášení na chráněném serveru |
| `FORBIDDEN` | Autentizován, ale nedostatečná oprávnění | Přístup zamítnut na základě role |
| `RATE_LIMITED` | Příliš mnoho požadavků | Překročení serverových rate limitů |
| `BACKPRESSURE` | Server je přetížen | Příliš mnoho souběžných operací, server tlačí zpět |
| `INTERNAL_ERROR` | Neočekávaná chyba serveru | Bug na straně serveru nebo problém s infrastrukturou |
| `BUCKET_NOT_DEFINED` | Bucket neexistuje | Přístup k nedefinovanému názvu bucketu |
| `QUERY_NOT_DEFINED` | Dotaz neexistuje | Odběr nedefinovaného názvu dotazu |
| `RULES_NOT_AVAILABLE` | Rules engine není nakonfigurován | Volání rules API na serveru bez rules |

## Klientské chybové kódy

Tyto kódy generuje samotné SDK, nikoliv server:

| Kód | Třída chyby | Popis |
|-----|-------------|-------|
| `TIMEOUT` | `TimeoutError` | Požadavku vypršel timeout (žádná odpověď v rámci `requestTimeoutMs`) |
| `DISCONNECTED` | `DisconnectedError` | Nepřipojeno nebo ztráta spojení během požadavku |

## Zachytávání chyb podle třídy

Použijte `instanceof` pro zachytávání chyb na správné úrovni specifičnosti:

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';

try {
  await client.store.bucket('users').insert({ name: 'Alice' });
} catch (err) {
  if (err instanceof DisconnectedError) {
    // Problém se spojením — nelze odeslat požadavek
    console.log('Nepřipojeno');
  } else if (err instanceof TimeoutError) {
    // Server neodpověděl včas
    console.log('Požadavku vypršel timeout');
  } else if (err instanceof NoexClientError) {
    // Server vrátil chybu
    switch (err.code) {
      case 'VALIDATION_ERROR':
        console.log('Neplatná data:', err.message);
        break;
      case 'ALREADY_EXISTS':
        console.log('Záznam už existuje');
        break;
      case 'UNAUTHORIZED':
        console.log('Nejprve se musíte přihlásit');
        break;
      default:
        console.log(`Chyba serveru [${err.code}]: ${err.message}`);
    }
  } else {
    // Neočekávaná chyba (nepochází z SDK)
    throw err;
  }
}
```

Na pořadí záleží -- kontrolujte podtřídy dříve, než základní třídu:

```typescript
// Špatné pořadí — NoexClientError zachytí všechno, TimeoutError se nikdy nedostane na řadu
catch (err) {
  if (err instanceof NoexClientError) { ... }
  else if (err instanceof TimeoutError) { ... }  // Nikdy se nedostane sem!
}

// Správné pořadí — nejprve specifické podtřídy
catch (err) {
  if (err instanceof TimeoutError) { ... }        // Nejspecifičtější
  else if (err instanceof DisconnectedError) { ... }
  else if (err instanceof NoexClientError) { ... } // Záchyt pro všechny serverové chyby
}
```

## Tok chyb

```
Klient odesílá požadavek
  │
  ├─ Nepřipojeno? ──────────────────► throw DisconnectedError
  │
  ├─ Požadavek odeslán, čeká se...
  │   │
  │   ├─ Spojení vypadne ───────────► reject s DisconnectedError
  │   │
  │   ├─ Timeout vypršel ───────────► reject s TimeoutError
  │   │
  │   ├─ Server odpovídá { type: 'error', code, message }
  │   │   └─────────────────────────► reject s NoexClientError(code, message)
  │   │
  │   └─ Server odpovídá { type: 'result', data }
  │       └─────────────────────────► resolve s data
```

## Kompletní funkční příklad

```typescript
import {
  NoexClient,
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    requestTimeoutMs: 5_000,
    reconnect: false,
  });

  await client.connect();

  const bucket = client.store.bucket('users');

  // Příklad 1: Serverová validační chyba
  try {
    await bucket.insert({}); // Chybí povinné pole 'name'
  } catch (err) {
    if (err instanceof NoexClientError && err.code === 'VALIDATION_ERROR') {
      console.log('Validace selhala:', err.message);
    }
  }

  // Příklad 2: Bucket není definován
  try {
    await client.store.bucket('nonexistent').all();
  } catch (err) {
    if (err instanceof NoexClientError && err.code === 'BUCKET_NOT_DEFINED') {
      console.log('Bucket neexistuje:', err.message);
    }
  }

  // Příklad 3: DisconnectedError po odpojení
  await client.disconnect();
  try {
    await bucket.all();
  } catch (err) {
    if (err instanceof DisconnectedError) {
      console.log('Nelze operovat:', err.message); // 'Cannot send request — client is disconnected'
    }
  }
}

main().catch(console.error);
```

## Cvičení

Napište funkci `classifyError(err: unknown)`, která:
1. Vrátí `'disconnected'` pro `DisconnectedError`
2. Vrátí `'timeout'` pro `TimeoutError`
3. Vrátí chybový kód (např. `'VALIDATION_ERROR'`) pro ostatní instance `NoexClientError`
4. Vrátí `'unknown'` pro cokoliv jiného

Poté ji otestujte s každým typem chyby.

<details>
<summary>Řešení</summary>

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';

function classifyError(err: unknown): string {
  if (err instanceof DisconnectedError) return 'disconnected';
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof NoexClientError) return err.code;
  return 'unknown';
}

// Test
console.log(classifyError(new DisconnectedError()));           // 'disconnected'
console.log(classifyError(new TimeoutError('timed out')));     // 'timeout'
console.log(classifyError(
  new NoexClientError('VALIDATION_ERROR', 'bad input'),
));                                                             // 'VALIDATION_ERROR'
console.log(classifyError(
  new NoexClientError('NOT_FOUND', 'missing'),
));                                                             // 'NOT_FOUND'
console.log(classifyError(new Error('random')));               // 'unknown'
console.log(classifyError('not an error'));                     // 'unknown'
```

</details>

## Shrnutí

- **`NoexClientError`** -- základní třída pro všechny chyby SDK; nese `code`, `message` a volitelné `details`
- **`TimeoutError`** -- požadavku vypršel timeout (`code: 'TIMEOUT'`); podtřída `NoexClientError`
- **`DisconnectedError`** -- nepřipojeno nebo ztráta spojení (`code: 'DISCONNECTED'`); podtřída `NoexClientError`
- Serverové chyby používají 15 odlišných kódů pokrývajících validaci, auth, rate limiting a další
- Vždy zachytávejte podtřídy (`TimeoutError`, `DisconnectedError`) dříve než základní třídu (`NoexClientError`)
- Použijte `err.code` pro přepínání na specifické serverové chybové kódy
- `DisconnectedError` je vyhozen synchronně při odesílání požadavků v nepřipojeném stavu

---

Další: [Strategie obnovy](./02-strategie-obnovy.md)
