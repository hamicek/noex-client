# Část 2: Začínáme

Nainstalujte SDK, připojte se k serveru a prozkoumejte konfigurační možnosti.

## Kapitoly

### [2.1 Instalace](./01-instalace.md)

Nastavte SDK ve svém projektu:
- `npm install @hamicek/noex-client`
- Node.js vyžaduje balíček `ws` pro WebSocket podporu
- Prohlížeč používá nativní WebSocket — žádné další závislosti

### [2.2 První připojení](./02-prvni-pripojeni.md)

Připojte se k běžícímu noex-serveru a interagujte s ním:
- `NoexClient.connect()` a welcome zpráva
- `client.disconnect()` pro korektní ukončení
- Lifecycle eventy: connected, disconnected, error

### [2.3 Konfigurace](./03-konfigurace.md)

Pochopte každou dostupnou volbu v `ClientOptions` a `ReconnectOptions`:
- `requestTimeoutMs`, `connectTimeoutMs` — řízení timeoutů
- `reconnect` — boolean nebo detailní `ReconnectOptions`
- `auth.token` — automatické přihlášení při connect
- `heartbeat` — automatická odpověď na ping
- `WebSocket` — vlastní WebSocket konstruktor pro Node.js

## Co se naučíte

Na konci této sekce budete schopni:
- Nainstalovat a importovat SDK v Node.js i prohlížeči
- Připojit se k noex-serveru a zpracovat welcome handshake
- Nakonfigurovat timeouty, reconnect, auth a heartbeat

---

Začněte s: [Instalace](./01-instalace.md)
