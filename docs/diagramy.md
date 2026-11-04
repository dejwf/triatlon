# Diagramy systému

Návrhové diagramy podle `CLAUDE.md` a implementace (F0–F3). Jsou v [Mermaidu](https://mermaid.js.org/) — GitHub je vykreslí přímo, lokálně např. ve VS Code s rozšířením _Markdown Preview Mermaid Support_. Až dodáš vlastní flow diagramy, tyhle s nimi porovnáme a rozdíly dořešíme (viz [Otevřené otázky](#otevřené-otázky-k-ověření)).

Obsah:

1. [Architektura](#1-architektura)
2. [Datový model](#2-datový-model)
3. [Přihlášení magic linkem](#3-přihlášení-magic-linkem)
4. [Den závodu — celkový průběh](#4-den-závodu--celkový-průběh)
5. [Stav závodníka](#5-stav-závodníka)
6. [Checkpoint: tlačítko čísla](#6-checkpoint-tlačítko-čísla)
7. [Hromadný start kategorie](#7-hromadný-start-kategorie)
8. [Registrace na místě](#8-registrace-na-místě)
9. [Offline fronta a synchronizace](#9-offline-fronta-a-synchronizace)
10. [Stav akce ve frontě](#10-stav-akce-ve-frontě)
11. [Synchronizace hodin](#11-synchronizace-hodin)
12. [Dva organizátoři zapíšou stejného závodníka](#12-dva-organizátoři-zapíšou-stejného-závodníka)
13. [Výpočet výsledků](#13-výpočet-výsledků)
14. [Korekce admina a remíza](#14-korekce-admina-a-remíza)
15. [Checkpointy a sub-checkpointy](#15-checkpointy-a-sub-checkpointy)

---

## 1. Architektura

```mermaid
flowchart LR
  subgraph Klienti
    M["📱 Mobilní appka (Expo)<br/>organizátoři na checkpointech<br/>offline fronta v SQLite"]
    W["💻 Web (React)<br/>admin, organizátor"]
    P["🌍 Veřejná tabule<br/>(F4, bez přihlášení)"]
  end
  subgraph Server
    API["API (NestJS)<br/>REST + SSE"]
    DB[("PostgreSQL<br/>append-only log časů")]
    SMTP["SMTP<br/>(dev: Mailpit)"]
  end
  S["packages/shared<br/>zod schémata + výpočet výsledků"]

  M -- "HTTPS: dávky akcí (idempotentní UUID)<br/>GET /time (hodiny)" --> API
  W -- "HTTPS REST" --> API
  API -- "SSE: výsledky se změnily" --> W
  API -. "SSE (F4)" .-> P
  API --> DB
  API -- "přihlašovací e-mail" --> SMTP
  S -. "stejná logika" .- M
  S -. "stejná logika" .- W
  S -. "stejná logika" .- API
```

## 2. Datový model

```mermaid
erDiagram
  Race ||--o{ Category : "má"
  Race ||--o{ Discipline : "má"
  Race ||--o{ Checkpoint : "má (pořadí seq)"
  Race ||--o{ Participant : "má"
  Race ||--o{ Assignment : "přiřazení"
  Category ||--o{ Participant : "zařazuje"
  Category ||--o{ CategoryCheckpoint : "platí checkpointy"
  Checkpoint ||--o{ CategoryCheckpoint : "v kategorii"
  Discipline |o--o{ Checkpoint : "ukončuje / obsahuje"
  User ||--o{ Assignment : "přiřazen"
  Checkpoint ||--o{ Assignment : "obsluhuje"
  Participant ||--o{ TimeEvent : "log akcí"
  Checkpoint ||--o{ TimeEvent : "na checkpointu"
  User ||--o{ TimeEvent : "zapsal"
  TimeEvent |o--o{ TimeEvent : "refEventId (zrušení/korekce)"
  Category ||--o{ RankingOverride : "remízy"
  User ||--o{ Session : "session"
  User ||--o{ LoginToken : "přihlášení"
  User ||--o{ AuditLog : "změny"

  Race {
    uuid id
    string name
    int year
    date date
    enum status "planned | running | finished"
    json ageGroups "definuje admin, nepřekrývají se"
  }
  Category {
    uuid id
    string ageGroupLabel
    int birthYearFrom
    int birthYearTo
    enum gender
    enum locality "local | guest"
    json distances
  }
  Checkpoint {
    uuid id
    int seq
    enum kind "transition | intermediate"
    uuid disciplineId
  }
  Participant {
    uuid id
    int bib "unikátní v kategorii"
    int birthYear
    enum status "registered | checked_in | absent | disqualified"
    enum registrationSource "manual | import | online | on_site"
  }
  TimeEvent {
    uuid id "generuje klient"
    enum type "record | cancel | note | admin_correction"
    datetime ts "čas akce (opravené hodiny)"
    string reason
    string deviceId
    datetime serverReceivedAt
  }
```

## 3. Přihlášení magic linkem

```mermaid
sequenceDiagram
  autonumber
  actor O as Organizátor
  participant App as Appka / web
  participant API
  participant Mail as E-mail
  O->>App: zadá e-mail
  App->>API: POST /auth/request
  API-->>App: 202 (vždy — neprozradí, zda účet existuje)
  API->>Mail: odkaz (web) + 6místný kód (appka), platnost 15 min
  alt web
    O->>App: klikne na odkaz
    App->>API: POST /auth/verify {token}
  else mobil
    O->>App: opíše kód
    App->>API: POST /auth/verify {email, code, deviceId}
  end
  API-->>App: access token (15 min) + refresh token (30 dní)
  Note over App,API: access token se obnovuje přes /auth/refresh (rotace).<br/>Vypršelá session v appce nemaže offline frontu — po přihlášení se odešle.
```

## 4. Den závodu — celkový průběh

```mermaid
flowchart TD
  subgraph Priprava["Příprava (web, admin)"]
    A1["Založit závod + věkové skupiny"] --> A2["Kategorie se vygenerují<br/>(skupina × pohlaví × lokalita)"]
    A2 --> A3["Checkpointy, sub-checkpointy,<br/>mapování na kategorie"]
    A3 --> A4["Závodníci: ruční zadání, import CSV/XLSX"]
    A4 --> A5["Organizátoři + přiřazení ke checkpointům"]
  end
  A5 --> B0["Organizátoři: přihlášení v appce,<br/>stažení dat pro offline"]
  B0 --> B1

  subgraph StartCP["Checkpoint start"]
    B1["Check-in: přítomen / nepřítomen"] --> B2{"Přihlásil se<br/>někdo na místě?"}
    B2 -- ano --> B3["Registrace na místě"] --> B1
    B2 -- ne --> B4["Hromadný start kategorie X"]
    B4 --> B5{"Přišel někdo pozdě?"}
    B5 -- ano --> B6["Individuální start"]
  end

  B4 --> C1
  B6 --> C1
  subgraph Trat["Checkpointy na trati"]
    C1["Konec plavání"] --> C2["(sub-checkpointy kola)"] --> C3["Konec kola"] --> C4["Cíl"]
  end

  C4 --> D1["Web: živé výsledky, přehled kategorií"]
  D1 --> D2{"Sporné časy / remízy?"}
  D2 -- ano --> D3["Korekce admina s důvodem,<br/>ruční určení pořadí"] --> D1
  D2 -- ne --> D4["Závod → dokončen,<br/>finální výsledky"]
```

## 5. Stav závodníka

```mermaid
stateDiagram-v2
  [*] --> registered: ruční zadání / import / online
  [*] --> checked_in: registrace na místě
  registered --> checked_in: check-in na startu
  registered --> absent: nedostavil se
  checked_in --> absent: oprava check-inu
  absent --> checked_in: dorazil pozdě
  registered --> disqualified: admin
  checked_in --> disqualified: admin
  disqualified --> checked_in: admin (zrušení DSQ)
  note right of absent
    nezobrazuje se v gridu,
    server odmítne jeho čas,
    nepočítá se do výsledků
  end note
```

## 6. Checkpoint: tlačítko čísla

```mermaid
stateDiagram-v2
  state "Čeká" as Waiting
  state "Zaznamenáno ⏳ (čeká na odeslání)" as Pending
  state "Zaznamenáno ✓" as Recorded
  state "Odmítnuto ⚠" as Rejected
  [*] --> Waiting
  Waiting --> Pending: klepnutí na číslo
  Pending --> Recorded: server přijal
  Pending --> Rejected: server odmítl
  Rejected --> Pending: znovu klepnout
  Recorded --> Waiting: ▾ vrátit akci (jen vlastní, zapíše se cancel)
  Pending --> Waiting: ▾ vrátit akci
  Waiting --> Waiting: ▾ přidat poznámku
  Recorded --> Recorded: ▾ přidat poznámku
  Waiting --> Recorded: záznam z jiného zařízení (vrátit nejde)
  note right of Recorded
    tlačítko je neaktivní (šedé),
    dropdown ▾ zůstává aktivní
  end note
```

## 7. Hromadný start kategorie

```mermaid
sequenceDiagram
  autonumber
  actor S as Organizátor startu
  participant App as Appka
  participant Q as Offline fronta
  participant API
  S->>App: „Start 31–40 muži místní“
  App-->>S: „Opravdu odstartovat 11 závodníků?“ (2. klepnutí do 4 s)
  S->>App: potvrdí
  App->>Q: N × record(start, stejný ts) — jen přítomní bez startu
  App-->>S: kategorie odstartována ⏳
  Q->>API: POST /time-events (dávka)
  API-->>Q: accepted × N
  App-->>S: ✓
  opt závodník dorazil pozdě
    S->>App: „Start“ u jeho čísla
    App->>Q: record(start, vlastní ts)
  end
  opt chybný start
    S->>App: „Vrátit start“ (potvrzení)
    App->>Q: cancel × N (refEventId = jednotlivé starty)
  end
```

## 8. Registrace na místě

```mermaid
sequenceDiagram
  autonumber
  actor S as Organizátor startu
  participant App as Appka
  participant API
  S->>App: jméno, ročník, pohlaví, lokalita
  App->>App: kategorie podle ročníku (shared/resolveCategory)<br/>navrhne další volné číslo v kategorii
  App->>App: do fronty: register {id = UUID z appky, bib}
  App-->>S: závodník je hned v gridu jako „12*“ (nepotvrzeno)
  Note over App: offline: časy na nového závodníka se zapisují<br/>normálně — odkazují na id z appky
  App->>API: POST /participants/on-site
  alt číslo volné
    API-->>App: participant, bibChanged = false
  else číslo mezitím obsadil jiný telefon
    API-->>App: participant s dalším volným číslem, bibChanged = true
    App-->>S: ⚠ „Číslo 12 bylo obsazené — má číslo 13. Vyměňte startovní číslo!“
  end
  Note over API: opakované odeslání (stejné id) vrátí totéž — nic se nezdvojí
```

## 9. Offline fronta a synchronizace

```mermaid
sequenceDiagram
  autonumber
  actor O as Organizátor
  participant UI as Appka (UI)
  participant DB as SQLite v telefonu
  participant Sync as Synchronizace (každých 5 s)
  participant API
  O->>UI: klepne na číslo
  UI->>DB: uloží akci (synchronně) — state = pending
  UI-->>O: hned zobrazí ⏳
  loop dokud jsou čekající akce
    Sync->>DB: čekající akce v pořadí vzniku
    Sync->>API: dávka zápisů času (≤ 500) / check-in / registrace
    alt bez signálu / chyba serveru (5xx, 401, 429)
      API--xSync: chyba
      Sync->>DB: nic nemění — zkusí znovu
      UI-->>O: ○ offline · ⏳ N čeká
    else odpověď
      API-->>Sync: accepted / duplicate → sent, rejected → důvod
      Sync->>DB: aktualizuje stav po každém kroku
    end
  end
  Sync->>API: stáhne závod, závodníky a log (snapshot)
  Sync->>DB: snapshot pro offline, odeslané akce z fronty zmizí
  Note over Sync,API: Idempotence: id akce = UUID z telefonu.<br/>Když odpověď nedorazí, opakované odeslání vrátí „duplicate“.
```

## 10. Stav akce ve frontě

```mermaid
stateDiagram-v2
  state "pending — čeká" as pending
  state "sent — přijato" as sent
  state "sent s upozorněním" as warned
  state "rejected — odmítnuto" as rejected
  [*] --> pending: akce v appce
  pending --> pending: bez signálu / 5xx / 401 (zkusí znovu)
  pending --> sent: accepted / duplicate
  pending --> rejected: 4xx nebo rejected (nepřiřazený checkpoint, nepřítomný…)
  sent --> warned: registrace se změněným číslem
  sent --> [*]: potvrzeno ve staženém snapshotu
  warned --> [*]: Beru na vědomí
  rejected --> [*]: Beru na vědomí
```

## 11. Synchronizace hodin

```mermaid
sequenceDiagram
  participant App as Appka
  participant API
  loop 5 vzorků (při startu a každých 5 min)
    App->>App: t0 = lokální čas
    App->>API: GET /api/time
    API-->>App: serverTime
    App->>App: t1 = lokální čas
  end
  App->>App: vzorek s nejkratší odezvou (t1 − t0)<br/>offset = serverTime − (t0 + t1) / 2
  Note over App: každá akce: ts = Date.now() + offset (− reakční doba)<br/>server odmítne akci víc než 5 min v budoucnosti
```

## 12. Dva organizátoři zapíšou stejného závodníka

```mermaid
sequenceDiagram
  participant A as Telefon A
  participant B as Telefon B
  participant API
  participant W as Web (admin)
  A->>API: record #12 v 10:15:03 (offline → později)
  B->>API: record #12 v 10:15:05
  API-->>A: accepted
  API-->>B: accepted
  Note over API: oba záznamy platí → výsledky použijí dřívější<br/>a označí ⚠ konflikt
  API-->>W: SSE: výsledky se změnily
  W->>W: admin otevře závodníka: historie (kdo, kdy, zařízení)
  W->>API: cancel nesprávného záznamu (s důvodem)
  Note over A,B: organizátor smí vrátit jen svůj záznam,<br/>v gridu B vidí záznam A jako hotový (po obnovení dat)
```

## 13. Výpočet výsledků

```mermaid
flowchart TD
  L[("Log TimeEvent<br/>(append-only)")] --> P["Projekce: seřadit podle serverReceivedAt"]
  P --> P1["record → záznam času"]
  P --> P2["cancel → záznam zrušen"]
  P --> P3["admin_correction s ref → nový čas záznamu<br/>bez ref → doplněný čas"]
  P --> P4["note → poznámka"]
  P1 & P2 & P3 --> T["Platný čas na každém checkpointu<br/>(víc platných → dřívější + ⚠ konflikt)"]
  T --> X["Pro každého závodníka kategorie<br/>(bez nepřítomných)"]
  X --> X1["celkový čas = cíl − start"]
  X --> X2["čas disciplíny = mezi hraničními checkpointy<br/>(sub-checkpointy ho neovlivní)"]
  X --> X3["mezičasy od startu"]
  X1 & X2 & X3 --> R["Pořadí: v cíli → nejdál na trati → čas od startu<br/>(na celé sekundy)"]
  R --> RT{"Stejná sekunda?"}
  RT -- ano --> RO{"Rozhodl admin<br/>přesně tuto skupinu?"}
  RO -- ano --> OK["pořadí podle rozhodnutí ✓"]
  RO -- ne --> TIE["remíza = stejné pořadí"]
  RT -- ne --> OK
```

## 14. Korekce admina a remíza

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin
  participant W as Web
  participant API
  participant DB
  A->>W: Výsledky → klik na závodníka
  W->>API: GET historie akcí
  API-->>W: záznamy (kdo, kdy, zařízení, důvod)
  alt oprava času
    A->>W: „Opravit“ + nový čas + důvod
    W->>API: admin_correction {refEventId, ts, reason}
  else doplnění chybějícího
    A->>W: „Doplnit“ + čas + důvod
    W->>API: admin_correction {ts, reason} bez ref
  else zrušení
    A->>W: „Zrušit“ + důvod
    W->>API: cancel {refEventId, reason}
  end
  API->>DB: nová událost (původní záznam zůstává)
  API-->>W: SSE → přepočet výsledků
  opt remíza
    A->>W: „Určit pořadí“ — seřadí skupinu + důvod
    W->>API: POST ranking-overrides
    API->>DB: RankingOverride + AuditLog (starší rozhodnutí téže skupiny se nahradí)
  end
```

## 15. Checkpointy a sub-checkpointy

```mermaid
flowchart LR
  S(["Start<br/>transition"]) -- plavání --> KP(["Konec plavání<br/>transition, ukončuje plavání"])
  KP -- cyklistika --> O["Otočka na kopci<br/>intermediate (cyklistika)"]
  O --> PK["Pod kopcem<br/>intermediate (cyklistika)"]
  PK --> KK(["Konec kola<br/>transition, ukončuje cyklistiku"])
  KK -- běh --> C(["Cíl<br/>transition, ukončuje běh"])
```

- Čas cyklistiky = Konec kola − Konec plavání; sub-checkpointy dávají jen mezičasy.
- Sub-checkpoint musí ležet mezi hranicí před disciplínou a hranicí, která ji ukončuje (API to hlídá i při přeřazení).
- Kategorie si volí, které checkpointy pro ni platí (např. děti bez otočky).

---

## Otevřené otázky k ověření

Tyto situace diagramy řeší výchozím chováním. Ověř je proti svým flow diagramům, až budou:

1. **Zápis mimo pořadí checkpointů** (např. cíl dřív než konec kola): appka ho povolí a výsledky použijí poslední dosažený checkpoint. Má appka varovat?
2. **Konflikt dvou záznamů**: platí dřívější a admin ho ověří. Nebo má mít přednost záznam od organizátora přiřazeného jako „hlavní“?
3. **Nepřítomný, který přece jen odstartuje**: organizátor startu ho přepne na přítomného a zapíše mu individuální start. Stačí to?
4. **Vrácení hromadného startu**: zruší všechny starty kategorie zapsané tímto organizátorem, včetně pozdních startů. Mají se pozdní starty zachovat?
5. **Reakční doba**: globální odečet 0–1 s na zařízení. Nebo radši korekce u konkrétního záznamu („−2 s“ v menu)?
6. **Odhlášení s neodeslanými akcemi**: appka varuje, akce zůstanou ve frontě a odešlou se po přihlášení téhož uživatele.
