# Vlkančický triatlon — systém pro měření závodů

Systém pro pořadatele amatérských vícedisciplinárních závodů, jako je plavání → kolo → běh.
Vznikl pro **Vlkančický triatlon** (koná se jednou ročně, první srpnovou sobotu), ale dá se
nastavit i pro jiné závody.

- **Organizátoři** zapisují mezičasy na checkpointech v **appce** na telefonu, i bez signálu.
- **Admini** ve **webové administraci** spravují závody, kategorie, závodníky a uživatele
  a opravují sporné výsledky. Každý zásah se zapisuje do auditu.
- **Diváci** sledují **veřejnou výsledkovou tabuli** bez přihlášení, živě během závodu
  i s finálními výsledky.

## Co systém umí

| Část                              | Pro koho              | Hlavní funkce                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Veřejná tabule** (`/vysledky`)  | diváci, závodníci     | živé průběžné i finální výsledky; domácí a hosté v jedné tabulce se sloupcem D/H a pořadím v kategorii; jen nezbytné osobní údaje (GDPR)                                                                                                          |
| **Web: administrace** (`/zavody`) | admini, organizátoři  | závody, věkové skupiny a kategorie, checkpointy, závodníci (ruční zadání, import CSV/XLSX), uživatelé a přiřazení ke checkpointům, živé výsledky, korekce časů a remíz s auditem, uzavírání kategorií (ředitel závodu), GDPR export a anonymizace |
| **Appka** (Android, iOS)          | organizátoři na trati | grid startovních čísel na checkpointu, poznámky a vrácení akce, check-in a registrace na místě, hromadný start kategorie, **offline fronta** a synchronizace hodin se serverem                                                                    |

**Role:** admin, ředitel závodu (uzavírá kategorie), organizátor (zapisuje na přiřazených
checkpointech) a veřejnost. Přihlašuje se e-mailem: na adresu přijde jednorázový kód nebo odkaz,
hesla se nepoužívají.

## Výchozí kategorie

Při zakládání závodu se předvyplní kategorie Vlkančického triatlonu
([vlkancice.cz/triatlon](https://www.vlkancice.cz/triatlon/zakladni-informace/)):

| Skupina                  | Věk      | Pohlaví             | Plavání / kolo / běh (m) |
| ------------------------ | -------- | ------------------- | ------------------------ |
| 0–5                      | do 5 let | dívky a hoši zvlášť | 10 / 200 / 50            |
| 6–8                      | 6–8      | dívky a hoši zvlášť | 20 / 500 / 100           |
| 9–10                     | 9–10     | dívky a hoši zvlášť | 40 / 1000 / 300          |
| 11–12                    | 11–12    | dívky a hoši zvlášť | 60 / 1500 / 500          |
| 13–14                    | 13–14    | dívky a hoši zvlášť | 80 / 2000 / 1000         |
| 15–16                    | 15–16    | dívky a hoši zvlášť | 100 / 2500 / 1200        |
| Ženy                     | 17+      | ženy                | 200 / 6000 / 2000        |
| Super ženy _(volitelná)_ | 17+      | ženy                | 400 / 12 000 / 4000      |
| Muži do 40               | 17–40    | muži                | 400 / 12 000 / 4000      |
| Muži nad 40              | 41+      | muži                | 200 / 6000 / 2000        |

- **Věk** se počítá podle ročníku narození: rok závodu − rok narození.
- **Domácí a hosté** mají každou kategorii zvlášť, s vlastním oficiálním pořadím.
- **Super ženy** jsou volitelná skupina: závodnice se do ní zařadí jen volbou při registraci,
  jinak podle věku do Žen.

**Kategorie lze volně měnit** u každého závodu v administraci, pokud ještě nejsou registrovaní
závodníci. Jde nastavit věkové hranice, popisky, skupiny jen pro jedno pohlaví, volitelné skupiny
a výchozí délky tratí. Délky tratí a checkpointy se dají upravit i u jednotlivých kategorií.
Výchozí sada je v [`packages/shared/src/age.ts`](packages/shared/src/age.ts) (`DEFAULT_AGE_GROUPS`).

## Technologie

TypeScript monorepo (pnpm workspaces):

```
apps/api         NestJS + PostgreSQL (Prisma) — REST API, SSE pro živé výsledky
apps/web         React (Vite) — administrace a veřejná tabule
apps/mobile      React Native (Expo) — appka pro organizátory, offline-first (SQLite)
packages/shared  sdílené typy, validace (zod) a výpočet výsledků — stejně na serveru i v klientech
deploy/          produkční Docker Compose (Postgres, API, Caddy s automatickým HTTPS, zálohy)
                 a Kubernetes (Helm chart v deploy/helm, cookbook v deploy/k8s)
```

Časy se ukládají jako append-only log akcí: záznam, zrušení, korekce, poznámka. Každá akce má
UUID z klienta, takže opakované odeslání z appky po výpadku signálu nic nezdvojí. Výsledky se
z logu vždy přepočítají.

## Rozjetí lokálně

**Potřeba:** Node.js 22+ (doporučeno 24), pnpm (`corepack enable`), Docker.

```sh
pnpm install
cp .env.example .env                           # výchozí hodnoty stačí pro vývoj
docker compose up -d                           # Postgres + Mailpit (zachytává e-maily)
pnpm --filter @triatlon/shared build
pnpm --filter @triatlon/api prisma:migrate     # migrace databáze
pnpm --filter @triatlon/api build
pnpm --filter @triatlon/api prisma:seed        # admin (admin@example.com) + závod s výchozími kategoriemi
pnpm dev                                       # API na :3000, web na :5173
```

- **Web:** <http://localhost:5173>. Administrace je na `/zavody` a veřejná tabule na
  `/vysledky`.
- **Přihlášení:** zadejte `admin@example.com`. Kód nebo odkaz přijde do Mailpitu na
  <http://localhost:8025>.
- **Ukázková data** (závod s běžícími kategoriemi a časy): `pnpm --filter @triatlon/api demo`.
- **Appka:** viz [`apps/mobile/README.md`](apps/mobile/README.md). Telefon musí být ve stejné
  Wi-Fi a appka se připojí k API na počítači s Expo dev serverem.

API se po změně kódu nepřestaví samo. Restartujte `pnpm dev`, případně jen
`pnpm --filter @triatlon/api dev`.

## Testy a kontrola kódu

```sh
pnpm test           # shared (Vitest), API (integrační testy proti Postgresu z docker compose), appka
pnpm typecheck
pnpm lint           # oxlint
pnpm format:check   # prettier
```

Totéž běží v CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) při každém pushi
a pull requestu.

## Nasazení

Celý systém běží na jednom serveru v Docker Compose: Postgres, API, Caddy s webem a automatickým
HTTPS, a pravidelné zálohy databáze. Nasazuje se ručně spouštěným GitHub workflow **Nasazení**:
testy → image do ghcr.io → SSH na server → záloha → restart.

- [`deploy/README.md`](deploy/README.md): provoz, zálohy, obnova, e-maily, GDPR.
- [`HOSTING_V_OBCI_ALADIN.md`](HOSTING_V_OBCI_ALADIN.md): testovací server na domácím připojení
  se statickou IP.

## Dokumentace

- [`CLAUDE.md`](CLAUDE.md): zadání a zdroj pravdy (role, datový model, pravidla výpočtu výsledků,
  implementační rozhodnutí).
- [`docs/diagramy.md`](docs/diagramy.md): diagramy architektury, toků v appce, synchronizace,
  výsledků a nasazení (Mermaid).
- [`deploy/README.md`](deploy/README.md): provoz na serveru.
- [`deploy/k8s/README.md`](deploy/k8s/README.md): nasazení do Kubernetes (Helm), cookbook pro další clustery.
- [`apps/mobile/README.md`](apps/mobile/README.md): vývoj appky.

## Stav projektu

Hotové jsou fáze F0–F4: kostra, administrace, výsledky, appka, veřejná tabule, GDPR
a nasazení. Čeká se na **generálku (F5)**: test se skutečnými telefony v terénu, zátěžový test
a provozní příručka pro den závodu. Otevřené body (hosting, doména, distribuce appky) jsou
v [`CLAUDE.md`](CLAUDE.md), sekce 10.

## Licence

Licence zatím není určená. Bez ní platí výhradní autorská práva autora. Než se kód začne
používat nebo sdílet jinde, je potřeba licenci vybrat.
