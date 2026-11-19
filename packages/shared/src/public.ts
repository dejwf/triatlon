/**
 * Veřejná výsledková tabule (bez přihlášení) — jen nezbytné minimum osobních údajů
 * (CLAUDE.md, sekce 6): jméno (pokud ho závodník nezakázal), kategorie, startovní číslo, časy.
 * Žádné ročníky, interní ID záznamů, poznámky ani kdo co zapsal.
 */
import type { CheckpointKind, Distances, Locality, RaceStatus } from './domain.js';
import type { ResultState } from './results.js';

export interface PublicRaceSummaryDto {
  id: string;
  name: string;
  year: number;
  date: string;
  status: RaceStatus;
}

export interface PublicResultRowDto {
  bib: number;
  /** Domácí / host — ve společné tabulce rozlišuje stejná startovní čísla. */
  locality: Locality;
  /** Zobrazovaný název (`displayNames`), nebo null, když závodník zveřejnění jména odmítl. */
  name: string | null;
  state: ResultState;
  rank: number | null;
  tied: boolean;
  /** Pořadí ve vlastní kategorii (domácí / hosté zvlášť) — oficiální pro vyhlášení. */
  categoryRank: number | null;
  categoryTied: boolean;
  totalMs: number | null;
  /** Start závodníka (ISO) — absolutní časy průjezdů a doběhu („právě v cíli“). */
  startedAt: string | null;
  /** Čas od startu na každém checkpointu kategorie (null = ještě neprojel). */
  splitsMs: (number | null)[];
  disciplinesMs: (number | null)[];
}

export interface PublicCategoryDto {
  id: string;
  name: string;
  /** Kategorie, ze kterých tabulka vzniká (u skupiny domácí + hosté obě). */
  categoryIds: string[];
  /** Domácí / hosté u jednotlivé kategorie; null u společné tabulky (skupiny). */
  locality: Locality | null;
  /** Délky tratí v metrech (plavání / kolo / běh), pokud jsou zadané. */
  distances: Distances | null;
  startedAt: string | null;
  /** Výsledky jsou oficiální (kategorie uzavřená ředitelem závodu; u skupiny všechny její). */
  closedAt: string | null;
  counts: { started: number; finished: number; dnf: number };
  checkpointIds: string[];
  rows: PublicResultRowDto[];
}

export interface PublicRaceResultsDto {
  race: PublicRaceSummaryDto;
  generatedAt: string;
  checkpoints: {
    id: string;
    name: string;
    /** `transition` = hranice disciplíny (start, konec úseku, cíl), `intermediate` = mezičas. */
    kind: CheckpointKind;
    disciplineId: string | null;
  }[];
  disciplines: { id: string; name: string }[];
  /** Výchozí pohled: věková skupina + pohlaví, domácí a hosté v jedné tabulce se společným pořadím. */
  groups: PublicCategoryDto[];
  /** Jednotlivé kategorie (domácí a hosté zvlášť) s pořadím v kategorii. */
  categories: PublicCategoryDto[];
}

// ---------- GDPR ----------

/** Export všech osobních údajů závodníka (právo na přístup / přenositelnost). */
export interface ParticipantExportDto {
  exportedAt: string;
  race: { name: string; year: number };
  participant: {
    firstName: string;
    lastName: string;
    birthYear: number;
    gender: string;
    locality: string;
    bib: number;
    category: string;
    status: string;
    registrationSource: string;
    publicName: boolean;
    nickname: string | null;
    formal: boolean;
    createdAt: string;
  };
  times: { checkpoint: string; type: string; ts: string; note: string | null }[];
}
