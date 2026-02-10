# Část 4: Reaktivní odběry

Odebírejte serverové dotazy a přijímejte živé push aktualizace při každé změně dat.

## Kapitoly

### [4.1 Odběr dotazů](./01-odber-dotazu.md)

Nastavte svůj první reaktivní odběr:
- `store.subscribe(query, callback)` — registrace dotazu a příjem aktualizací
- Initial data doručena okamžitě přes callback
- Push aktualizace přicházejí automaticky při změně výsledku dotazu na serveru

### [4.2 Parametrizované dotazy](./02-parametrizovane-dotazy.md)

Předávejte dynamické parametry do serverových dotazů:
- `store.subscribe(query, params, callback)` — odběr s parametry
- Případy použití: filtrování podle uživatele, role, stavu nebo jakékoli dynamické hodnoty

### [4.3 Správa odběrů](./03-sprava-odberu.md)

Správně ukončujte odběry:
- Funkce unsubscribe vrácená z `store.subscribe`
- Cleanup vzory pro komponenty a dlouhodobé procesy
- Paměťové a výkonové aspekty

## Co se naučíte

Na konci této sekce budete schopni:
- Odebírat libovolný serverový dotaz a reagovat na změny v reálném čase
- Používat parametrizované dotazy pro dynamické filtrování
- Správně odhlašovat odběry a vyhnout se únikům zdrojů

---

Začněte s: [Odběr dotazů](./01-odber-dotazu.md)
