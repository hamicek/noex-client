# Chatovací aplikace

Vytvořte multi-room chatovací systém, který kombinuje všechny hlavní funkce SDK: store pro persistenci zpráv, rules pro event-driven notifikace, odběry pro živé doručování, transakce pro atomické změny stavu a reconnect recovery pro bezproblémový uživatelský zážitek.

## Co se naučíte

- Použití rules enginu pro emitování chatovacích událostí a odběr témat místností
- Persistenci zpráv v store bucketu při současném vysílání přes rules
- Kombinaci store odběrů a rules odběrů v jednom klientovi
- Atomické operace s místnostmi pomocí transakcí
- Automatickou obnovu odběrů po reconnectu
- Correlation a causation ID pro trasování zpráv

## Přehled architektury

```
┌─────────────────────────────────────────────────────────────────┐
│                          noex-server                             │
│                                                                  │
│  Store                              Rules                        │
│  ┌──────────────────┐               ┌──────────────────────┐    │
│  │ messages bucket   │               │ topic: chat:*         │    │
│  │ rooms bucket      │               │ topic: presence:*     │    │
│  └──────────────────┘               └──────────────────────┘    │
│                                                                  │
│  Dotazy                             Fakta                        │
│  ┌──────────────────┐               ┌──────────────────────┐    │
│  │ room-messages     │               │ room:general:members  │    │
│  │   (dle roomId)    │               │ user:alice:status     │    │
│  │ room-list         │               └──────────────────────┘    │
│  └──────────────────┘                                            │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │   Alice    │  │    Bob     │  │   Carol    │                │
│  │   emit()   │  │ subscribe  │  │ subscribe  │                │
│  │   insert() │  │  push ←    │  │  push ←    │                │
│  └────────────┘  └────────────┘  └────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

**Dva push kanály spolupracují:**

| Kanál | Spouštěč | Použití |
|-------|----------|---------|
| `subscription` (store) | Data v bucketu se změní | Historie zpráv, seznam místností |
| `event` (rules) | Zavolá se `rules.emit()` | Živé chatovací události, indikátor psaní, přítomnost |

Store odběry doručují aktuální stav (kompletní seznam zpráv). Rules odběry doručují jednotlivé události v okamžiku, kdy nastanou (každá nová zpráva, příchod, odchod). Kompletní chatovací klient používá obojí.

## Část 1: Nastavení serveru

```typescript
// server.ts
import { Store } from '@hamicek/noex-store';
import { RulesEngine } from '@hamicek/noex-rules';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthSession } from '@hamicek/noex-server';

async function main() {
  const store = await Store.start({ name: 'chat-app' });
  const rules = new RulesEngine();

  // ── Buckety ─────────────────────────────────────────────────────
  await store.defineBucket('messages', {
    key: 'id',
    schema: {
      id:     { type: 'string', generated: 'uuid' },
      roomId: { type: 'string', required: true },
      userId: { type: 'string', required: true },
      text:   { type: 'string', required: true },
    },
  });

  await store.defineBucket('rooms', {
    key: 'id',
    schema: {
      id:   { type: 'string', generated: 'uuid' },
      name: { type: 'string', required: true },
    },
  });

  // ── Dotazy ──────────────────────────────────────────────────────
  store.defineQuery(
    'room-messages',
    async (ctx, params: { roomId: string }) => {
      return ctx.bucket('messages').where({ roomId: params.roomId });
    },
  );

  store.defineQuery('room-list', async (ctx) => {
    return ctx.bucket('rooms').all();
  });

  // ── Auth ────────────────────────────────────────────────────────
  const users: Record<string, AuthSession> = {
    'alice-token': { userId: 'alice', roles: ['user'] },
    'bob-token':   { userId: 'bob', roles: ['user'] },
    'carol-token': { userId: 'carol', roles: ['user'] },
  };

  const server = await NoexServer.start({
    port: 8080,
    store,
    rules,
    auth: {
      validate: async (token) => users[token] ?? null,
    },
  });

  console.log(`Chat server naslouchá na ws://localhost:${server.port}`);
}

main();
```

## Část 2: Odesílání zpráv

Chatová zpráva zahrnuje dvě operace: **persist** zprávy ve store (aby byla k dispozici v historii) a **emit** rules události (aby ji všichni odebírající klienti okamžitě obdrželi).

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const alice = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'alice-token' },
});
await alice.connect();

const roomId = 'general';

// Uložení zprávy
const msg = await alice.store.bucket('messages').insert({
  roomId,
  userId: 'alice',
  text: 'Ahoj všichni!',
});

// Vysílání přes rules — všichni klienti odebírající chat:general to obdrží
await alice.rules.emit(`chat:${roomId}`, {
  messageId: msg.id,
  userId: 'alice',
  text: 'Ahoj všichni!',
});
```

### Correlation ID pro trasování

Použijte `correlationId` pro propojení souvisejících událostí v konverzaci:

```typescript
const correlationId = `conv-${Date.now()}`;

await alice.rules.emit(
  `chat:${roomId}`,
  { userId: 'alice', text: 'Je tu někdo?' },
  correlationId,
);

// Bob odpovídá ve stejném konverzačním vláknu
await bob.rules.emit(
  `chat:${roomId}`,
  { userId: 'bob', text: 'Jsem tu!' },
  correlationId,
  msg.id, // causationId — tato zpráva vznikla jako reakce na Alicinu zprávu
);
```

## Část 3: Příjem zpráv — rules odběry

Rules odběry používají vzory témat se separátorem `:`. Zástupný znak `*` odpovídá jednomu segmentu:

```typescript
const bob = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'bob-token' },
});
await bob.connect();

// Odběr všech chatovacích událostí v místnosti "general"
const unsubChat = await bob.rules.subscribe(`chat:general`, (event, topic) => {
  console.log(`[${topic}] ${event.data['userId']}: ${event.data['text']}`);
});

// Odběr VŠECH místností najednou
const unsubAll = await bob.rules.subscribe('chat:*', (event, topic) => {
  const roomId = topic.split(':')[1];
  console.log(`[Místnost ${roomId}] ${event.data['userId']}: ${event.data['text']}`);
});
```

Když Alice emituje `chat:general`, Bobův callback se zavolá s event objektem obsahujícím `id`, `topic`, `data`, `timestamp` a volitelné `correlationId`/`causationId`.

## Část 4: Historie zpráv — store odběry

Rules události jsou efemérní — dorazí pouze pokud odebíráte v okamžiku, kdy nastanou. Pro historii zpráv odebírejte store dotaz:

```typescript
// Bob chce kompletní historii zpráv pro místnost "general"
const messageHistory: Record<string, unknown>[] = [];

const unsubHistory = await bob.store.subscribe(
  'room-messages',
  { roomId: 'general' },
  (data) => {
    messageHistory.length = 0;
    for (const m of data as Record<string, unknown>[]) {
      messageHistory.push(m);
    }
    console.log(`Historie: ${messageHistory.length} zpráv`);
  },
);

// Počáteční data: všechny existující zprávy v #general
// Push aktualizace: kdykoli je do #general vložena nová zpráva
```

**Proč obojí?** Rules odběry dávají okamžité doručení jednotlivých událostí (nízká latence). Store odběry dávají kompletní aktuální stav (spolehlivé, přežijí reconnect). Použijte rules pro real-time indikátor „nová zpráva" a store pro vykreslení kompletního seznamu zpráv.

## Část 5: Správa místností s transakcemi

Vytvořte místnost a zaznamenejte první zprávu atomicky:

```typescript
// Vytvoření místnosti + úvodní zpráva v jedné atomické operaci
const result = await alice.store.transaction([
  {
    op: 'insert',
    bucket: 'rooms',
    data: { name: 'project-x' },
  },
  {
    op: 'insert',
    bucket: 'messages',
    data: {
      roomId: 'project-x',
      userId: 'system',
      text: 'Místnost vytvořena uživatelem alice',
    },
  },
]);

const room = result.results[0]!.data as Record<string, unknown>;
const systemMsg = result.results[1]!.data as Record<string, unknown>;

console.log(`Vytvořena místnost: ${room['name']} (${room['id']})`);
console.log(`Systémová zpráva: ${systemMsg['id']}`);

// Notifikace přes rules
await alice.rules.emit(`presence:${room['id']}`, {
  userId: 'alice',
  action: 'created_room',
});
```

### Sledování přítomnosti pomocí faktů

Použijte rules fakta pro sledování, kdo je v které místnosti:

```typescript
// Alice vstupuje do "general"
await alice.rules.setFact('room:general:members:alice', { joinedAt: Date.now() });

// Dotaz na všechny členy "general"
const members = await alice.rules.queryFacts('room:general:members:*');
console.log(`Členové: ${members.map((f) => f.key.split(':')[3]).join(', ')}`);

// Alice odchází
await alice.rules.deleteFact('room:general:members:alice');
```

## Část 6: Reconnect recovery

Když spadne síť a klient se znovu připojí, SDK automaticky obnoví všechny aktivní odběry. Obnoví se jak store, tak rules odběry:

```typescript
const carol = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'carol-token' },
  reconnect: {
    initialDelayMs: 500,
    maxDelayMs: 5000,
    maxRetries: 10,
  },
});

await carol.connect();

// Odběr rules událostí a store dotazů
const chatMessages: unknown[] = [];
const unsubRules = await carol.rules.subscribe('chat:general', (event) => {
  chatMessages.push(event);
});

const storeMessages: unknown[] = [];
const unsubStore = await carol.store.subscribe(
  'room-messages',
  { roomId: 'general' },
  (data) => {
    storeMessages.push(data);
  },
);

// Sledování stavu připojení
carol.on('reconnecting', (attempt) => {
  console.log(`Opětovné připojování... pokus ${attempt}`);
});

carol.on('reconnected', () => {
  console.log('Znovu připojeno — odběry obnoveny');
  // Oba odběry — chatMessages rules a storeMessages store —
  // jsou automaticky znovu vytvořeny.
  // Callback store odběru se zavolá s čerstvými aktuálními daty.
});

carol.on('disconnected', (reason) => {
  console.log(`Odpojeno: ${reason}`);
});
```

```
    Carol                      Server
      │                          │
      │  ── připojeno ──         │
      │  rules.subscribe         │
      │  store.subscribe         │
      │                          │
      │  ✕ výpadek sítě ✕        │
      │                          │
      │  reconnecting (1)        │
      │  ... prodleva ...        │
      │  reconnecting (2)        │
      │  ... prodleva ...        │
      │                          │
      │  ── znovu připojeno ──   │
      │  auto-login              │
      │  rules.subscribe (nový)  │
      │  store.subscribe (nový)  │← čerstvá data
      │                          │
      │  ── normální provoz ──   │
```

Po reconnectu:
- **Auth** je obnovena automaticky (auto-login s uloženým tokenem)
- **Store odběry** jsou znovu vytvořeny; callback se zavolá s čerstvými aktuálními daty
- **Rules odběry** jsou znovu vytvořeny s novým subscription ID
- Zprávy odeslané během odpojení se **nepřehrají** — použijte čerstvá data ze store odběru k doplnění mezer

## Kompletní funkční příklad

```typescript
import { Store } from '@hamicek/noex-store';
import { RulesEngine } from '@hamicek/noex-rules';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';
import type { AuthSession } from '@hamicek/noex-server';
import WebSocket from 'ws';

async function main() {
  // ── Server ──────────────────────────────────────────────────────
  const store = await Store.start({ name: 'chat-demo' });
  const rules = new RulesEngine();

  await store.defineBucket('messages', {
    key: 'id',
    schema: {
      id:     { type: 'string', generated: 'uuid' },
      roomId: { type: 'string', required: true },
      userId: { type: 'string', required: true },
      text:   { type: 'string', required: true },
    },
  });

  store.defineQuery('room-messages', async (ctx, params: { roomId: string }) => {
    return ctx.bucket('messages').where({ roomId: params.roomId });
  });

  const users: Record<string, AuthSession> = {
    'alice-token': { userId: 'alice', roles: ['user'] },
    'bob-token':   { userId: 'bob', roles: ['user'] },
  };

  const server = await NoexServer.start({
    port: 0,
    host: '127.0.0.1',
    store,
    rules,
    auth: { validate: async (token) => users[token] ?? null },
  });

  const url = `ws://127.0.0.1:${server.port}`;

  // ── Alice ───────────────────────────────────────────────────────
  const alice = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'alice-token' },
  });
  await alice.connect();

  // ── Bob ─────────────────────────────────────────────────────────
  const bob = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'bob-token' },
  });
  await bob.connect();

  // Bob odebírá živé události v #general
  const liveEvents: string[] = [];
  const unsubRules = await bob.rules.subscribe('chat:general', (event) => {
    liveEvents.push(`${event.data['userId']}: ${event.data['text']}`);
    console.log(`[Živě] ${event.data['userId']}: ${event.data['text']}`);
  });

  // Bob odebírá historii zpráv v #general
  let history: Record<string, unknown>[] = [];
  const unsubStore = await bob.store.subscribe(
    'room-messages',
    { roomId: 'general' },
    (data) => {
      history = data as Record<string, unknown>[];
      console.log(`[Historie] ${history.length} zpráv`);
    },
  );

  // Alice posílá zprávu
  const msg = await alice.store.bucket('messages').insert({
    roomId: 'general',
    userId: 'alice',
    text: 'Ahoj Bobe!',
  });
  await alice.rules.emit('chat:general', {
    messageId: msg.id,
    userId: 'alice',
    text: 'Ahoj Bobe!',
  });
  await store.settle();

  // Bob odpovídá
  const reply = await bob.store.bucket('messages').insert({
    roomId: 'general',
    userId: 'bob',
    text: 'Ahoj Alice!',
  });
  await bob.rules.emit('chat:general', {
    messageId: reply.id,
    userId: 'bob',
    text: 'Ahoj Alice!',
  });
  await store.settle();

  // Čas na doručení pushů
  await new Promise((r) => setTimeout(r, 200));

  console.log(`\nŽivé události přijaty: ${liveEvents.length}`);
  console.log(`Historie zpráv: ${history.length}`);

  // ── Cleanup ─────────────────────────────────────────────────────
  unsubRules();
  unsubStore();
  await alice.disconnect();
  await bob.disconnect();
  await server.stop();
  await store.stop();

  console.log('Hotovo.');
}

main();
```

## Cvičení

Rozšiřte chatovací aplikaci o:

1. Indikátor psaní: když uživatel začne psát, emitujte rules událost `typing:general` s `{ userId, isTyping: true }`. Když přestane, emitujte s `isTyping: false`.
2. Odebírejte `typing:*` pro zobrazení „X píše..." ve všech místnostech.
3. Použijte transakci pro vytvoření nové místnosti a zároveň odeslání první „uvítací" zprávy atomicky.
4. Sledujte přítomnost uživatelů pomocí faktů: `setFact('online:alice', true)` při připojení, `deleteFact('online:alice')` při odpojení. Dotažte všechny online uživatele pomocí `queryFacts('online:*')`.

<details>
<summary>Řešení</summary>

**Indikátor psaní:**

```typescript
// Alice začíná psát
await alice.rules.emit('typing:general', { userId: 'alice', isTyping: true });

// Alice přestala psát (odeslala zprávu nebo se zastavila)
await alice.rules.emit('typing:general', { userId: 'alice', isTyping: false });

// Bob odebírá události psaní ve všech místnostech
await bob.rules.subscribe('typing:*', (event, topic) => {
  const roomId = topic.split(':')[1];
  if (event.data['isTyping']) {
    console.log(`[${roomId}] ${event.data['userId']} píše...`);
  }
});
```

**Atomické vytvoření místnosti:**

```typescript
const result = await alice.store.transaction([
  { op: 'insert', bucket: 'rooms', data: { name: 'nova-mistnost' } },
  {
    op: 'insert',
    bucket: 'messages',
    data: { roomId: 'nova-mistnost', userId: 'system', text: 'Vítejte v nova-mistnost!' },
  },
]);
```

**Sledování přítomnosti:**

```typescript
// Při připojení
await alice.rules.setFact('online:alice', true);

// Při odpojení (před client.disconnect())
await alice.rules.deleteFact('online:alice');

// Dotaz na online uživatele
const onlineFacts = await bob.rules.queryFacts('online:*');
const onlineUsers = onlineFacts.map((f) => f.key.split(':')[1]);
console.log('Online:', onlineUsers.join(', '));
```

</details>

## Shrnutí

- **Dva push kanály** — store odběry doručují kompletní stav (historie zpráv), rules odběry doručují jednotlivé události (živé notifikace)
- **Persist + broadcast** — vložte do store pro trvanlivost, emitujte přes rules pro okamžité doručení
- **Correlation ID** — parametry `correlationId` a `causationId` umožňují trasovat konverzační vlákna
- **Vzory témat** — `chat:*` odpovídá všem místnostem, `chat:general` odpovídá jedné; vzory používají `:` jako separátor segmentů
- **Fakta pro přítomnost** — `setFact`/`deleteFact`/`queryFacts` sledují efemérní stav jako online uživatele
- **Transakce** — atomické vytvoření místnosti zajistí, že místnost a její uvítací zpráva se vytvoří společně nebo vůbec
- **Reconnect recovery** — store i rules odběry se automaticky obnoví; store doručí čerstvá data, rules pokračuje v naslouchání od bodu reconnectu

---

Zpět na: [Příručka učení](../index.md)
