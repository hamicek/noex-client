# Eventy

Pravidlový engine zpracovává **eventy** — zprávy publikované na topic, které spouštějí serverová pravidla. Klientské SDK poskytuje `rules.emit()` pro publikování eventů a přijetí serverem vytvořeného objektu eventu s přiděleným `id`, `timestamp` a `source`. Eventy lze propojit pomocí correlation a causation ID, což umožňuje end-to-end trasování řetězců událostí.

## Co se naučíte

- Jak emitovat eventy do pravidlového enginu pomocí `rules.emit()`
- Struktura vráceného objektu `RulesEvent`
- Jak trasovat související eventy pomocí `correlationId` a `causationId`
- Zpracování chyb, když pravidlový engine není dostupný

## Jak eventy fungují

Eventy proudí od klienta do serverového pravidlového enginu:

```
Klient                          Server
┌──────────────┐  rules.emit   ┌───────────────────────┐
│ rules.emit() │──────────────>│ Pravidlový engine      │
│              │               │ ┌───────────────────┐  │
│              │               │ │ Přidělení id, ts  │  │
│              │               │ │ Vyhodnocení        │  │
│              │  RulesEvent   │ │ pravidel           │  │
│              │<──────────────│ │ Vrácení eventu     │  │
└──────────────┘               │ └───────────────────┘  │
                               └───────────────────────┘
```

Klíčové body:
- Event je uložen a zpracován pravidlovým enginem na serveru
- Všechna odpovídající pravidla jsou vyhodnocena před vrácením odpovědi
- Vrácený `RulesEvent` obsahuje serverem přidělené `id` a `timestamp`
- Eventy bez `data` jsou validní — samotný topic může nést význam

## rules.emit()

Základní forma přijímá topic a volitelná data:

```typescript
const event = await client.rules.emit('order.created', { orderId: '100' });
console.log(event.id);        // serverem přidělené unikátní ID
console.log(event.timestamp); // serverem přidělený timestamp
console.log(event.topic);     // 'order.created'
console.log(event.data);      // { orderId: '100' }
```

**Signatura:**

```typescript
emit(
  topic: string,
  data?: Record<string, unknown>,
  correlationId?: string,
  causationId?: string,
): Promise<RulesEvent>
```

| Parametr | Typ | Povinný | Popis |
|----------|-----|---------|-------|
| topic | `string` | ano | Topic eventu (např. `'order.created'`, `'user.login'`) |
| data | `Record<string, unknown>` | ne | Libovolný payload eventu |
| correlationId | `string` | ne | Correlation ID pro trasování souvisejících eventů |
| causationId | `string` | ne | ID příčinného eventu (vyžaduje `correlationId`) |

Vrací `Promise<RulesEvent>` — serverem vytvořený event.

## RulesEvent

Každý emitovaný event vrací objekt `RulesEvent`:

```typescript
interface RulesEvent {
  readonly id: string;
  readonly topic: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly source: string;
}
```

| Pole | Popis |
|------|-------|
| `id` | Serverem přidělený unikátní identifikátor |
| `topic` | Topic, na který byl event emitován |
| `data` | Payload předaný do `emit()` (prázdný objekt `{}` pokud byl vynechán) |
| `timestamp` | Serverem přidělený timestamp (Unix ms) |
| `correlationId` | Correlation ID, pokud bylo zadáno |
| `causationId` | Causation ID, pokud bylo zadáno |
| `source` | Identifikátor zdroje eventu (např. klientské připojení) |

## Emitování bez dat

Parametr `data` je volitelný. Event pouze s topicem je užitečný pro jednoduché signály:

```typescript
const ping = await client.rules.emit('system.ping');
console.log(ping.topic); // 'system.ping'
```

## Correlation a causation

Když eventy tvoří řetězec — např. objednávka spustí platbu, která spustí odeslání — můžete řetězec trasovat pomocí `correlationId` a `causationId`:

```
Objednávka zadána ──────> Platba zpracována ──────> Zásilka vytvořena
correlationId: 'tx-1'     correlationId: 'tx-1'     correlationId: 'tx-1'
causationId: —             causationId: order.id      causationId: payment.id
```

```typescript
// Krok 1: Začátek řetězce s correlationId
const order = await client.rules.emit(
  'order.placed',
  { orderId: 'ORD-42', total: 99.90 },
  'tx-1',
);

// Krok 2: Pokračování řetězce — odkaz na objednávku jako příčinu
const payment = await client.rules.emit(
  'payment.processed',
  { orderId: 'ORD-42', amount: 99.90 },
  'tx-1',
  order.id,
);

// Krok 3: Dokončení řetězce — odkaz na platbu jako příčinu
const shipment = await client.rules.emit(
  'shipment.created',
  { orderId: 'ORD-42', carrier: 'DHL' },
  'tx-1',
  payment.id,
);

// Všechny tři sdílejí correlationId 'tx-1'
// Každý ukazuje na předchozí event přes causationId
```

Parametr `causationId` vyžaduje nastavení `correlationId` — nelze mít causation bez kontextu correlation.

## Zpracování chyb

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await client.rules.emit('order.created', { orderId: '100' });
} catch (err) {
  if (err instanceof NoexClientError) {
    // VALIDATION_ERROR — prázdný topic, neplatná data
    // RULES_NOT_AVAILABLE — server nemá nakonfigurovaný pravidlový engine
    console.log(err.code, err.message);
  }
  if (err instanceof TimeoutError) {
    console.log('Server neodpověděl včas');
  }
  if (err instanceof DisconnectedError) {
    console.log('Nepřipojeno k serveru');
  }
}
```

Chyba `RULES_NOT_AVAILABLE` nastane, když je server spuštěn bez pravidlového enginu. Váš klientský kód by měl tento případ ošetřit, pokud je pravidlový engine ve vaší architektuře volitelnou komponentou.

## Kompletní funkční příklad

Pipeline zpracování objednávek s korelovanými eventy:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Emitování eventu objednávky
  const order = await client.rules.emit('order.placed', {
    orderId: 'ORD-1',
    items: ['widget', 'gadget'],
    total: 49.99,
  });

  console.log(`Event objednávky: ${order.id} v ${new Date(order.timestamp).toISOString()}`);

  // Emitování korelovaného eventu platby
  const payment = await client.rules.emit(
    'payment.completed',
    { orderId: 'ORD-1', method: 'card' },
    order.id, // použití ID eventu objednávky jako correlation ID
    order.id, // event objednávky způsobil tuto platbu
  );

  console.log(`Event platby: ${payment.id}`);
  console.log(`  correlationId: ${payment.correlationId}`);
  console.log(`  causationId: ${payment.causationId}`);

  // Emitování jednoduchého signálu — data nejsou potřeba
  await client.rules.emit('system.health-check');

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Emituje event `user.registered` s daty `{ userId: 'u1', name: 'Alice' }`
2. Emituje event `welcome.email.sent` korelovaný s registrací, přičemž použije `id` registračního eventu jako `correlationId` i `causationId`
3. Zaloguje `id`, `topic` a `correlationId` obou eventů

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const registration = await client.rules.emit('user.registered', {
    userId: 'u1',
    name: 'Alice',
  });

  console.log(`Registrace: id=${registration.id}, topic=${registration.topic}`);

  const welcome = await client.rules.emit(
    'welcome.email.sent',
    { userId: 'u1', email: 'alice@example.com' },
    registration.id,
    registration.id,
  );

  console.log(`Uvítání: id=${welcome.id}, topic=${welcome.topic}`);
  console.log(`  correlationId: ${welcome.correlationId}`);

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `rules.emit(topic, data?, correlationId?, causationId?)` publikuje event do pravidlového enginu
- Vrácený `RulesEvent` obsahuje serverem přidělené `id`, `timestamp` a `source`
- `data` jsou volitelná — eventy pouze s topicem jsou validní pro jednoduché signály
- Použijte `correlationId` pro seskupení souvisejících eventů a `causationId` pro budování řetězců příčin
- `causationId` vyžaduje nastavení `correlationId`
- Server vyhodnotí všechna odpovídající pravidla před vrácením odpovědi
- `RULES_NOT_AVAILABLE` je vyhozena, když server nemá nakonfigurovaný pravidlový engine

---

Další: [Fakta](./02-fakta.md)
