# Dashboard v reálném čase

Vytvořte živý metrický dashboard, kde administrátoři vkládají data a diváci vidí aktualizace okamžitě. Tento projekt přidává na model odběrů z předchozí kapitoly autentizaci, oprávnění založená na rolích a agregační dotazy.

## Co se naučíte

- Autentizace klientů pomocí `auth.login` a auto-login přes `ClientOptions.auth`
- Přístup řízený oprávněními: admini mutují, diváci odebírají
- Parametrizované odběry pro filtrované panely dashboardu
- Agregační dotazy (`avg`, `count`) pro souhrnné widgety
- Multi-client push: admin insert spustí push pro všechny odběry diváků

## Přehled architektury

```
┌─────────────────────────────────────────────────────────────┐
│                       noex-server                            │
│                                                              │
│  Bucket: metrics              Dotazy                         │
│  ┌──────────────────────┐     ┌───────────────────────────┐  │
│  │ name: string          │     │ all-metrics                │  │
│  │ value: number         │     │ metrics-by-name({ name })  │  │
│  │ unit: string          │     │ metric-count               │  │
│  │ timestamp: number     │     │ latest-metrics({ n })      │  │
│  └──────────────────────┘     └───────────────────────────┘  │
│                                                              │
│  Auth                         Oprávnění                      │
│  ┌──────────────────────┐     ┌───────────────────────────┐  │
│  │ admin-token → admin   │     │ admin  → plný přístup      │  │
│  │ viewer-token → viewer │     │ viewer → čtení + odběry    │  │
│  └──────────────────────┘     └───────────────────────────┘  │
│                                                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐          │
│  │   Admin    │   │  Divák 1   │   │  Divák 2   │          │
│  │  insert()  │   │ subscribe  │   │ subscribe  │          │
│  │  update()  │   │  push ←    │   │  push ←    │          │
│  └────────────┘   └────────────┘   └────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Část 1: Nastavení serveru

```typescript
// server.ts
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthSession } from '@hamicek/noex-server';

async function main() {
  const store = await Store.start({ name: 'dashboard' });

  // ── Bucket ──────────────────────────────────────────────────────
  await store.defineBucket('metrics', {
    key: 'id',
    schema: {
      id:        { type: 'string', generated: 'uuid' },
      name:      { type: 'string', required: true },
      value:     { type: 'number', required: true },
      unit:      { type: 'string', default: '' },
      timestamp: { type: 'number', required: true },
    },
  });

  // ── Dotazy ──────────────────────────────────────────────────────
  store.defineQuery('all-metrics', async (ctx) => {
    return ctx.bucket('metrics').all();
  });

  store.defineQuery('metrics-by-name', async (ctx, params: { name: string }) => {
    return ctx.bucket('metrics').where({ name: params.name });
  });

  store.defineQuery('metric-count', async (ctx) => {
    return ctx.bucket('metrics').count();
  });

  store.defineQuery('latest-metrics', async (ctx, params: { n: number }) => {
    return ctx.bucket('metrics').last(params.n);
  });

  // ── Auth + Oprávnění ────────────────────────────────────────────
  const adminSession: AuthSession = { userId: 'admin-1', roles: ['admin'] };
  const viewerSession: AuthSession = { userId: 'viewer-1', roles: ['viewer'] };

  const WRITE_OPS = new Set([
    'store.insert', 'store.update', 'store.delete', 'store.clear',
    'store.transaction',
  ]);

  const server = await NoexServer.start({
    port: 8080,
    store,
    auth: {
      validate: async (token) => {
        if (token === 'admin-token') return adminSession;
        if (token === 'viewer-token') return viewerSession;
        return null;
      },
      permissions: {
        check: (session, operation) => {
          if (session.roles.includes('admin')) return true;
          if (WRITE_OPS.has(operation)) return false;
          return true;
        },
      },
    },
  });

  console.log(`Dashboard server naslouchá na ws://localhost:${server.port}`);
}

main();
```

## Část 2: Admin klient — vkládání metrik

Admin se připojí s auto-loginem a vkládá metriky:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const admin = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'admin-token' },
});

const welcome = await admin.connect();
// Auto-login proběhne automaticky, když welcome.requiresAuth je true

// Ověření autentizace
const session = await admin.auth.whoami();
console.log(session?.userId); // "admin-1"
console.log(session?.roles);  // ["admin"]

// Vložení metrik
const metrics = admin.store.bucket('metrics');

await metrics.insert({
  name: 'cpu',
  value: 72.5,
  unit: '%',
  timestamp: Date.now(),
});

await metrics.insert({
  name: 'memory',
  value: 4200,
  unit: 'MB',
  timestamp: Date.now(),
});

await metrics.insert({
  name: 'cpu',
  value: 68.1,
  unit: '%',
  timestamp: Date.now(),
});
```

## Část 3: Divák klient — živý dashboard

Divák se připojí, autentizuje a odebírá více panelů dashboardu:

```typescript
const viewer = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'viewer-token' },
});
await viewer.connect();

// ── Panel 1: Tabulka všech metrik ──────────────────────────────
const unsubAll = await viewer.store.subscribe('all-metrics', (data) => {
  const rows = data as Record<string, unknown>[];
  console.log(`\n--- Všechny metriky (${rows.length}) ---`);
  for (const row of rows) {
    console.log(`  ${row['name']}: ${row['value']} ${row['unit']}`);
  }
});

// ── Panel 2: Graf pouze CPU ────────────────────────────────────
const unsubCpu = await viewer.store.subscribe(
  'metrics-by-name',
  { name: 'cpu' },
  (data) => {
    const cpuReadings = data as Record<string, unknown>[];
    console.log(`CPU hodnoty: ${cpuReadings.length}`);
  },
);

// ── Panel 3: Odznak celkového počtu ────────────────────────────
const unsubCount = await viewer.store.subscribe('metric-count', (data) => {
  console.log(`Celkem metrik: ${data}`);
});

// ── Panel 4: Widget posledních 5 čtení ─────────────────────────
const unsubLatest = await viewer.store.subscribe(
  'latest-metrics',
  { n: 5 },
  (data) => {
    const latest = data as Record<string, unknown>[];
    console.log(`Posledních ${latest.length} čtení`);
  },
);
```

Každý callback odběru se okamžitě zavolá s aktuálními daty. Jak admin vkládá nové metriky, každý panel se aktualizuje nezávisle — push dostanou pouze panely, jejichž výsledek dotazu se skutečně změnil.

### Vynucování oprávnění

Pokud se divák pokusí mutovat data, server požadavek zamítne:

```typescript
import { NoexClientError } from '@hamicek/noex-client';

try {
  await viewer.store.bucket('metrics').insert({
    name: 'hack', value: 0, unit: '', timestamp: 0,
  });
} catch (err) {
  const error = err as NoexClientError;
  console.log(error.code);    // "FORBIDDEN"
  console.log(error.message); // "No permission for store.insert on metrics"
}
```

## Část 4: Admin dávkové vložení přes transakci

Transakce vloží více metrik atomicky — odběratelé obdrží jediný push po commitu, ne jeden za každou operaci:

```typescript
const result = await admin.store.transaction([
  {
    op: 'insert',
    bucket: 'metrics',
    data: { name: 'disk', value: 78, unit: '%', timestamp: Date.now() },
  },
  {
    op: 'insert',
    bucket: 'metrics',
    data: { name: 'network', value: 1250, unit: 'Mbps', timestamp: Date.now() },
  },
]);

console.log(result.results.length); // 2
// Callback diváka pro all-metrics se zavolá JEDNOU s kompletním aktualizovaným seznamem
```

## Část 5: Selektivní push chování

Server pushne pouze tehdy, když se výsledek dotazu skutečně změní. To je klíčové pro efektivitu dashboardu:

```typescript
// Divák odebírá pouze CPU metriky
const cpuSnapshots: unknown[] = [];
await viewer.store.subscribe('metrics-by-name', { name: 'cpu' }, (data) => {
  cpuSnapshots.push(data);
});

// Admin vloží metriku paměti
await admin.store.bucket('metrics').insert({
  name: 'memory', value: 8100, unit: 'MB', timestamp: Date.now(),
});

// → Žádný push do cpuSnapshots — výsledek CPU dotazu se nezměnil

// Admin vloží CPU metriku
await admin.store.bucket('metrics').insert({
  name: 'cpu', value: 91.3, unit: '%', timestamp: Date.now(),
});

// → Push dorazí do cpuSnapshots s aktualizovaným seznamem CPU
```

## Kompletní funkční příklad

```typescript
import { Store } from '@hamicek/noex-store';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';
import type { AuthSession } from '@hamicek/noex-server';
import WebSocket from 'ws';

async function main() {
  // ── Server ──────────────────────────────────────────────────────
  const store = await Store.start({ name: 'dashboard-demo' });

  await store.defineBucket('metrics', {
    key: 'id',
    schema: {
      id:        { type: 'string', generated: 'uuid' },
      name:      { type: 'string', required: true },
      value:     { type: 'number', required: true },
      unit:      { type: 'string', default: '' },
      timestamp: { type: 'number', required: true },
    },
  });

  store.defineQuery('all-metrics', async (ctx) => ctx.bucket('metrics').all());
  store.defineQuery('metrics-by-name', async (ctx, params: { name: string }) => {
    return ctx.bucket('metrics').where({ name: params.name });
  });
  store.defineQuery('metric-count', async (ctx) => ctx.bucket('metrics').count());

  const adminSession: AuthSession = { userId: 'admin-1', roles: ['admin'] };
  const viewerSession: AuthSession = { userId: 'viewer-1', roles: ['viewer'] };

  const WRITE_OPS = new Set([
    'store.insert', 'store.update', 'store.delete', 'store.clear',
    'store.transaction',
  ]);

  const server = await NoexServer.start({
    port: 0,
    host: '127.0.0.1',
    store,
    auth: {
      validate: async (token) => {
        if (token === 'admin-token') return adminSession;
        if (token === 'viewer-token') return viewerSession;
        return null;
      },
      permissions: {
        check: (session, operation) => {
          if (session.roles.includes('admin')) return true;
          if (WRITE_OPS.has(operation)) return false;
          return true;
        },
      },
    },
  });

  const url = `ws://127.0.0.1:${server.port}`;

  // ── Admin ───────────────────────────────────────────────────────
  const admin = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'admin-token' },
  });
  await admin.connect();

  // ── Divák ───────────────────────────────────────────────────────
  const viewer = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'viewer-token' },
  });
  await viewer.connect();

  let metricCount = 0;
  const unsubCount = await viewer.store.subscribe('metric-count', (data) => {
    metricCount = data as number;
    console.log(`[Divák] Celkem metrik: ${metricCount}`);
  });

  const unsubAll = await viewer.store.subscribe('all-metrics', (data) => {
    const rows = data as Record<string, unknown>[];
    console.log(`[Divák] Seznam metrik: ${rows.length} položek`);
  });

  // Admin vkládá metriky
  await admin.store.bucket('metrics').insert({
    name: 'cpu', value: 72.5, unit: '%', timestamp: Date.now(),
  });
  await store.settle();

  await admin.store.bucket('metrics').insert({
    name: 'memory', value: 4200, unit: 'MB', timestamp: Date.now(),
  });
  await store.settle();

  // Cleanup
  unsubCount();
  unsubAll();
  await admin.disconnect();
  await viewer.disconnect();
  await server.stop();
  await store.stop();

  console.log('Hotovo.');
}

main();
```

## Cvičení

Rozšiřte dashboard o systém alertů:

1. Přidejte bucket `alerts` s poli: `metric` (string), `threshold` (number), `severity` (`'low' | 'medium' | 'high'`)
2. Definujte dotaz `active-alerts`, který vrací všechny alerty
3. Upravte kontrolu oprávnění tak, aby diváci mohli číst alerty, ale vytvářet je mohli pouze admini
4. Z admin klienta použijte transakci pro atomické vložení metriky a alertu, když hodnota překročí práh

<details>
<summary>Řešení</summary>

**Doplnění serveru:**

```typescript
await store.defineBucket('alerts', {
  key: 'id',
  schema: {
    id:        { type: 'string', generated: 'uuid' },
    metric:    { type: 'string', required: true },
    threshold: { type: 'number', required: true },
    severity:  { type: 'string', default: 'low' },
    timestamp: { type: 'number', required: true },
  },
});

store.defineQuery('active-alerts', async (ctx) => {
  return ctx.bucket('alerts').all();
});
```

Úprava oprávnění není potřeba — existující množina `WRITE_OPS` již pokrývá `store.insert` a `store.transaction`.

**Admin klient — atomická metrika + alert:**

```typescript
const cpuValue = 95.2;
const threshold = 90;

if (cpuValue > threshold) {
  await admin.store.transaction([
    {
      op: 'insert',
      bucket: 'metrics',
      data: { name: 'cpu', value: cpuValue, unit: '%', timestamp: Date.now() },
    },
    {
      op: 'insert',
      bucket: 'alerts',
      data: {
        metric: 'cpu',
        threshold,
        severity: 'high',
        timestamp: Date.now(),
      },
    },
  ]);
}
```

Diváci odebírající `active-alerts` obdrží push s novým alertem. Diváci odebírající `all-metrics` obdrží aktualizovaný seznam metrik. Oba pushe přijdou z jednoho commitu transakce.

</details>

## Shrnutí

- **Auto-login** — nastavte `auth: { token }` v `ClientOptions` pro automatickou autentizaci při připojení (i reconnectu)
- **Vynucování oprávnění** — server zamítne zakázané operace s chybovým kódem `FORBIDDEN`; SDK vyhodí `NoexClientError`
- **Parametrizované odběry** — `store.subscribe(query, params, callback)` umožňuje každému panelu dashboardu filtrovat nezávisle
- **Transakce** — dávkové operace jsou atomické; odběratelé obdrží jediný push po commitu
- **Selektivní push** — filtrované odběry (např. `metrics-by-name({ name: 'cpu' })`) se spustí pouze při změně jejich konkrétního výsledku
- **Oddělení rolí** — admin a divák používají stejné SDK, různé tokeny udělují různá oprávnění

---

Další: [Chatovací aplikace](./03-chatovaci-aplikace.md)
