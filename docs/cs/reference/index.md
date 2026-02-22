# API Reference

Kompletní API reference pro `@hamicek/noex-client`. Každá třída, metoda, typ a konfigurační možnost zdokumentovaná se signaturami a příklady.

## Klient

| Modul | Popis |
|-------|-------|
| [NoexClient](./01-noex-client.md) | Hlavní vstupní bod — připojení, odpojení, události, stav spojení, API jmenné prostory |
| [Konfigurace](./02-configuration.md) | `ClientOptions`, `ReconnectOptions` a všechny výchozí hodnoty |
| [Transport](./08-transport.md) | Interní WebSocket transport — strategie reconnectu, heartbeat, životní cyklus spojení |

## API

| Modul | Popis |
|-------|-------|
| [Store API](./03-store-api.md) | Přístup k bucketům, reaktivní subscripce, atomické transakce, metadata úložiště |
| [Bucket API](./04-bucket-api.md) | Typované CRUD, dotazy, agregace a hromadné operace nad jedním bucketem |
| [Store Subscriptions](./05-store-subscriptions.md) | Reaktivní subscripce dotazů — počáteční data, push aktualizace, obnova při reconnectu |
| [Rules API](./06-rules-api.md) | Pravidlový engine — události, fakty, subscripce událostí v reálném čase |
| [Auth API](./07-auth-api.md) | Autentizace — přihlášení, odhlášení, dotaz na session, auto-login |
| [Logic API](./11-logic-api.md) | Logic engine — vypočítané položky, pohledy, omezení, výrazy, `expr` helper |

## Infrastruktura

| Modul | Popis |
|-------|-------|
| [Typy](./09-types.md) | Všechny exportované typy a rozhraní |
| [Chyby](./10-errors.md) | `NoexClientError`, `TimeoutError`, `DisconnectedError`, chybové kódy serveru |

## Rychlé odkazy

```typescript
import { NoexClient } from '@hamicek/noex-client';
import type { ClientOptions, ConnectionState, AuthSession } from '@hamicek/noex-client';
```

### Připojení k serveru

```typescript
const client = new NoexClient('ws://localhost:3000');
await client.connect();
```

### CRUD nad bucketem

```typescript
const users = client.store.bucket<{ name: string }>('users');
const user = await users.insert({ name: 'Alice' });
const all = await users.all();
```

### Subscripce na změny

```typescript
const unsub = await client.store.subscribe('activeUsers', (data) => {
  console.log('Active users:', data);
});
```

### Odpojení

```typescript
await client.disconnect();
```
