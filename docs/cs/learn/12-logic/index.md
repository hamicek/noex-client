# Část 12: Integrace logic

Použití logic enginu pro vypočítané položky, odvozené pohledy, omezení a výrazy přes klientské SDK.

## Kapitoly

### [12.1 Nastavení](./01-nastaveni.md)

Přístup k logic enginu z klienta:
- `client.logic` namespace (LogicAPI)
- Požadavky na server — logic musí být nakonfigurovaný
- `expr` helper pro tvorbu výrazů
- Přehled všech logic operací

### [12.2 Vypočítané položky](./02-vypocitane-polozky.md)

Definice a správa vypočítaných položek:
- `logic.defineComputed(bucket, fields)` — definice automaticky počítaných položek
- `logic.dropComputed(bucket)` — odebrání vypočítaných položek
- `logic.listComputed()` — výpis všech konfigurací
- Integrace se store — vypočítané hodnoty se objeví po insert/update

### [12.3 Pohledy a omezení](./03-pohledy-a-omezeni.md)

Práce s odvozenými pohledy a omezeními:
- `logic.defineView(definition)` — tvorba pohledů s joiny, filtry, seskupením
- `logic.queryView(name)` / `logic.explainView(name)` — dotazování a inspekce pohledů
- `logic.defineConstraint(constraint)` — vynucení business pravidel při store zápisech
- Porušení omezení jako chyby

### [12.4 Odběry pohledů](./04-odbery-pohledu.md)

Odběr pohledů a vyhodnocení výrazů:
- `logic.subscribeView(name, callback)` — initial data + push aktualizace
- `logic.evaluateExpr(expr, record?)` — samostatné vyhodnocení výrazů
- `expr` helper detailně — všechny operátory podle kategorie
- Reconnect recovery pro logic odběry

## Co se naučíte

Na konci této sekce budete schopni:
- Přistupovat k logic enginu přes `client.logic`
- Tvořit výrazy s `expr` helperem
- Definovat vypočítané položky, které se automaticky počítají při insert/update
- Vytvářet a dotazovat odvozené pohledy
- Vynucovat omezení při store zápisech
- Odebírat reaktivní pohledy a přijímat živé aktualizace
- Vyhodnocovat výrazy samostatně

---

Začněte s: [Nastavení](./01-nastaveni.md)
