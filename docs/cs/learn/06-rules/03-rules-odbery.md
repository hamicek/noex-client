# Rules odběry

Rules odběry umožňují přijímat **real-time notifikace o eventech** z pravidlového enginu. Když se přihlásíte k odběru s topic pattern, server pushne každý odpovídající event do vašeho callbacku v okamžiku zpracování. Koncepčně je to podobné store odběrům, ale s důležitými rozdíly: rules odběry používají push kanál `event`, **nedoručují** počáteční data a callback přijímá objekt `RulesEvent` s odpovídajícím topicem.

## Co se naučíte

- Jak odebírat eventy pravidlového enginu pomocí `rules.subscribe()`
- Jak funguje matching topic pattern
- Rozdíl mezi rules odběry a store odběry
- Jak spravovat více souběžných odběrů
- Jak funguje unsubscribe (synchronní, fire-and-forget)

## Rules vs store odběry

| | Store odběry | Rules odběry |
|---|---------------------|---------------------|
| **Odběr na** | Pojmenovaný serverový query | Topic pattern |
| **Počáteční data** | Ano — callback obdrží aktuální výsledek query | Ne — pouze budoucí eventy |
| **Push kanál** | `subscription` | `event` |
| **Signatura callbacku** | `(data: unknown) => void` | `(event: RulesEvent, topic: string) => void` |
| **Obsah pushe** | Kompletní výsledek query (přehodnocený) | Jednotlivý event, který odpovídal pattern |
| **Obnova po reconnectu** | Znovu odebírá + doručí počáteční data | Pouze znovu odebírá — žádné přehrání zmeškaných eventů |

## rules.subscribe()

Odběr eventů odpovídajících topic pattern:

```typescript
const unsubscribe = await client.rules.subscribe('order.*', (event, topic) => {
  console.log(`Event na ${topic}:`, event.data);
});
```

**Signatura:**

```typescript
subscribe(
  pattern: string,
  callback: (event: RulesEvent, topic: string) => void,
): Promise<Unsubscribe>
```

| Parametr | Typ | Popis |
|----------|-----|-------|
| pattern | `string` | Topic pattern pro matching (např. `'order.*'`) |
| callback | `(event: RulesEvent, topic: string) => void` | Volán s každým odpovídajícím eventem a jeho topicem |

Vrací `Promise<Unsubscribe>` — synchronní funkci `() => void`, která zastaví odběr.

## Žádná počáteční data

Na rozdíl od store odběrů rules odběry **nedoručují** počáteční data. Callback je vyvolán pouze tehdy, když po navázání odběru dorazí nové eventy:

```typescript
const events: RulesEvent[] = [];

const unsub = await client.rules.subscribe('order.*', (event) => {
  events.push(event);
});

// V tuto chvíli je events prázdný — žádné počáteční doručení
console.log(events.length); // 0

// Callback se spustí až po emitování
await client.rules.emit('order.created', { orderId: '1' });
// events.length === 1 (po příchodu pushe)
```

## Matching topic pattern

Zástupný znak `*` odpovídá jednomu libovolnému segmentu topicu (segmenty jsou odděleny `.`):

```typescript
// Odpovídá: order.created, order.shipped, order.cancelled
await client.rules.subscribe('order.*', (event, topic) => {
  console.log(`Event objednávky: ${topic}`);
});

// Odpovídá: user.registered
await client.rules.subscribe('user.*', (event, topic) => {
  console.log(`Event uživatele: ${topic}`);
});

// Odpovídá čemukoliv (jednosegtmentové topicy)
await client.rules.subscribe('*', (event, topic) => {
  console.log(`Jakýkoliv event: ${topic}`);
});
```

Eventy, které neodpovídají pattern, nejsou doručeny:

```typescript
const received: string[] = [];

const unsub = await client.rules.subscribe('order.*', (_event, topic) => {
  received.push(topic);
});

await client.rules.emit('order.created', {});  // → doručen
await client.rules.emit('user.login', {});      // → NEDORUČEN
await client.rules.emit('order.shipped', {});   // → doručen

// received === ['order.created', 'order.shipped']
unsub();
```

## Unsubscribe

Funkce `Unsubscribe` vrácená z `subscribe()` je **synchronní** a vrací `void`:

```typescript
const unsubscribe = await client.rules.subscribe('order.*', callback);

// Později — zastavení příjmu eventů
unsubscribe();
```

Při zavolání:
1. Odběr je okamžitě odebrán z lokálního `SubscriptionManager`
2. Požadavek `rules.unsubscribe` je odeslán na server (fire-and-forget — chyby jsou tiše zachyceny)
3. Žádné další eventy nejsou doručovány do callbacku

Vícenásobné volání `unsubscribe()` je bezpečné — následná volání jsou no-op.

## Více souběžných odběrů

Můžete mít více aktivních odběrů s různými pattern. Každý funguje nezávisle:

```typescript
const orderUnsub = await client.rules.subscribe('order.*', (event, topic) => {
  console.log(`[order] ${topic}:`, event.data);
});

const userUnsub = await client.rules.subscribe('user.*', (event, topic) => {
  console.log(`[user] ${topic}:`, event.data);
});

// Oba přijímají své příslušné eventy nezávisle
await client.rules.emit('order.created', { orderId: '1' });
await client.rules.emit('user.registered', { userId: 'u1' });

// Zrušení jednoho neovlivní druhý
orderUnsub();
// odběr uživatelů stále aktivní
await client.rules.emit('user.login', { userId: 'u1' });
// callback [user] se spustí — callback [order] ne

userUnsub();
```

## Obnova po reconnectu

Rules odběry jsou automaticky obnoveny při reconnectu klienta. SDK znovu odešle požadavek `rules.subscribe` s původním pattern a server přidělí nové `subscriptionId`:

```typescript
client.on('reconnected', () => {
  console.log('Reconnectnuto — rules odběry obnoveny automaticky');
});

const unsub = await client.rules.subscribe('order.*', (event, topic) => {
  // Tento callback funguje během běžného provozu I po reconnectu.
  // Eventy emitované během odpojení jsou ztraceny — žádné přehrání.
  handleOrderEvent(event, topic);
});
```

Po reconnectu:
- Odběr je znovu navázán se stejným pattern
- Žádná počáteční data nejsou doručena (rules odběry nikdy nedoručují počáteční data)
- Eventy, které nastaly během odpojení, **nejsou** přehrány
- Pokud se obnovení odběru nezdaří, odběr je tiše odebrán a zalogován do `console.error`

## Kompletní funkční příklad

Systém monitorování objednávek, který v reálném čase loguje všechny eventy objednávek:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { RulesEvent } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Odběr všech eventů objednávek
  const unsub = await client.rules.subscribe('order.*', (event: RulesEvent, topic: string) => {
    const time = new Date(event.timestamp).toISOString();
    console.log(`[${time}] ${topic}:`, JSON.stringify(event.data));
    if (event.correlationId) {
      console.log(`  correlation: ${event.correlationId}`);
    }
  });

  // Simulace životního cyklu objednávky
  const placed = await client.rules.emit('order.placed', {
    orderId: 'ORD-1',
    total: 150,
  });

  await client.rules.emit(
    'order.paid',
    { orderId: 'ORD-1', method: 'card' },
    placed.id,
    placed.id,
  );

  await client.rules.emit(
    'order.shipped',
    { orderId: 'ORD-1', carrier: 'FedEx' },
    placed.id,
  );

  // Počkáme na doručení všech pushů
  await new Promise((r) => setTimeout(r, 500));

  // Cleanup
  unsub();
  await client.disconnect();
}

main().catch(console.error);
```

Výstup:

```
[2025-01-15T10:00:00.050Z] order.placed: {"orderId":"ORD-1","total":150}
[2025-01-15T10:00:00.100Z] order.paid: {"orderId":"ORD-1","method":"card"}
  correlation: evt-abc123
[2025-01-15T10:00:00.150Z] order.shipped: {"orderId":"ORD-1","carrier":"FedEx"}
  correlation: evt-abc123
```

## Cvičení

Napište skript, který:
1. Vytvoří dva odběry: jeden pro eventy `order.*` a jeden pro eventy `payment.*`
2. Sbírá eventy do dvou oddělených polí
3. Emituje `order.created`, `payment.received` a `order.shipped`
4. Počká na pushe a poté ověří:
   - Pole objednávek má 2 eventy (`order.created`, `order.shipped`)
   - Pole plateb má 1 event (`payment.received`)
5. Zruší odběr objednávek, emituje `order.cancelled` a ověří, že pole objednávek má stále 2

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { RulesEvent } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const orderEvents: Array<{ event: RulesEvent; topic: string }> = [];
  const paymentEvents: Array<{ event: RulesEvent; topic: string }> = [];

  // 1. Odběr obou pattern
  const unsubOrders = await client.rules.subscribe('order.*', (event, topic) => {
    orderEvents.push({ event, topic });
  });

  const unsubPayments = await client.rules.subscribe('payment.*', (event, topic) => {
    paymentEvents.push({ event, topic });
  });

  // 3. Emitování eventů
  await client.rules.emit('order.created', { orderId: '1' });
  await client.rules.emit('payment.received', { amount: 100 });
  await client.rules.emit('order.shipped', { orderId: '1' });

  // 4. Čekání a ověření
  await new Promise((r) => setTimeout(r, 500));

  console.log('Eventy objednávek:', orderEvents.length);   // 2
  console.log('Eventy plateb:', paymentEvents.length); // 1
  console.log('Topicy objednávek:', orderEvents.map((e) => e.topic));
  // ['order.created', 'order.shipped']

  // 5. Zrušení odběru objednávek, emitování dalšího
  unsubOrders();
  await client.rules.emit('order.cancelled', { orderId: '1' });
  await new Promise((r) => setTimeout(r, 200));

  console.log('Eventy objednávek po unsubscribe:', orderEvents.length); // stále 2

  unsubPayments();
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `rules.subscribe(pattern, callback)` odebírá eventy pravidlového enginu odpovídající pattern
- Žádná počáteční data nejsou doručena — callback se spustí pouze při nových eventech
- Callback přijímá `(event: RulesEvent, topic: string)` — jak event, tak odpovídající topic
- Vrácená funkce `Unsubscribe` je synchronní a fire-and-forget
- Více odběrů s různými pattern funguje nezávisle
- Zrušení jednoho pattern neovlivní ostatní
- Odběry jsou automaticky obnoveny při reconnectu (bez přehrání zmeškaných eventů)
- Push kanál je `event` (oddělený od store kanálu `subscription`)

---

Další: [Přihlášení a odhlášení](../07-autentizace/01-prihlaseni-a-odhlaseni.md)
