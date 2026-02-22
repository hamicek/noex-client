# Naučte se noex-client

Příručka pro Node.js a browserové vývojáře, kteří chtějí stavět real-time aplikace s SDK noex-client. Naučte se připojit k noex-serveru, spravovat data, odebírat živé aktualizace a zvládat reconnect — to vše s typově bezpečným TypeScriptem.

## Pro koho je tato příručka?

- Node.js / TypeScript vývojáři (intermediate+)
- Znáte async/await a základní WebSocket koncepty
- Nepotřebujete předchozí zkušenosti s noex
- Chcete strukturované klientské SDK místo ručního odesílání WebSocket zpráv

## Cesta učení

### Část 1: Úvod

Pochopte, proč klientské SDK existuje a jak do sebe jeho vrstvy zapadají.

| Kapitola | Popis |
|----------|-------|
| [1.1 Proč klientské SDK?](./01-uvod/01-proc-klientske-sdk.md) | Problémy s přímou WebSocket komunikací a jak je SDK řeší |
| [1.2 Klíčové koncepty](./01-uvod/02-klicove-koncepty.md) | Vrstvená architektura (transport → protokol → API), životní cyklus připojení, slovník pojmů |

### Část 2: Začínáme

Nainstalujte SDK a proveďte první připojení.

| Kapitola | Popis |
|----------|-------|
| [2.1 Instalace](./02-zaciname/01-instalace.md) | npm install, Node.js vs browser, balíček `ws` |
| [2.2 První připojení](./02-zaciname/02-prvni-pripojeni.md) | NoexClient.connect(), welcome info, disconnect, lifecycle eventy |
| [2.3 Konfigurace](./02-zaciname/03-konfigurace.md) | Všechna pole ClientOptions a ReconnectOptions s výchozími hodnotami |

### Část 3: Store operace

Čtení a zápis dat přes typované bucket handle.

| Kapitola | Popis |
|----------|-------|
| [3.1 Základní CRUD](./03-store-operace/01-zakladni-crud.md) | bucket(), insert, get, update, delete |
| [3.2 Dotazy](./03-store-operace/02-dotazy.md) | all, where, findOne, count |
| [3.3 Agregace a stránkování](./03-store-operace/03-agregace-a-strankovani.md) | first, last, paginate, sum, avg, min, max |
| [3.4 Typové buckety](./03-store-operace/04-typove-buckety.md) | BucketAPI\<T\> generika, RecordMeta, typová bezpečnost |

### Část 4: Reaktivní odběry

Odebírejte serverové dotazy a přijímejte push aktualizace.

| Kapitola | Popis |
|----------|-------|
| [4.1 Odběr dotazů](./04-odbery/01-odber-dotazu.md) | store.subscribe, initial data, push aktualizace |
| [4.2 Parametrizované dotazy](./04-odbery/02-parametrizovane-dotazy.md) | Subscribe s parametry, dynamické dotazy |
| [4.3 Správa odběrů](./04-odbery/03-sprava-odberu.md) | Unsubscribe, cleanup vzory, best practices |

### Část 5: Transakce

Provádějte více store operací atomicky.

| Kapitola | Popis |
|----------|-------|
| [5.1 Atomické operace](./05-transakce/01-atomicke-operace.md) | store.transaction, pole operací, podporované typy operací |
| [5.2 Vzory transakcí](./05-transakce/02-vzory.md) | Cross-bucket operace, read-modify-write, zpracování chyb |

### Část 6: Integrace rules

Emitujte eventy, spravujte fakta a odebírejte výsledky pravidel.

| Kapitola | Popis |
|----------|-------|
| [6.1 Eventy](./06-rules/01-eventy.md) | rules.emit, topic, data, correlationId, causationId |
| [6.2 Fakta](./06-rules/02-fakta.md) | setFact, getFact, deleteFact, queryFacts, getAllFacts |
| [6.3 Rules odběry](./06-rules/03-rules-odbery.md) | rules.subscribe s pattern, event push kanál, unsubscribe |

### Část 7: Autentizace

Ověření tokenem a automatická obnova relace.

| Kapitola | Popis |
|----------|-------|
| [7.1 Přihlášení a odhlášení](./07-autentizace/01-prihlaseni-a-odhlaseni.md) | auth.login, auth.whoami, auth.logout, AuthSession |
| [7.2 Automatické přihlášení](./07-autentizace/02-automaticke-prihlaseni.md) | ClientOptions.auth, auto-login při connect a reconnect |

### Část 8: Reconnect a odolnost

Zvládněte výpadky sítě s automatickým reconnectem a obnovou odběrů.

| Kapitola | Popis |
|----------|-------|
| [8.1 Automatický reconnect](./08-reconnect/01-automaticky-reconnect.md) | ReconnectOptions, exponential backoff, jitter, maxRetries |
| [8.2 Obnova odběrů](./08-reconnect/02-obnova-odberu.md) | Resubscribe po reconnectu, aktualizace ID, doručení čerstvých dat |
| [8.3 Heartbeat](./08-reconnect/03-heartbeat.md) | Ping/pong, automatická odpověď, detekce mrtvého spojení |

### Část 9: Zpracování chyb

Pochopte třídy chyb, kódy a strategie obnovy.

| Kapitola | Popis |
|----------|-------|
| [9.1 Typy chyb](./09-zpracovani-chyb/01-typy-chyb.md) | NoexClientError, TimeoutError, DisconnectedError, chybové kódy |
| [9.2 Strategie obnovy](./09-zpracovani-chyb/02-strategie-obnovy.md) | Serverové chybové kódy, retry vzory, graceful degradation |

### Část 10: Testování

Nastavte testy a ověřte real-time chování.

| Kapitola | Popis |
|----------|-------|
| [10.1 Nastavení testů](./10-testovani/01-nastaveni-testu.md) | Vitest, testovací server, port: 0, cleanup |
| [10.2 Testovací vzory](./10-testovani/02-testovaci-vzory.md) | Testování subscriptions, reconnectu, auth, edge cases |

### Část 12: Integrace logic

Použití logic enginu pro vypočítané položky, pohledy, omezení a výrazy.

| Kapitola | Popis |
|----------|-------|
| [12.1 Nastavení](./12-logic/01-nastaveni.md) | `client.logic` namespace, `expr` helper, požadavky na server |
| [12.2 Vypočítané položky](./12-logic/02-vypocitane-polozky.md) | defineComputed, dropComputed, listComputed, integrace se store |
| [12.3 Pohledy a omezení](./12-logic/03-pohledy-a-omezeni.md) | defineView, queryView, defineConstraint, porušení omezení |
| [12.4 Odběry pohledů](./12-logic/04-odbery-pohledu.md) | subscribeView, evaluateExpr, expr helper, reconnect recovery |

### Část 11: Projekty

Aplikujte vše v reálných projektech.

| Kapitola | Popis |
|----------|-------|
| [11.1 Todo aplikace](./11-projekty/01-todo-aplikace.md) | CRUD + subscriptions, real-time aktualizace |
| [11.2 Dashboard v reálném čase](./11-projekty/02-dashboard-v-realnem-case.md) | Reaktivní dotazy, auth, multi-client, agregace |
| [11.3 Chatovací aplikace](./11-projekty/03-chatovaci-aplikace.md) | Rules + subscriptions, reconnect recovery, transakce |

## Formát kapitol

Každá kapitola obsahuje:

1. **Úvod** - Co se naučíte a proč je to důležité
2. **Teorie** - Vysvětlení konceptu s diagramy a srovnávacími tabulkami
3. **Příklad** - Kompletní spustitelný kód s postupnými kroky
4. **Cvičení** - Praktický úkol s řešením
5. **Shrnutí** - Klíčové poznatky
6. **Další kroky** - Odkaz na další kapitolu

## Získání pomoci

- [API Reference](../reference/index.md) - Kompletní API dokumentace

---

Připraveni začít? Začněte s [Proč klientské SDK?](./01-uvod/01-proc-klientske-sdk.md)
