/**
 * Demo data pro vyzkoušení výsledků bez mobilní appky: „Ukázkový závod (demo)“ s dnešním
 * datem, závodníky ve třech kategoriích a simulovanými časy (část v cíli, část na trati,
 * remíza, konflikt dvou záznamů, korekce, poznámka, nepřítomný). Opakované spuštění demo
 * závod smaže a vytvoří znovu; ostatních dat se nedotkne.
 *
 *   pnpm --filter @triatlon/api demo
 */
import { AgeGroups } from '@triatlon/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { createRaceWithDefaults } from './races/race-factory';

const NAME = 'Ukázkový závod (demo)';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const FIRST = {
  male: ['Jan', 'Petr', 'Tomáš', 'Martin', 'Karel', 'Jakub', 'Ondřej'],
  female: ['Eva', 'Jana', 'Lucie', 'Anna', 'Tereza', 'Klára', 'Marie'],
};
const LAST = {
  male: ['Novák', 'Svoboda', 'Dvořák', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák'],
  female: [
    'Nováková',
    'Svobodová',
    'Dvořáková',
    'Černá',
    'Procházková',
    'Kučerová',
    'Veselá',
    'Horáková',
  ],
};

/** Deterministický pseudonáhodný generátor — demo vypadá pokaždé stejně. */
function rng(seed: number) {
  return () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const rand = rng(42);
  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} neexistuje — spusťte nejdřív seed.`);

    const today = new Date();
    const date = today.toISOString().slice(0, 10);
    const old = await prisma.race.findMany({ where: { name: NAME } });
    for (const r of old) {
      await prisma.timeEvent.deleteMany({ where: { participant: { raceId: r.id } } });
      await prisma.participant.deleteMany({ where: { raceId: r.id } });
      await prisma.race.delete({ where: { id: r.id } });
    }

    const race = await prisma.$transaction((tx) =>
      createRaceWithDefaults(tx, {
        name: NAME,
        date,
        ageGroups: AgeGroups.parse([
          { label: '9–10', minAge: 9, maxAge: 10 },
          { label: '31–40', minAge: 31, maxAge: 40 },
        ]),
      }),
    );
    const bike = await prisma.discipline.findFirstOrThrow({
      where: { raceId: race.id, name: 'cyklistika' },
    });
    const cps = await prisma.checkpoint.findMany({
      where: { raceId: race.id },
      orderBy: { seq: 'asc' },
    });
    // Sub-checkpoint: otočka na kopci během cyklistiky.
    const endBike = cps.find((c) => c.name === 'Konec kola')!;
    const finish = cps.at(-1)!;
    // Uvolnit místo před koncem kola: cíl o jedno dál, konec kola o jedno dál.
    await prisma.checkpoint.update({ where: { id: finish.id }, data: { seq: finish.seq + 1 } });
    await prisma.checkpoint.update({ where: { id: endBike.id }, data: { seq: endBike.seq + 1 } });
    const hill = await prisma.checkpoint.create({
      data: {
        raceId: race.id,
        name: 'Otočka na kopci',
        seq: endBike.seq,
        kind: 'intermediate',
        disciplineId: bike.id,
      },
    });
    const year = race.year;

    const categories = await prisma.category.findMany({ where: { raceId: race.id } });
    const plan = [
      { group: '31–40', gender: 'male', count: 12, startMinAgo: 70, pace: 1 },
      { group: '31–40', gender: 'female', count: 8, startMinAgo: 55, pace: 1.1 },
      { group: '9–10', gender: 'male', count: 6, startMinAgo: 25, pace: 0.4 },
    ] as const;

    let n = 0;
    for (const p of plan) {
      const category = categories.find(
        (c) => c.ageGroupLabel === p.group && c.gender === p.gender && c.locality === 'local',
      )!;
      const all = await prisma.category.findMany({
        where: { id: category.id },
        include: { checkpoints: true },
      });
      // Sub-checkpoint jen pro dospělé.
      if (p.group === '31–40') {
        await prisma.categoryCheckpoint.create({
          data: { categoryId: category.id, checkpointId: hill.id },
        });
      } else {
        await prisma.categoryCheckpoint.deleteMany({
          where: { categoryId: all[0]!.id, checkpointId: hill.id },
        });
      }
      const startAt = Date.now() - p.startMinAgo * 60_000;

      for (let i = 0; i < p.count; i++) {
        n++;
        const participant = await prisma.participant.create({
          data: {
            raceId: race.id,
            categoryId: category.id,
            bib: i + 1,
            firstName: FIRST[p.gender][(n * 3) % FIRST[p.gender].length]!,
            lastName: LAST[p.gender][(n * 5) % LAST[p.gender].length]!,
            birthYear: year - (p.group === '9–10' ? 9 : 35),
            gender: p.gender,
            locality: 'local',
            status: i === p.count - 1 ? 'absent' : 'checked_in',
            registrationSource: 'manual',
          },
        });
        if (participant.status === 'absent') continue;

        // Časy úseků (s) — dospělí ~ 8 + 35 + 20 min, děti kratší trať.
        const legs = [480, 2100, 1200].map((s) => s * p.pace * (0.85 + rand() * 0.35));
        const marks = [
          { cp: cps[0]!.id, t: 0 },
          { cp: cps[1]!.id, t: legs[0]! },
          ...(p.group === '31–40' ? [{ cp: hill.id, t: legs[0]! + legs[1]! * 0.55 }] : []),
          { cp: endBike.id, t: legs[0]! + legs[1]! },
          { cp: cps.at(-1)!.id, t: legs[0]! + legs[1]! + legs[2]! },
        ];
        // Remíza: první dva muži 31–40 doběhnou ve stejné sekundě.
        if (p.group === '31–40' && p.gender === 'male' && i < 2) {
          marks.at(-1)!.t = 3500 + i * 0.4;
        }
        let ord = 0;
        for (const m of marks) {
          const ts = new Date(startAt + m.t * 1000);
          if (ts.getTime() > Date.now()) break; // ještě nedorazil
          ord++;
          await prisma.timeEvent.create({
            data: {
              id: crypto.randomUUID(),
              type: 'record',
              participantId: participant.id,
              checkpointId: m.cp,
              ts,
              userId: admin.id,
              deviceId: 'demo',
              serverReceivedAt: new Date(ts.getTime() + 2000 + ord),
            },
          });
        }
      }
      // Hromadný start kategorie = čas startu u všech přítomných (už zapsán výše).
    }

    // Konflikt: druhý záznam téhož závodníka na konci plavání od jiného zařízení.
    const someone = await prisma.timeEvent.findFirstOrThrow({
      where: { checkpointId: cps[1]!.id, participant: { raceId: race.id } },
    });
    await prisma.timeEvent.create({
      data: {
        id: crypto.randomUUID(),
        type: 'record',
        participantId: someone.participantId,
        checkpointId: someone.checkpointId,
        ts: new Date(someone.ts.getTime() + 3000),
        userId: admin.id,
        deviceId: 'demo-2',
      },
    });
    await prisma.timeEvent.create({
      data: {
        id: crypto.randomUUID(),
        type: 'note',
        participantId: someone.participantId,
        checkpointId: someone.checkpointId,
        ts: someone.ts,
        note: 'Ztratil plavecké brýle, pomáhali jsme mu.',
        userId: admin.id,
        deviceId: 'demo',
      },
    });

    console.log(`Vytvořen „${NAME}“ (${date}) s ${n} závodníky a simulovanými časy.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
