import { describe, expect, it } from 'vitest';
import { DEFAULT_AGE_GROUPS } from './age.js';
import type { AgeGroup } from './domain.js';
import { parseImportRow, resolveCategory, type CategoryKey } from './participants.js';

const groups: AgeGroup[] = [
  { label: '6–8', minAge: 6, maxAge: 8 },
  { label: '31–40', minAge: 31, maxAge: 40 },
];
const categories: CategoryKey[] = [
  { id: 'a', name: '6–8 ženy místní', ageGroupLabel: '6–8', gender: 'female', locality: 'local' },
  { id: 'b', name: '31–40 muži hosté', ageGroupLabel: '31–40', gender: 'male', locality: 'guest' },
];

describe('resolveCategory', () => {
  it('zařadí podle ročníku, pohlaví a lokality', () => {
    const r = resolveCategory(
      { birthYear: 2020, gender: 'female', locality: 'local' },
      2027,
      groups,
      categories,
    );
    expect(r).toEqual({ category: categories[0] });
  });

  it('hlásí věk mimo skupiny i chybějící kategorii', () => {
    expect(
      resolveCategory(
        { birthYear: 2010, gender: 'male', locality: 'guest' },
        2027,
        groups,
        categories,
      ),
    ).toHaveProperty('error');
    expect(
      resolveCategory(
        { birthYear: 1990, gender: 'female', locality: 'guest' },
        2027,
        groups,
        categories,
      ),
    ).toHaveProperty('error');
  });
});

describe('resolveCategory — volitelná kategorie (Super ženy)', () => {
  const cats: CategoryKey[] = DEFAULT_AGE_GROUPS.flatMap((g) =>
    (['male', 'female'] as const)
      .filter((gender) => !g.gender || g.gender === gender)
      .map((gender) => ({
        id: `${g.label}|${gender}`,
        name: g.label,
        ageGroupLabel: g.label,
        gender,
        locality: 'local' as const,
      })),
  );
  const resolve = (p: { birthYear: number; gender: 'male' | 'female'; electiveGroup?: string }) =>
    resolveCategory({ ...p, locality: 'local' }, 2027, DEFAULT_AGE_GROUPS, cats);

  it('bez volby podle věku, s volbou do Super žen', () => {
    expect(resolve({ birthYear: 1990, gender: 'female' })).toMatchObject({
      category: { ageGroupLabel: 'Ženy' },
    });
    expect(
      resolve({ birthYear: 1990, gender: 'female', electiveGroup: 'super zeny' }),
    ).toMatchObject({ category: { ageGroupLabel: 'Super ženy' } });
    // Uvedení automatické kategorie je v pořádku (např. sloupec „Kategorie“ v importu).
    expect(resolve({ birthYear: 1990, gender: 'female', electiveGroup: 'Ženy' })).toMatchObject({
      category: { ageGroupLabel: 'Ženy' },
    });
  });

  it('odmítne volbu, která neodpovídá věku nebo pohlaví', () => {
    expect(resolve({ birthYear: 1990, gender: 'male', electiveGroup: 'Super ženy' })).toEqual({
      error: 'Kategorie „Super ženy“ není určená pro muže ve věku 37 let.',
    });
    expect(resolve({ birthYear: 1980, gender: 'male', electiveGroup: 'Muži do 40' })).toEqual({
      error: 'Kategorii „Muži do 40“ nelze zvolit.',
    });
    expect(resolve({ birthYear: 1990, gender: 'female', electiveGroup: 'Muži do 40' })).toEqual({
      error: 'Kategorii „Muži do 40“ nelze zvolit. Lze zvolit: Ženy, Super ženy.',
    });
  });
});

describe('parseImportRow', () => {
  it('rozpozná české sloupce a hodnoty', () => {
    const r = parseImportRow({
      'Jméno ': 'Jan',
      Příjmení: 'Novák',
      'Datum narození': '15. 3. 1990',
      Pohlaví: 'M',
      Lokalita: 'Místní',
      'Startovní číslo': '12',
    });
    expect(r).toEqual({
      ok: true,
      value: {
        firstName: 'Jan',
        lastName: 'Novák',
        birthYear: 1990,
        gender: 'male',
        locality: 'local',
        bib: 12,
        nickname: null,
      },
    });
  });

  it('přezdívka a oslovení', () => {
    const base = { jmeno: 'Jan', prijmeni: 'Novák', rocnik: 1990, pohlavi: 'M', lokalita: 'M' };
    expect(parseImportRow({ ...base, Přezdívka: ' Honza ', Oslovení: 'Neformální' })).toMatchObject(
      { ok: true, value: { nickname: 'Honza', formal: false } },
    );
    expect(parseImportRow({ ...base, osloveni: 'F' })).toMatchObject({
      ok: true,
      value: { nickname: null, formal: true },
    });
    expect(parseImportRow({ ...base, osloveni: 'tykat' })).toEqual({
      ok: false,
      errors: ['Nerozpoznané oslovení „tykat“ (použijte formální / neformální).'],
    });
  });

  it('číslo je volitelné, ženy jako Ž, hosté jako host', () => {
    const r = parseImportRow({
      jmeno: 'Eva',
      prijmeni: 'Malá',
      rocnik: 2019,
      pohlavi: 'Ž',
      lokalita: 'host',
    });
    expect(r).toMatchObject({ ok: true, value: { gender: 'female', locality: 'guest' } });
    expect(r.ok && r.value.bib).toBeUndefined();
  });

  it('vrací všechny chyby řádku', () => {
    const r = parseImportRow({
      jmeno: '',
      prijmeni: 'X',
      rocnik: 'neznamo',
      pohlavi: '?',
      cislo: 'abc',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        'Nerozpoznaný ročník „neznamo“.',
        'Nerozpoznané pohlaví „?“ (použijte M / Ž).',
        'Chybí lokalita.',
        'Jméno: Povinné pole.',
        'Neplatné startovní číslo „abc“.',
      ]);
    }
  });
});
