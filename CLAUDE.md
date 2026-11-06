# CLAUDE.md — Systém pro zaznamenávání sportovních závodů (Vlkančický triatlon)

Tento soubor popisuje požadavky a kontext pro implementaci systému pomocí Claude AI (Claude Code). Slouží jako zdroj pravdy pro architekturu, datový model a chování aplikace.

## 1. Účel

Systém pro organizátory amatérských vícedisciplinárních závodů (triatlon apod.), který umožňuje:
- vytvářet závody a kategorie,
- spravovat závodníky a jejich startovní čísla,
- v den závodu zaznamenávat mezičasy na checkpointech přes appku (mobilní klient pro organizátory),
- průběžně i finálně počítat a zobrazovat výsledky,
- spravovat uživatele a role.

Referenční událost: **Vlkančický triatlon** (koná se 1× ročně, více kategorií dle věku, pohlaví a lokality účastníka).

## 2. Architektura / topologie

- **N mobilních klientů** (Android + iOS) — pro organizátory zaznamenávající mezičasy na checkpointech.
- **N webových klientů** — pro administraci: správu závodů, kategorií, závodníků, uživatelů a zobrazení výsledků.
- **Centrální server s daty v cloudu** — jediný zdroj pravdy, synchronizace mezi mobilními a webovými klienty v (téměř) reálném čase.

Zvolený tech stack (rozhodnuto 2026-11-04): **TypeScript všude**, monorepo (pnpm workspaces):
- `apps/api` — backend NestJS (případně Fastify), REST API nad **PostgreSQL** (relační DB se silnou konzistencí — výsledky a startovní čísla nesmí kolidovat).
- `apps/web` — webová SPA v **Reactu** (administrace, výsledky, veřejná výsledková tabule, online registrace), komunikuje s týmž API jako mobil.
- `apps/mobile` — mobilní klient **React Native (Expo)** pro Android i iOS.
- `packages/shared` — sdílené typy, validační schémata (zod) a výpočet výsledků (stejná logika na serveru i klientech).
- Offline odolnost: checkpointy se mohou odehrávat v místech se slabým signálem → mobilní klient musí umět zaznamenat čas lokálně a dosynchronizovat se serverem, jakmile je spojení dostupné (fronta nezaslaných akcí, idempotentní zápisy).
- Realtime: WebSocket/SSE pro živé promítání průběžných výsledků a stavů na webu (admin dashboard i veřejná tabule).

Hosting: zatím nerozhodnuto → stavět přenositelně: Docker image pro každou službu, docker-compose pro lokální vývoj, připravenost na pozdější nasazení do Kubernetes (Helm) nebo managed cloudu. Data v EU regionu (GDPR).

## 3. Role a oprávnění

| Role | Oprávnění |
|---|---|
| **Super admin** | Vše co admin + správa systému napříč všemi závody/organizacemi. |
| **Admin** | Správa rolí a uživatelů; vytváření a správa závodů; správa kategorií; správa závodníků a jejich startovních čísel; přiřazování uživatelů (organizátorů) k závodům; korekce nerozhodných/sporných výsledků (manuální zásah do zaznamenaných časů s auditním záznamem). |
| **Ředitel závodu** | Oprávnění organizátora v rámci konkrétního závodu (uděluje admin v záložce Organizátoři): **uzavírá kategorie** (výsledky se stanou oficiálními) a s důvodem je znovu otevírá — z webu i z appky. Vidí závod i bez přiřazeného checkpointu. Admin smí totéž vždy. |
| **Organizátor** | Zadává mezičasy závodníků na checkpointu; může přepínat mezi závody/kategoriemi, ke kterým má přiřazení; vidí průběžné i celkové výsledky; zadává poznámky k mezičasům; může na místě (při check-inu) zaregistrovat nového závodníka. Nemá právo měnit již zaznamenaná data jiných organizátorů ani měnit pořadí. |
| **Veřejnost (anonym)** | Bez přihlášení; pouze čtení veřejné výsledkové tabule (živé i finální výsledky) a odeslání online registrace. |

Diváci (i tiskový mluvčí apod.) = role **Veřejnost** — samostatná "náhledová" role se nezavádí. Samostatná role "časoměřič na startu" se také nezavádí — jde o organizátora přiřazeného ke checkpointu `start` (viz sekce 4 – Uživatel a sekce 5).

## 4. Datový model (klíčové entity)

### Závod (Race / Event)
- Koná se právě 1× ročně (instance závodu pro daný rok).
- Obsahuje N kategorií.
- Stav: plánovaný / probíhá / dokončen.
- Vlastní seznam checkpointů a jejich pořadí (společný napříč kategoriemi, i když trasy mají různou délku).

### Kategorie (Category)
- Patří k závodu.
- Definována kombinací:
  - věkové skupiny — **definuje je admin** pro každý závod; hranice jsou včetně a běžné skupiny se (pro každé pohlaví) nesmí překrývat; věk se počítá podle **ročníku narození**: `věk = rok závodu − rok narození` (datum narození v roce nerozhoduje). Kategorie si proto drží rozsah ročníků odvozený z věkové skupiny a roku závodu. Skupina může být **jen pro jedno pohlaví** (např. „Muži do 40“) a **volitelná** (např. „Super ženy“ — stejný věk jako „Ženy“, ale dlouhá trať; závodník se do ní zařadí jen volbou při registraci / importu / registraci na místě, jinak podle věku). Skupina nese i výchozí délky tratí pro své kategorie.
  - **Výchozí skupiny = kategorie Vlkančického triatlonu** (vlkancice.cz/triatlon, `DEFAULT_AGE_GROUPS` v `packages/shared/src/age.ts`), při zakládání závodu předvyplněné a upravitelné:

    | Skupina | Věk | Pohlaví | Plavání / kolo / běh (m) |
    |---|---|---|---|
    | 0–5, 6–8, 9–10, 11–12, 13–14, 15–16 | děti | dívky a hoši zvlášť | 10/200/50 … 100/2500/1200 |
    | Ženy | 17+ | ženy | 200 / 6000 / 2000 |
    | Super ženy (volitelná) | 17+ | ženy | 400 / 12 000 / 4000 |
    | Muži do 40 | 17–40 | muži | 400 / 12 000 / 4000 |
    | Muži nad 40 | 41+ | muži | 200 / 6000 / 2000 |

  - pohlaví (muži / ženy),
  - lokality (local / guest).
- Stav: **otevřená / uzavřená**. Uzavírá ředitel závodu (nebo admin), až kategorie doběhne: výsledky jsou **oficiální**, kdo má start, ale ne cíl, je **DNF** (nedokončil), organizátoři už do kategorie nezapisují (časy, check-in, registrace na místě), admin může dál korigovat s důvodem. Uzavřít lze jen odstartovanou kategorii; znovuotevření vyžaduje důvod; obojí je v auditu. Uzavřením poslední kategorie přejde závod do stavu _dokončen_, znovuotevřením zpět do _probíhá_.
- Každá kategorie má vlastní definici tras (délka plavání, kola, běhu) — tedy i vlastní definici/mapování checkpointů s očekávanou vzdáleností, pokud bude potřeba počítat tempo.

### Závodník (Participant)
- Patří do právě jedné kategorie v rámci závodu.
- Startovní číslo: **unikátní v rámci kategorie, NENÍ unikátní v rámci závodu** (dva závodníci v různých kategoriích mohou mít stejné číslo) → interní identifikace vždy přes `(závod_id, kategorie_id, startovní_číslo)`, nikoliv jen přes číslo.
- Stav: registrován / přítomen (checked-in) / nepřítomen (absent) / diskvalifikován (volitelně do budoucna).
- Absent závodník se vynechává ze zadávání časů a z výsledků.
- Rok narození (případně celé datum) — pro zařazení do kategorie.
- Volitelná **přezdívka** (při anonymizaci se maže) a **oslovení** ve výsledcích (`packages/shared/src/names.ts`):
  - formální (výchozí): `Jan "Honza" Novák`, bez přezdívky `Jan Novák`,
  - neformální: přezdívka, jinak jméno (`Honza` / `Jan`); při shodě ve společné tabulce (věková skupina + pohlaví, domácí i hosté) se přidají 2 písmena příjmení (`Honza No`, „Ch“ = jedno písmeno), při další shodě dvojčíslí ročníku (`Honza No 99`). Rozlišují se jen ti, kdo se shodují.
  - Nastavuje se při ručním zadání, importu (sloupce `přezdívka`, `oslovení` = formální/neformální) i registraci na místě. Zobrazovaný název platí ve všech výsledcích (veřejná tabule, administrace, appka); seznamy a check-in ukazují celé údaje.
- Zdroj registrace: `manual` (ruční zadání adminem) / `import` (CSV/Excel) / `online` (veřejný formulář) / `on_site` (registrace na místě z mobilu).

### Checkpoint
- Patří k závodu (typicky sdílený napříč kategoriemi), reprezentuje "změnu módu pohybu" (konec plavání, konec kola, cíl) nebo start.
- Má pořadí/sekvenci v rámci trasy.
- U kategorie může/nemusí být relevantní (např. u dětí kratší trasa, ale stejné typy checkpointů — pokud by se lišily i typy checkpointů, je potřeba mapování kategorie → sada checkpointů).
- Výchozí sada pro Vlkančický triatlon: **start → plavání → cyklistika → běh → cíl**, tj. měřené body `start`, `konec plavání`, `konec kola`, `cíl` (konec běhu). Přechody (depo) se zvlášť neměří.
- **Dva typy checkpointů:**
  - `transition` = **hranice disciplíny** — start, nebo checkpoint, který disciplínu **ukončuje** (konec plavání, konec kola, cíl).
  - `intermediate` = **sub-checkpoint** — mezičas **uvnitř** disciplíny, **nic neukončuje**. Příklad: během cyklistiky závodníci stoupají na kopec; na otočce je sub-checkpoint a další pod kopcem — ani jeden není konec cyklistiky. Zajímavé pro diváky i závodníky (hlavně dospělé kategorie).
- Pravidla:
  - sub-checkpoint musí patřit do disciplíny a ležet **uvnitř** ní — mezi předchozí hranicí a hranicí, která jeho disciplínu ukončuje (vynucuje API i při změně pořadí a mazání),
  - pořadí je obecná sekvence, ne pevný výčet 4 bodů,
  - čas disciplíny se počítá mezi hraničními (`transition`) checkpointy — sub-checkpointy ho neovlivní,
  - průběžné pořadí funguje s libovolným počtem checkpointů,
  - mapování kategorie → sada checkpointů umožní sub-checkpointy jen u vybraných kategorií.

### Záznam mezičasu (TimeRecord / Split)
- Vazba: `závodník + checkpoint + čas (timestamp) + zaznamenal (uživatel) + poznámka (volitelně)`.
- Musí nést auditní informace: kdo, kdy, z jakého zařízení.
- Akce zaznamenání je **vratná** (viz UX níže — "vrátit akci") → potřeba buď soft-delete, nebo stavový záznam historie (append-only log je bezpečnější pro audit než přepisování).
- Korekce admina u sporných/nerozhodných výsledků se zaznamenává jako samostatná revize s odkazem na původní záznam (nikdy tichý přepis).

### Uživatel (User)
- Role (viz výše), přiřazení k jednomu nebo více závodům (pro organizátory).
- Organizátor je v rámci závodu přiřazen ke **konkrétnímu checkpointu (případně více)**. Přiřazení určuje, co v mobilní appce vidí a smí zapisovat:
  - checkpoint `start` → check-in (absence), registrace na místě, hromadný start kategorie (viz sekce 5),
  - ostatní checkpointy → grid čísel pro zaznamenání mezičasů,
  - na nepřiřazeném checkpointu zapisovat nesmí (prevence omylu); výsledky vidí vždy.

## 5. Mobilní klient — UX flow (zaznamenávání na checkpointu)

1. Organizátor se v mobilní appce přihlásí a zvolí aktivní závod (pokud je přiřazen k více) a checkpoint, na kterém stojí (nabídnou se jen checkpointy, ke kterým je přiřazen).
2. Zobrazí se seznam/grid tlačítek se startovními čísly závodníků (relevantních pro daný checkpoint a kategorie, které tam dorazí) — číslo musí být zobrazeno spolu s kategorií, protože čísla se mezi kategoriemi opakují.
3. **Tlačítko číslo závodníka**:
   - vedle/na tlačítku dropdown šipka s položkou **"přidat poznámku"** (lze přidat ještě před zaznamenáním času, nebo rovnou po).
   - kliknutím na číslo → zaznamená se timestamp (čas kliknutí, případně s možností korekce o pár vteřin dozadu kvůli reakční době obsluhy).
4. Po zaznamenání: tlačítko čísla se stane **neaktivní** (disabled, vizuálně odlišené — zaznamenáno), ale dropdown zůstává aktivní s položkami:
   - "přidat poznámku",
   - "vrátit akci" (zruší zaznamenaný čas → tlačítko se opět stane aktivním; akce se loguje jako zrušená, ne mazaná).
5. Check-in před startem (jen pro organizátora přiřazeného ke checkpointu `start`): zvláštní obrazovka/mód, kde se označují **absent** závodníci (ti, kteří se nedostavili) — tito se pak v průběhu závodu na checkpointech nezobrazují jako "k zaznamenání" nebo jsou vizuálně odlišeni. V check-in módu lze také **přidat závodníka na místě** (registrace v den závodu; i offline přes frontu — startovní číslo musí server potvrdit jako unikátní v kategorii).
6. **Hromadný start kategorie** (checkpoint `start`): ve Vlkančicích startuje každá kategorie hromadně a zvlášť (start ve vlnách ani společný start více kategorií se nepoužívá), proto se čas startu nezaznamenává po jednotlivých číslech, ale jedním tlačítkem **"Start kategorie X"** → čas startu se zapíše všem přítomným (ne-absent) závodníkům kategorie. Akce je vratná ("vrátit akci", logováno jako zrušené) a jde přes offline frontu jako ostatní zápisy. Pozdní start jednotlivce lze řešit individuálním zaznamenáním startu.
7. Nutná **offline fronta**: pokud není signál, akce (zaznamenání času, poznámka, zrušení) se uloží lokálně a odešlou se při obnovení spojení; UI musí indikovat stav synchronizace (odesláno / čeká na sync / konflikt).

> Poznámka: uživatel dodá flow diagramy — po jejich dodání upřesnit edge-case chování (např. konflikt při zaznamenání stejného závodníka dvěma organizátory současně, zaznamenání mimo pořadí checkpointů apod.).

## 6. Webový klient — admin/organizátor pohledy

**Admin vidí:**
- stav závodníka: celkový čas, čas v jednotlivé disciplíně (průběžný i čas posledního dokončeného úseku), odhadované pořadí (průběžné, dopočítané i pro nedokončené závodníky),
- stav (dobu trvání) závodu / kategorie — kolik času uplynulo od startu dané kategorie,
- dokončené kategorie s finálními výsledky,
- možnost korigovat sporné/nerozhodné výsledky s auditní stopou.

**Organizátor vidí (přes web i mobil):**
- průběžné i celkové výsledky závodníků,
- přepínání mezi závody/kategoriemi, ke kterým má přístup.

**Veřejná výsledková tabule** (bez přihlášení):
- živé průběžné i finální výsledky po kategoriích, aktualizované v reálném čase,
- zobrazuje jen nezbytné minimum osobních údajů (jméno, kategorie, startovní číslo, časy) — GDPR.

**Registrace a import závodníků:**
- ruční zadání adminem ve webovém rozhraní,
- import z CSV/Excelu (XLSX) s náhledem, validací a hlášením chyb před uložením,
- veřejný online registrační formulář,
- registrace na místě z mobilu (viz sekce 5).

## 7. Výpočty výsledků

- Celkový čas = čas na posledním checkpointu (cíl) minus čas startu.
- Čas v disciplíně = rozdíl mezi dvěma po sobě jdoucími checkpointy relevantními pro danou disciplínu.
- Průběžné pořadí: řazení podle posledního dosaženého checkpointu a jeho času; u závodníků se stejným posledním checkpointem řazení podle času.
- Řazení/výsledky vždy v rámci kategorie (napříč kategoriemi srovnání časů nedává smysl kvůli různé délce trasy).
- Nerozhodný výsledek: admin má nástroj pro ruční určení pořadí se zápisem důvodu (auditováno).
- **DNF**: v uzavřené kategorii je závodník se startem a bez cíle „nedokončil“ a nemá pořadí (dokud je kategorie otevřená, je „na trati“ s průběžným pořadím).
- **Přesnost pořadí: celé sekundy** — časy ve stejné sekundě jsou remíza (stejné pořadí), dokud ji admin ručně nerozhodne; rozhodnutí platí jen pro přesně tutéž skupinu závodníků.
- **Konflikt záznamů**: víc platných záznamů téhož závodníka na stejném checkpointu (např. dva organizátoři) → platí dřívější a výsledky ho označí k ověření adminem.
- Výpočet je čistá funkce nad append-only logem (`packages/shared/src/results.ts`): `record` / `cancel` (vrácení) / `admin_correction` (oprava s `refEventId`, nebo doplnění chybějícího času bez něj — vždy s důvodem) / `note`.

## 7a. Appka — implementační rozhodnutí (F3)

Mobilnímu klientovi se v projektu říká **appka** (skloňováno podle vzoru žena).


- `apps/mobile` (Expo SDK 58, Expo Router). Data závodu (závod, závodníci, log akcí) se ukládají do telefonu (SQLite) → appka funguje bez signálu i po restartu.
- **Offline fronta** (`src/lib/outbox.ts`): akce se uloží synchronně před potvrzením v UI, odesílají se přísně v pořadí vzniku (registrace na místě před časy toho závodníka), zápisy časů dávkou. Síťová chyba / 5xx / 401 → zkusí znovu; 4xx nebo `rejected` → označí se a obsluha je vidí v „Synchronizace“.
- **Zobrazení na checkpointu** (`src/lib/view.ts`) = snapshot ze serveru + neodeslané akce, přes stejnou projekci jako server (`projectEvents`).
- **Grid na checkpointu za startem ukazuje jen odstartované závodníky** (platný start ze serveru nebo z fronty tohoto telefonu) — jinak by šlo zapsat mezičas před startem a vznikly by záporné časy. Kdo už na checkpointu čas má, zůstává vidět (aby šel zápis vrátit). Závodníci uzavřených kategorií se nezobrazují.
- **Hodiny**: offset vůči `GET /api/time` (vzorek s nejkratší odezvou), každých 5 min; čas akce = hodiny telefonu + offset − volitelný odečet reakční doby (0–1 s, nastavení zařízení).
- **Check-in** `POST /races/:id/participants/:pid/status` a **registrace na místě** `POST /races/:id/participants/on-site` smí admin nebo organizátor přiřazený ke startu (start = první `transition` checkpoint bez disciplíny). Registrace je idempotentní podle UUID z appky; obsazené navržené číslo server nahradí dalším volným a appka obsluhu upozorní, ať vymění startovní číslo.
- `GET /races/:id/time-events` vrací log akcí (všech zařízení) pro offline snapshot; detail závodu nese `myCheckpointIds`.
- Hromadný start zapíše stejný čas všem přítomným bez startu; „vrátit start“ zruší starty kategorie zapsané tímto organizátorem.
- Přihlášení v appce kódem z e-mailu (odkaz v e-mailu vede na web). Vypršelá session frontu nemaže — odešle se po přihlášení téhož uživatele.

## 7b. Veřejná tabule, GDPR, nasazení — implementační rozhodnutí (F4)

- **Veřejná tabule** `/vysledky` (web, bez přihlášení) z `GET /api/public/races…` + živý kanál `…/stream` (EventSource). Viditelné jsou jen závody ve stavu _probíhá_ / _dokončen_. Ve výchozím pohledu jsou **domácí a hosté téže věkové skupiny a pohlaví v jedné tabulce** se společným pořadím (v závorce pořadí v kategorii) a sloupcem **D/H** hned za startovním číslem (čísla se mezi kategoriemi opakují); přepínačem „Domácí a hosté zvlášť“ se zobrazí jednotlivé kategorie s pořadím v kategorii. Zobrazuje pořadí, číslo, zobrazovaný název (oslovení, viz sekce 4 – Závodník), mezičasy od startu a celkový čas — **bez ročníku** (výjimka: dvojčíslí u neformálního oslovení při shodě jmen), interních ID, poznámek a autorů záznamů. Výsledky se počítají jednou pro všechny diváky (cache zneplatněná při změně).
- **GDPR**: závodník může odmítnout zveřejnění jména (`publicName` → na tabuli jen číslo); admin umí **export údajů** (JSON) a **anonymizaci** (jméno nahrazeno, kopie údajů z auditu odstraněny, časy a pořadí zůstávají, aby se neměnily výsledky ostatních). Informace pro závodníky na `/ochrana-osobnich-udaju` (pořadatel se doplní při buildu). Online formulář a souhlasy řeší až online registrace (mimo MVP).
- **Nasazení** (`deploy/`, `Dockerfile`): Docker Compose na jednom serveru — Postgres, API (migrace při startu), Caddy (web + proxy + automatické HTTPS), pravidelné zálohy `pg_dump`. Postup v [`deploy/README.md`](deploy/README.md).

## 8. Nefunkční požadavky

- **Konzistence dat**: zápisy časů musí být idempotentní (opakované odeslání stejné akce z mobilu po výpadku sítě nesmí vytvořit duplicitní záznam) — doporučeno generovat klientský UUID pro každou akci.
- **Auditovatelnost**: každá změna/korekce dat (zejména admin zásahy do výsledků) musí být dohledatelná — kdo, kdy, co, proč.
- **Offline-first mobilní klient** (viz výše).
- **Škálovatelnost**: desítky až stovky závodníků na kategorii, jednotky až desítky organizátorů současně zapisujících.
- **Bezpečnost**: autentizace uživatelů (admin/organizátor), autorizace podle přiřazení k závodu, ochrana osobních údajů závodníků (GDPR — provozováno v EU/ČR).
- **Jazyk UI**: čeština (primárně), případně příprava na vícejazyčnost.

## 9. Rozhodnutá zadání (2026-11-04)

| Bod | Rozhodnutí |
|---|---|
| Checkpointy | start → plavání → cyklistika → běh → cíl (viz sekce 4 – Checkpoint). |
| Věk | Podle ročníku narození (rok závodu − rok narození). |
| Tech stack | TypeScript monorepo: NestJS + PostgreSQL, React web, React Native (Expo) mobil (viz sekce 2). |
| Veřejné výsledky | Ano — veřejná výsledková tabule bez přihlášení (viz sekce 6). |
| Registrace | Ruční zadání, CSV/Excel import, online formulář, registrace na místě (viz sekce 6). |

## 10. Otevřené body (k doplnění)

1. **Flow diagramy** od uživatele pro mobilní UX (přislíbeno dodat). Zatím návrhové diagramy v [`docs/diagramy.md`](docs/diagramy.md) včetně seznamu otevřených otázek k ověření.
2. **Hosting/cloud provider** — připraveno nasazení přes Docker Compose na libovolný server v EU (`deploy/`); konkrétního poskytovatele, doménu a SMTP poskytovatele je třeba vybrat.
4. **Text o zpracování osobních údajů** (`/ochrana-osobnich-udaju`) — nechat ověřit, doplnit pořadatele (IČO, adresa) a dobu uchování.
3. ~~Sub-checkpointy v mobilní appce a ve výsledcích~~ — hotovo: ve výsledcích jako mezičasy (F2), v appce se zapisují gridem jako ostatní checkpointy (F3).
