# Část 5: Transakce

Provádějte více store operací jako jednu atomickou jednotku.

## Kapitoly

### [5.1 Atomické operace](./01-atomicke-operace.md)

Pochopte, jak transakce fungují:
- `store.transaction(operations)` — odeslání pole operací
- Podporované operace: get, insert, update, delete, where, findOne, count
- Sémantika vše-nebo-nic — buď všechny operace uspějí, nebo se celá transakce vrátí zpět

### [5.2 Vzory transakcí](./02-vzory.md)

Aplikujte transakce na reálné scénáře:
- Cross-bucket operace — atomický přesun dat mezi buckety
- Read-modify-write — čtení aktuálního stavu, výpočet nového, zápis zpět
- Zpracování chyb — co se stane, když transakce selže

## Co se naučíte

Na konci této sekce budete schopni:
- Sestavovat transakce z více operací
- Aplikovat běžné transakční vzory pro konzistenci dat
- Korektně zpracovávat chyby transakcí

---

Začněte s: [Atomické operace](./01-atomicke-operace.md)
