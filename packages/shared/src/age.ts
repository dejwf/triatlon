import { groupHasGender, type AgeGroup, type Gender } from './domain.js';

/** Věk pro zařazení do kategorie se počítá podle ročníku narození: rok závodu − rok narození. */
export function ageInRaceYear(raceYear: number, birthYear: number): number {
  return raceYear - birthYear;
}

/** Rozsah ročníků narození, který odpovídá věkové skupině v daném roce závodu. */
export function birthYearRange(
  raceYear: number,
  group: AgeGroup,
): { from: number | null; to: number } {
  return {
    from: group.maxAge === null ? null : raceYear - group.maxAge,
    to: raceYear - group.minAge,
  };
}

/**
 * Najde běžnou (nevolitelnou) věkovou skupinu pro ročník narození a pohlaví. Běžné skupiny se
 * nepřekrývají (validuje `AgeGroups`), takže vyhovuje nejvýš jedna; `undefined` = věk nespadá
 * do žádné skupiny.
 */
export function findAgeGroup(
  raceYear: number,
  birthYear: number,
  groups: readonly AgeGroup[],
  gender?: Gender,
): AgeGroup | undefined {
  return groups.find(
    (g) =>
      !g.elective &&
      (!gender || groupHasGender(g, gender)) &&
      fitsAge(g, ageInRaceYear(raceYear, birthYear)),
  );
}

export const fitsAge = (g: AgeGroup, age: number) =>
  age >= g.minAge && (g.maxAge === null || age <= g.maxAge);

/** Volitelné skupiny (např. Super ženy), které si závodník daného věku a pohlaví může zvolit. */
export function electiveGroups(
  raceYear: number,
  birthYear: number,
  gender: Gender,
  groups: readonly AgeGroup[],
): AgeGroup[] {
  const age = ageInRaceYear(raceYear, birthYear);
  return groups.filter((g) => g.elective && groupHasGender(g, gender) && fitsAge(g, age));
}

/** Pohlaví u dětských skupin (horní hranice do 16 let): dívky / hoši, jinak ženy / muži. */
export function genderWord(group: Pick<AgeGroup, 'maxAge'>, gender: Gender): string {
  const youth = group.maxAge !== null && group.maxAge <= 16;
  return gender === 'male' ? (youth ? 'hoši' : 'muži') : youth ? 'dívky' : 'ženy';
}

/**
 * Název skupiny bez lokality — i název společné tabulky domácích a hostů: skupina jen pro jedno
 * pohlaví se jmenuje podle popisku („Super ženy“), jinak popisek + pohlaví („6–8 hoši“).
 */
export function groupName(group: AgeGroup, gender: Gender): string {
  return group.gender ? group.label : `${group.label} ${genderWord(group, gender)}`;
}

/**
 * Výchozí kategorie podle Vlkančického triatlonu (vlkancice.cz/triatlon): děti po věkových
 * skupinách (dívky a hoši zvlášť), ženy, volitelně Super ženy (dlouhá trať), muži do 40 (dlouhá
 * trať) a nad 40. Admin je může pro každý závod upravit.
 */
export const DEFAULT_AGE_GROUPS: AgeGroup[] = [
  { label: '0–5', minAge: 0, maxAge: 5, distances: { swim: 10, bike: 200, run: 50 } },
  { label: '6–8', minAge: 6, maxAge: 8, distances: { swim: 20, bike: 500, run: 100 } },
  { label: '9–10', minAge: 9, maxAge: 10, distances: { swim: 40, bike: 1000, run: 300 } },
  { label: '11–12', minAge: 11, maxAge: 12, distances: { swim: 60, bike: 1500, run: 500 } },
  { label: '13–14', minAge: 13, maxAge: 14, distances: { swim: 80, bike: 2000, run: 1000 } },
  { label: '15–16', minAge: 15, maxAge: 16, distances: { swim: 100, bike: 2500, run: 1200 } },
  {
    label: 'Ženy',
    minAge: 17,
    maxAge: null,
    gender: 'female',
    distances: { swim: 200, bike: 6000, run: 2000 },
  },
  {
    label: 'Super ženy',
    minAge: 17,
    maxAge: null,
    gender: 'female',
    elective: true,
    distances: { swim: 400, bike: 12000, run: 4000 },
  },
  {
    label: 'Muži do 40',
    minAge: 17,
    maxAge: 40,
    gender: 'male',
    distances: { swim: 400, bike: 12000, run: 4000 },
  },
  {
    label: 'Muži nad 40',
    minAge: 41,
    maxAge: null,
    gender: 'male',
    distances: { swim: 200, bike: 6000, run: 2000 },
  },
];
