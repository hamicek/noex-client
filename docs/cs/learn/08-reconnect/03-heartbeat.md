# Heartbeat

WebSocket spojení mohou tiše zemřít -- síťový přepínač se resetuje, firewall ukončí nečinné spojení nebo vzdálená strana spadne bez odeslání close frame. Mechanismus heartbeat detekuje tato mrtvá spojení, takže SDK může spustit reconnect místo nekonečného čekání.

## Co se naučíte

- Jak funguje ping/pong heartbeat protokol
- Proč je heartbeat ve výchozím stavu zapnutý
- Jak heartbeat vypnout, když není potřeba
- Jak detekce mrtvého spojení spouští reconnect

## Jak to funguje

Heartbeat protokol je jednoduchý:

1. **Server** periodicky posílá zprávu `ping` s časovým razítkem
2. **Klient** automaticky odpovídá zprávou `pong` se stejným časovým razítkem
3. Pokud server přestane přijímat pongy, uzavře spojení
4. Pokud klient přestane přijímat pingy, TCP spojení nakonec vyprší timeout nebo ho server uzavře -- v obou případech event `close` spustí reconnect smyčku

```
Server                          Klient
  │                               │
  │──── { type: "ping",  ────────►│
  │      timestamp: 1234 }        │
  │                               │
  │◄─── { type: "pong",  ────────│
  │      timestamp: 1234 }        │
  │                               │
  │          ... interval ...      │
  │                               │
  │──── { type: "ping",  ────────►│
  │      timestamp: 5678 }        │
  │                               │
  │◄─── { type: "pong",  ────────│
  │      timestamp: 5678 }        │
```

## Zapnuto ve výchozím stavu

Heartbeat je **zapnutý**, pokud ho explicitně nevypnete:

```typescript
// Heartbeat zapnutý (výchozí)
const client = new NoexClient('ws://localhost:8080', { WebSocket });

// Heartbeat explicitně zapnutý (stejné jako výchozí)
const client2 = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: true,
});

// Heartbeat vypnutý
const client3 = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: false,
});
```

## Co klient dělá

Zpracování heartbeatu na straně klienta je minimální a automatické:

1. Když přijde zpráva s `{ type: "ping", timestamp: <number> }`, transport ji zachytí
2. Transport okamžitě odešle zpět `{ type: "pong", timestamp: <stejné číslo> }`
3. Zpráva ping se **nepředává** do protokolové vrstvy -- váš kód ji nikdy neuvidí

```typescript
// Nemusíte pingy ošetřovat. Je to plně automatické.
// Neexistuje žádný event 'ping' ani callback k implementaci.
const client = new NoexClient('ws://localhost:8080', { WebSocket });
await client.connect();
// Pongy se odesílají automaticky na pozadí.
```

## Když heartbeat selže

Pokud spojení tiše zemře (žádný close frame od protějšku), sekvence je následující:

```
1. Server odešle ping → paket se ztratí (spojení mrtvé)
2. Server čeká na pong → žádná odpověď
3. Server detekuje mrtvé spojení → uzavře WebSocket
4. Klient obdrží event close (nebo TCP timeout)
5. Klient přejde do stavu 'reconnecting'
6. Začíná automatická reconnect smyčka
```

Bez heartbeatu by klient nikdy nevěděl, že spojení je mrtvé -- seděl by nečinně v domnění, že je stále připojen, zatímco všechny budoucí požadavky by visely, dokud by jim individuálně nevypršel timeout.

## Kdy heartbeat vypnout

Heartbeat vypněte pouze pokud:

- Server nepodporuje ping/pong protokol
- Ladíte a provoz ping/pong je rušivý
- Máte vlastní keep-alive mechanismus na jiné vrstvě

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  heartbeat: false,
  // Bez heartbeatu se mrtvá spojení detekují pouze když:
  // 1. Zkusíte odeslat požadavek a selže
  // 2. OS TCP stack vyprší timeout (může trvat minuty)
});
```

## Heartbeat vs WebSocket-level ping/pong

Noex heartbeat je protokol na **aplikační úrovni** -- používá běžné WebSocket textové zprávy (`{ type: "ping" }`), nikoliv vestavěné ping/pong framy WebSocket protokolu. Tento design funguje napříč všemi WebSocket implementacemi, včetně prohlížečů, které nezpřístupňují ping/pong na úrovni protokolu.

| Vlastnost | noex heartbeat | WebSocket ping/pong framy |
|-----------|---------------|---------------------------|
| Typ zprávy | JSON textová zpráva | Protokolový řídicí frame |
| Podpora v prohlížeči | Ano (běžné zprávy) | Ne (prohlížeče nezpřístupňují framy) |
| Podpora serveru | Jakýkoliv noex-server | Vyžaduje podporu WebSocket knihovny |
| Payload | `{ type, timestamp }` | Binární payload (neprůhledný) |

## Kompletní funkční příklad

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    heartbeat: true, // výchozí — uvedeno pro názornost
    reconnect: {
      maxRetries: Infinity,
      initialDelayMs: 1_000,
    },
  });

  client.on('connected', () => {
    console.log('Připojeno — heartbeat aktivní');
  });

  client.on('reconnecting', (attempt) => {
    // Emitováno při výpadku spojení, včetně
    // mrtvých spojení detekovaných přes heartbeat timeout
    console.log(`Reconnect (pokus ${attempt})...`);
  });

  client.on('reconnected', () => {
    console.log('Reconnectnuto');
  });

  await client.connect();
  console.log('Naslouchám... (Ctrl+C pro ukončení)');
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Vytvoří dva klienty -- jednoho s heartbeatem zapnutým a jednoho s vypnutým
2. Připojí oba ke stejnému serveru
3. Na obou klientech se přihlásí k odběru dotazu pro ověření, že fungují
4. Čistě odpojí klienty a ověří, že oba přešli do stavu `disconnected`

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const url = 'ws://localhost:8080';

  // Klient s heartbeatem (výchozí)
  const clientA = new NoexClient(url, {
    WebSocket,
    heartbeat: true,
    reconnect: false,
  });

  // Klient bez heartbeatu
  const clientB = new NoexClient(url, {
    WebSocket,
    heartbeat: false,
    reconnect: false,
  });

  await clientA.connect();
  console.log(`Klient A: stav=${clientA.state}, heartbeat=zapnutý`);

  await clientB.connect();
  console.log(`Klient B: stav=${clientB.state}, heartbeat=vypnutý`);

  // Oba by měli být funkční
  const usersA = await clientA.store.bucket('users').all();
  const usersB = await clientB.store.bucket('users').all();
  console.log(`Klient A vidí ${usersA.length} uživatelů`);
  console.log(`Klient B vidí ${usersB.length} uživatelů`);

  // Odpojení obou
  await clientA.disconnect();
  await clientB.disconnect();

  console.log(`Klient A: stav=${clientA.state}`); // 'disconnected'
  console.log(`Klient B: stav=${clientB.state}`); // 'disconnected'
}

main().catch(console.error);
```

</details>

## Shrnutí

- Server periodicky posílá `{ type: "ping", timestamp }`
- Klient automaticky odpovídá `{ type: "pong", timestamp }` -- žádný kód není potřeba
- Heartbeat je ve výchozím stavu zapnutý (`heartbeat: true`)
- Detekuje mrtvá spojení, která by jinak zůstala nepovšimnuta
- Mrtvá spojení spustí standardní reconnect smyčku
- Vypněte pomocí `heartbeat: false` pouze pokud server heartbeat nepodporuje
- Noex heartbeat je JSON na aplikační úrovni (nikoliv WebSocket protokolový ping/pong), takže funguje v prohlížečích

---

Další: [Typy chyb](../09-zpracovani-chyb/01-typy-chyb.md)
