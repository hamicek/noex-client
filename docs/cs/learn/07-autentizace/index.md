# Část 7: Autentizace

Ověření tokenem a automatická obnova relace při reconnectu.

## Kapitoly

### [7.1 Přihlášení a odhlášení](./01-prihlaseni-a-odhlaseni.md)

Ruční správa auth relací:
- `auth.login(token)` — ověření a získání AuthSession
- `auth.whoami()` — kontrola aktuální relace (userId, roles, metadata, expiresAt)
- `auth.logout()` — ukončení aktuální relace

### [7.2 Automatické přihlášení](./02-automaticke-prihlaseni.md)

Nechte SDK, aby autentizaci řešilo automaticky:
- `ClientOptions.auth.token` — konfigurace tokenu při vytváření klienta
- Automatické přihlášení po prvním connect
- Automatické opětovné přihlášení po každém úspěšném reconnectu

## Co se naučíte

Na konci této sekce budete schopni:
- Ručně se přihlásit a odhlásit
- Zkontrolovat aktuální relaci
- Nakonfigurovat automatické přihlášení pro bezúdržbovou autentizaci

---

Začněte s: [Přihlášení a odhlášení](./01-prihlaseni-a-odhlaseni.md)
