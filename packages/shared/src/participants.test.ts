import { describe, expect, it } from 'vitest';
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
      },
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
