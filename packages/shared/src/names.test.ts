import { describe, expect, it } from 'vitest';
import { displayNames, surnameShort, type NamedPerson } from './names.js';

const person = (
  id: string,
  firstName: string,
  lastName: string,
  extra: Partial<NamedPerson> = {},
): NamedPerson => ({ id, firstName, lastName, birthYear: 1999, formal: false, ...extra });

describe('zobrazované názvy závodníků', () => {
  it('formální: Jméno "Přezdívka" Příjmení, bez přezdívky Jméno Příjmení', () => {
    const names = displayNames([
      person('a', 'Jan', 'Novák', { formal: true, nickname: 'Honza' }),
      person('b', 'Petr', 'Malý', { formal: true }),
      person('c', 'Eva', 'Nová', {}),
    ]);
    expect(names.get('a')).toBe('Jan "Honza" Novák');
    expect(names.get('b')).toBe('Petr Malý');
    expect(names.get('c')).toBe('Eva');
  });

  it('neformální: přezdívka, při shodě 2 písmena příjmení, pak dvojčíslí ročníku', () => {
    const names = displayNames([
      person('a', 'Jan', 'Novák', { nickname: 'Honza' }),
      person('b', 'Jan', 'Nedoma', { nickname: 'honza' }),
      person('c', 'Jan', 'Nosek', { nickname: 'Honza', birthYear: 2005 }),
      person('d', 'Jan', 'Dvořák'),
      person('e', 'Petr', 'Malý', { nickname: 'Péťa' }),
    ]);
    expect(names.get('a')).toBe('Honza No 99');
    expect(names.get('b')).toBe('honza Ne');
    expect(names.get('c')).toBe('Honza No 05');
    expect(names.get('d')).toBe('Jan'); // bez přezdívky jméno; formální „Jan“ by se neshodoval
    expect(names.get('e')).toBe('Péťa');
  });

  it('bez přezdívky jméno, při shodě Jan No; formální se do shody nepočítá', () => {
    const names = displayNames([
      person('a', 'Jan', 'Novák'),
      person('b', 'Jan', 'Dvořák'),
      person('c', 'Jan', 'Malý', { formal: true }),
    ]);
    expect([names.get('a'), names.get('b'), names.get('c')]).toEqual([
      'Jan No',
      'Jan Dv',
      'Jan Malý',
    ]);
  });

  it('dvojčata zůstanou stejná (rozliší je číslo)', () => {
    const names = displayNames([person('a', 'Jan', 'Novák'), person('b', 'Jan', 'Novák')]);
    expect(names.get('a')).toBe('Jan No 99');
    expect(names.get('b')).toBe('Jan No 99');
  });

  it('české ch je jedno písmeno', () => {
    expect(surnameShort('Chalupa')).toBe('Cha');
    expect(surnameShort('Novák')).toBe('No');
    expect(surnameShort('Ó')).toBe('Ó');
  });
});
