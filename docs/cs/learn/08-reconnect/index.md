# Část 8: Reconnect a odolnost

Zvládněte výpadky sítě s automatickým reconnectem, obnovou odběrů a heartbeatem.

## Kapitoly

### [8.1 Automatický reconnect](./01-automaticky-reconnect.md)

Konfigurace a pochopení reconnect chování:
- `ReconnectOptions` — maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier, jitter
- Exponential backoff s náhodným jitter pro zamezení thundering herd efektu
- Lifecycle eventy: `reconnecting`, `reconnected`, `disconnected`

### [8.2 Obnova odběrů](./02-obnova-odberu.md)

Pochopte, co se stane s odběry po reconnectu:
- Automatické znovupřihlášení s doručením čerstvých dat
- Aktualizace serverem přidělených subscription ID
- Žádný manuální zásah — callbacky pokračují v přijímání dat

### [8.3 Heartbeat](./03-heartbeat.md)

Udržení spojení naživu a detekce mrtvých protějšků:
- Server posílá ping, klient automaticky odpovídá pong
- Volba `heartbeat` (ve výchozím stavu zapnuta)
- Detekce mrtvého spojení, když přestanou přicházet pingy

## Co se naučíte

Na konci této sekce porozumíte:
- Jak funguje exponential backoff s jitter
- Co se děje s čekajícími požadavky a odběry během reconnectu
- Jak heartbeat udržuje spojení zdravé

---

Začněte s: [Automatický reconnect](./01-automaticky-reconnect.md)
