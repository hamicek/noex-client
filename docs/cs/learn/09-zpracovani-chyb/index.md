# Část 9: Zpracování chyb

Pochopte třídy chyb, kódy a strategie pro odolné aplikace.

## Kapitoly

### [9.1 Typy chyb](./01-typy-chyb.md)

Poznejte hierarchii chyb:
- `NoexClientError` — základní třída pro všechny serverové chyby, nese strojově čitelný `code`
- `TimeoutError` — požadavek nedostal odpověď v rámci `requestTimeoutMs`
- `DisconnectedError` — pokus o odeslání při nepřipojeném stavu nebo ztráta spojení
- Serverové chybové kódy: VALIDATION_ERROR, UNAUTHORIZED, NOT_FOUND, RATE_LIMITED

### [9.2 Strategie obnovy](./02-strategie-obnovy.md)

Korektní zpracování chyb v produkci:
- Mapování serverových chybových kódů na uživatelsky srozumitelné zprávy
- Retry vzory pro idempotentní operace
- Proč se neautomaticky opakují neídempotentní operace (insert, emit)
- Graceful degradation, když je server nedostupný

## Co se naučíte

Na konci této sekce budete schopni:
- Zachytávat a klasifikovat chyby podle typu a kódu
- Implementovat vhodné strategie obnovy pro každý typ chyby
- Stavět odolné aplikace s korektní degradací

---

Začněte s: [Typy chyb](./01-typy-chyb.md)
