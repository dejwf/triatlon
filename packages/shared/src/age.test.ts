import { describe, expect, it } from 'vitest';
import {
  ageInRaceYear,
  birthYearRange,
  DEFAULT_AGE_GROUPS,
  electiveGroups,
  findAgeGroup,
  groupName,
} from './age.js';
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

  it('výchozí kategorie Vlkančic: platné, podle pohlaví, Super ženy jen volbou', () => {
    expect(AgeGroups.safeParse(DEFAULT_AGE_GROUPS).success).toBe(true);
    const g = DEFAULT_AGE_GROUPS;
    expect(findAgeGroup(2027, 2020, g, 'female')?.label).toBe('6–8');
    expect(findAgeGroup(2027, 2010, g, 'female')?.label).toBe('Ženy'); // 17 let
    expect(findAgeGroup(2027, 1987, g, 'male')?.label).toBe('Muži do 40'); // 40 let
    expect(findAgeGroup(2027, 1986, g, 'male')?.label).toBe('Muži nad 40'); // 41 let
    expect(electiveGroups(2027, 1990, 'female', g).map((x) => x.label)).toEqual(['Super ženy']);
    expect(electiveGroups(2027, 1990, 'male', g)).toEqual([]);
    expect(electiveGroups(2027, 2012, 'female', g)).toEqual([]); // 15 let
  });

  it('názvy skupin: děti dívky / hoši, skupina jednoho pohlaví podle popisku', () => {
    const [kids] = DEFAULT_AGE_GROUPS;
    expect(groupName(kids!, 'male')).toBe('0–5 hoši');
    expect(groupName(kids!, 'female')).toBe('0–5 dívky');
    expect(groupName({ label: '31–40', minAge: 31, maxAge: 40 }, 'female')).toBe('31–40 ženy');
    expect(groupName(DEFAULT_AGE_GROUPS.at(-1)!, 'male')).toBe('Muži nad 40');
  });

  it('překryv se hlídá zvlášť pro každé pohlaví; volitelná skupina se překrývat smí', () => {
    expect(
      AgeGroups.safeParse([
        { label: 'Ženy', minAge: 17, maxAge: null, gender: 'female' },
        { label: 'Muži', minAge: 17, maxAge: null, gender: 'male' },
        { label: 'Super ženy', minAge: 17, maxAge: null, gender: 'female', elective: true },
      ]).success,
    ).toBe(true);
    expect(
      AgeGroups.safeParse([
        { label: 'Ženy', minAge: 17, maxAge: null, gender: 'female' },
        { label: '30+', minAge: 30, maxAge: null },
      ]).success,
    ).toBe(false);
    expect(
      AgeGroups.safeParse([
        { label: 'A', minAge: 1, maxAge: 2 },
        { label: 'a', minAge: 3, maxAge: 4 },
      ]).success,
    ).toBe(false);
  });
});
