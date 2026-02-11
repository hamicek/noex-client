# Automaticky reconnect

Síťová spojení padají -- servery se restartují, WiFi se připojuje znovu, load balancery rotují. SDK tohle vše zvládá automaticky s exponential backoff, jitter a konfigurovatelnými limity pokusů. Strategii nastavíte jednou a SDK se postará o znovunavázání spojení transparentně.

## Co se naučíte

- Jak zapnout a konfigurovat automatický reconnect pomocí `ReconnectOptions`
- Jak exponential backoff s jitter zabraňuje thundering herd efektu
- Které lifecycle eventy se emitují během reconnectu
- Co se stane s čekajícími požadavky při výpadku spojení
- Jak reconnect vypnout nebo zastavit programaticky

## Reconnect je zapnutý ve výchozím stavu

Když vytvoříte `NoexClient`, reconnect je **zapnutý** ve výchozím stavu s rozumnými výchozími hodnotami:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

// Reconnect je zapnutý s výchozími hodnotami — žádná další konfigurace není potřeba
const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();
// Pokud spojení vypadne, SDK se automaticky reconnectne.
```

Můžete ho explicitně vypnout:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: false, // Žádný automatický reconnect
});
```

## ReconnectOptions

Předejte objekt do `reconnect` pro detailní kontrolu:

```typescript
interface ReconnectOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly jitterMs?: number;
}
```

| Pole | Typ | Výchozí | Popis |
|------|-----|---------|-------|
| `maxRetries` | `number` | `Infinity` | Maximální počet pokusů o reconnect. `Infinity` znamená nikdy nevzdat. |
| `initialDelayMs` | `number` | `1000` | Zpoždění před prvním pokusem o reconnect (ms). |
| `maxDelayMs` | `number` | `30000` | Horní hranice pro backoff zpoždění (ms). |
| `backoffMultiplier` | `number` | `2` | Násobitel aplikovaný na každý další pokus. |
| `jitterMs` | `number` | `500` | Náhodný jitter přidaný ke každému zpoždění pro zamezení thundering herd efektu (ms). |

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 500,
    maxDelayMs: 15_000,
    backoffMultiplier: 2,
    jitterMs: 300,
  },
});
```

## Exponential backoff s jitter

Zpoždění před každým pokusem o reconnect se vypočítá jako:

```
delay = min(initialDelayMs × backoffMultiplier ^ attempt, maxDelayMs) + random() × jitterMs
```

S výchozími hodnotami (`initialDelayMs=1000`, `backoffMultiplier=2`, `maxDelayMs=30000`, `jitterMs=500`):

```
Pokus 0:  min(1000 × 2⁰, 30000) + jitter  =  1000 + [0..500)  ≈  1.0–1.5s
Pokus 1:  min(1000 × 2¹, 30000) + jitter  =  2000 + [0..500)  ≈  2.0–2.5s
Pokus 2:  min(1000 × 2², 30000) + jitter  =  4000 + [0..500)  ≈  4.0–4.5s
Pokus 3:  min(1000 × 2³, 30000) + jitter  =  8000 + [0..500)  ≈  8.0–8.5s
Pokus 4:  min(1000 × 2⁴, 30000) + jitter  = 16000 + [0..500)  ≈ 16.0–16.5s
Pokus 5:  min(1000 × 2⁵, 30000) + jitter  = 30000 + [0..500)  ≈ 30.0–30.5s  (strop)
Pokus 6+: 30000 + [0..500)  ≈ 30.0–30.5s  (zůstává na stropu)
```

**Proč jitter?** Když se server restartuje, všichni připojení klienti detekují výpadek přibližně ve stejnou chvíli. Bez jitteru by se všichni reconnectnuli současně a přetížili server. Náhodný jitter rozloží pokusy o reconnect v čase.

## Stavy spojení

Klient během svého lifecycle prochází čtyřmi stavy:

```
                  connect()
  disconnected ──────────────► connecting
       ▲                            │
       │                            │ úspěch
       │                            ▼
       │    disconnect()        connected
       │◄────────────────────────────│
       │                            │ ztráta spojení
       │         maxRetries         ▼
       │◄──────── vyčerpáno ── reconnecting ─┐
                                    ▲        │ pokus selhal
                                    └────────┘
```

Aktuální stav můžete zkontrolovat kdykoliv:

```typescript
console.log(client.state);       // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
console.log(client.isConnected); // true pouze když state === 'connected'
```

## Lifecycle eventy

SDK emituje eventy v každé fázi reconnect cyklu:

| Event | Payload | Kdy |
|-------|---------|-----|
| `reconnecting` | `attempt: number` | Před každým pokusem o reconnect (indexováno od 1) |
| `reconnected` | -- | Reconnect uspěl -- spojení obnoveno |
| `connected` | -- | Emitován spolu s `reconnected` po úspěšném reconnectu |
| `welcome` | `WelcomeInfo` | Přijata uvítací zpráva ze serveru po reconnectu |
| `disconnected` | `reason: string` | Všechny pokusy vyčerpány nebo reconnect vypnutý |
| `error` | `Error` | `maxRetries` vyčerpáno (nese `'Max reconnect attempts reached'`) |

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  reconnect: { maxRetries: 5, initialDelayMs: 500 },
});

client.on('reconnecting', (attempt) => {
  console.log(`Pokus o reconnect ${attempt}...`);
});

client.on('reconnected', () => {
  console.log('Spojení obnoveno');
});

client.on('disconnected', (reason) => {
  console.log(`Trvale odpojeno: ${reason}`);
});

client.on('error', (err) => {
  console.error('Chyba spojení:', err.message);
});

await client.connect();
```

## Sekvence reconnectu

Když spojení nečekaně vypadne, interně proběhne následující sekvence:

```
1. Ztráta spojení
   ├─ Stav → 'reconnecting'
   └─ Všechny čekající požadavky zamítnuty s DisconnectedError
2. Čekání (exponential backoff + jitter)
3. Pokus o WebSocket spojení
4. Čekání na uvítací zprávu ze serveru
5. Pokud je nakonfigurován auth.token a server vyžaduje auth:
   └─ Automatické zavolání auth.login(token)
6. Obnovení všech aktivních odběrů (resubscribeAll)
7. Stav → 'connected'
8. Emitování 'connected', 'reconnected', 'welcome'
9. Hotovo — klient je plně funkční
```

Pokud kroky 3--6 selžou, klient zvýší čítač pokusů a vrátí se ke kroku 2. Pokud se vyčerpá `maxRetries`, klient přejde do stavu `disconnected` a emituje `disconnected` + `error`.

## Čekající požadavky jsou zamítnuty okamžitě

Když spojení vypadne, **všechny rozpracované požadavky jsou zamítnuty** s `DisconnectedError`. K tomu dojde ještě před jakýmkoliv pokusem o reconnect:

```typescript
import { DisconnectedError } from '@hamicek/noex-client';

try {
  // Pokud spojení vypadne, zatímco tento požadavek čeká...
  await client.store.bucket('users').all();
} catch (err) {
  if (err instanceof DisconnectedError) {
    // err.code === 'DISCONNECTED'
    // err.message === 'Connection lost'
    console.log('Požadavek selhal, protože spojení bylo ztraceno');
  }
}
```

Požadavky odeslané ve stavu `reconnecting` také vyhodí `DisconnectedError` synchronně:

```typescript
if (client.state === 'reconnecting') {
  // Toto vyhodí chybu okamžitě — žádné čekání
  await client.store.bucket('users').all();
  // DisconnectedError: Cannot send request — client is reconnecting
}
```

## Zastavení reconnectu programaticky

Zavolejte `disconnect()` kdykoliv pro zastavení reconnect smyčky:

```typescript
client.on('reconnecting', (attempt) => {
  if (attempt > 3) {
    console.log('Vzdávám to ručně');
    client.disconnect(); // Zastaví reconnect smyčku
  }
});
```

`disconnect()` nastaví interní příznak, který okamžitě přeruší reconnect smyčku. Klient přejde do stavu `disconnected`. Žádné další pokusy o reconnect se neprovádějí.

## Kompletní funkční příklad

Služba, která monitoruje lifecycle reconnectu:

```typescript
import { NoexClient, DisconnectedError } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    reconnect: {
      maxRetries: 20,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      backoffMultiplier: 2,
      jitterMs: 500,
    },
  });

  // Sledování lifecycle spojení
  client.on('connected', () => {
    console.log(`[${new Date().toISOString()}] Připojeno`);
  });

  client.on('reconnecting', (attempt) => {
    console.log(`[${new Date().toISOString()}] Reconnect (pokus ${attempt})...`);
  });

  client.on('reconnected', () => {
    console.log(`[${new Date().toISOString()}] Reconnect úspěšný`);
  });

  client.on('disconnected', (reason) => {
    console.log(`[${new Date().toISOString()}] Odpojeno: ${reason}`);
    process.exit(1);
  });

  client.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Chyba: ${err.message}`);
  });

  await client.connect();
  console.log('Připojeno. Provádím operace...');

  // Bezpečný wrapper pro požadavky, který zvládá odpojení
  async function safeInsert(name: string) {
    try {
      return await client.store.bucket('users').insert({ name });
    } catch (err) {
      if (err instanceof DisconnectedError) {
        console.log(`Vložení "${name}" selhalo — nepřipojeno`);
        return null;
      }
      throw err;
    }
  }

  await safeInsert('Alice');
  console.log('Naslouchám... (Ctrl+C pro ukončení)');
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Vytvoří klienta s `maxRetries: 5` a rychlým backoff (`initialDelayMs: 200`, `jitterMs: 0`)
2. Připojí se k serveru
3. Loguje každý event `reconnecting` s číslem pokusu a vypočítaným zpožděním
4. Loguje, když reconnect uspěje nebo když se vyčerpají všechny pokusy
5. Ověří, že `client.state` odpovídá očekávanému stavu v každém kroku

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    reconnect: {
      maxRetries: 5,
      initialDelayMs: 200,
      maxDelayMs: 5_000,
      backoffMultiplier: 2,
      jitterMs: 0,
    },
  });

  let lastReconnectTime = 0;

  client.on('reconnecting', (attempt) => {
    const now = Date.now();
    const elapsed = lastReconnectTime ? now - lastReconnectTime : 0;
    lastReconnectTime = now;
    console.log(
      `Pokus ${attempt} | stav: ${client.state} | ${elapsed}ms od posledního pokusu`,
    );
    // Stav by měl být 'reconnecting'
    console.assert(client.state === 'reconnecting');
  });

  client.on('reconnected', () => {
    console.log('Reconnectnuto!');
    console.assert(client.state === 'connected');
    console.assert(client.isConnected === true);
  });

  client.on('disconnected', (reason) => {
    console.log(`Odpojeno: ${reason}`);
    console.assert(client.state === 'disconnected');
    console.assert(client.isConnected === false);
  });

  const welcome = await client.connect();
  console.log(`Připojeno k serveru v${welcome.version}`);
  console.assert(client.state === 'connected');

  // Udržet proces naživu — když server spadne,
  // uvidíte pokusy o reconnect vypsané výše
  console.log('Čekám na odpojení... (vypněte server pro test)');
}

main().catch(console.error);
```

</details>

## Shrnutí

- Automatický reconnect je **zapnutý ve výchozím stavu** s `Infinity` pokusy
- Vypnete ho pomocí `reconnect: false` nebo přizpůsobíte přes `ReconnectOptions`
- Vzorec zpoždění: `min(initial × multiplier ^ attempt, max) + random() × jitter`
- Jitter zabraňuje thundering herd efektu, když se mnoho klientů reconnectuje současně
- Eventy: `reconnecting(attempt)` -> `reconnected` / `disconnected(reason)`
- Čekající požadavky jsou při ztrátě spojení okamžitě zamítnuty s `DisconnectedError`
- Požadavky odeslané ve stavu `reconnecting` také vyhodí `DisconnectedError`
- Zavolejte `disconnect()` kdykoliv pro přerušení reconnect smyčky
- Po úspěšném reconnectu SDK znovu autentizuje (pokud je nakonfigurováno) a obnoví odběry

---

Další: [Obnova odběrů](./02-obnova-odberu.md)
