# Realtime Dashboard

Build a live metrics dashboard where administrators push data and viewers see updates instantly. This project layers authentication, role-based permissions, and aggregation queries on top of the subscription model from the previous chapter.

## What You'll Learn

- Authenticating clients with `auth.login` and auto-login via `ClientOptions.auth`
- Permission-gated access: admins mutate, viewers subscribe
- Parameterized subscriptions for filtered dashboard panels
- Aggregation queries (`avg`, `count`) for summary widgets
- Multi-client push: admin inserts trigger pushes to all viewer subscriptions

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       noex-server                            │
│                                                              │
│  Bucket: metrics              Queries                        │
│  ┌──────────────────────┐     ┌───────────────────────────┐  │
│  │ name: string          │     │ all-metrics                │  │
│  │ value: number         │     │ metrics-by-name({ name })  │  │
│  │ unit: string          │     │ metric-count               │  │
│  │ timestamp: number     │     │ latest-metrics({ n })      │  │
│  └──────────────────────┘     └───────────────────────────┘  │
│                                                              │
│  Auth                         Permissions                    │
│  ┌──────────────────────┐     ┌───────────────────────────┐  │
│  │ admin-token → admin   │     │ admin  → full access       │  │
│  │ viewer-token → viewer │     │ viewer → read + subscribe  │  │
│  └──────────────────────┘     └───────────────────────────┘  │
│                                                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐          │
│  │   Admin    │   │  Viewer 1  │   │  Viewer 2  │          │
│  │  insert()  │   │ subscribe  │   │ subscribe  │          │
│  │  update()  │   │  push ←    │   │  push ←    │          │
│  └────────────┘   └────────────┘   └────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Part 1: Server Setup

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

  // ── Queries ─────────────────────────────────────────────────────
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

  // ── Auth + Permissions ──────────────────────────────────────────
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

  console.log(`Dashboard server listening on ws://localhost:${server.port}`);
}

main();
```

## Part 2: Admin Client — Push Metrics

The admin connects with auto-login and inserts metrics:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const admin = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'admin-token' },
});

const welcome = await admin.connect();
// Auto-login happens automatically when welcome.requiresAuth is true

// Verify authentication
const session = await admin.auth.whoami();
console.log(session?.userId); // "admin-1"
console.log(session?.roles);  // ["admin"]

// Push metrics
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

## Part 3: Viewer Client — Live Dashboard

The viewer connects, authenticates, and subscribes to multiple dashboard panels:

```typescript
const viewer = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'viewer-token' },
});
await viewer.connect();

// ── Panel 1: All metrics table ─────────────────────────────────
const unsubAll = await viewer.store.subscribe('all-metrics', (data) => {
  const rows = data as Record<string, unknown>[];
  console.log(`\n--- All Metrics (${rows.length}) ---`);
  for (const row of rows) {
    console.log(`  ${row['name']}: ${row['value']} ${row['unit']}`);
  }
});

// ── Panel 2: CPU-only chart ────────────────────────────────────
const unsubCpu = await viewer.store.subscribe(
  'metrics-by-name',
  { name: 'cpu' },
  (data) => {
    const cpuReadings = data as Record<string, unknown>[];
    console.log(`CPU readings: ${cpuReadings.length}`);
  },
);

// ── Panel 3: Total metric count badge ──────────────────────────
const unsubCount = await viewer.store.subscribe('metric-count', (data) => {
  console.log(`Total metrics: ${data}`);
});

// ── Panel 4: Last 5 readings widget ───────────────────────────
const unsubLatest = await viewer.store.subscribe(
  'latest-metrics',
  { n: 5 },
  (data) => {
    const latest = data as Record<string, unknown>[];
    console.log(`Latest ${latest.length} readings`);
  },
);
```

Each subscription callback fires immediately with current data. As the admin pushes new metrics, each panel updates independently — only panels whose query result actually changed receive a push.

### Permission Enforcement

If the viewer tries to mutate data, the server rejects the request:

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

## Part 4: Admin Batch Insert via Transaction

Transactions insert multiple metrics atomically — subscribers receive a single push after the commit, not one per operation:

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
// Viewer's all-metrics callback fires ONCE with the full updated list
```

## Part 5: Selective Push Behavior

The server only pushes when a query's result actually changes. This is critical for dashboard efficiency:

```typescript
// Viewer subscribes to CPU-only metrics
const cpuSnapshots: unknown[] = [];
await viewer.store.subscribe('metrics-by-name', { name: 'cpu' }, (data) => {
  cpuSnapshots.push(data);
});

// Admin inserts a memory metric
await admin.store.bucket('metrics').insert({
  name: 'memory', value: 8100, unit: 'MB', timestamp: Date.now(),
});

// → No push to cpuSnapshots — the CPU query result didn't change

// Admin inserts a CPU metric
await admin.store.bucket('metrics').insert({
  name: 'cpu', value: 91.3, unit: '%', timestamp: Date.now(),
});

// → Push arrives to cpuSnapshots with the updated CPU list
```

## Complete Working Example

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

  // ── Viewer ──────────────────────────────────────────────────────
  const viewer = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'viewer-token' },
  });
  await viewer.connect();

  let metricCount = 0;
  const unsubCount = await viewer.store.subscribe('metric-count', (data) => {
    metricCount = data as number;
    console.log(`[Viewer] Total metrics: ${metricCount}`);
  });

  const unsubAll = await viewer.store.subscribe('all-metrics', (data) => {
    const rows = data as Record<string, unknown>[];
    console.log(`[Viewer] Metrics list: ${rows.length} items`);
  });

  // Admin pushes metrics
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

  console.log('Done.');
}

main();
```

## Exercise

Extend the dashboard with an alerting system:

1. Add an `alerts` bucket with fields: `metric` (string), `threshold` (number), `severity` (`'low' | 'medium' | 'high'`)
2. Define a query `active-alerts` that returns all alerts
3. Modify the permission check so viewers can read alerts but only admins can create them
4. From the admin client, use a transaction to atomically insert a metric and an alert when the value exceeds a threshold

<details>
<summary>Solution</summary>

**Server additions:**

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

No permission changes needed — the existing `WRITE_OPS` set already covers `store.insert` and `store.transaction`.

**Admin client — atomic metric + alert:**

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

Viewers subscribed to `active-alerts` receive a push with the new alert. Viewers subscribed to `all-metrics` receive the updated metric list. Both pushes arrive from a single transaction commit.

</details>

## Summary

- **Auto-login** — set `auth: { token }` in `ClientOptions` to authenticate automatically on connect (and reconnect)
- **Permission enforcement** — the server rejects forbidden operations with `FORBIDDEN` error code; the SDK throws `NoexClientError`
- **Parameterized subscriptions** — `store.subscribe(query, params, callback)` lets each dashboard panel filter independently
- **Transactions** — batch operations are atomic; subscribers receive a single push after the commit
- **Selective push** — filtered subscriptions (e.g., `metrics-by-name({ name: 'cpu' })`) only fire when their specific result changes
- **Role separation** — admin and viewer use the same SDK, different tokens grant different permissions

---

Next: [Chat Application](./03-chat-application.md)
