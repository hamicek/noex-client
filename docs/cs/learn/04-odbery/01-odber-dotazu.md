# Odběr dotazů

noex-server podporuje **reaktivní dotazy** — pojmenované dotazy definované na serveru, které se automaticky přehodnotí při změně podkladových dat. Klient odebírá tyto dotazy a přijímá push aktualizace v reálném čase. Tato kapitola pokrývá metodu `store.subscribe()`, způsob doručení počátečních dat a příjem push aktualizací.

## Co se naučíte

- Jak fungují reaktivní dotazy na straně serveru
- Jak odebírat pomocí `store.subscribe(query, callback)`
- Jak se doručují počáteční data do callbacku
- Jak přicházejí push aktualizace při změně dat
- Životní cyklus odběru od subscribe po push

## Jak fungují reaktivní dotazy

Reaktivní dotazy jsou definovány na **serveru** — klient je pouze odkazuje jménem. Průběh je následující:

```
                            Server
                         ┌──────────────────────────────┐
Klient                   │                              │
┌──────────┐  subscribe  │  ┌─────────────────────┐     │
│  store.   │──────────>│  │ Vyhodnocení dotazu  │     │
│ subscribe │            │  │ Vrácení poč. dat    │     │
│ ('query') │<──────────│  └─────────────────────┘     │
└──────────┘   result    │                              │
                         │  ... data se změní ...       │
┌──────────┐   push      │  ┌─────────────────────┐     │
│ callback  │<──────────│  │ Přehodnocení dotazu │     │
│ (data)    │            │  │ Push pokud výsledek≠│     │
└──────────┘             │  └─────────────────────┘     │
                         └──────────────────────────────┘
```

Klíčové body:
- Server definuje dotazy (např. "vrať všechny uživatele", "spočítej aktivní relace")
- Klient odebírá podle **jména** — neposílá logiku dotazu
- Server pushuje aktualizace **pouze** tehdy, když se výsledek dotazu skutečně změní
- Pokud mutace neovlivní výsledek dotazu, push se neodešle

## store.subscribe()

Základní forma přijímá název dotazu a callback:

```typescript
const unsubscribe = await client.store.subscribe('all-users', (data) => {
  console.log('Uživatelé:', data);
});
```

**Signatura:**

```typescript
subscribe(query: string, callback: (data: unknown) => void): Promise<Unsubscribe>
```

| Parametr | Typ | Popis |
|----------|-----|-------|
| query | `string` | Název serverového dotazu |
| callback | `(data: unknown) => void` | Volán s počátečními daty a při každém push |

Vrací `Promise<Unsubscribe>` — synchronní funkci `() => void`, která zastaví odběr.

## Doručení počátečních dat

Při volání `subscribe()` server okamžitě vyhodnotí dotaz a vrátí aktuální výsledek. Callback se zavolá **synchronně** s těmito daty **ještě před** splněním promise:

```typescript
const received: unknown[] = [];

const unsub = await client.store.subscribe('all-users', (data) => {
  received.push(data);
});

// V tomto bodě už byl callback zavolán jednou
console.log(received.length); // 1
console.log(received[0]);     // [] (prázdné pole, pokud neexistují žádní uživatelé)
```

Tato garance znamená, že po `await subscribe()` váš callback vždy obsahuje aktuální stav. Nepotřebujete samostatný krok pro "načtení počátečních dat".

## Push aktualizace

Po počátečním doručení server sleduje podkladová data. Když mutace (insert, update, delete) způsobí změnu výsledku dotazu, server odešle push zprávu a váš callback se zavolá znovu:

```typescript
const snapshots: unknown[] = [];

await client.store.subscribe('all-users', (data) => {
  snapshots.push(data);
});

// snapshots[0] = [] (počáteční: žádní uživatelé)

await client.store.bucket('users').insert({ name: 'Alice' });
// Poté, co server zpracuje požadavek, dotaz se přehodnotí.
// snapshots[1] = [{ id: '...', name: 'Alice', ... }]

await client.store.bucket('users').insert({ name: 'Bob' });
// snapshots[2] = [{ id: '...', name: 'Alice', ... }, { id: '...', name: 'Bob', ... }]
```

Každý push doručí **kompletní** výsledek dotazu — nikoli diff. Váš callback vždy obdrží plný aktuální stav.

### Push je selektivní

Server pushuje pouze tehdy, když se výsledek dotazu **skutečně změní**. Pokud odebíráte filtrovaný dotaz a mutace neovlivní filtr, push nedorazí:

```typescript
// Server definuje dotaz 'users-by-role', který filtruje podle parametru role
await client.store.subscribe('users-by-role', { role: 'admin' }, (data) => {
  console.log('Administrátoři:', data);
});

// Tento insert vytvoří uživatele s rolí 'user' — výsledek dotazu pro adminy se nezmění
// → push nedorazí
await client.store.bucket('users').insert({ name: 'Regular', role: 'user' });

// Tento insert vytvoří uživatele s rolí 'admin' — výsledek dotazu pro adminy se změní
// → push dorazí s aktualizovaným seznamem
await client.store.bucket('users').insert({ name: 'AdminUser', role: 'admin' });
```

## Skalární dotazy

Dotazy nemusí vracet pole. Dotaz na počet vrací číslo:

```typescript
await client.store.subscribe('user-count', (data) => {
  console.log('Celkem uživatelů:', data); // data je číslo
});

// Počáteční: 0
// Po insertu: 1
// Po dalším insertu: 2
```

Callback obdrží cokoliv, co serverový dotaz vrátí — pole, objekty, čísla nebo jakoukoli jinou JSON hodnotu.

## Kompletní funkční příklad

Živý seznam uživatelů synchronizovaný se serverem:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Odběr dotazu 'all-users' definovaného na serveru
  const unsub = await client.store.subscribe('all-users', (data) => {
    const users = data as Array<{ name: string; role: string }>;
    console.log(`[${new Date().toISOString()}] ${users.length} uživatelů:`);
    for (const user of users) {
      console.log(`  - ${user.name} (${user.role})`);
    }
  });

  // Simulace mutací — každá spustí push aktualizaci
  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'editor' });

  // Čekání na doručení push aktualizací
  await new Promise((r) => setTimeout(r, 500));

  // Cleanup
  unsub();
  await client.disconnect();
}

main().catch(console.error);
```

Výstup:

```
[2025-01-15T10:00:00.000Z] 0 uživatelů:
[2025-01-15T10:00:00.050Z] 1 uživatelů:
  - Alice (admin)
[2025-01-15T10:00:00.100Z] 2 uživatelů:
  - Alice (admin)
  - Bob (editor)
```

## Zpracování chyb

```typescript
import { NoexClientError, TimeoutError, DisconnectedError } from '@hamicek/noex-client';

try {
  await client.store.subscribe('nonexistent-query', (data) => {
    // ...
  });
} catch (err) {
  if (err instanceof NoexClientError) {
    console.log(err.code);    // např. 'QUERY_NOT_FOUND'
    console.log(err.message); // lidsky čitelný popis
  }
  if (err instanceof TimeoutError) {
    console.log('Server neodpověděl včas');
  }
  if (err instanceof DisconnectedError) {
    console.log('Nepřipojeno k serveru');
  }
}
```

Pokud váš callback vyhodí chybu během doručování **počátečních** dat, odběr se automaticky uklidí a chyba se propaguje volajícímu:

```typescript
try {
  await client.store.subscribe('all-users', (data) => {
    throw new Error('zpracování selhalo');
  });
} catch (err) {
  // err.message === 'zpracování selhalo'
  // Odběr byl uklidněn — žádný únik zdrojů
}
```

Pokud callback vyhodí chybu během **push** aktualizace, chyba se zaloguje do `console.error`, ale odběr zůstane aktivní. Klient nespadne.

## Cvičení

Napište skript, který:
1. Odebírá dotaz `all-users`
2. Sbírá každý snapshot, který callback obdrží, do pole
3. Vloží dva uživatele
4. Krátce počká na push aktualizace
5. Zaloguje celkový počet přijatých snapshotů a finální snapshot

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  const snapshots: unknown[] = [];

  const unsub = await client.store.subscribe('all-users', (data) => {
    snapshots.push(data);
  });

  // Vložení dvou uživatelů
  const users = client.store.bucket('users');
  await users.insert({ name: 'Alice', role: 'admin' });
  await users.insert({ name: 'Bob', role: 'editor' });

  // Čekání na push aktualizace
  await new Promise((r) => setTimeout(r, 500));

  console.log('Celkem snapshotů:', snapshots.length); // 3
  console.log('Počáteční:', snapshots[0]);              // []
  console.log('Finální:', snapshots[snapshots.length - 1]);

  unsub();
  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- Reaktivní dotazy jsou definovány na serveru — klient odebírá podle jména
- `store.subscribe(query, callback)` vrací `Promise<Unsubscribe>`
- Callback obdrží **počáteční data synchronně** ještě před splněním promise
- Push aktualizace doručují **kompletní** výsledek dotazu, nikoli diffy
- Server pushuje pouze tehdy, když se výsledek dotazu skutečně změní
- Skalární dotazy (count, agregace) fungují stejným způsobem — callback obdrží hodnotu přímo
- Chyby callbacku během počátečního doručení automaticky uklidí odběr
- Chyby callbacku během push aktualizací se zalogují, ale nerozbijí odběr

---

Další: [Parametrizované dotazy](./02-parametrizovane-dotazy.md)
