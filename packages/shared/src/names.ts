/**
 * Zobrazovaný název závodníka ve výsledcích (CLAUDE.md, sekce 4 – Závodník):
 * - formální: `Jméno "Přezdívka" Příjmení`, bez přezdívky `Jméno Příjmení`,
 * - neformální: přezdívka, jinak jméno; při shodě ve společné tabulce (věková skupina + pohlaví,
 *   domácí i hosté) se přidají 2 písmena příjmení („Honza No“), při další shodě dvojčíslí
 *   ročníku („Honza No 99“). Rozlišují se jen ti, kdo se shodují.
 */
export interface NamedPerson {
  id: string;
  firstName: string;
  lastName: string;
  nickname?: string | null;
  formal?: boolean;
  birthYear: number;
}

/** Začátek příjmení na 2 písmena; české „ch“ je jedno písmeno (Chalupa → Cha). */
export function surnameShort(lastName: string): string {
  const s = lastName.trim();
  const letters = s.slice(0, 2).toLocaleLowerCase('cs') === 'ch' ? 3 : 2;
  return s.slice(0, letters);
}

export function formalName(p: NamedPerson): string {
  const nick = p.nickname?.trim();
  return nick ? `${p.firstName} "${nick}" ${p.lastName}` : `${p.firstName} ${p.lastName}`;
}

const MAX_LEVEL = 2;

function informalName(p: NamedPerson, level: number): string {
  const parts = [p.nickname?.trim() || p.firstName];
  if (level >= 1) parts.push(surnameShort(p.lastName));
  if (level >= 2) parts.push(String(p.birthYear % 100).padStart(2, '0'));
  return parts.join(' ');
}

const key = (name: string) => name.trim().toLocaleLowerCase('cs');

/** Názvy pro závodníky jedné společné tabulky (id → název). */
export function displayNames(people: readonly NamedPerson[]): Map<string, string> {
  const result = new Map<string, string>();
  const informal = people.filter((p) => p.formal === false);
  for (const p of people) if (p.formal !== false) result.set(p.id, formalName(p));

  const level = new Map(informal.map((p) => [p.id, 0]));
  for (;;) {
    const byName = new Map<string, NamedPerson[]>();
    for (const p of informal) {
      const k = key(informalName(p, level.get(p.id)!));
      byName.set(k, [...(byName.get(k) ?? []), p]);
    }
    let changed = false;
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      for (const p of group) {
        const l = level.get(p.id)!;
        if (l < MAX_LEVEL) {
          level.set(p.id, l + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (const p of informal) result.set(p.id, informalName(p, level.get(p.id)!));
  return result;
}
