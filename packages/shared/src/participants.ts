import { findAgeGroup } from './age.js';
import { ParticipantInput } from './admin.js';
import type { AgeGroup, Gender, Locality } from './domain.js';

export interface CategoryKey {
  id: string;
  name: string;
  ageGroupLabel: string;
  gender: Gender;
  locality: Locality;
}

/**
 * Zařadí závodníka do kategorie podle ročníku narození (věk = rok závodu − ročník), pohlaví
 * a lokality. Vrací kategorii, nebo českou chybovou hlášku.
 */
export function resolveCategory<C extends CategoryKey>(
  p: { birthYear: number; gender: Gender; locality: Locality },
  raceYear: number,
  ageGroups: readonly AgeGroup[],
  categories: readonly C[],
): { category: C } | { error: string } {
  const group = findAgeGroup(raceYear, p.birthYear, ageGroups);
  if (!group) {
    return {
      error: `Ročník ${p.birthYear} (věk ${raceYear - p.birthYear}) nespadá do žádné věkové skupiny.`,
    };
  }
  const category = categories.find(
    (c) => c.ageGroupLabel === group.label && c.gender === p.gender && c.locality === p.locality,
  );
  if (!category) {
    return {
      error: `Kategorie pro skupinu ${group.label}, ${GENDER_LABEL[p.gender]}, ${LOCALITY_LABEL[p.locality]} neexistuje.`,
    };
  }
  return { category };
}

export const GENDER_LABEL: Record<Gender, string> = { male: 'muži', female: 'ženy' };
export const LOCALITY_LABEL: Record<Locality, string> = { local: 'místní', guest: 'hosté' };

// ---------- Import z CSV/XLSX ----------

/** Odstraní diakritiku, mezery a velikost písmen — pro porovnání názvů sloupců a hodnot. */
function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_.-]+/g, '');
}

/** Povolené názvy sloupců (po normalizaci). První sloupec, který se najde, vyhrává. */
const COLUMNS = {
  firstName: ['jmeno', 'krestnijmeno', 'firstname', 'name'],
  lastName: ['prijmeni', 'lastname', 'surname'],
  birthYear: [
    'rocnik',
    'roknarozeni',
    'datumnarozeni',
    'narozen',
    'narozena',
    'birthyear',
    'birthdate',
  ],
  gender: ['pohlavi', 'gender', 'sex'],
  locality: ['lokalita', 'mistni', 'locality'],
  bib: ['cislo', 'startovnicislo', 'startcislo', 'bib'],
} as const;

/** Názvy sloupců pro šablonu importu. */
export const IMPORT_TEMPLATE_HEADER = [
  'jméno',
  'příjmení',
  'ročník',
  'pohlaví',
  'lokalita',
  'číslo',
];

const GENDER_VALUES: Record<string, Gender> = {
  m: 'male',
  muz: 'male',
  muzi: 'male',
  male: 'male',
  z: 'female',
  zena: 'female',
  zeny: 'female',
  f: 'female',
  female: 'female',
};

const LOCALITY_VALUES: Record<string, Locality> = {
  l: 'local',
  m: 'local',
  mistni: 'local',
  local: 'local',
  ano: 'local',
  h: 'guest',
  host: 'guest',
  hoste: 'guest',
  guest: 'guest',
  ne: 'guest',
};

function pick(raw: Record<string, unknown>, aliases: readonly string[]): unknown {
  const keys = Object.keys(raw);
  for (const alias of aliases) {
    const key = keys.find((k) => norm(k) === alias);
    if (key !== undefined && raw[key] !== null && String(raw[key]).trim() !== '') return raw[key];
  }
  return undefined;
}

/** Ročník z „1990“, „15. 3. 1990“, „1990-03-15“ apod. */
function parseBirthYear(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  const years = String(value).match(/\b(19|20)\d{2}\b/g);
  return years?.length === 1 ? Number(years[0]) : undefined;
}

/** Převede řádek ze souboru na vstup závodníka, nebo vrátí seznam chyb (česky). */
export function parseImportRow(
  raw: Record<string, unknown>,
): { ok: true; value: ParticipantInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const rawYear = pick(raw, COLUMNS.birthYear);
  const birthYear = rawYear === undefined ? undefined : parseBirthYear(rawYear);
  if (rawYear === undefined) errors.push('Chybí ročník narození.');
  else if (birthYear === undefined) errors.push(`Nerozpoznaný ročník „${String(rawYear)}“.`);

  const rawGender = pick(raw, COLUMNS.gender);
  const gender = GENDER_VALUES[norm(rawGender)];
  if (rawGender === undefined) errors.push('Chybí pohlaví.');
  else if (!gender) errors.push(`Nerozpoznané pohlaví „${String(rawGender)}“ (použijte M / Ž).`);

  const rawLocality = pick(raw, COLUMNS.locality);
  const locality = LOCALITY_VALUES[norm(rawLocality)];
  if (rawLocality === undefined) errors.push('Chybí lokalita.');
  else if (!locality) {
    errors.push(`Nerozpoznaná lokalita „${String(rawLocality)}“ (použijte místní / host).`);
  }

  const rawBib = pick(raw, COLUMNS.bib);
  const bib = rawBib === undefined ? undefined : Number(String(rawBib).trim());

  const parsed = ParticipantInput.safeParse({
    firstName: String(pick(raw, COLUMNS.firstName) ?? '').trim(),
    lastName: String(pick(raw, COLUMNS.lastName) ?? '').trim(),
    birthYear,
    gender,
    locality,
    bib,
  });

  if (!parsed.success) {
    const labels: Record<string, string> = {
      firstName: 'Jméno',
      lastName: 'Příjmení',
      birthYear: 'Ročník',
      bib: 'Startovní číslo',
    };
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]);
      // Chyby ročníku/pohlaví/lokality už jsou popsané výše srozumitelněji.
      if (['gender', 'locality'].includes(field)) continue;
      if (field === 'birthYear' && birthYear === undefined) continue;
      errors.push(
        field === 'bib'
          ? `Neplatné startovní číslo „${String(rawBib)}“.`
          : `${labels[field] ?? field}: ${issue.message}`,
      );
    }
  }

  return errors.length === 0 && parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors };
}
