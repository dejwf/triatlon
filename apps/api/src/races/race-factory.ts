import {
  birthYearRange,
  GENDER_LABEL,
  LOCALITY_LABEL,
  type AgeGroup,
  type Gender,
  type Locality,
  type RaceCreateInput,
} from '@triatlon/shared';
import type { Prisma, Race } from '../generated/prisma/client';

const GENDERS: Gender[] = ['male', 'female'];
const LOCALITIES: Locality[] = ['local', 'guest'];

/** Výchozí disciplíny a checkpointy triatlonu: start → konec plavání → konec kola → cíl. */
const DISCIPLINES = ['plavání', 'cyklistika', 'běh'];
const CHECKPOINTS: { name: string; discipline: number | null }[] = [
  { name: 'Start', discipline: null },
  { name: 'Konec plavání', discipline: 0 },
  { name: 'Konec kola', discipline: 1 },
  { name: 'Cíl', discipline: 2 },
];

export function raceYear(date: string | Date): number {
  return new Date(date).getUTCFullYear();
}

/** Založí závod včetně výchozích disciplín, checkpointů a kategorií (věk × pohlaví × lokalita). */
export async function createRaceWithDefaults(
  tx: Prisma.TransactionClient,
  input: RaceCreateInput,
): Promise<Race> {
  const race = await tx.race.create({
    data: {
      name: input.name,
      year: raceYear(input.date),
      date: new Date(input.date),
      ageGroups: input.ageGroups,
    },
  });

  const disciplines = [];
  for (const [i, name] of DISCIPLINES.entries()) {
    disciplines.push(await tx.discipline.create({ data: { raceId: race.id, name, seq: i + 1 } }));
  }
  for (const [i, cp] of CHECKPOINTS.entries()) {
    await tx.checkpoint.create({
      data: {
        raceId: race.id,
        name: cp.name,
        seq: i + 1,
        kind: 'transition',
        disciplineId: cp.discipline === null ? null : disciplines[cp.discipline]!.id,
      },
    });
  }

  await createCategories(tx, race.id, race.year, input.ageGroups);
  return race;
}

/** Vytvoří kategorie pro všechny kombinace věkové skupiny, pohlaví a lokality a namapuje na ně všechny checkpointy závodu. */
export async function createCategories(
  tx: Prisma.TransactionClient,
  raceId: string,
  year: number,
  ageGroups: readonly AgeGroup[],
): Promise<void> {
  const checkpoints = await tx.checkpoint.findMany({ where: { raceId }, select: { id: true } });
  for (const group of ageGroups) {
    const range = birthYearRange(year, group);
    for (const gender of GENDERS) {
      for (const locality of LOCALITIES) {
        await tx.category.create({
          data: {
            raceId,
            name: `${group.label} ${GENDER_LABEL[gender]} ${LOCALITY_LABEL[locality]}`,
            ageGroupLabel: group.label,
            birthYearFrom: range.from,
            birthYearTo: range.to,
            gender,
            locality,
            checkpoints: { create: checkpoints.map((cp) => ({ checkpointId: cp.id })) },
          },
        });
      }
    }
  }
}
