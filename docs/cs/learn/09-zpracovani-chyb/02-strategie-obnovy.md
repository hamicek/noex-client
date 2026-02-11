# Strategie obnovy

Znát typy chyb je jen polovina příběhu. Druhá polovina je rozhodování **co dělat**, když k jednotlivým chybám dojde. Tato kapitola pokrývá vzory pro opakování požadavků, graceful degradation a zpracování chyb v callbacích -- vše, co potřebujete pro stavbu odolných produkčních aplikací.

## Co se naučíte

- Které chyby je bezpečné opakovat a které ne
- Jak implementovat logiku opakování pro idempotentní operace
- Jak ošetřit chyby v callbacích odběrů
- Strategie graceful degradation, když je server nedostupný
- Jak mapovat chybové kódy na uživatelsky srozumitelné zprávy

## Bezpečnost opakování: idempotentní vs neídempotentní

Nejdůležitější otázka před opakováním neúspěšného požadavku je: **je tuto operaci bezpečné zopakovat?**

| Operace | Idempotentní? | Bezpečné opakovat? |
|---------|---------------|---------------------|
| `bucket.get(key)` | Ano | Ano |
| `bucket.all()` | Ano | Ano |
| `bucket.where(filter)` | Ano | Ano |
| `bucket.findOne(filter)` | Ano | Ano |
| `bucket.count()` | Ano | Ano |
| `bucket.update(key, data)` | Ano* | Ano (stejná data) |
| `bucket.delete(key)` | Ano | Ano (druhé smazání je no-op) |
| `bucket.insert(data)` | **Ne** | **Ne** -- může vytvořit duplicity |
| `rules.emit(topic, data)` | **Ne** | **Ne** -- může emitovat duplicitní eventy |
| `store.subscribe(query, cb)` | Ano | Ano |
| `store.transaction(ops)` | Záleží | Pouze pokud jsou všechny operace idempotentní |

\* `update` je idempotentní pouze tehdy, když nastavujete stejné hodnoty. Pokud aktualizace závisí na aktuálním stavu (např. inkrementace počítadla), **není** idempotentní.

## Vzor pro opakování idempotentních operací

```typescript
import {
  NoexClientError,
  TimeoutError,
  DisconnectedError,
} from '@hamicek/noex-client';

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1_000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Neopakovat neopravitelné chyby
      if (err instanceof NoexClientError) {
        switch (err.code) {
          case 'VALIDATION_ERROR':
          case 'BUCKET_NOT_DEFINED':
          case 'QUERY_NOT_DEFINED':
          case 'UNAUTHORIZED':
          case 'FORBIDDEN':
          case 'ALREADY_EXISTS':
          case 'UNKNOWN_OPERATION':
          case 'RULES_NOT_AVAILABLE':
            throw err; // Nemá smysl opakovat — vstup je chybný
        }
      }

      // Opakovat při timeout, disconnect, rate limit, conflict, internal error
      if (attempt < maxRetries) {
        const wait = err instanceof NoexClientError && err.code === 'RATE_LIMITED'
          ? delayMs * 2  // Více zpomalit při rate limitingu
          : delayMs;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw lastError;
}

// Použití
const users = await withRetry(() => client.store.bucket('users').all());
```

## Rozhodovací matice chybových kódů

| Chybový kód | Akce | Opakovat? |
|-------------|------|-----------|
| `TIMEOUT` | Požadavek mohl uspět -- zkontrolujte stav před opakováním | Pouze idempotentní |
| `DISCONNECTED` | Počkejte na reconnect, pak opakujte | Pouze idempotentní |
| `RATE_LIMITED` | Zpomalte, čekejte déle | Ano, se zpožděním |
| `BACKPRESSURE` | Snižte frekvenci požadavků | Ano, se zpožděním |
| `CONFLICT` | Znovu načtěte záznam, aplikujte změny, opakujte | Ano (read-modify-write) |
| `INTERNAL_ERROR` | Zalogujte pro vyšetření, opakujte jednou | Ano, jednou |
| `VALIDATION_ERROR` | Opravte vstupní data | Ne |
| `BUCKET_NOT_DEFINED` | Použijte správný název bucketu | Ne |
| `QUERY_NOT_DEFINED` | Použijte správný název dotazu | Ne |
| `UNAUTHORIZED` | Nejprve zavolejte `auth.login()` | Ne (re-auth, pak opakujte) |
| `FORBIDDEN` | Uživatel nemá oprávnění | Ne |
| `ALREADY_EXISTS` | Záznam existuje -- použijte `update` místo toho | Ne |
| `NOT_FOUND` | Záznam neexistuje -- ošetřete elegantně | Ne |
| `PARSE_ERROR` | Bug v SDK nebo neshoda protokolu | Ne |
| `INVALID_REQUEST` | Bug v SDK nebo neshoda protokolu | Ne |
| `UNKNOWN_OPERATION` | Nesoulad verzí klienta/serveru | Ne |
| `RULES_NOT_AVAILABLE` | Server nemá nakonfigurovaný rules engine | Ne |

## Ošetření stavu disconnected

Když se klient reconnectuje, všechny požadavky vyhodí `DisconnectedError`. Místo okamžitého opakování počkejte na obnovení spojení:

```typescript
import { DisconnectedError } from '@hamicek/noex-client';

async function waitForConnection(client: NoexClient, timeoutMs = 30_000): Promise<void> {
  if (client.isConnected) return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubConnected();
      unsubDisconnected();
      reject(new Error('Vypršel timeout při čekání na spojení'));
    }, timeoutMs);

    const unsubConnected = client.on('connected', () => {
      clearTimeout(timer);
      unsubConnected();
      unsubDisconnected();
      resolve();
    });

    const unsubDisconnected = client.on('disconnected', () => {
      clearTimeout(timer);
      unsubConnected();
      unsubDisconnected();
      reject(new Error('Klient se trvale odpojil'));
    });
  });
}

// Použití
try {
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    await waitForConnection(client);
    // Opakovat po reconnectu
    const users = await client.store.bucket('users').all();
  }
}
```

## Chyby v callbacích odběrů

Chyby vyhozené uvnitř callbacků odběrů se zpracovávají odlišně v závislosti na tom, kdy k nim dojde:

### Při doručení úvodních dat

Pokud callback vyhodí chybu při přijímání úvodních dat (první zavolání po `subscribe()`), odběr se **vyčistí** a promise z `subscribe()` se zamítne:

```typescript
try {
  await client.store.subscribe('all-users', (data) => {
    throw new Error('Selhalo zpracování úvodních dat');
  });
} catch (err) {
  // err.message === 'Selhalo zpracování úvodních dat'
  // Odběr byl vyčištěn — žádný únik
  // Klient zůstává funkční
}
```

### Při push aktualizacích

Pokud callback vyhodí chybu při následných push doručeních, chyba je **zachycena a zalogována** do `console.error`. Odběr zůstává aktivní a pokračuje v přijímání budoucích pushů:

```typescript
let callCount = 0;

await client.store.subscribe('user-count', (data) => {
  callCount++;
  if (callCount === 2) {
    throw new Error('Dočasná chyba zpracování');
    // Zalogováno do console.error, ale odběr pokračuje
  }
  console.log('Počet:', data);
});

// Po vyhození chyby:
// - Chyba zalogována do console.error
// - Odběr je stále aktivní
// - Další push zavolá callback znovu
```

### Osvědčený postup: chraňte své callbacky

```typescript
await client.store.subscribe('all-users', (data) => {
  try {
    const users = data as User[];
    updateUI(users);
  } catch (err) {
    // Ošetřete elegantně místo spoléhání na zachycení chyb v SDK
    console.error('Selhalo zpracování dat z odběru:', err);
    showErrorBanner('Aktualizace dat selhala');
  }
});
```

## Graceful degradation

Když je server nedostupný a reconnect zatím neuspěl, vaše aplikace by měla degradovat elegantně:

```typescript
import { NoexClient, DisconnectedError, NoexClientError } from '@hamicek/noex-client';
import WebSocket from 'ws';

class ResilientApp {
  private client: NoexClient;
  private lastKnownUsers: User[] = [];
  private isOnline = false;

  constructor(url: string) {
    this.client = new NoexClient(url, {
      WebSocket,
      reconnect: { maxRetries: Infinity },
    });

    this.client.on('connected', () => {
      this.isOnline = true;
      console.log('Online');
    });

    this.client.on('reconnecting', () => {
      this.isOnline = false;
      console.log('Offline — používám cachovaná data');
    });

    this.client.on('disconnected', () => {
      this.isOnline = false;
      console.log('Odpojeno');
    });
  }

  async start() {
    await this.client.connect();

    await this.client.store.subscribe('all-users', (data) => {
      this.lastKnownUsers = data as User[];
      console.log(`Uživatelé aktualizováni: ${this.lastKnownUsers.length}`);
    });
  }

  getUsers(): User[] {
    // Vždy vrátí data — živá nebo cachovaná
    return this.lastKnownUsers;
  }

  async addUser(name: string): Promise<boolean> {
    if (!this.isOnline) {
      console.log('Nelze přidat uživatele — offline');
      return false;
    }

    try {
      await this.client.store.bucket('users').insert({ name });
      return true;
    } catch (err) {
      if (err instanceof DisconnectedError) {
        console.log('Spojení ztraceno během operace');
        return false;
      }
      throw err;
    }
  }
}

interface User {
  id: string;
  name: string;
}
```

## Mapování chybových kódů na uživatelské zprávy

```typescript
function getUserMessage(err: unknown): string {
  if (err instanceof DisconnectedError) {
    return 'Jste momentálně offline. Zkontrolujte prosím své připojení.';
  }
  if (err instanceof TimeoutError) {
    return 'Server odpovídá příliš dlouho. Zkuste to prosím znovu.';
  }
  if (err instanceof NoexClientError) {
    switch (err.code) {
      case 'VALIDATION_ERROR':
        return 'Zkontrolujte prosím svůj vstup a zkuste to znovu.';
      case 'UNAUTHORIZED':
        return 'Vaše relace vypršela. Přihlaste se prosím znovu.';
      case 'FORBIDDEN':
        return 'Pro tuto akci nemáte oprávnění.';
      case 'NOT_FOUND':
        return 'Požadovaná položka nebyla nalezena.';
      case 'ALREADY_EXISTS':
        return 'Tato položka již existuje.';
      case 'RATE_LIMITED':
        return 'Příliš mnoho požadavků. Chvíli prosím počkejte.';
      case 'CONFLICT':
        return 'Data byla změněna někým jiným. Obnovte stránku a zkuste to znovu.';
      default:
        return 'Došlo k neočekávané chybě. Zkuste to prosím později.';
    }
  }
  return 'Něco se pokazilo.';
}
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
    reconnect: { maxRetries: 10 },
  });

  client.on('error', (err) => {
    console.error(`[chyba klienta] ${err.message}`);
  });

  await client.connect();
  const bucket = client.store.bucket('users');

  // Bezpečné vložení s ošetřením chyb
  async function createUser(name: string) {
    try {
      return await bucket.insert({ name });
    } catch (err) {
      if (err instanceof NoexClientError) {
        switch (err.code) {
          case 'VALIDATION_ERROR':
            console.log(`Neplatný vstup: ${err.message}`);
            return null;
          case 'ALREADY_EXISTS':
            console.log(`Uživatel "${name}" už existuje`);
            return null;
          case 'RATE_LIMITED':
            console.log('Rate limited — čekám...');
            await new Promise((r) => setTimeout(r, 2_000));
            return bucket.insert({ name }); // Opakovat jednou
          default:
            console.log(`Chyba serveru [${err.code}]: ${err.message}`);
            return null;
        }
      }
      if (err instanceof DisconnectedError) {
        console.log('Nepřipojeno — nelze vytvořit uživatele');
        return null;
      }
      throw err; // Neznámá chyba — vyhodit dál
    }
  }

  await createUser('Alice');
  await createUser('Bob');

  // Bezpečné čtení s opakováním
  async function getUsers() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await bucket.all();
      } catch (err) {
        if (err instanceof TimeoutError && attempt < 2) {
          console.log(`Timeout, opakuji (${attempt + 1}/2)...`);
          continue;
        }
        throw err;
      }
    }
  }

  const users = await getUsers();
  console.log('Uživatelé:', users);

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Vytvořte wrapper třídu `SafeBucket`, která:
1. Obaluje instanci `BucketAPI`
2. Poskytuje `safeGet(key)` -- vrací `null` místo vyhození chyby při `NOT_FOUND`
3. Poskytuje `safeInsert(data)` -- opakuje jednou při `RATE_LIMITED`, vrací `null` při `ALREADY_EXISTS`
4. Poskytuje `safeAll()` -- opakuje až 3x při `TIMEOUT`

<details>
<summary>Řešení</summary>

```typescript
import {
  NoexClientError,
  TimeoutError,
  type BucketAPI,
} from '@hamicek/noex-client';

class SafeBucket<T extends Record<string, unknown>> {
  constructor(private readonly bucket: BucketAPI<T>) {}

  async safeGet(key: unknown): Promise<(T & Record<string, unknown>) | null> {
    try {
      return await this.bucket.get(key);
    } catch (err) {
      if (err instanceof NoexClientError && err.code === 'NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  async safeInsert(data: T): Promise<(T & Record<string, unknown>) | null> {
    try {
      return await this.bucket.insert(data);
    } catch (err) {
      if (err instanceof NoexClientError) {
        if (err.code === 'ALREADY_EXISTS') return null;
        if (err.code === 'RATE_LIMITED') {
          await new Promise((r) => setTimeout(r, 1_000));
          return this.bucket.insert(data); // Opakovat jednou (bez catch — nechat vyhodit)
        }
      }
      throw err;
    }
  }

  async safeAll(): Promise<Array<T & Record<string, unknown>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.bucket.all();
      } catch (err) {
        lastError = err;
        if (!(err instanceof TimeoutError)) throw err;
        // TimeoutError — opakovat
      }
    }
    throw lastError;
  }
}

// Použití
// const safe = new SafeBucket(client.store.bucket('users'));
// const user = await safe.safeGet('nonexistent'); // null, ne chyba
// const all = await safe.safeAll(); // Opakuje až 3x při timeout
```

</details>

## Shrnutí

- **Idempotentní operace** (get, all, where, count, delete) je bezpečné opakovat; **insert a emit ne**
- Zkontrolujte `err.code` pro rozhodnutí o správné strategii obnovy pro každý typ chyby
- **Neopakujte** validační chyby, auth chyby nebo chyby "not defined" -- opravte hlavní příčinu
- **Opakujte** timeouty, rate limity a interní chyby -- s příslušnými prodlevami
- Místo aktivního opakování při `DisconnectedError` čekejte na event `connected`
- Chyby v callbacích odběrů při doručení úvodních dat zamítnou promise `subscribe()`
- Chyby v callbacích odběrů při push aktualizacích jsou zachyceny a zalogovány -- odběr zůstává aktivní
- Stavějte graceful degradation s cachovanými daty pro období nedostupnosti serveru
- Mapujte chybové kódy na uživatelsky srozumitelné zprávy pro UI aplikace

---

Další: [Nastavení testů](../10-testovani/01-nastaveni-testu.md)
