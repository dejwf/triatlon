import { describe, expect, it } from 'vitest';
import { ageInRaceYear, birthYearRange, findAgeGroup } from './age.js';
import { AgeGroups, type AgeGroup } from './domain.js';

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

  it('přijme nepřekrývající se skupiny a odmítne překryv', () => {
    const ok = [
      { label: '6–8', minAge: 6, maxAge: 8 },
      { label: '9–10', minAge: 9, maxAge: 10 },
      { label: '51+', minAge: 51, maxAge: null },
    ];
    expect(AgeGroups.safeParse(ok).success).toBe(true);
    expect(
      AgeGroups.safeParse([
        { label: '6–8', minAge: 6, maxAge: 8 },
        { label: '8–10', minAge: 8, maxAge: 10 },
      ]).success,
    ).toBe(false);
    expect(
      AgeGroups.safeParse([
        { label: '50+', minAge: 50, maxAge: null },
        { label: '60+', minAge: 60, maxAge: null },
      ]).success,
    ).toBe(false);
    expect(AgeGroups.safeParse([{ label: 'x', minAge: 10, maxAge: 5 }]).success).toBe(false);
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
