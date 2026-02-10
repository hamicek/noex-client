# Část 1: Úvod

Tato sekce vysvětluje, proč klientské SDK existuje, a představuje architekturu, se kterou budete pracovat v celé příručce.

## Kapitoly

### [1.1 Proč klientské SDK?](./01-proc-klientske-sdk.md)

Dozvíte se o problémech s přímou WebSocket komunikací a jak SDK poskytuje strukturovanou alternativu:
- Ruční rámování zpráv, korelace a zpracování chyb
- Žádná typová bezpečnost ani abstrakce nad drátovým protokolem
- Reconnect, obnova odběrů a heartbeat ponechány na vývojáři

### [1.2 Klíčové koncepty](./02-klicove-koncepty.md)

Přehled základních stavebních bloků:
- **Transport** - Správa WebSocket spojení, odesílání a příjem
- **Protokol** - Rámování zpráv, korelace request/response, směrování push
- **API** - Vysokoúrovňové store, rules a auth operace
- **Životní cyklus připojení** - connecting → connected → reconnecting → disconnected
- **Slovník** - Bucket, subscription, push, welcome, heartbeat

## Co se naučíte

Na konci této sekce porozumíte:
- Proč je specializované SDK lepší než ruční odesílání WebSocket zpráv
- Jak funguje třívrstvá architektura (transport → protokol → API)
- Co znamená každý stav připojení a kdy dochází k přechodům
- Slovníku používanému v celé příručce

---

Začněte s: [Proč klientské SDK?](./01-proc-klientske-sdk.md)
