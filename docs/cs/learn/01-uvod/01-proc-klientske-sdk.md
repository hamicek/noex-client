# Proč klientské SDK?

S noex-serverem můžete komunikovat přes obyčejný WebSocket. Otevřete spojení, pošlete JSON, naparsujete JSON, hotovo. Funguje to — dokud to nepřestane fungovat. Ve chvíli, kdy potřebujete korelaci request/response, reconnect, správu odběrů nebo typovou bezpečnost, stejně píšete vlastní SDK. Tato kapitola vysvětluje, proč vestavěné SDK existuje a jaké problémy řeší.

## Co se naučíte

- Proč se ruční práce s WebSocket zprávami stává údržbovou pastí
- Jak vypadá surová WebSocket komunikace s noex-serverem
- Jak SDK eliminuje boilerplate a vynucuje správnost
- Třívrstvá architektura, která to umožňuje

## Problém: Surová WebSocket komunikace

### Ruční framování zpráv

noex-server používá JSON protokol přes WebSocket. Každá zpráva, kterou odešlete, musí obsahovat `type`, unikátní `id` pro korelaci a `payload`. Server odpoví se stejným `id`, abyste mohli spárovat požadavky s odpověďmi. Takto vypadá jednoduchá operace „vložit záznam" bez SDK:

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  // Nejdřív počkejte na welcome zprávu
  // ...pak odešlete požadavek
  ws.send(JSON.stringify({
    id: crypto.randomUUID(),
    type: 'store.insert',
    payload: { bucket: 'users', data: { name: 'Alice' } },
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === 'welcome') {
    console.log('Connected to server', msg.payload.version);
  } else if (msg.type === 'response') {
    // Ke kterému požadavku tato odpověď patří?
    // Potřebujete Map<id, callback> pro korelaci.
  } else if (msg.type === 'push') {
    // Aktualizace odběru — směrujte na správný handler
  } else if (msg.type === 'ping') {
    // Musíte odpovědět pong, jinak vás server odpojí
    ws.send(JSON.stringify({ type: 'pong' }));
  }
});
```

Tohle je jen jeden insert. Každá operace vyžaduje stejný boilerplate: vygenerovat ID, serializovat, odeslat, čekat, korelovat, naparsovat, ošetřit chyby, ošetřit timeout.

### Žádná korelace z krabice

WebSocket je obousměrný proud. Když odešlete tři požadavky najednou, dostanete tři odpovědi — ale v jakém pořadí? Potřebujete registr čekajících požadavků:

```typescript
const pending = new Map<string, {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function sendRequest(type: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Request timeout'));
    }, 10_000);

    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, type, payload }));
  });
}

// V message handleru:
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'response' && pending.has(msg.id)) {
    const { resolve, reject, timer } = pending.get(msg.id)!;
    clearTimeout(timer);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.payload);
  }
});
```

Právě jste napsali 25 řádků infrastruktury pro něco, co SDK dělá interně.

### Reconnect je váš problém

Když vypadne síť, váš WebSocket se zavře. Teď potřebujete:

1. Detekovat close event a rozhodnout se, zda se znovu připojit
2. Implementovat exponenciální backoff, abyste nezahltili server
3. Znovu navázat spojení a znovu se autentizovat
4. Obnovit všechny aktivní odběry
5. Doručit čerstvá data každému callback odběru

```text
┌───────────────────────────────────────────────────────────┐
│              Co musíte implementovat sami                  │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  1. Sledování timeoutů       setTimeout per požadavek     │
│  2. Korelace požadavků       Map<id, Promise>             │
│  3. Směrování push zpráv     směrování dle subscriptionId │
│  4. Heartbeat                odpovídat na server ping     │
│  5. Reconnect smyčka        backoff + jitter + retry      │
│  6. Re-auth při reconnectu  znovu odeslat auth.login      │
│  7. Obnovení odběrů         znovu zaregistrovat všechny   │
│  8. Normalizace chyb        parsování serverových kódů    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

Každý z těchto bodů je zdrojem záludných chyb. Zmeškáte heartbeat? Server vás odpojí. Zapomenete obnovit odběry? Tichá ztráta dat. Špatný timeout? Kaskádové selhání.

### Důsledky

| Oblast | Surový WebSocket | S SDK |
|--------|------------------|-------|
| **Framování zpráv** | Serializujete/parsujete každou zprávu | Řešeno interně |
| **Korelace request/response** | Stavíte vlastní Map + timeout | `await bucket.insert(data)` |
| **Směrování odběrů** | Parsovat push, najít ID, zavolat handler | `store.subscribe(q, callback)` |
| **Heartbeat** | Naslouchat ping, odpovědět pong | Automatický |
| **Reconnect** | Backoff smyčka + obnovení odběrů + reauth | Vestavěný, konfigurovatelný |
| **Typová bezpečnost** | Žádná (surový JSON) | `BucketAPI<T>` generics |
| **Ošetření chyb** | Parsovat chybové kódy sami | Typovaná `NoexClientError` hierarchie |
| **Řízení timeoutů** | Ruční `setTimeout` per požadavek | Volba `requestTimeoutMs` |

## Řešení: Tři vrstvy abstrakce

SDK organizuje vše do tří vrstev:

```text
┌───────────────────────────────────────────────────────────┐
│                       API vrstva                          │
│  store.bucket('users').insert({ name: 'Alice' })         │
│  rules.emit('user.created', { userId: '123' })           │
│  auth.login('jwt-token')                                 │
├───────────────────────────────────────────────────────────┤
│                    Protokolová vrstva                      │
│  Framování zpráv (JSON { id, type, payload })             │
│  Korelace request/response (pending Map)                  │
│  Směrování push zpráv (subscriptionId → callback)         │
│  Vynucení timeoutu (requestTimeoutMs)                     │
├───────────────────────────────────────────────────────────┤
│                   Transportní vrstva                       │
│  Správa WebSocket spojení                                 │
│  Reconnect s exponenciálním backoff + jitter              │
│  Heartbeat (automatická pong odpověď)                     │
│  Stavový automat spojení                                  │
└───────────────────────────────────────────────────────────┘
```

Pracujete s **API vrstvou**. Protokolová a transportní vrstva jsou neviditelné, ale dělají veškerou těžkou práci. Když zavoláte `bucket.insert(data)`, SDK:

1. Serializuje požadavek s unikátním ID
2. Odešle ho přes WebSocket
3. Spustí timeout timer
4. Čeká na korelovanou odpověď
5. Naparsuje odpověď, rejectne při chybě, resolvne při úspěchu
6. Vrátí typovaný výsledek

Vše v jediném `await`.

## Kompletní funkční příklad

Stejná operace „vložit uživatele" — surový WebSocket vs SDK:

**Surový WebSocket (30+ řádků):**

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
const pending = new Map<string, { resolve: Function; reject: Function }>();

ws.on('open', () => {
  ws.once('message', (raw) => {
    const welcome = JSON.parse(raw.toString());
    if (welcome.type !== 'welcome') throw new Error('Expected welcome');

    const id = crypto.randomUUID();
    pending.set(id, {
      resolve: (data: unknown) => console.log('Created:', data),
      reject: (err: Error) => console.error('Failed:', err),
    });
    ws.send(JSON.stringify({
      id,
      type: 'store.insert',
      payload: { bucket: 'users', data: { name: 'Alice' } },
    }));
  });
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'response' && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)!;
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.payload);
  }
});
```

**S SDK (6 řádků):**

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const users = client.store.bucket('users');
const alice = await users.insert({ name: 'Alice' });
console.log('Created:', alice);

await client.disconnect();
```

Stejný výsledek. Verze s SDK je správná ze své podstaty — korelaci, timeout, parsování chyb a cleanup řeší automaticky.

## Cvičení

Máte následující surový WebSocket kód, který načte uživatele a aktualizuje jeho jméno. Přepište ho pomocí SDK.

```typescript
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  // zpracování welcome vynecháno pro stručnost
  const getId = crypto.randomUUID();
  ws.send(JSON.stringify({
    id: getId,
    type: 'store.get',
    payload: { bucket: 'users', key: 'user-1' },
  }));
  // pak v message handleru najít odpověď,
  // naparsovat ji a odeslat update požadavek...
});
```

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();

const users = client.store.bucket('users');
const user = await users.get('user-1');

if (user) {
  const updated = await users.update('user-1', { name: 'Bob' });
  console.log('Updated:', updated);
}

await client.disconnect();
```

Tři řádky business logiky místo vnořených callbacků s ruční JSON serializací. SDK zajistí korelaci, kontrolu chyb a typovou inferenci.

</details>

## Shrnutí

- Surová WebSocket komunikace s noex-serverem vyžaduje ruční framování zpráv, korelaci požadavků, směrování push zpráv, obsluhu heartbeat, reconnect a parsování chyb
- Každá z těchto oblastí je zdrojem záludných chyb — zmeškané heartbeaty, ztracené odběry, race conditions
- SDK to vše zabalí do třívrstvé architektury: transport (spojení), protokol (framování + korelace) a API (typované operace)
- Získáte `await`-based operace, automatický reconnect a TypeScript typovou bezpečnost zdarma

---

Další: [Klíčové koncepty](./02-klicove-koncepty.md)
