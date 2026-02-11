# Automatické přihlášení

Ruční volání `auth.login()` po každém `connect()` a reconnectu je zdlouhavé a náchylné k chybám. SDK poskytuje **automatické přihlášení** — předejte token v `ClientOptions.auth` a SDK zavolá `auth.login()` automaticky pokaždé, když server vyžaduje autentizaci. Funguje to jak při prvním připojení, tak po každém úspěšném reconnectu.

## Co se naučíte

- Jak nakonfigurovat automatické přihlášení pomocí `ClientOptions.auth.token`
- Přesná sekvence během prvního připojení a reconnectu
- Jak automatické přihlášení spolupracuje s obnovou odběrů
- Co se stane, když je token pro automatické přihlášení neplatný nebo expirovaný
- Kdy použít automatické přihlášení vs ruční přihlášení

## Konfigurace automatického přihlášení

Předejte token v možnosti `auth` při vytváření klienta:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-secret-token' },
});

const welcome = await client.connect();
// Pokud welcome.requiresAuth === true, auth.login() už bylo zavoláno.
// Připojení je ověřené — připraveno pro store/rules operace.
```

Po vyřešení `connect()` je klient již ověřený. Není potřeba samostatné volání `auth.login()`.

## ClientOptions.auth

```typescript
interface ClientOptions {
  auth?: {
    token: string;
  };
  // ... další možnosti
}
```

| Pole | Typ | Popis |
|------|-----|-------|
| auth.token | `string` | Token pro automatickou autentizaci |

## Sekvence připojení

Když je `connect()` zavoláno s nakonfigurovaným `auth.token`:

```
1. WebSocket spojení se otevře
2. Server odešle welcome zprávu  ─────  { requiresAuth: true/false }
3. Pokud requiresAuth === true:
   └─ SDK zavolá auth.login(token) ────  automatické ověření
4. Emitován event 'connected'
5. Emitován event 'welcome'
6. Promise connect() se vyřeší  ────────  vrácen WelcomeInfo
```

Pokud je `requiresAuth` nastaveno na `false`, krok automatického přihlášení je přeskočen — token není odesílán serveru, který ho neočekává.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-token' },
});

const welcome = await client.connect();

if (welcome.requiresAuth) {
  // Již ověřeno — automatické přihlášení proběhlo během connect()
  const session = await client.auth.whoami();
  console.log(`Automaticky přihlášen jako ${session!.userId}`);
} else {
  // Autentizace není potřeba — token nebyl odeslán
  console.log('Server nevyžaduje autentizaci');
}
```

## Sekvence reconnectu

Automatické přihlášení je klíčové během reconnectu. Bez něj by se klient reconnectnul, ale nepodařilo by se obnovit odběry, protože server odmítá operace z neověřených připojení.

```
1. Spojení ztraceno — stav: 'reconnecting'
2. Exponential backoff zpoždění
3. WebSocket spojení znovu navázáno
4. Server odešle welcome zprávu
5. Pokud requiresAuth === true:
   └─ SDK zavolá auth.login(token)  ───  opětovné ověření
6. SubscriptionManager.resubscribeAll()  ─  obnova odběrů
7. Emitován event 'connected'
8. Emitován event 'reconnected'
9. Emitován event 'welcome'
```

Sekvence je: **připojení -> ověření -> obnova odběrů**. Autentizace proběhne před obnovou odběrů, čímž se zajistí, že požadavky na obnovu odběrů budou přijaty.

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'my-token' },
  reconnect: {
    maxRetries: 10,
    initialDelayMs: 1000,
  },
});

client.on('reconnected', () => {
  // V tomto bodě: reconnectnuto + opětovně ověřeno + odběry obnoveny
  console.log('Plně obnoveno');
});

await client.connect();

// Odběr query — bude automaticky obnoven po reconnectu
await client.store.subscribe('all-users', (data) => {
  console.log('Uživatelé:', data);
});
```

## Selhání automatického přihlášení

Pokud automatické přihlášení selže (neplatný token, expirovaný token, chyba serveru), chování závisí na kontextu:

### Během prvního connect()

Promise `connect()` **rejectne** s chybou přihlášení:

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'invalid-token' },
});

try {
  await client.connect();
} catch (err) {
  // NoexClientError s kódem 'UNAUTHORIZED'
  console.log('Automatické přihlášení selhalo:', err);
}
```

### Během reconnectu

Pokus o reconnect je považován za **selhání**. Klient to zkusí znovu podle strategie reconnectu (exponential backoff, `maxRetries`):

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'might-expire' },
  reconnect: { maxRetries: 5 },
});

client.on('error', (err) => {
  // Selhání automatického přihlášení během reconnectu jsou hlášena zde
  console.log('Chyba reconnectu:', err.message);
});

client.on('disconnected', () => {
  // Emitováno pokud jsou vyčerpány všechny pokusy
  console.log('Trvale odpojeno');
});
```

## Automatické přihlášení vs ruční přihlášení

| Scénář | Doporučený přístup |
|--------|-------------------|
| Statický API klíč nebo servisní token | **Automatické přihlášení** — token se nemění |
| Uživatel zadává přihlašovací údaje za běhu | **Ruční přihlášení** — nejprve získat token, pak přihlásit |
| Token může expirovat a potřebuje obnovení | **Ruční přihlášení** — logika obnovení před přihlášením |
| Jednoduché skripty a backendové služby | **Automatické přihlášení** — minimální kód |
| Víceuživatelská aplikace | **Ruční přihlášení** — různé tokeny pro každou relaci |

### Vzor automatického přihlášení (doporučený pro služby)

```typescript
const client = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: process.env.API_TOKEN! },
  reconnect: true,
});

await client.connect();
// Připraveno k použití — autentizace řešena automaticky, i přes reconnecty
```

### Vzor ručního přihlášení (doporučený pro interaktivní aplikace)

```typescript
const client = new NoexClient('ws://localhost:8080', { WebSocket });
const welcome = await client.connect();

if (welcome.requiresAuth) {
  const token = await promptUserForCredentials();
  await client.auth.login(token);
}
```

## Kompletní funkční příklad

Služba, která se připojí s automatickým přihlášením a monitoruje reconnect:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    auth: { token: 'service-api-key' },
    reconnect: {
      maxRetries: Infinity,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    },
  });

  client.on('connected', () => {
    console.log('Připojeno a ověřeno');
  });

  client.on('reconnecting', () => {
    console.log('Spojení ztraceno — reconnect...');
  });

  client.on('reconnected', () => {
    console.log('Reconnectnuto — opětovně ověřeno a odběry obnoveny');
  });

  client.on('error', (err) => {
    console.error('Chyba klienta:', err.message);
  });

  const welcome = await client.connect();
  console.log(`Verze serveru: ${welcome.version}`);
  console.log(`Vyžaduje autentizaci: ${welcome.requiresAuth}`);

  // Ověření autentizace
  const session = await client.auth.whoami();
  if (session) {
    console.log(`Ověřen jako ${session.userId} s rolemi: ${session.roles.join(', ')}`);
  }

  // Začátek práce — odběry přežijí reconnecty
  await client.store.subscribe('active-sessions', (data) => {
    const sessions = data as Array<Record<string, unknown>>;
    console.log(`Aktivní relace: ${sessions.length}`);
  });

  // Udržení procesu naživu
  console.log('Naslouchám aktualizacím... (Ctrl+C pro zastavení)');
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Vytvoří klienta s nakonfigurovaným automatickým přihlášením
2. Připojí se a ověří autentizaci pomocí `whoami()`
3. Vloží záznam do bucketu `logs` pro potvrzení, že operace fungují
4. Ručně se odhlásí a ověří, že `whoami()` vrací `null`
5. Ručně se znovu přihlásí stejným tokenem a ověří, že relace je obnovena

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  // 1. Vytvoření klienta s automatickým přihlášením
  const client = new NoexClient('ws://localhost:8080', {
    WebSocket,
    auth: { token: 'my-token' },
  });

  // 2. Připojení a ověření
  await client.connect();
  const session = await client.auth.whoami();
  console.log(`Automatické přihlášení: ${session?.userId}`); // např. 'user-1'

  // 3. Provedení store operace
  const record = await client.store.bucket('logs').insert({
    action: 'test',
    timestamp: Date.now(),
  });
  console.log(`Vložen log: ${record['action']}`);

  // 4. Odhlášení a ověření
  await client.auth.logout();
  const afterLogout = await client.auth.whoami();
  console.log(`Po odhlášení: ${afterLogout}`); // null

  // 5. Ruční opětovné přihlášení
  const restored = await client.auth.login('my-token');
  console.log(`Znovu přihlášen jako: ${restored.userId}`);

  const verified = await client.auth.whoami();
  console.log(`Relace obnovena: ${verified?.userId}`);

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- Nakonfigurujte automatické přihlášení pomocí `ClientOptions.auth.token` — SDK zavolá `auth.login()` automaticky
- Automatické přihlášení proběhne během `connect()` pouze když `welcome.requiresAuth === true`
- Automatické přihlášení proběhne během reconnectu před obnovou odběrů — čímž se zajistí přijetí operací
- Pokud je token neplatný během `connect()`, promise rejectne s `UNAUTHORIZED`
- Pokud je token neplatný během reconnectu, pokus selže a klient to zkusí znovu
- Automatické přihlášení je ideální pro statické tokeny (API klíče, servisní účty)
- Použijte ruční přihlášení, když se tokeny za běhu mění nebo potřebují logiku obnovení
- Sekvence připojení -> ověření -> obnova odběrů zajišťuje bezproblémovou obnovu

---

Další: [Automatický reconnect](../08-reconnect/01-automaticky-reconnect.md)
