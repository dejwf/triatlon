/**
 * Ukázková data pro vývoj: Vlkančický triatlon 2027 s výchozími věkovými skupinami,
 * disciplínami, checkpointy, kategoriemi a jedním adminem. Spuštění je idempotentní.
 */
import { AgeGroups, DEFAULT_AGE_GROUPS } from '@triatlon/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { createRaceWithDefaults } from './races/race-factory';

const RACE_NAME = 'Vlkančický triatlon';
// První srpnová sobota (vlkancice.cz/triatlon).
const RACE_DATE = '2027-08-07';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

const ageGroups = AgeGroups.parse(DEFAULT_AGE_GROUPS);

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
