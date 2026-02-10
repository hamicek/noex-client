# Část 3: Store operace

Čtení a zápis dat přes typované bucket handle.

## Kapitoly

### [3.1 Základní CRUD](./01-zakladni-crud.md)

Vytvářejte, čtěte, upravujte a mažte záznamy:
- `client.store.bucket('name')` — získání bucket handle
- `insert(data)`, `get(key)`, `update(key, data)`, `delete(key)`
- `RecordMeta` — id, createdAt, updatedAt přidané serverem

### [3.2 Dotazy](./02-dotazy.md)

Dotazování záznamů s filtry:
- `all()` — všechny záznamy v bucketu
- `where(filter)` — záznamy odpovídající podmínce
- `findOne(filter)` — jeden záznam nebo null
- `count(filter?)` — počet odpovídajících záznamů

### [3.3 Agregace a stránkování](./03-agregace-a-strankovani.md)

Navigace ve velkých datasetech a výpočet agregací:
- `first(n)`, `last(n)` — nejstarší a nejnovější záznamy
- `paginate({ limit, after? })` — stránkování s kurzorem
- `sum(field)`, `avg(field)`, `min(field)`, `max(field)` — numerické agregace

### [3.4 Typové buckety](./04-typove-buckety.md)

Využijte TypeScript generika pro typově bezpečné záznamy:
- `BucketAPI<T>` — generický typový parametr
- Průnik s `RecordMeta` v návratových typech
- Kontrola typů při kompilaci pro insert a update payloady

## Co se naučíte

Na konci této sekce budete schopni:
- Provádět všechny CRUD operace nad libovolným bucketem
- Dotazovat, filtrovat a stránkovat záznamy
- Používat agregační funkce pro numerickou analýzu
- Definovat typované buckety s plnou TypeScript podporou

---

Začněte s: [Základní CRUD](./01-zakladni-crud.md)
