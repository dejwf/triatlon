/**
 * Ukázková data pro vývoj: Vlkančický triatlon 2027 s výchozími věkovými skupinami,
 * disciplínami, checkpointy, kategoriemi a jedním adminem. Spuštění je idempotentní.
 */
import { AgeGroups, birthYearRange, type AgeGroup } from '@triatlon/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const RACE_NAME = 'Vlkančický triatlon';
const RACE_YEAR = 2027;
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

const ageGroups: AgeGroup[] = AgeGroups.parse([
  { label: '0–5', minAge: 0, maxAge: 5 },
  { label: '6–8', minAge: 6, maxAge: 8 },
  { label: '9–10', minAge: 9, maxAge: 10 },
  { label: '11–15', minAge: 11, maxAge: 15 },
  { label: '16–30', minAge: 16, maxAge: 30 },
  { label: '31–40', minAge: 31, maxAge: 40 },
  { label: '41–50', minAge: 41, maxAge: 50 },
  { label: '51+', minAge: 51, maxAge: null },
]);

const genders = [
  { value: 'male', label: 'muži' },
  { value: 'female', label: 'ženy' },
] as const;
const localities = [
  { value: 'local', label: 'místní' },
  { value: 'guest', label: 'hosté' },
] as const;

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: 'Admin', role: 'admin' },
    });

    if (
      await prisma.race.findUnique({ where: { name_year: { name: RACE_NAME, year: RACE_YEAR } } })
    ) {
      console.log(`Závod ${RACE_NAME} ${RACE_YEAR} už existuje — přeskakuji.`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      const race = await tx.race.create({
        data: {
          name: RACE_NAME,
          year: RACE_YEAR,
          date: new Date(`${RACE_YEAR}-07-17`),
          ageGroups,
        },
      });

      const [swim, bike, run] = await Promise.all(
        ['plavání', 'cyklistika', 'běh'].map((name, i) =>
          tx.discipline.create({ data: { raceId: race.id, name, seq: i + 1 } }),
        ),
      );

      // start → konec plavání → konec kola → cíl (CLAUDE.md, sekce 4 – Checkpoint)
      const checkpoints = await Promise.all(
        [
          { name: 'Start', disciplineId: null },
          { name: 'Konec plavání', disciplineId: swim!.id },
          { name: 'Konec kola', disciplineId: bike!.id },
          { name: 'Cíl', disciplineId: run!.id },
        ].map((cp, i) =>
          tx.checkpoint.create({
            data: { raceId: race.id, seq: i + 1, kind: 'transition', ...cp },
          }),
        ),
      );

      for (const group of ageGroups) {
        const range = birthYearRange(RACE_YEAR, group);
        for (const gender of genders) {
          for (const locality of localities) {
            await tx.category.create({
              data: {
                raceId: race.id,
                name: `${group.label} ${gender.label} ${locality.label}`,
                ageGroupLabel: group.label,
                birthYearFrom: range.from,
                birthYearTo: range.to,
                gender: gender.value,
                locality: locality.value,
                checkpoints: {
                  create: checkpoints.map((cp) => ({ checkpointId: cp.id })),
                },
              },
            });
          }
        }
      }
    });

    console.log(`Vytvořen závod ${RACE_NAME} ${RACE_YEAR} a admin ${ADMIN_EMAIL}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
