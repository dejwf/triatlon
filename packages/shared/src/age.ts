import type { AgeGroup } from './domain.js';

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
 * Najde věkovou skupinu pro ročník narození. Skupiny se nepřekrývají (validuje `AgeGroups`),
 * takže vyhovuje nejvýš jedna; `undefined` = věk nespadá do žádné definované skupiny.
 */
export function findAgeGroup(
  raceYear: number,
  birthYear: number,
  groups: readonly AgeGroup[],
): AgeGroup | undefined {
  const age = ageInRaceYear(raceYear, birthYear);
  return groups.find((g) => age >= g.minAge && (g.maxAge === null || age <= g.maxAge));
}
