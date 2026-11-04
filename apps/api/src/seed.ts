/**
 * Ukázková data pro vývoj: Vlkančický triatlon 2027 s výchozími věkovými skupinami,
 * disciplínami, checkpointy, kategoriemi a jedním adminem. Spuštění je idempotentní.
 */
import { AgeGroups } from '@triatlon/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { createRaceWithDefaults } from './races/race-factory';

const RACE_NAME = 'Vlkančický triatlon';
const RACE_DATE = '2027-07-17';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

const ageGroups = AgeGroups.parse([
  { label: '0–5', minAge: 0, maxAge: 5 },
  { label: '6–8', minAge: 6, maxAge: 8 },
  { label: '9–10', minAge: 9, maxAge: 10 },
  { label: '11–15', minAge: 11, maxAge: 15 },
  { label: '16–30', minAge: 16, maxAge: 30 },
  { label: '31–40', minAge: 31, maxAge: 40 },
  { label: '41–50', minAge: 41, maxAge: 50 },
  { label: '51+', minAge: 51, maxAge: null },
]);

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

    const year = new Date(RACE_DATE).getUTCFullYear();
    if (await prisma.race.findUnique({ where: { name_year: { name: RACE_NAME, year } } })) {
      console.log(`Závod ${RACE_NAME} ${year} už existuje — přeskakuji.`);
      return;
    }
    await prisma.$transaction((tx) =>
      createRaceWithDefaults(tx, { name: RACE_NAME, date: RACE_DATE, ageGroups }),
    );
    console.log(`Vytvořen závod ${RACE_NAME} ${year} a admin ${ADMIN_EMAIL}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
