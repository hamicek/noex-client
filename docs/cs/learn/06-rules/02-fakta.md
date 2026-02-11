# Fakta

Fakta jsou perzistentní páry klíč-hodnota uložené v pravidlovém enginu. Pravidla mohou při vyhodnocování podmínek odkazovat na fakta a váš klientský kód je může číst, zapisovat a dotazovat přes `rules` API. Na rozdíl od eventů (což jsou přechodné zprávy) reprezentují fakta **aktuální stav** — přetrvávají, dokud nejsou explicitně smazána nebo přepsána.

## Co se naučíte

- Jak vytvářet a aktualizovat fakta pomocí `setFact()`
- Jak číst fakta pomocí `getFact()` a mazat je pomocí `deleteFact()`
- Jak dotazovat fakta podle vzoru pomocí `queryFacts()` a `getAllFacts()`
- Struktura objektu `Fact` včetně verzování
- Konvence pojmenování klíčů se separátorem segmentů `:`

## Fakta vs eventy

| | Eventy | Fakta |
|---|--------|-------|
| **Životnost** | Přechodná — zpracována jednou | Perzistentní — existují dokud nejsou smazána |
| **Účel** | Signalizace, že se něco stalo | Reprezentace aktuálního stavu |
| **Verzování** | Ne | Ano — `version` se při aktualizaci inkrementuje |
| **API** | `emit()` | `setFact()`, `getFact()`, `deleteFact()`, `queryFacts()` |

Pravidlový engine používá obojí: eventy spouštějí vyhodnocení pravidel, fakta poskytují kontext pro podmínky pravidel. Například pravidlo může říkat „když dorazí event `order.placed`, zkontroluj fakt `user:*:tier` pro rozhodnutí o slevě."

## setFact()

Vytvoří nebo aktualizuje fakt. Pokud klíč již existuje, hodnota je nahrazena a verze se inkrementuje:

```typescript
const fact = await client.rules.setFact('user:1:role', 'admin');
console.log(fact.key);       // 'user:1:role'
console.log(fact.value);     // 'admin'
console.log(fact.version);   // 1
console.log(fact.timestamp); // serverem přidělený timestamp
```

Aktualizace existujícího faktu:

```typescript
const updated = await client.rules.setFact('user:1:role', 'superadmin');
console.log(updated.version); // 2
```

**Signatura:**

```typescript
setFact(key: string, value: unknown): Promise<Fact>
```

| Parametr | Typ | Popis |
|----------|-----|-------|
| key | `string` | Klíč faktu (např. `'user:1:role'`) |
| value | `unknown` | Jakákoliv JSON-serializovatelná hodnota |

Hodnoty mohou být primitiva, pole nebo objekty:

```typescript
await client.rules.setFact('counter', 42);
await client.rules.setFact('tags', ['urgent', 'vip']);
await client.rules.setFact('user:1:profile', {
  name: 'Alice',
  roles: ['admin', 'user'],
});
```

## Objekt Fact

Každé volání `setFact()` vrací objekt `Fact`:

```typescript
interface Fact {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly source: string;
  readonly version: number;
}
```

| Pole | Popis |
|------|-------|
| `key` | Klíč faktu |
| `value` | Aktuální hodnota |
| `timestamp` | Čas poslední aktualizace (Unix ms) |
| `source` | Identifikátor klienta, který fakt nastavil |
| `version` | Začíná na 1, inkrementuje se s každou aktualizací |

## getFact()

Přečte hodnotu faktu podle klíče. Vrací `null`, pokud fakt neexistuje:

```typescript
const role = await client.rules.getFact('user:1:role');
if (role !== null) {
  console.log('Role:', role); // 'admin'
}

const missing = await client.rules.getFact('nonexistent');
console.log(missing); // null
```

**Signatura:**

```typescript
getFact(key: string): Promise<unknown | null>
```

Všimněte si, že `getFact()` vrací pouze **hodnotu**, ne celý objekt `Fact`. Pokud potřebujete metadata (version, timestamp), použijte `queryFacts()` s přesným klíčem nebo `getAllFacts()`.

## deleteFact()

Odstraní fakt podle klíče. Vrací `true`, pokud fakt existoval a byl smazán, `false` pokud neexistoval:

```typescript
await client.rules.setFact('temp', 42);

const deleted = await client.rules.deleteFact('temp');
console.log(deleted); // true

const again = await client.rules.deleteFact('temp');
console.log(again); // false (již smazáno)

const value = await client.rules.getFact('temp');
console.log(value); // null
```

**Signatura:**

```typescript
deleteFact(key: string): Promise<boolean>
```

## Konvence pojmenování klíčů

Fakta používají `:` jako separátor segmentů v klíčích. To umožňuje dotazování na základě vzorů pomocí `queryFacts()`. Konvence je `entita:id:atribut`:

```
user:1:role       → role uživatele 1
user:1:name       → jméno uživatele 1
user:2:role       → role uživatele 2
config:theme      → globální nastavení tématu
order:100:status  → stav objednávky 100
```

Toto hierarchické pojmenování umožňuje dotazovat všechny atributy uživatele (`user:1:*`), všechny role (`user:*:role`) nebo všechny konfigurační hodnoty (`config:*`).

## queryFacts()

Najde všechny fakta odpovídající glob-like vzoru. Zástupný znak `*` odpovídá přesně jednomu segmentu (oddělenému `:`):

```typescript
await client.rules.setFact('user:1:name', 'Alice');
await client.rules.setFact('user:2:name', 'Bob');
await client.rules.setFact('user:1:role', 'admin');
await client.rules.setFact('product:1:title', 'Widget');

const names = await client.rules.queryFacts('user:*:name');
// Vrací Fact[] — dva fakty: user:1:name a user:2:name
for (const fact of names) {
  console.log(`${fact.key} = ${fact.value}`);
}
```

**Signatura:**

```typescript
queryFacts(pattern: string): Promise<Fact[]>
```

**Pravidla pro matching vzorů:**

| Vzor | Odpovídá | Neodpovídá |
|------|----------|------------|
| `user:*` | `user:1`, `user:42` | `user:1:role` |
| `user:*:role` | `user:1:role`, `user:42:role` | `user:1`, `user:1:name` |
| `config:*` | `config:theme`, `config:lang` | `config:ui:theme` |

Znak `*` odpovídá přesně jednomu segmentu — `user:*` odpovídá `user:1`, ale ne `user:1:role` (ten má tři segmenty). Pro shodu s třísegtmentovými klíči použijte `user:*:role` nebo `user:*:*`.

Vrací prázdné pole, když žádné fakty neodpovídají:

```typescript
const empty = await client.rules.queryFacts('nonexistent:*');
console.log(empty); // []
```

## getAllFacts()

Vrací všechny fakty aktuálně v enginu:

```typescript
const facts = await client.rules.getAllFacts();
console.log(`Celkem faktů: ${facts.length}`);

for (const fact of facts) {
  console.log(`${fact.key} (v${fact.version}) = ${JSON.stringify(fact.value)}`);
}
```

**Signatura:**

```typescript
getAllFacts(): Promise<Fact[]>
```

Vrací prázdné pole, pokud žádné fakty neexistují.

## Kompletní funkční příklad

Systém správy uživatelských profilů pomocí faktů:

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // Uložení uživatelských profilů jako faktů
  await client.rules.setFact('user:1:name', 'Alice');
  await client.rules.setFact('user:1:role', 'admin');
  await client.rules.setFact('user:2:name', 'Bob');
  await client.rules.setFact('user:2:role', 'editor');
  await client.rules.setFact('user:3:name', 'Charlie');
  await client.rules.setFact('user:3:role', 'viewer');

  // Dotaz na všechna jména uživatelů
  const names = await client.rules.queryFacts('user:*:name');
  console.log('Všichni uživatelé:');
  for (const fact of names) {
    console.log(`  ${fact.key} = ${fact.value}`);
  }

  // Dotaz na všechny adminy
  const roles = await client.rules.queryFacts('user:*:role');
  const admins = roles.filter((f) => f.value === 'admin');
  console.log(`\nAdmini: ${admins.map((f) => f.key).join(', ')}`);

  // Aktualizace role
  const updated = await client.rules.setFact('user:3:role', 'editor');
  console.log(`\nCharlie povýšen na editora (verze ${updated.version})`);

  // Smazání dat uživatele
  await client.rules.deleteFact('user:2:name');
  await client.rules.deleteFact('user:2:role');

  // Ověření smazání
  const bobName = await client.rules.getFact('user:2:name');
  console.log(`\nBobovo jméno po smazání: ${bobName}`); // null

  // Kontrola zbývajících faktů
  const remaining = await client.rules.getAllFacts();
  console.log(`\nCelkem zbývajících faktů: ${remaining.length}`);

  await client.disconnect();
}

main().catch(console.error);
```

## Cvičení

Napište skript, který:
1. Uloží konfigurační fakta: `config:app:name` = `'MyApp'`, `config:app:version` = `'2.0'`, `config:db:host` = `'localhost'`
2. Dotáže se na všechny fakta `config:app:*` a zaloguje je
3. Aktualizuje `config:app:version` na `'2.1'` a ověří, že se pole version inkrementovalo
4. Smaže `config:db:host` a potvrdí, že vrací `true`
5. Zavolá `getAllFacts()` a zaloguje celkový počet

<details>
<summary>Řešení</summary>

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

async function main() {
  const client = new NoexClient('ws://localhost:8080', { WebSocket });
  await client.connect();

  // 1. Uložení konfiguračních faktů
  await client.rules.setFact('config:app:name', 'MyApp');
  const v1 = await client.rules.setFact('config:app:version', '2.0');
  await client.rules.setFact('config:db:host', 'localhost');

  // 2. Dotaz na konfiguraci aplikace
  const appConfig = await client.rules.queryFacts('config:app:*');
  console.log('Konfigurace aplikace:');
  for (const fact of appConfig) {
    console.log(`  ${fact.key} = ${fact.value}`);
  }
  // config:app:name = MyApp
  // config:app:version = 2.0

  // 3. Aktualizace verze a kontrola pole version
  const v2 = await client.rules.setFact('config:app:version', '2.1');
  console.log(`\nVerze před: ${v1.version}, po: ${v2.version}`);
  // Verze před: 1, po: 2

  // 4. Smazání db host
  const deleted = await client.rules.deleteFact('config:db:host');
  console.log(`\nSmazáno config:db:host: ${deleted}`); // true

  // 5. Počet zbývajících faktů
  const all = await client.rules.getAllFacts();
  console.log(`\nCelkem faktů: ${all.length}`); // 2

  await client.disconnect();
}

main().catch(console.error);
```

</details>

## Shrnutí

- `setFact(key, value)` vytvoří nebo aktualizuje fakt, při každé aktualizaci inkrementuje `version`
- `getFact(key)` vrací hodnotu nebo `null` — ne celý objekt `Fact`
- `deleteFact(key)` vrací `true` pokud bylo smazáno, `false` pokud klíč neexistoval
- `queryFacts(pattern)` najde fakta odpovídající glob vzoru, kde `*` odpovídá jednomu segmentu oddělenému `:`
- `getAllFacts()` vrací všechny fakty v enginu
- Jako separátor segmentů v klíčích používejte `:`: `entita:id:atribut`
- Vzor `user:*` odpovídá `user:1`, ale **ne** `user:1:role` — segmenty se přesně shodují
- Hodnoty mohou být libovolný JSON-serializovatelný typ: primitiva, pole, objekty

---

Další: [Rules odběry](./03-rules-odbery.md)
