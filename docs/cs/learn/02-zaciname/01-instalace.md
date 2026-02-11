# Instalace

Tato kapitola provede instalaci SDK ve vašem projektu. Nastavení se mírně liší mezi prostředím Node.js a prohlížeče kvůli dostupnosti WebSocket.

## Co se naučíte

- Jak nainstalovat balíček `@hamicek/noex-client`
- Proč Node.js potřebuje balíček `ws` a prohlížeč ne
- Jak ověřit instalaci minimálním importem

## Instalace balíčku

```bash
npm install @hamicek/noex-client
```

Balíček je výhradně ESM a nemá žádné runtime závislosti. Cílí na Node.js 20+ a moderní prohlížeče.

## Nastavení pro Node.js

Node.js nemá vestavěný globální `WebSocket`. Potřebujete balíček `ws`:

```bash
npm install ws
npm install -D @types/ws   # TypeScript typy
```

Při vytváření klienta předejte konstruktor `ws` přes volbu `WebSocket`:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
});
```

Pokud zapomenete předat `WebSocket` a `globalThis.WebSocket` není k dispozici, klient vyhodí runtime chybu při zavolání `connect()`.

### Proč samostatný balíček?

SDK je navrženo tak, aby fungovalo v Node.js i v prohlížeči bez závislostí. Zabalení WebSocket implementace by přidalo zbytečnou váhu pro uživatele prohlížeče (kteří již mají vestavěný `WebSocket`). Přijetím konstruktoru `WebSocket` přes volby zůstává SDK malé a nezávislé na prostředí.

## Nastavení pro prohlížeč

Prohlížeče mají vestavěný `WebSocket`. Žádné další balíčky nejsou potřeba:

```typescript
import { NoexClient } from '@hamicek/noex-client';

const client = new NoexClient('ws://localhost:8080');
// WebSocket se automaticky převezme z globalThis
```

### Konfigurace bundleru

SDK je distribuováno jako ESM (`import`/`export`). Moderní bundlery (Vite, esbuild, webpack 5) to zvládají nativně. Žádná speciální konfigurace není potřeba.

Pokud používáte TypeScript, ujistěte se, že váš `tsconfig.json` obsahuje:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

## Ověření instalace

Po instalaci ověřte, že importy fungují:

```typescript
import { NoexClient, NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

console.log(typeof NoexClient);           // 'function'
console.log(typeof NoexClientError);       // 'function'
console.log(typeof TimeoutError);          // 'function'
console.log(typeof DisconnectedError);     // 'function'
```

Pokud nějaký import selže, zkontrolujte, že:
1. Váš `package.json` obsahuje `"type": "module"` (pro ESM v Node.js)
2. Vaše TypeScript konfigurace používá `"moduleResolution": "bundler"` nebo `"node16"`

## Co je v balíčku?

SDK exportuje následující:

| Export | Druh | Účel |
|--------|------|------|
| `NoexClient` | class | Hlavní klient — spojení, životní cyklus, přístup k API |
| `StoreAPI` | class | Jmenný prostor store operací |
| `BucketAPI` | class | Typované bucket operace |
| `RulesAPI` | class | Operace pravidlového enginu |
| `AuthAPI` | class | Autentizační operace |
| `NoexClientError` | class | Základní chyba pro všechny serverové chyby |
| `TimeoutError` | class | Požadavek vypršel (timeout) |
| `DisconnectedError` | class | Operace provedena v odpojeném stavu |
| `ClientOptions` | type | Konfigurace pro konstruktor klienta |
| `ReconnectOptions` | type | Konfigurace chování reconnectu |
| `ConnectionState` | type | `'connecting' \| 'connected' \| 'reconnecting' \| 'disconnected'` |
| `WelcomeInfo` | type | Welcome zpráva serveru: `{ version, serverTime, requiresAuth }` |
| `RecordMeta` | type | Serverem generovaná metadata záznamu: `{ id, _version, _createdAt, _updatedAt }` |
| `Unsubscribe` | type | `() => void` — synchronní cleanup funkce |
| `PaginatedResult<T>` | type | `{ records, hasMore, nextCursor? }` |
| `TransactionOp` | type | Diskriminovaná unie pro transakční operace |
| `TransactionResult` | type | `{ results: Array<{ index, data }> }` |

## Cvičení

Nastavte nový Node.js projekt s TypeScriptem a nainstalujte `@hamicek/noex-client` i `ws`. Vytvořte soubor, který importuje `NoexClient` a vypíše jeho typ.

<details>
<summary>Řešení</summary>

```bash
mkdir noex-test && cd noex-test
npm init -y
npm install @hamicek/noex-client ws
npm install -D typescript @types/ws @types/node
npx tsc --init --module ESNext --moduleResolution bundler --target ES2022
```

Přidejte `"type": "module"` do `package.json` a vytvořte `index.ts`:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

console.log('NoexClient:', typeof NoexClient); // 'function'
console.log('WebSocket:', typeof WebSocket);   // 'function'

// Připraveno k připojení — to uděláme v další kapitole
```

Spusťte pomocí `npx tsx index.ts` nebo zkompilujte s `npx tsc && node dist/index.js`.

</details>

## Shrnutí

- Instalujte pomocí `npm install @hamicek/noex-client`
- Node.js navíc potřebuje `npm install ws` pro WebSocket podporu — předejte ho jako `{ WebSocket }` ve volbách klienta
- Prohlížeče automaticky používají nativní `WebSocket` — žádné další nastavení
- SDK je výhradně ESM bez runtime závislostí
- Všechny třídy, typy a chybové třídy se exportují z kořene balíčku

---

Další: [První připojení](./02-prvni-pripojeni.md)
