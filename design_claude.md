# design_claude.md — UI/UX zásady a návrh obrazovek (Vlkančický triatlon)

Doplněk k [`CLAUDE.md`](CLAUDE.md): popisuje **vzhled a chování UI** všech tří částí systému.
Slouží jako zdroj pravdy pro implementaci obrazovek v `apps/web` a `apps/mobile`.

Interaktivní návrh (plátno se 6 obrazovkami): https://claude.ai/artifact/S8qBcijhaBv6Qkw8EiCocy
Zdrojové soubory návrhu: [`design/navrh/`](design/navrh/) (formát `.dc.html`, slouží jako předloha,
ne jako kód k přímému použití).

## 1. Principy

- **Žádné nové UI/grafové knihovny.** Web je React + vlastní CSS (`apps/web/src/index.css`), appka
  React Native core komponenty. Všechny vizualizace se skládají z `div`/`View` (pruhy, mřížky,
  tečky). Volitelně `react-native-svg` v appce (přerušovaný zbytek pruhu, gradienty), ne nutné.
- **Data pouze ze sdílených DTO** (`packages/shared`): veřejná tabule z `PublicRaceResultsDto`
  (`splitsMs`, `disciplinesMs`, `rank`, `categoryRank`, `counts`). Žádné výpočty pořadí v UI.
- **GDPR:** na veřejných výstupech jen jméno se souhlasem (`name: null` → „Jméno nezveřejněno“),
  startovní číslo, D/H, kategorie, časy. Žádné ročníky ani poznámky.
- **Čitelnost venku:** vysoký kontrast (text ≥ 4,5 : 1), dotykové cíle ≥ 44 px, tabulární číslice
  (`font-variant-numeric: tabular-nums`) u všech časů.
- **Barvy se nerozlišují jen odstínem:** liší se i světlostí; preferujeme modrou/oranžovou před
  červenou/zelenou. Stav vždy doplňuje text (např. „na trati“, „DNF“).
- **Živost je vidět:** odznak „ŽIVĚ“ + „aktualizováno před N s“ (SSE). Průběžné výsledky jsou
  výslovně označené, dokud ředitel kategorii neuzavře.

## 2. Barvy a typografie

Vychází z existujících tokenů (`index.css`, `apps/mobile/src/ui.tsx`):

| Token | Hodnota | Použití |
|---|---|---|
| accent / primary | `#0b6bcb` | aktivní prvky, vybraná kategorie |
| text | `#1b1d21` (web), `#16202a` (mobil) | text |
| muted | `#5f6672` | popisky |
| ok | `#1b7a3a` | v cíli, uzavřeno |
| danger | `#c22a2a` | DNF, chyby, anomálie |
| warn | `#9a6700` / pozadí `#fff4d6` | offline, průběžné, k uzavření |

**Disciplíny** (stejné všude — web, kiosk, appka):

| Disciplína | Světlé pozadí | Tmavé pozadí (kiosk) |
|---|---|---|
| Plavání | `#0b6bcb` | `#4c9be8` |
| Kolo | `#ef6c00` | `#ff9a3d` |
| Běh | `#6a1b9a` | `#b67ae0` |

**Kategorie v appce:** `CATEGORY_COLORS` z `ui.tsx` (rozlišení stejných čísel v různých kategoriích).

**D/H odznak:** Domácí `#eef5fd`/`#08478a`, Host `#fff4d6`/`#7a5200`.

Písmo: `system-ui` (v návrhu Inter jako náhled); časy vždy tabulární číslice.

## 3. Klíčové vizualizace

### 3.1 Pruh rozložení času (discipline bar)
Vodorovný pruh složený z úseků plavání → kolo → běh. **Všechny řádky ve stejném měřítku**
(měřítko = nejpomalejší dokončený čas kategorie + rezerva), takže je vidět, kde kdo ztrácí.
- Na trati: hotové úseky plné, zbytek **přerušovaný obrys** (odhad).
- DNF: jen hotové úseky, bez zbytku.
- Zdroj: `disciplinesMs`.

### 3.2 Vývoj pořadí
Sloupec `3 → 1 → 1` = pořadí po T1, T2 a v cíli (pořadí podle kumulovaného `splitsMs` mezi těmi,
kdo checkpoint projeli). Na trati končí `→ …`.

### 3.3 Detail závodníka (rozbalený řádek)
- Úseky proti **mediánu dokončených** v kategorii (plný vs. světlý pruh, rozdíl zeleně/červeně).
- Časová osa checkpointů (Start → T1 → T2 → Cíl) s časem od startu a průběžným pořadím.

### 3.4 Heatmapa „Kde jsou závodníci“ (kiosk)
Mřížka kategorie × úsek; číslo = počet závodníků na úseku, sytost barvy roste s počtem.
Poslední sloupec = v cíli.

### 3.5 Stav kategorie (back-office)
Skládaný pruh: v cíli / na trati / DNF / čeká na start + odznak stavu
(`Nestartovala`, `Probíhá`, `Doběhnuto`, `Uzavřená`). U „Doběhnuto“ tlačítko **Uzavřít**.

## 4. Obrazovky

### 4.1 Veřejná tabule — web (`/vysledky/:raceId`)
- Hlavička: název, datum, odznak ŽIVĚ, čas aktualizace.
- Přepínač kategorií (čipy s počtem závodníků), pohled **Společně (D + H) / Domácí / Hosté**.
- Souhrn: odstartovalo / v cíli / na trati / DNF; poznámka „průběžné výsledky“ do uzavření.
- Tabulka: Poř., Č., D/H, Závodník (+ pořadí v kategorii nebo stav na trati), pruh rozložení,
  Plav., Kolo, Běh, Celkem, Ztráta, Vývoj poř. Klik na řádek rozbalí detail (3.3).
- Responzivní: na telefonu tabulka v boxu s vodorovným posunem, nebo kartový layout jako 4.6.
- **Bez QR kódu** — na mobilu nedává smysl.

### 4.2 Veřejná tabule — kiosk / TV (1920×1080)
- Tmavý režim, velké písmo, bez interakce. Kategorie se **automaticky střídají** (indikátor
  „Kategorie 1 / 11 · další … za N s“ + průběhový pruh).
- Vlevo top 9–10 kategorie (medailové barvy pro 1.–3.), pruh rozložení, čas, ztráta.
- Vpravo: „Právě v cíli“ (poslední 3 doběhy napříč kategoriemi), heatmapa (3.4).
- **QR kód + URL veřejné tabule** (bílý blok vpravo dole, „Výsledky v mobilu“). QR se generuje
  z nastavené veřejné adresy webu (např. knihovna `qrcode`), URL je vypsaná i textem.
- Spodní lišta: na trati / v cíli / uzavřené kategorie + adresa výsledků.
- Doporučená route: `/vysledky/:raceId/kiosk` (fullscreen, bez navigace).

### 4.3 Back-office — přehled závodu (záložka Přehled)
- KPI: registrováno, přítomno, na trati, v cíli, DNF, uzavřené kategorie.
- **Stav kategorií** (3.5).
- **Telefony na checkpointech:** checkpoint, organizátor + zařízení, poslední synchronizace,
  odchylka hodin, délka offline fronty; offline zařízení zvýrazněné.
- **Průchody checkpointem** (histogram po 5 min, výběr checkpointu).
- **Ke kontrole:** remízy, anomálie (T2 dřív než T1), chybějící průjezdy — s akcí Rozhodnout/Opravit.
- **Audit:** poslední zásahy (korekce, zrušení, uzavření, registrace, hromadný start).

### 4.4 Appka — checkpoint (režim Záznam)
- Horní lišta: checkpoint, závod, **stav synchronizace** (Online · 0 / Offline · N).
- Režimy: Záznam / Start / Check-in / Registrace.
- Hledání čísla, „Jen čekající“, čipy kategorií v jejich barvách.
- „Zaznamenáno X z Y“ + pruh rozdělený podle barev kategorií.
- Mřížka čísel: barevný proužek kategorie; zaznamenané šedé, přeškrtnuté, s časem.
- Po klepnutí **snackbar** „Č. 12 (M do 40) · 11:01:52 · Vrátit“.

### 4.5 Appka — bez signálu / synchronizace
- Varovná karta „Bez signálu N min“ + časová osa akcí ve frontě od výpadku.
- Hodiny telefonu: odchylka proti serveru na stupnici −2 s … +2 s, čas ověření.
- Seznam akcí čekajících na odeslání (záznam, poznámka, vrácení), tlačítko „Zkusit odeslat teď“.

### 4.6 Appka — průběžné výsledky
- Výběr kategorie, souhrn v cíli / na trati / DNF.
- Karty: pořadí, číslo, jméno, D/H, mini pruh rozložení, pořadí v kategorii nebo stav na trati,
  čas a ztráta.
- Tlačítko **Uzavřít kategorii** jen pro ředitele závodu; neaktivní, dokud jsou lidé na trati.

## 5. Otevřené body

- Skutečná veřejná doména (QR v návrhu vede na zástupné `vysledky.example.cz`).
- Interval střídání kategorií na kiosku (návrh: 20–30 s podle počtu řádků).
- Zda kiosk zobrazuje i dětské kategorie s krátkou tratí, nebo jen vybrané.
