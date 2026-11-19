/**
 * Odvozené údaje pro vizualizace výsledků (veřejná tabule, kiosk, appka): pruh rozložení času,
 * vývoj pořadí, medián kategorie, „kde jsou závodníci“ a „právě v cíli“. Čisté funkce nad už
 * spočítanými řádky — pořadí samo se tu nepočítá (to dělá `results.ts`).
 */
import { RANK_PRECISION_MS, type ResultState } from './results.js';

/** Minimum řádku, které vizualizace potřebují (veřejný i administrátorský výstup). */
export interface BoardRow {
  state: ResultState;
  totalMs: number | null;
  /** Čas od startu na checkpointech kategorie (null = neprojel). */
  splitsMs: (number | null)[];
  /** Časy disciplín v pořadí trasy (null = úsek nedokončen). */
  disciplinesMs: (number | null)[];
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/** Medián každé disciplíny mezi závodníky v cíli (null = nikdo ji zatím nedokončil). */
export function disciplineMedians(rows: readonly BoardRow[]): (number | null)[] {
  const finished = rows.filter((r) => r.state === 'finished');
  const legs = Math.max(0, ...rows.map((r) => r.disciplinesMs.length));
  return Array.from({ length: legs }, (_, k) =>
    median(finished.map((r) => r.disciplinesMs[k]).filter((ms): ms is number => ms != null)),
  );
}

/** Index disciplíny, ve které závodník je (= počet dokončených úseků od začátku). */
export function currentLeg(row: BoardRow): number {
  const i = row.disciplinesMs.findIndex((ms) => ms == null);
  return i === -1 ? row.disciplinesMs.length : i;
}

/** Odhad zbývajícího času na trati podle mediánu dokončených (null = nelze odhadnout). */
export function estimatedRestMs(row: BoardRow, medians: readonly (number | null)[]): number | null {
  if (row.state !== 'racing') return null;
  let rest = 0;
  for (let k = currentLeg(row); k < medians.length; k++) {
    const m = medians[k];
    if (m == null) return null;
    rest += m;
  }
  return rest;
}

/** Součet dokončených úseků (délka plné části pruhu). */
export function doneMs(row: BoardRow): number {
  return row.disciplinesMs.reduce<number>((a, ms) => a + (ms ?? 0), 0);
}

/**
 * Měřítko pruhů rozložení času — stejné pro všechny řádky kategorie, aby šlo porovnávat:
 * nejpomalejší dokončený čas (nebo nejdelší odhad na trati) + 5 % rezerva.
 */
export function barScaleMs(rows: readonly BoardRow[]): number {
  const medians = disciplineMedians(rows);
  const longest = Math.max(
    0,
    ...rows.map((r) =>
      r.state === 'finished' && r.totalMs != null
        ? r.totalMs
        : doneMs(r) + (estimatedRestMs(r, medians) ?? 0),
    ),
  );
  return Math.max(1000, Math.round(longest * 1.05));
}

/** Ztráta na nejrychlejšího v cíli (null = není v cíli / je první). */
export function gapMs(row: BoardRow, rows: readonly BoardRow[]): number | null {
  if (row.state !== 'finished' || row.totalMs == null) return null;
  const best = Math.min(
    ...rows.filter((r) => r.state === 'finished' && r.totalMs != null).map((r) => r.totalMs!),
  );
  return row.totalMs - best;
}

/**
 * Pořadí na každém checkpointu (indexy jako `splitsMs`) mezi těmi, kdo ho projeli, podle času
 * od startu na celé sekundy — stejná sekunda = stejné pořadí. Výsledek je ve stejném pořadí
 * jako `rows`. Na startu má pořadí každý null.
 */
export function checkpointRanks(rows: readonly BoardRow[]): (number | null)[][] {
  const out = rows.map((r) => r.splitsMs.map(() => null as number | null));
  const width = Math.max(0, ...rows.map((r) => r.splitsMs.length));
  for (let k = 1; k < width; k++) {
    const passed = rows
      .map((r, i) => ({ i, s: r.splitsMs[k] }))
      .filter((x): x is { i: number; s: number } => x.s != null)
      .map((x) => ({ i: x.i, sec: Math.floor(x.s / RANK_PRECISION_MS) }))
      .sort((a, b) => a.sec - b.sec);
    passed.forEach((x, n) => {
      const prev = passed[n - 1];
      out[x.i]![k] = prev && prev.sec === x.sec ? out[prev.i]![k]! : n + 1;
    });
  }
  return out;
}

/** Index posledního projetého checkpointu (−1 = žádný). */
export function lastPassed(row: BoardRow): number {
  for (let k = row.splitsMs.length - 1; k >= 0; k--) if (row.splitsMs[k] != null) return k;
  return -1;
}

/** Kolik závodníků je na kterém úseku (jen „na trati“) a kolik v cíli. */
export function trackCounts(
  rows: readonly BoardRow[],
  legs: number,
): {
  legs: number[];
  finished: number;
} {
  const counts = Array.from({ length: legs }, () => 0);
  for (const r of rows) {
    if (r.state !== 'racing') continue;
    const k = Math.min(currentLeg(r), legs - 1);
    if (k >= 0) counts[k]!++;
  }
  return { legs: counts, finished: rows.filter((r) => r.state === 'finished').length };
}

/** Okamžik doběhu (ms od epochy) z času startu závodníka a celkového času. */
export function finishedAtMs(row: BoardRow & { startedAt: string | null }): number | null {
  if (row.state !== 'finished' || row.totalMs == null || !row.startedAt) return null;
  return Date.parse(row.startedAt) + row.totalMs;
}

/** Posledních `n` doběhů napříč kategoriemi, nejnovější první. */
export function latestFinishers<R extends BoardRow & { startedAt: string | null }, C>(
  tables: readonly { table: C; rows: readonly R[] }[],
  n: number,
): { table: C; row: R; at: number }[] {
  return tables
    .flatMap(({ table, rows }) => rows.map((row) => ({ table, row, at: finishedAtMs(row) })))
    .filter((x): x is { table: C; row: R; at: number } => x.at !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, n);
}
