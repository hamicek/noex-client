# Testovací vzory

S připraveným testovacím prostředím tato kapitola pokrývá testování čtyř pilířů real-time aplikace: odběry, obnova po reconnectu, autentizace a okrajové případy. Každá sekce ukazuje přesné vzory používané v testovací sadě noex-client — vzory, které se osvědčily jako spolehlivé proti problémům s časováním a race conditions.

## Co se naučíte

- Jak testovat počáteční data odběrů a push notifikace
- Jak testovat reconnect s restartem serveru a obnovou odběrů
- Jak testovat autentizační toky (login, auto-login, oprávnění)
- Jak testovat okrajové případy: souběžné operace, chyby v callback, rychlé subscribe/unsubscribe

## Testování odběrů

Testy odběrů ověřují dvě věci: **doručení počátečních dat** (synchronní, dorazí před dokončením `subscribe()`) a **push notifikace** (asynchronní, dorazí poté, co mutace spustí přehodnocení dotazu).

### Nastavení dotazů

Dotazy musí být definovány na serverovém store před zahájením odběru:

```typescript
beforeEach(async () => {
  ctx = await startTestServer({
    buckets: [
      { name: 'users', schema: { name: { type: 'string', required: true } } },
    ],
  });

  ctx.store.defineQuery('all-users', async (qCtx) => {
    return qCtx.bucket('users').all();
  });

  ctx.store.defineQuery('user-count', async (qCtx) => {
    return qCtx.bucket('users').count();
  });

  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();
});
```

### Testování počátečních dat

Callback je zavolán s počátečními daty ještě před dokončením `subscribe()`:

```typescript
it('delivers existing records as initial data', async () => {
  await client.store.bucket('users').insert({ name: 'Alice' });

  const received: unknown[] = [];
  await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  const users = received[0] as Record<string, unknown>[];
  expect(users).toHaveLength(1);
  expect(users[0]!['name']).toBe('Alice');
});

it('delivers scalar initial data (count query)', async () => {
  await client.store.bucket('users').insert({ name: 'A' });
  await client.store.bucket('users').insert({ name: 'B' });

  const received: unknown[] = [];
  await client.store.subscribe('user-count', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  expect(received[0]).toBe(2);
});
```

### Testování push notifikací

Třístupňový vzor pro testování push: **mutace** → **settle** → **waitFor**:

```typescript
it('calls callback when record is inserted', async () => {
  const received: unknown[] = [];
  await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1); // počáteční: []

  await client.store.bucket('users').insert({ name: 'Bob' });
  await ctx.store.settle();                    // 1. Server přehodnotí dotazy
  await waitFor(() => received.length >= 2);   // 2. Klient obdrží push

  const users = received[1] as Record<string, unknown>[];
  expect(users).toHaveLength(1);
  expect(users[0]!['name']).toBe('Bob');
});
```

```
  mutace          settle()         waitFor()         assert
    │                │                 │                │
    ▼                ▼                 ▼                ▼
 insert()  →  přehodnocení    →  push dorazí   →  kontrola dat
              dotazů               (strana
              (strana serveru)      klienta)
```

### Testování chytrého push (žádné falešné aktualizace)

Odběry pushnou pouze tehdy, když se výsledek dotazu **skutečně změní**:

```typescript
it('only pushes when query result actually changes', async () => {
  const received: unknown[] = [];
  await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  expect(received[0]).toEqual([]);

  // Vložení běžného uživatele — filtrovaný výsledek dotazu se nezměnil
  await client.store.bucket('users').insert({ name: 'Regular', role: 'user' });
  await ctx.store.settle();

  // Krátká prodleva pro ověření, že žádný push nedorazí
  await new Promise((r) => setTimeout(r, 100));
  expect(received).toHaveLength(1); // Stále 1 — žádný falešný push

  // Vložení admina — výsledek dotazu se změní
  await client.store.bucket('users').insert({ name: 'AdminUser', role: 'admin' });
  await ctx.store.settle();
  await waitFor(() => received.length >= 2);

  const admins = received[1] as Record<string, unknown>[];
  expect(admins).toHaveLength(1);
  expect(admins[0]!['name']).toBe('AdminUser');
});
```

### Testování unsubscribe

Návratová hodnota `subscribe()` je synchronní unsubscribe funkce:

```typescript
it('stops push notifications after unsubscribe', async () => {
  const received: unknown[] = [];
  const unsub = await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);

  unsub(); // Synchronní — není potřeba await

  await client.store.bucket('users').insert({ name: 'Ghost' });
  await ctx.store.settle();

  // Chvíli počkáme, abychom ověřili, že žádný push nedorazí
  await new Promise((r) => setTimeout(r, 200));
  expect(received).toHaveLength(1); // Žádná nová data
});
```

## Testování reconnectu

Reconnect testy vyžadují ruční správu serveru. Vzor: spustit server, připojit se, zastavit server, restartovat ho na stejném portu, ověřit, že se klient zotaví.

### Základní reconnect

```typescript
const FAST_RECONNECT = {
  initialDelayMs: 50,
  maxDelayMs: 200,
  jitterMs: 0,
  maxRetries: 20,
} as const;

it('reconnects after server restart', async () => {
  await setup(); // Vytvoří store + server
  const port = server!.port;

  client = new NoexClient(`ws://127.0.0.1:${port}`, {
    WebSocket: WebSocket as never,
    reconnect: FAST_RECONNECT,
    connectTimeoutMs: 2_000,
  });
  await client.connect();

  // Nastavit listener PŘED zastavením serveru
  const reconnectedPromise = waitForEvent(client, 'reconnected');

  // Zastavit server → spustí disconnect
  await server!.stop();

  // Klient by měl přejít do stavu reconnecting
  await waitFor(() => client!.state === 'reconnecting');

  // Spustit nový server na stejném portu
  server = await NoexServer.start({
    store: store!,
    port,
    host: '127.0.0.1',
  });

  await reconnectedPromise;
  expect(client.isConnected).toBe(true);
  expect(client.state).toBe('connected');
});
```

### Testování vyčerpání maximálního počtu pokusů

```typescript
it('gives up after max retries and emits disconnected', async () => {
  await setup();
  const port = server!.port;

  client = new NoexClient(`ws://127.0.0.1:${port}`, {
    WebSocket: WebSocket as never,
    reconnect: {
      initialDelayMs: 10,
      maxDelayMs: 10,
      jitterMs: 0,
      maxRetries: 3,
    },
    connectTimeoutMs: 100,
  });

  await client.connect();

  const errors: Error[] = [];
  client.on('error', (err) => errors.push(err));

  const disconnectedPromise = waitForEvent<string>(client, 'disconnected');

  // Zastavit server trvale — nerestartovat
  await server!.stop();

  const reason = await disconnectedPromise;
  expect(client.state).toBe('disconnected');
  expect(reason).toContain('Max reconnect');
  expect(errors.find((e) => e.message.includes('Max reconnect'))).toBeDefined();
});
```

### Testování obnovy odběrů

Po reconnectu SDK automaticky obnoví všechny aktivní odběry:

```typescript
it('restores store subscriptions after reconnect', async () => {
  await setup();
  const port = server!.port;

  client = createClient(port);
  await client.connect();

  await client.store.bucket('users').insert({ name: 'Alice' });

  const received: unknown[] = [];
  await client.store.subscribe('all-users', (data) => {
    received.push(data);
  });

  expect(received).toHaveLength(1);
  const initial = received[0] as Record<string, unknown>[];
  expect(initial).toHaveLength(1);

  // Restart serveru
  const reconnectedPromise = waitForEvent(client, 'reconnected');
  await restartServer();
  await reconnectedPromise;

  // Obnovený odběr by měl doručit aktuální data
  await waitFor(() => received.length >= 2);

  const resubData = received[received.length - 1] as Record<string, unknown>[];
  expect(resubData).toHaveLength(1);
  expect(resubData[0]!['name']).toBe('Alice');
});
```

### Testování push po reconnectu

Ověření, že push notifikace fungují i po reconnectu:

```typescript
it('receives push notifications after reconnect', async () => {
  await setup();
  const port = server!.port;

  client = createClient(port);
  await client.connect();

  const received: unknown[] = [];
  await client.store.subscribe('user-count', (data) => {
    received.push(data);
  });

  expect(received[0]).toBe(0);

  const reconnectedPromise = waitForEvent(client, 'reconnected');
  await restartServer();
  await reconnectedPromise;

  // Vložení po reconnectu — mělo by spustit push přes obnovený odběr
  await client.store.bucket('users').insert({ name: 'Bob' });
  await store!.settle();
  await waitFor(() => received.some((v) => v === 1));

  expect(received[received.length - 1]).toBe(1);
});
```

## Testování autentizace

Testy autentizace používají vlastní `AuthConfig`, která mapuje tokeny na session:

### Auth fixture

```typescript
import type { AuthConfig, AuthSession } from '@hamicek/noex-server';

const userSession: AuthSession = { userId: 'user-1', roles: ['user'] };
const adminSession: AuthSession = { userId: 'admin-1', roles: ['admin'] };

function createAuth(): AuthConfig {
  return {
    validate: async (token) => {
      if (token === 'valid-user') return userSession;
      if (token === 'valid-admin') return adminSession;
      return null;
    },
  };
}
```

### Testování loginu a session

```typescript
it('should login with valid token', async () => {
  ctx = await startTestServer({ auth: createAuth() });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();

  const session = await client.auth.login('valid-user');
  expect(session.userId).toBe('user-1');
  expect(session.roles).toEqual(['user']);
});

it('should reject login with invalid token', async () => {
  ctx = await startTestServer({ auth: createAuth() });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();

  await expect(client.auth.login('bad-token')).rejects.toThrow(NoexClientError);

  try {
    await client.auth.login('bad-token');
  } catch (err) {
    expect((err as NoexClientError).code).toBe('UNAUTHORIZED');
  }
});
```

### Testování auto-loginu

Když je `auth.token` nastaven v `ClientOptions`, SDK se automaticky přihlásí po připojení (a po reconnectu):

```typescript
it('should auto-login when token is provided', async () => {
  ctx = await startTestServer({ auth: createAuth() });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
    auth: { token: 'valid-user' },
  });

  const welcome = await client.connect();
  expect(welcome.requiresAuth).toBe(true);

  // Již autentizován — není potřeba explicitní login
  const session = await client.auth.whoami();
  expect(session).not.toBeNull();
  expect(session!.userId).toBe('user-1');
});
```

### Testování vynucování oprávnění

```typescript
it('should enforce permissions', async () => {
  ctx = await startTestServer({
    auth: createAuth({
      permissions: {
        check: (session, _operation, _resource) => {
          return session.roles.includes('admin');
        },
      },
    }),
    buckets: [{ name: 'items', schema: { value: { type: 'number', required: true } } }],
  });
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });
  await client.connect();

  // Uživatel bez role admin — zamítnuto
  await client.auth.login('valid-user');
  await expect(
    client.store.bucket('items').insert({ value: 1 }),
  ).rejects.toThrow(NoexClientError);

  // Přihlášení jako admin — povoleno
  await client.auth.login('valid-admin');
  const record = await client.store.bucket('items').insert({ value: 2 });
  expect(record['value']).toBe(2);
});
```

## Testování okrajových případů

### Souběžné operace

Ověření, že SDK správně přiřazuje odpovědi, když je v letu mnoho požadavků najednou:

```typescript
it('should handle 50 concurrent inserts without losing correlation', async () => {
  const bucket = client.store.bucket('items');
  const promises = Array.from({ length: 50 }, (_, i) =>
    bucket.insert({ value: i }),
  );

  const results = await Promise.all(promises);

  expect(results).toHaveLength(50);
  const values = results.map((r) => r['value'] as number).sort((a, b) => a - b);
  expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i));
});
```

### Odolnost vůči chybám v callback

Chyby v callback odběrů během push aktualizací se zalogují, ale nerozbijí odběr ani klienta:

```typescript
it('callback errors do not crash the client', async () => {
  let callCount = 0;

  await client.store.subscribe('all-users', (data) => {
    callCount++;
    if (callCount === 2) {
      throw new Error('callback boom'); // Vyhodí výjimku při prvním push
    }
  });

  await client.store.bucket('users').insert({ name: 'Survivor' });
  await ctx.store.settle();
  await waitFor(() => callCount >= 2);

  // Klient je stále funkční po chybě v callback
  expect(client.isConnected).toBe(true);

  // Stále může posílat požadavky
  const all = await client.store.bucket('users').all();
  expect(all).toHaveLength(1);
});
```

Nicméně chyby během **doručení počátečních dat** odmítnou promise `subscribe()`:

```typescript
it('rejects subscribe when initial data callback throws', async () => {
  await expect(
    client.store.subscribe('user-count', () => {
      throw new Error('initial boom');
    }),
  ).rejects.toThrow('initial boom');

  // Klient zůstává funkční
  expect(client.isConnected).toBe(true);
});
```

### Rychlé střídání subscribe/unsubscribe

Testy, které ověřují, že rychlé cykly subscribe/unsubscribe nezpůsobují úniky zdrojů:

```typescript
it('should handle rapid subscribe/unsubscribe churn', async () => {
  for (let i = 0; i < 10; i++) {
    const unsub = await client.store.subscribe('all-users', () => {});
    unsub();
  }

  // Klient by měl být čistý a funkční
  expect(client.isConnected).toBe(true);

  const alice = await client.store.bucket('users').insert({ name: 'Alice' });
  expect(alice['name']).toBe('Alice');
});
```

### Opakované cykly connect/disconnect

Jedna instance klienta se může znovu připojit po záměrném odpojení:

```typescript
it('should handle multiple connect/disconnect cycles', async () => {
  client = new NoexClient(ctx.url, {
    WebSocket: WebSocket as never,
    reconnect: false,
  });

  for (let i = 0; i < 5; i++) {
    await client.connect();
    expect(client.isConnected).toBe(true);
    await client.disconnect();
    expect(client.state).toBe('disconnected');
  }
});
```

### Požadavky ve stavu reconnecting

Požadavky odeslané během reconnectu klienta jsou okamžitě odmítnuty:

```typescript
it('should throw DisconnectedError when client is reconnecting', async () => {
  // ... nastavení s povoleným reconnectem ...

  // Zastavit server pro spuštění reconnectu
  await server.stop();
  await waitFor(() => client!.state === 'reconnecting');

  // Pokus o odeslání požadavku během reconnectu
  await expect(
    client!.store.bucket('items').all(),
  ).rejects.toThrow(DisconnectedError);

  // Ověření, že chyba má správný kód
  try {
    await client!.store.bucket('items').all();
  } catch (err) {
    expect(err).toBeInstanceOf(DisconnectedError);
    expect((err as DisconnectedError).code).toBe('DISCONNECTED');
  }
});
```

## Přehled organizace testů

```
tests/
├── integration/
│   ├── helpers/
│   │   └── test-server.ts        # Helper pro server
│   ├── connection.test.ts        # Připojení, odpojení, události
│   ├── store-crud.test.ts        # Insert, get, update, delete, dotazy
│   ├── store-subscriptions.test.ts  # Subscribe, push, unsubscribe
│   ├── store-transactions.test.ts   # Atomické multi-op transakce
│   ├── reconnect.test.ts         # Reconnect, obnova, maximální počet pokusů
│   ├── auth.test.ts              # Login, logout, auto-login, oprávnění
│   ├── rules.test.ts             # Události, fakta, odběry pravidel
│   ├── typed-bucket.test.ts      # Generické BucketAPI<T>
│   └── edge-cases.test.ts        # Souběžné operace, chyby v callback, churn
└── unit/
    ├── transport/
    │   ├── transport.test.ts     # WebSocket stavový automat
    │   └── reconnect.test.ts     # Backoff strategie
    ├── protocol/
    │   ├── request-manager.test.ts  # Korelace požadavků a odpovědí
    │   └── push-router.test.ts      # Směrování push zpráv
    └── subscription/
        └── subscription-manager.test.ts  # Lifecycle odběrů
```

## Kompletní funkční příklad

Test, který pokrývá celý lifecycle — připojení, odběr, mutace, příjem push, reconnect, ověření obnovy:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';

function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) { clearInterval(interval); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(interval); reject(new Error('waitFor timed out')); }
    }, 5);
  });
}

function waitForEvent(client: NoexClient, event: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error(`${event} timed out`)); }, timeoutMs);
    const unsub = (client as any).on(event, (...args: unknown[]) => {
      clearTimeout(timer); unsub(); resolve(args[0]);
    });
  });
}

describe('Full Lifecycle Test', () => {
  let store: Store;
  let server: NoexServer;
  let client: NoexClient;

  afterEach(async () => {
    try { await client?.disconnect(); } catch {}
    if (server?.isRunning) await server.stop();
    await store?.stop();
  });

  it('should survive a full connect → subscribe → mutate → reconnect cycle', async () => {
    // 1. Nastavení
    store = await Store.start({ name: 'lifecycle-test' });
    await store.defineBucket('tasks', {
      key: 'id',
      schema: {
        id: { type: 'string', generated: 'uuid' },
        title: { type: 'string', required: true },
      },
    });
    store.defineQuery('all-tasks', async (qCtx) => qCtx.bucket('tasks').all());

    server = await NoexServer.start({ store, port: 0, host: '127.0.0.1' });
    const port = server.port;

    client = new NoexClient(`ws://127.0.0.1:${port}`, {
      WebSocket: WebSocket as never,
      reconnect: { initialDelayMs: 50, maxDelayMs: 200, jitterMs: 0, maxRetries: 20 },
    });

    // 2. Připojení
    await client.connect();
    expect(client.isConnected).toBe(true);

    // 3. Odběr
    const received: unknown[] = [];
    await client.store.subscribe('all-tasks', (data) => {
      received.push(data);
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);

    // 4. Mutace a ověření push
    await client.store.bucket('tasks').insert({ title: 'Buy milk' });
    await store.settle();
    await waitFor(() => received.length >= 2);

    const tasks = received[1] as Record<string, unknown>[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!['title']).toBe('Buy milk');

    // 5. Reconnect
    const reconnected = waitForEvent(client, 'reconnected');
    await server.stop();
    server = await NoexServer.start({ store, port, host: '127.0.0.1' });
    await reconnected;

    // 6. Ověření obnovy odběru
    await waitFor(() => received.length >= 3);

    // 7. Ověření, že push funguje po reconnectu
    await client.store.bucket('tasks').insert({ title: 'Walk the dog' });
    await store.settle();
    await waitFor(() => {
      const last = received[received.length - 1] as Record<string, unknown>[];
      return Array.isArray(last) && last.length === 2;
    });

    const final = received[received.length - 1] as Record<string, unknown>[];
    expect(final).toHaveLength(2);
  });
});
```

## Cvičení

Napište testovací soubor, který ověří **nezávislost odběrů**:

1. Vytvořte dva odběry stejného dotazu (`all-users`)
2. Vložte záznam a ověřte, že oba callback obdrží push
3. Zrušte první odběr (unsubscribe)
4. Vložte další záznam a ověřte, že push obdrží pouze druhý callback
5. Ověřte, že pole `received` prvního callback nenarostlo

<details>
<summary>Řešení</summary>

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { NoexClient } from '@hamicek/noex-client';
import { startTestServer, type TestServerContext } from './helpers/test-server.js';

function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fn()) { resolve(); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) { clearInterval(interval); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(interval); reject(new Error('timed out')); }
    }, 5);
  });
}

describe('Subscription Independence', () => {
  let ctx: TestServerContext;
  let client: NoexClient;

  beforeEach(async () => {
    ctx = await startTestServer({
      buckets: [
        { name: 'users', schema: { name: { type: 'string', required: true } } },
      ],
    });
    ctx.store.defineQuery('all-users', async (qCtx) => qCtx.bucket('users').all());

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

  it('unsubscribing one does not affect others', async () => {
    const received1: unknown[] = [];
    const received2: unknown[] = [];

    const unsub1 = await client.store.subscribe('all-users', (data) => {
      received1.push(data);
    });
    await client.store.subscribe('all-users', (data) => {
      received2.push(data);
    });

    // Oba obdrží počáteční data
    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);

    // Vložení — oba obdrží push
    await client.store.bucket('users').insert({ name: 'Alice' });
    await ctx.store.settle();
    await waitFor(() => received1.length >= 2 && received2.length >= 2);
    expect(received1).toHaveLength(2);
    expect(received2).toHaveLength(2);

    // Zrušení prvního odběru
    unsub1();

    // Další vložení — push obdrží pouze druhý
    await client.store.bucket('users').insert({ name: 'Bob' });
    await ctx.store.settle();
    await waitFor(() => received2.length >= 3);

    expect(received1).toHaveLength(2); // Žádná nová data
    expect(received2).toHaveLength(3); // Stále přijímá
  });
});
```

</details>

## Shrnutí

- **Testy odběrů** sledují vzor: subscribe → mutace → `settle()` → `waitFor()` → assert
- **Push pouze při změně** — ověřte, že po irelevantních mutacích nedorazí žádné falešné push zprávy, pomocí krátké prodlevy
- **Reconnect testy** používají `FAST_RECONNECT` volby, ruční správu serveru a `waitForEvent`
- **Obnova odběrů** je automatická — po reconnectu SDK obnoví odběry a doručí čerstvá data
- **Testy autentizace** používají vlastní `validate` funkci, která mapuje známé tokeny na session
- **Auto-login** se testuje předáním `auth: { token }` v `ClientOptions` a kontrolou `whoami()` po připojení
- **Souběžné operace** — použijte `Promise.all` a ověřte, že všechny odpovědi jsou správně přiřazeny
- **Chyby v callback** během push nerozbijí klienta; během počátečních dat odmítnou `subscribe()`
- **Rychlé střídání** — subscribe/unsubscribe v těsné smyčce by nemělo způsobit úniky zdrojů
- Organizujte testy podle funkcionality: připojení, CRUD, odběry, reconnect, autentizace, transakce, okrajové případy

---

Další: [Todo aplikace](../11-projekty/01-todo-aplikace.md)
