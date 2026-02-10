# Část 10: Testování

Nastavte integrační testy a ověřte real-time chování.

## Kapitoly

### [10.1 Nastavení testů](./01-nastaveni-testu.md)

Konfigurace testovacího prostředí:
- Vitest jako test runner
- Spuštění testovacího serveru s `port: 0` a `host: '127.0.0.1'`
- Setup a teardown klienta se správným cleanup
- Práce s asynchronními operacemi v testech

### [10.2 Testovací vzory](./02-testovaci-vzory.md)

Testování běžných SDK scénářů:
- Testy subscriptions — ověření initial data a push aktualizací
- Testy reconnectu — simulace odpojení a ověření obnovy
- Testy auth — login, neautorizovaný přístup, expirace relace
- Edge cases — timeouty, souběžné operace, rychlé subscribe/unsubscribe

## Co se naučíte

Na konci této sekce budete schopni:
- Nastavit spolehlivé testovací prostředí pro noex-client
- Psát testy pro subscriptions, reconnect a auth flow
- Správně pracovat s asynchronním časováním v testech

---

Začněte s: [Nastavení testů](./01-nastaveni-testu.md)
