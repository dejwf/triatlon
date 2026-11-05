/**
 * Veřejná výsledková tabule (bez přihlášení) — jen nezbytné minimum osobních údajů
 * (CLAUDE.md, sekce 6): jméno (pokud ho závodník nezakázal), kategorie, startovní číslo, časy.
 * Žádné ročníky, interní ID záznamů, poznámky ani kdo co zapsal.
 */
import type { RaceStatus } from './domain.js';
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
  /** „Příjmení Jméno“, nebo null, když závodník zveřejnění jména odmítl. */
  name: string | null;
  state: ResultState;
  rank: number | null;
  tied: boolean;
  totalMs: number | null;
  /** Čas od startu na každém checkpointu kategorie (null = ještě neprojel). */
  splitsMs: (number | null)[];
  disciplinesMs: (number | null)[];
}

export interface PublicCategoryDto {
  id: string;
  name: string;
  startedAt: string | null;
  /** Výsledky jsou oficiální (kategorie uzavřená ředitelem závodu). */
  closedAt: string | null;
  counts: { started: number; finished: number; dnf: number };
  checkpointIds: string[];
  rows: PublicResultRowDto[];
}

export interface PublicRaceResultsDto {
  race: PublicRaceSummaryDto;
  generatedAt: string;
  checkpoints: { id: string; name: string }[];
  disciplines: { id: string; name: string }[];
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
    createdAt: string;
  };
  times: { checkpoint: string; type: string; ts: string; note: string | null }[];
}
