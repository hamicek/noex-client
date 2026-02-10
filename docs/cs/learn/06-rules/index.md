# Část 6: Integrace rules

Emitujte eventy, spravujte fakta a odebírejte výsledky pravidlového enginu přes klientské SDK.

## Kapitoly

### [6.1 Eventy](./01-eventy.md)

Emitujte eventy do serverového pravidlového enginu:
- `rules.emit(topic, data)` — emitování eventu
- `correlationId` a `causationId` pro trasování řetězců událostí
- Vrácený objekt `RulesEvent` s id, timestamp a source

### [6.2 Fakta](./02-fakta.md)

Správa perzistentních faktů, nad kterými pravidlový engine uvažuje:
- `setFact(key, value)` — vytvoření nebo aktualizace faktu
- `getFact(key)` — čtení jednoho faktu
- `deleteFact(key)` — odstranění faktu
- `queryFacts(pattern)` — glob-style dotazy se separátorem segmentů `:`
- `getAllFacts()` — výpis všech faktů

### [6.3 Rules odběry](./03-rules-odbery.md)

Odběr real-time rule událostí podle topic pattern:
- `rules.subscribe(pattern, callback)` — pattern-based odběr událostí
- Event push kanál (oddělený od store subscription kanálu)
- Cleanup při unsubscribe

## Co se naučíte

Na konci této sekce budete schopni:
- Emitovat eventy a trasovat je pomocí correlation/causation ID
- Spravovat fakta přes klientské SDK
- Odebírat rule-fired eventy v reálném čase

---

Začněte s: [Eventy](./01-eventy.md)
