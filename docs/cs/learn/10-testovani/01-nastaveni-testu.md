# Nastavení testů

Integrační testy pro real-time WebSocket SDK vyžadují běžící server, dynamickou alokaci portů a pečlivý cleanup. Tato kapitola ukazuje, jak nastavit testovací prostředí, které je rychlé, izolované a deterministické — s použitím Vitest jako test runneru a helperu, který pro každý test spustí skutečný noex-server na náhodném portu.

## Co se naučíte

- Jak nakonfigurovat Vitest pro integrační testy noex-client
- Jak vytvořit helper `startTestServer()` pro izolaci testů
- Standardní lifecycle vzor s `beforeEach`/`afterEach`
- Proč je `reconnect: false` správná výchozí hodnota pro většinu testů
- Jak řešit asynchronní časování pomocí `waitFor()` a `store.settle()`

## Konfigurace Vitest

noex-client používá Vitest s explicitními importy (bez globálních proměnných) a timeout 10 sekund:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
```

| Pole | Hodnota | Proč |
|------|---------|------|
| `globals` | `false` | Vyžaduje explicitní `import { describe, it, expect } from 'vitest'` — žádná skrytá magie |
| `environment` | `'node'` | Testy běží v Node.js, ne v jsdom |
| `testTimeout` | `10_000` | WebSocket handshake a reconnect testy potřebují víc než výchozích 5s |

Instalace testovacích závislostí:

```bash
npm install -D vitest ws @types/ws @hamicek/noex-server @hamicek/noex-store
```

## Helper pro testovací server

Klíčem ke spolehlivým integračním testům je helper, který spustí skutečný server na náhodném portu (`port: 0`). Tím se eliminují konflikty portů při paralelním spouštění testů:

```typescript
// tests/integration/helpers/test-server.ts
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthConfig } from '@hamicek/noex-server';
import type { RuleEngine } from '@hamicek/noex-rules';

export interface TestServerContext {
  server: NoexServer;
  store: Store;
  rules?: RuleEngine;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

let storeCounter = 0;

export async function startTestServer(
  options?: {
    port?: number;
    buckets?: Array<{ name: string; schema: Record<string, unknown> }>;
    rules?: RuleEngine;
    auth?: AuthConfig;
  },
): Promise<TestServerContext> {
  const store = await Store.start({ name: `client-test-${++storeCounter}` });

  if (options?.buckets) {
    for (const b of options.buckets) {
      await store.defineBucket(b.name, {
        key: 'id',
        schema: {
          id: { type: 'string', generated: 'uuid' },
          ...b.schema,
        },
      });
    }
  }

  const server = await NoexServer.start({
    store,
    rules: options?.rules,
    auth: options?.auth,
    port: options?.port ?? 0,
    host: '127.0.0.1',
  });

  const port = server.port;
  const url = `ws://127.0.0.1:${port}`;

  return {
    server,
    store,
    rules: options?.rules,
    url,
    port,
    async stop() {
      if (server.isRunning) {
        await server.stop();
      }
      await store.stop();
    },
  };
}
```

Klíčová designová rozhodnutí:

- **`port: 0`** — operační systém přidělí volný port, čímž se eliminují konflikty
- **`host: '127.0.0.1'`** — naslouchá pouze na localhost, rychlé a bezpečné
- **Unikátní názvy store** — čítač zabraňuje kolizím mezi souběžnými testy
- **`stop()` kontroluje `isRunning`** — bezpečné volání i v případě, že server již byl zastaven (např. v reconnect testech)

## Standardní lifecycle testu

Každý soubor integračních testů má stejnou strukturu:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Feature X', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });

    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client?.isConnected) {
      await client.disconnect();
    }
    await ctx.stop();
  });

  it('should do something', async () => {
    const bucket = client.store.bucket('users');
    const record = await bucket.insert({ name: 'Alice' });
    expect(record['name']).toBe('Alice');
  });
});
```

Tři zásadní detaily:

1. **`WebSocket: WebSocket as never`** — předá třídu WebSocket z knihovny `ws` klientovi. Přetypování `as never` je nutné, protože `ws` a prohlížečový WebSocket mají mírně odlišné typové signatury, ale za běhu jsou kompatibilní.

2. **`reconnect: false`** — vypne automatický reconnect. Bez toho by vypnutí serveru v `afterEach` spustilo reconnect pokusy, které by závodily se startem serveru dalšího testu a způsobovaly nestabilní selhání.

3. **`afterEach` vždy provede cleanup** — nejprve odpojí klienta, pak zastaví server. Na pořadí záleží: odpojení klienta jako první zabrání reconnect smyčce vyvolané vypnutím serveru.

## Asynchronní časování: waitFor() a store.settle()

Real-time systémy jsou ze své podstaty asynchronní. Dvě pomocné funkce zajišťují spolehlivé časování:

### waitFor() — opakovaně kontroluje podmínku

```typescript
function waitFor(
  fn: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 5);
  });
}
```

Použijte `waitFor`, když čekáte na příchod push zpráv:

```typescript
const received: unknown[] = [];
await client.store.subscribe('all-users', (data) => {
  received.push(data);
});

// received.length === 1 (počáteční data již dorazila)

await client.store.bucket('users').insert({ name: 'Bob' });
await ctx.store.settle();
await waitFor(() => received.length >= 2);

// Nyní je bezpečné provádět asserty na received[1]
```

### store.settle() — čeká na vyhodnocení dotazů na serveru

Po mutaci (insert, update, delete) server asynchronně přehodnotí všechny dotčené dotazy. `store.settle()` počká, dokud nejsou všechna probíhající vyhodnocení dokončena:

```
Klient                    Server
  │                         │
  ├── insert({ name }) ──►  │
  │                         ├── mutace ve store
  │  ◄── { id, name } ─────┤
  │                         ├── přehodnocení dotazů (async!)
  │                         │   └── settle() čeká tady
  │                         ├── push notifikace
  │  ◄── push data ─────────┤
  │                         │
```

Bez `settle()` by push notifikace nemusela být ještě odeslána v okamžiku, kdy kontrolujete `received.length`. S `settle()` server garantuje, že všechna vyhodnocení dotazů jsou dokončena.

**Vzor:** vždy po mutaci zavolejte `ctx.store.settle()`, pak `waitFor()` na straně klienta:

```typescript
await client.store.bucket('users').insert({ name: 'Bob' });
await ctx.store.settle();  // Server: všechny dotazy přehodnoceny
await waitFor(() => received.length >= 2);  // Klient: push dorazil
```

### waitForEvent() — čeká na lifecycle událost

Pro reconnect testy často potřebujete počkat na konkrétní událost:

```typescript
function waitForEvent<T = void>(
  client: NoexClient,
  event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'error' | 'welcome',
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer);
      unsub();
      resolve(args[0] as T);
    });
  });
}
```

Použití:

```typescript
const reconnectedPromise = waitForEvent(client, 'reconnected');

// ... restart serveru ...

await reconnectedPromise; // Splní se, když se klient znovu připojí
```

## Nastavení reconnect testů

Reconnect testy vyžadují odlišné nastavení, protože musí řídit lifecycle serveru nezávisle. Místo `startTestServer` vytvářejí store a server ručně:

```typescript
const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 0,
  maxRetries: 20,
} as const;

let store: Store;
let server: NoexServer;

async function setup() {
  store = await Store.start({ name: `reconnect-test-${Date.now()}` });
  await store.defineBucket('users', {
    key: 'id',
    schema: {
      id: { type: 'string', generated: 'uuid' },
      name: { type: 'string', required: true },
    },
  });

  server = await NoexServer.start({
    store,
    port: 0,
    host: '127.0.0.1',
  });
}

async function restartServer() {
  const port = server.port;
  await server.stop();

  server = await NoexServer.start({
    store,  // Stejný store — data přežijí restart
    port,   // Stejný port — klient se může znovu připojit
    host: '127.0.0.1',
  });
}
```

Klíčové rozdíly oproti standardnímu nastavení:

- **`FAST_RECONNECT`** — nízké prodlevy a nulový jitter, aby testy doběhly rychle
- **`restartServer()`** znovu použije stejný `store` a `port` — klient se připojí na stejnou adresu a vidí stejná data
- **Store přežije server** — volá se pouze `server.stop()`, ne `store.stop()`

## Kompletní funkční příklad

Minimální testovací soubor, který ověřuje CRUD operace:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError, DisconnectedError } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Users CRUD', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx.stop();
  });

  it('should insert and retrieve a user', async () => {
    const bucket = client.store.bucket('users');

    const inserted = await bucket.insert({ name: 'Alice' });
    expect(inserted['name']).toBe('Alice');
    expect(typeof inserted['id']).toBe('string');

    const found = await bucket.get(inserted['id']);
    expect(found).not.toBeNull();
    expect(found!['name']).toBe('Alice');
  });

  it('should reject requests after disconnect', async () => {
    await client.disconnect();

    // request() vyhodí výjimku synchronně, když není připojen
    expect(() => {
      client.request('store.all', { bucket: 'users' });
    }).toThrow(DisconnectedError);
  });

  it('should return server errors as NoexClientError', async () => {
    try {
      await client.store.bucket('nonexistent').all();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NoexClientError);
      expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
    }
  });
});
```

## Cvičení

Vytvořte testovací soubor, který:
1. Spustí testovací server se dvěma buckety: `users` (name: string) a `logs` (action: string)
2. Otestuje, že vložení záznamu do jednoho bucketu neovlivní druhý
3. Otestuje, že požadavek na neexistující bucket vrátí `NoexClientError` s kódem `'BUCKET_NOT_DEFINED'`
4. Správně provede cleanup v `afterEach`

<details>
<summary>Řešení</summary>

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient, NoexClientError } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

describe('Integration: Multi-Bucket Isolation', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
        { name: 'logs', schema: { action: { type: 'string', required: true } } },
      ],
    });
    client = new NoexClient(ctx.url, {
      WebSocket: WebSocket as never,
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    if (client?.isConnected) await client.disconnect();
    await ctx.stop();
  });

  it('should keep buckets isolated', async () => {
    const users = client.store.bucket('users');
    const logs = client.store.bucket('logs');

    await users.insert({ name: 'Alice' });
    await logs.insert({ action: 'user_created' });

    const allUsers = await users.all();
    const allLogs = await logs.all();

    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]!['name']).toBe('Alice');
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0]!['action']).toBe('user_created');
  });

  it('should reject requests to nonexistent bucket', async () => {
    try {
      await client.store.bucket('nonexistent').all();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NoexClientError);
      expect((err as NoexClientError).code).toBe('BUCKET_NOT_DEFINED');
    }
  });
});
```

</details>

## Shrnutí

- Používejte **Vitest** s `globals: false`, `environment: 'node'` a `testTimeout: 10_000`
- Helper **`startTestServer()`** vytvoří izolovaný server na náhodném portu (`port: 0`)
- Ve standardních testech vždy **vypněte reconnect**: `reconnect: false`
- Provádějte cleanup v `afterEach`: nejprve odpojte klienta, pak zastavte server
- Použijte **`ctx.store.settle()`** po mutacích k čekání na přehodnocení dotazů na serveru
- Použijte **`waitFor(fn)`** k opakované kontrole podmínek na straně klienta (např. příchod push zprávy)
- Použijte **`waitForEvent(client, event)`** k čekání na lifecycle události v reconnect testech
- Reconnect testy používají **`FAST_RECONNECT`** volby a ruční správu serveru pro plnou kontrolu

---

Další: [Testovací vzory](./02-testovaci-vzory.md)
