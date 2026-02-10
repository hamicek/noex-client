# Part 6: Rules Integration

Emit events, manage facts, and subscribe to rule engine matches through the client SDK.

## Chapters

### [6.1 Events](./01-events.md)

Emit events into the server-side rule engine:
- `rules.emit(topic, data)` — emit an event
- `correlationId` and `causationId` for tracing event chains
- The returned `RulesEvent` object with id, timestamp, and source

### [6.2 Facts](./02-facts.md)

Manage persistent facts that the rule engine reasons about:
- `setFact(key, value)` — create or update a fact
- `getFact(key)` — read a single fact
- `deleteFact(key)` — remove a fact
- `queryFacts(pattern)` — glob-style queries with `:` segment separator
- `getAllFacts()` — dump every fact

### [6.3 Rules Subscriptions](./03-rules-subscriptions.md)

Subscribe to real-time rule events by topic pattern:
- `rules.subscribe(pattern, callback)` — pattern-based event subscription
- Event push channel (separate from store subscription channel)
- Unsubscribe cleanup

## What You'll Learn

By the end of this section, you'll be able to:
- Emit events and trace them with correlation/causation IDs
- Manage facts through the client SDK
- Subscribe to rule-fired events in real time

---

Start with: [Events](./01-events.md)
