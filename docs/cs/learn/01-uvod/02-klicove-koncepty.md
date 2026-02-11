# Klíčové koncepty

Než začnete psát jakýkoliv kód, tato kapitola vybuduje mentální model toho, jak je SDK strukturované. Porozumíte vrstvené architektuře, životnímu cyklu spojení a slovníku používanému ve zbytku průvodce.

## Co se naučíte

- Jak tři vrstvy (transport, protokol, API) rozdělují odpovědnost
- Co znamená každý stav spojení a kdy dochází k přechodům
- Jak požadavky, odpovědi a push zprávy proudí systémem
- Slovníček pojmů používaných ve všech následujících kapitolách

## Architektura: Tři vrstvy

SDK je organizováno do tří vrstev, z nichž každá má jednu odpovědnost:

```text
┌─────────────────────────────────────────────────────────────┐
│                        Váš kód                               │
│                                                             │
│  const users = client.store.bucket<User>('users');          │
│  const alice = await users.insert({ name: 'Alice' });      │
│  const unsub = await client.store.subscribe('q', cb);       │
│  await client.rules.emit('user.created', { id: alice.id }); │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      API vrstva                              │
│                                                             │
│  StoreAPI   →  bucket(), subscribe(), transaction()         │
│  BucketAPI  →  insert(), get(), update(), delete(), ...     │
│  RulesAPI   →  emit(), setFact(), getFact(), subscribe()    │
│  AuthAPI    →  login(), logout(), whoami()                  │
│                                                             │
│  Překládá volání metod na protokolové zprávy.               │
│  Vrací typované výsledky.                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Protokolová vrstva                         │
│                                                             │
│  Každá odchozí zpráva: { id, type, payload }                │
│  Každá příchozí odpověď spárována podle id                  │
│  Push zprávy směrovány podle subscriptionId                 │
│  Vynucení timeoutu per požadavek                            │
│                                                             │
│  Zpracovává drátový formát, aby to API vrstva nemusela.     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Transportní vrstva                         │
│                                                             │
│  WebSocket open / close / send / receive                    │
│  Reconnect s exponenciálním backoff + jitter                │
│  Heartbeat (automatická pong odpověď na server ping)        │
│  Stavový automat spojení                                    │
│                                                             │
│  Spravuje fyzické spojení, aby protokolová vrstva           │
│  nemusela řešit reconnect ani surové bajty.                 │
└─────────────────────────────────────────────────────────────┘
```

### API vrstva

S touto vrstvou pracujete. `NoexClient` vystavuje tři jmenné prostory:

| Jmenný prostor | Přístup | Účel |
|----------------|---------|------|
| `client.store` | `StoreAPI` | Bucket CRUD, dotazy, odběry, transakce |
| `client.rules` | `RulesAPI` | Emise událostí, správa faktů, odběry pravidel |
| `client.auth` | `AuthAPI` | Přihlášení tokenem, správa session |

Každá metoda na těchto objektech se přeloží na protokolovou zprávu, odešle ji, počká na odpověď a vrátí typovaný výsledek. Nikdy nesestavujete surový JSON sami.

### Protokolová vrstva

Protokolová vrstva zpracovává drátový formát. noex-server používá jednoduchý JSON protokol přes WebSocket:

**Odchozí požadavek:**
```json
{ "id": "abc-123", "type": "store.insert", "payload": { "bucket": "users", "data": { "name": "Alice" } } }
```

**Příchozí odpověď:**
```json
{ "id": "abc-123", "type": "response", "payload": { "id": "rec-1", "name": "Alice", "_version": 1, "_createdAt": 1706745600000, "_updatedAt": 1706745600000 } }
```

**Příchozí push (aktualizace odběru):**
```json
{ "type": "push", "channel": "subscription", "subscriptionId": "sub-1", "payload": [...] }
```

Protokolová vrstva udržuje `Map<id, Promise>` pro čekající požadavky a směruje push zprávy na správný callback odběru podle `subscriptionId`.

### Transportní vrstva

Transportní vrstva spravuje samotné WebSocket spojení:

- Otevírá a zavírá spojení
- Implementuje reconnect s konfigurovatelným backoff
- Automaticky odpovídá na heartbeat ping ze serveru
- Sleduje stavový automat spojení

## Životní cyklus spojení

Klient má čtyři možné stavy:

```text
                    connect()
  disconnected ──────────────────► connecting
       ▲                               │
       │                          success / timeout
       │                               │
       │   disconnect()            ┌───▼───────┐
       ├───────────────────────────┤ connected  │
       │                           └───┬───────┘
       │                        connection lost
       │                               │
       │     max retries           ┌───▼──────────┐
       ├───────────────────────────┤ reconnecting  │
       │                           └───┬──────────┘
       │                          reconnect success
       │                               │
       │                           ┌───▼───────┐
       └───────────────────────────┤ connected  │
                                   └───────────┘
```

| Stav | Význam |
|------|--------|
| `disconnected` | Počáteční stav. Žádné spojení. Všechny požadavky vyhodí `DisconnectedError`. |
| `connecting` | Bylo zavoláno `connect()`. WebSocket se otevírá a čeká na welcome zprávu ze serveru. |
| `connected` | Spojení je aktivní. Požadavky se odesílají a odpovědi přijímají. |
| `reconnecting` | Spojení bylo neočekávaně ztraceno. Klient se pokouší o reconnect s exponenciálním backoff. Požadavky vyhazují `DisconnectedError`. |

### Události

Klient emituje události při každém přechodu stavu:

| Událost | Kdy | Handler |
|---------|-----|---------|
| `connected` | WebSocket otevřen a welcome přijat | `() => void` |
| `disconnected` | Spojení uzavřeno (po vyčerpání všech pokusů nebo zavolání `disconnect()`) | `(reason: string) => void` |
| `reconnecting` | Před každým pokusem o reconnect | `(attempt: number) => void` |
| `reconnected` | Úspěšný reconnect (odběry již obnoveny) | `() => void` |
| `error` | Transportní chyba nebo vyčerpání maximálního počtu pokusů | `(error: Error) => void` |
| `welcome` | Přijata welcome zpráva ze serveru | `(info: WelcomeInfo) => void` |

Na události se přihlašujete pomocí `client.on()`, které vrací unsubscribe funkci:

```typescript
const off = client.on('reconnecting', (attempt) => {
  console.log(`Pokus o reconnect č. ${attempt}...`);
});

// Později: přestat naslouchat
off();
```

## Tok zpráv

Takto prochází jedno volání `bucket.insert()` vrstvami:

```text
  Váš kód                 API vrstva             Protokolová vrstva     Transportní vrstva
     │                        │                        │                       │
     │  users.insert(data)    │                        │                       │
     │───────────────────────►│                        │                       │
     │                        │  request('store.insert',│                       │
     │                        │    { bucket, data })    │                       │
     │                        │───────────────────────►│                       │
     │                        │                        │  vygenerovat id       │
     │                        │                        │  JSON.stringify()     │
     │                        │                        │  spustit timeout      │
     │                        │                        │  ws.send(json)        │
     │                        │                        │──────────────────────►│
     │                        │                        │                       │
     │                        │                        │     (server zpracuje) │
     │                        │                        │                       │
     │                        │                        │  ws.onmessage(json)   │
     │                        │                        │◄──────────────────────│
     │                        │                        │  spárovat id → resolve│
     │                        │  typovaný výsledek     │  zrušit timeout       │
     │                        │◄───────────────────────│                       │
     │  T & RecordMeta        │                        │                       │
     │◄───────────────────────│                        │                       │
```

U **push zpráv** (aktualizace odběrů) je tok odlišný — žádný požadavek neexistuje. Server pošle push, protokolová vrstva ho spáruje podle `subscriptionId` a přímo zavolá zaregistrovaný callback.

## Slovníček

| Pojem | Definice |
|-------|----------|
| **Bucket** | Pojmenovaná kolekce záznamů na serveru (jako databázová tabulka). Přístupná přes `client.store.bucket('name')`. |
| **RecordMeta** | Serverem generovaná metadata přidaná ke každému záznamu: `id`, `_version`, `_createdAt`, `_updatedAt`. |
| **Subscription (odběr)** | Živé spojení na serverový dotaz. Když se výsledek dotazu změní, server pushne nová data klientovi. |
| **Push** | Serverem iniciovaná zpráva doručující aktualizace odběrů nebo události pravidel. Není to odpověď na požadavek. |
| **Welcome** | První zpráva, kterou server pošle po otevření WebSocket spojení. Obsahuje `version`, `serverTime` a `requiresAuth`. |
| **Heartbeat** | Periodická výměna ping/pong mezi serverem a klientem. Server pošle ping; SDK automaticky odpoví pong. Detekuje mrtvá spojení. |
| **Reconnect** | Automatické obnovení ztraceného spojení s exponenciálním backoff a jitter. Po reconnectu jsou obnoveny aktivní odběry. |
| **Transakce** | Atomická dávka store operací. Všechny operace uspějí, nebo všechny selžou — žádné částečné výsledky. |
| **Unsubscribe** | Synchronní funkce `() => void` vrácená z `subscribe()`. Jejím zavoláním přestanete dostávat push aktualizace a notifikujete server. |
| **WelcomeInfo** | Typovaný objekt vrácený z `connect()`: `{ version: string, serverTime: number, requiresAuth: boolean }`. |
| **ConnectionState** | Jedna ze čtyř hodnot: `'disconnected'`, `'connecting'`, `'connected'`, `'reconnecting'`. |

## Cvičení

Nakreslete tok zpráv (jako seznam kroků) pro následující scénář:

1. Klient zavolá `client.store.subscribe('all-users', callback)`
2. Druhý klient vloží nového uživatele do bucketu `users`
3. Server pushne aktualizovaný výsledek dotazu prvnímu klientovi

<details>
<summary>Řešení</summary>

**Krok 1: Požadavek na subscribe**

1. API vrstva přeloží `store.subscribe('all-users', callback)` na požadavek `store.subscribe`
2. Protokolová vrstva vygeneruje unikátní `id`, serializuje `{ id, type: 'store.subscribe', payload: { query: 'all-users' } }`
3. Transportní vrstva odešle JSON přes WebSocket
4. Server zpracuje odběr, vrátí odpověď s `subscriptionId` a počátečními daty
5. Protokolová vrstva spáruje odpověď podle `id`, zaregistruje callback pod `subscriptionId`
6. Callback je zavolán s počátečními daty
7. `Promise<Unsubscribe>` se resolvne

**Krok 2: Druhý klient vloží záznam**

8. Druhý klient odešle požadavek na insert na server
9. Server zpracuje insert a detekuje, že se výsledek dotazu `all-users` změnil

**Krok 3: Push aktualizace**

10. Server odešle push zprávu: `{ type: 'push', channel: 'subscription', subscriptionId: 'sub-1', payload: [...] }`
11. Transportní vrstva přijme WebSocket zprávu
12. Protokolová vrstva směruje push podle `subscriptionId` na zaregistrovaný callback
13. Callback je zavolán s aktualizovanými daty

Klíčový poznatek: push zprávy zcela obcházejí cyklus request/response. Přicházejí asynchronně a jsou směrovány podle `subscriptionId`, nikoliv podle `id` požadavku.

</details>

## Shrnutí

- SDK má tři vrstvy: **transport** (WebSocket + reconnect), **protokol** (framování + korelace) a **API** (typované metody)
- Životní cyklus spojení má čtyři stavy: `disconnected` → `connecting` → `connected` → `reconnecting`
- Každý přechod stavu emituje událost, na kterou můžete naslouchat pomocí `client.on()`
- Požadavky proudí dolů vrstvami; odpovědi a push zprávy proudí zpět nahoru
- Push zprávy (odběry) obcházejí request/response — jsou směrovány podle `subscriptionId`
- Slovníček pokrývá klíčové pojmy: bucket, subscription, push, welcome, heartbeat, reconnect, transakce

---

Další: [Instalace](../02-zaciname/01-instalace.md)
