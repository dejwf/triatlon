import { describe, expect, it } from 'vitest';
import { ageInRaceYear, birthYearRange, findAgeGroup } from './age.js';
import type { AgeGroup } from './domain.js';

const groups: AgeGroup[] = [
  { label: '0–5', minAge: 0, maxAge: 5 },
  { label: '6–8', minAge: 6, maxAge: 8 },
  { label: '50+', minAge: 50, maxAge: null },
];

describe('age', () => {
  it('počítá věk podle ročníku', () => {
    expect(ageInRaceYear(2027, 2020)).toBe(7);
  });

  it('najde skupinu včetně otevřené horní hranice', () => {
    expect(findAgeGroup(2027, 2020, groups)?.label).toBe('6–8');
    expect(findAgeGroup(2027, 1950, groups)?.label).toBe('50+');
    expect(findAgeGroup(2027, 2000, groups)).toBeUndefined();
  });

  it('převede skupinu na rozsah ročníků', () => {
    expect(birthYearRange(2027, { label: '6–8', minAge: 6, maxAge: 8 })).toEqual({
      from: 2019,
      to: 2021,
    });
    expect(birthYearRange(2027, { label: '50+', minAge: 50, maxAge: null })).toEqual({
      from: null,
      to: 1977,
    });
  });
});
