# První připojení

Tato kapitola vás provede prvním připojením k noex-serveru. Naučíte se vytvořit klienta, připojit se, prozkoumat welcome zprávu, naslouchat lifecycle událostem a čistě se odpojit.

## Co se naučíte

- Jak vytvořit instanci `NoexClient` a zavolat `connect()`
- Co obsahuje welcome zpráva serveru
- Jak naslouchat lifecycle událostem (`connected`, `disconnected`, `error`)
- Jak se elegantně odpojit

## Vytvoření klienta

Konstruktor `NoexClient` přijímá WebSocket URL a volitelný konfigurační objekt. **Neotevírá** spojení — k tomu dojde až při zavolání `connect()`.

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

// Vytvoření klienta (zatím žádné spojení)
const client = new NoexClient('ws://localhost:8080', { WebSocket });

console.log(client.state);       // 'disconnected'
console.log(client.isConnected); // false
```

Dvoukrokový vzor (vytvořit, pak připojit) vám dává prostor zaregistrovat posluchače událostí ještě před otevřením spojení.

## Připojení

`connect()` otevře WebSocket, počká na welcome zprávu ze serveru a vrátí objekt `WelcomeInfo`:

```typescript
const welcome = await client.connect();

console.log(welcome.version);      // např. '1.0.0'
console.log(welcome.serverTime);   // např. 1706745600000 (Unix ms)
console.log(welcome.requiresAuth); // true nebo false

console.log(client.state);         // 'connected'
console.log(client.isConnected);   // true
```

Pokud se připojení nezdaří nebo welcome zpráva nedorazí v rámci `connectTimeoutMs` (výchozí: 5000 ms), promise se rejectne.

### Co se děje během `connect()`

```text
  Klient                                  Server
    │                                         │
    │  WebSocket open ───────────────────────►│
    │                                         │
    │◄─────────────────── welcome zpráva ─────│
    │  { version, serverTime, requiresAuth }  │
    │                                         │
    │  (auto-login pokud je auth.token nastaven)│
    │  auth.login(token) ───────────────────►│
    │◄─────────────── odpověď session ────────│
    │                                         │
    │  connect() se resolvne s WelcomeInfo    │
```

Pokud je `auth.token` nastavený ve volbách klienta a server hlásí `requiresAuth: true`, SDK automaticky odešle požadavek `auth.login` ještě před resolvnutím `connect()`.

## Lifecycle události

Zaregistrujte posluchače událostí před zavoláním `connect()`, abyste zachytili každý přechod stavu:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });

// Registrace posluchačů před připojením
client.on('connected', () => {
  console.log('Připojeno!');
});

client.on('disconnected', (reason) => {
  console.log('Odpojeno:', reason);
});

client.on('error', (error) => {
  console.error('Chyba:', error.message);
});

client.on('reconnecting', (attempt) => {
  console.log(`Reconnect... pokus č. ${attempt}`);
});

client.on('reconnected', () => {
  console.log('Reconnect úspěšný! Odběry obnoveny.');
});

client.on('welcome', (info) => {
  console.log('Verze serveru:', info.version);
});

// Nyní se připojte
await client.connect();
```

### Odhlášení z událostí

`client.on()` vrací synchronní unsubscribe funkci:

```typescript
const off = client.on('error', (err) => {
  console.error(err);
});

// Později: přestat naslouchat
off();
```

Tohle sleduje stejný vzor jako store odběry — každé `on()` nebo `subscribe()` vrací cleanup funkci.

## Odpojení

`disconnect()` elegantně uzavře spojení:

```typescript
await client.disconnect();

console.log(client.state);       // 'disconnected'
console.log(client.isConnected); // false
```

Při zavolání `disconnect()`:

1. Reconnect smyčka se zastaví (pokud je aktivní)
2. Všechny čekající požadavky jsou rejectnuty s `DisconnectedError`
3. Všechny odběry jsou vyčištěny
4. WebSocket je uzavřen s kódem `1000` (normální uzavření)
5. Emituje se událost `'disconnected'`

### Vzor pro cleanup

Typický životní cyklus aplikace:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', { WebSocket });

// Ošetření ukončení procesu
process.on('SIGINT', async () => {
  await client.disconnect();
  process.exit(0);
});

await client.connect();

// ... používejte klienta ...
```

## Stav spojení

Aktuální stav můžete kdykoli zkontrolovat:

```typescript
client.state;       // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
client.isConnected; // zkratka pro client.state === 'connected'
```

Operace jako `bucket.insert()` nebo `store.subscribe()` vyžadují, aby byl klient ve stavu `'connected'`. Pokud je zavoláte v odpojeném stavu nebo během reconnectu, vyhodí `DisconnectedError`.

## Kompletní funkční příklad

Celý skript, který se připojí, vypíše welcome informace, provede jednoduchou operaci a odpojí se:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });

  client.on('connected', () => console.log('Připojeno'));
  client.on('disconnected', (reason) => console.log('Odpojeno:', reason));
  client.on('error', (err) => console.error('Chyba:', err.message));

  const welcome = await client.connect();
  console.log(`Server v${welcome.version}, čas: ${new Date(welcome.serverTime).toISOString()}`);
  console.log(`Vyžadována autentizace: ${welcome.requiresAuth}`);

  // Rychlý test: vložit a načíst záznam
  const items = client.store.bucket('items');
  const item = await items.insert({ name: 'test' });
  console.log('Vytvořeno:', item.id);

  const fetched = await items.get(item.id);
  console.log('Načteno:', fetched?.name);

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Vytvoří `NoexClient` a zaregistruje všech šest lifecycle posluchačů událostí
2. Připojí se k serveru
3. Vypíše verzi serveru a zda je vyžadována autentizace
4. Odpojí se po 3 sekundách

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });

  client.on('connected', () => console.log('[event] connected'));
  client.on('disconnected', (reason) => console.log('[event] disconnected:', reason));
  client.on('reconnecting', (attempt) => console.log('[event] reconnecting:', attempt));
  client.on('reconnected', () => console.log('[event] reconnected'));
  client.on('error', (err) => console.log('[event] error:', err.message));
  client.on('welcome', (info) => console.log('[event] welcome:', info.version));

  const welcome = await client.connect();
  console.log(`Server: v${welcome.version}`);
  console.log(`Vyžadována autentizace: ${welcome.requiresAuth}`);

  setTimeout(async () => {
    await client.disconnect();
    console.log('Hotovo');
  }, 3_000);
}

main().catch(console.error);
```

Měli byste vidět události `connected` a `welcome` hned po `connect()`, a pak po 3 sekundách se vyvolá událost `disconnected`.

</details>

## Shrnutí

- `new NoexClient(url, options)` vytvoří klienta bez připojení — zavolejte `connect()` zvlášť
- `connect()` otevře WebSocket, počká na welcome zprávu a volitelně provede automatické přihlášení
- Welcome zpráva vám sdělí `version` serveru, `serverTime` a `requiresAuth`
- Zaregistrujte lifecycle posluchače pomocí `client.on()` před připojením, abyste zachytili každý přechod
- `disconnect()` zastaví reconnect, rejectne čekající požadavky, vyčistí odběry a zavře socket
- Pomocí `client.state` nebo `client.isConnected` zkontrolujete aktuální stav spojení

---

Další: [Konfigurace](./03-konfigurace.md)
