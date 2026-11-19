/** Integrační testy F4: ředitel závodu a uzavření kategorie, veřejná tabule, GDPR. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type {
  PublicRaceResultsDto,
  RaceDetailDto,
  RaceResultsDto,
  TimeEventInput,
} from '@triatlon/shared';
import { createTestApp, type TestApp } from './test-utils';

let t: TestApp;
let admin: string;
let director: { id: string; token: string };
let finisher: { id: string; token: string };
let race: RaceDetailDto;
let start: string;
let finish: string;
let categoryId: string;
const ids: Record<string, string> = {};

const person = (firstName: string, bib: number) => ({
  firstName,
  lastName: 'Testovací',
  birthYear: 1990,
  gender: 'male',
  locality: 'local',
  bib,
});

const record = (participantId: string, checkpointId: string, ts: string): TimeEventInput => ({
  id: crypto.randomUUID(),
  type: 'record',
  participantId,
  checkpointId,
  ts,
  deviceId: 'test',
});

describe('F4: uzavření kategorie, veřejná tabule, GDPR', () => {
  before(async () => {
    t = await createTestApp();
    admin = (await t.login('admin')).token;
    director = await t.login('organizer');
    finisher = await t.login('organizer');
    race = (
      await t.request(
        'POST',
        '/races',
        {
          name: `Test F4 ${crypto.randomUUID().slice(0, 8)}`,
          date: '2026-07-17',
          ageGroups: [{ label: '31–40', minAge: 31, maxAge: 40 }],
        },
        admin,
      )
    ).body;
    start = race.checkpoints[0]!.id;
    finish = race.checkpoints.at(-1)!.id;
    await t.request(
      'PUT',
      `/races/${race.id}/assignments/${finisher.id}`,
      { checkpointIds: [start, finish] },
      admin,
    );
    for (const [name, bib] of [
      ['Hotový', 1],
      ['Natrati', 2],
      ['Skrytý', 3],
    ] as const) {
      const res = await t.request(
        'POST',
        `/races/${race.id}/participants`,
        { ...person(name, bib), publicName: name !== 'Skrytý' },
        admin,
      );
      ids[name] = res.body.id;
      categoryId = res.body.categoryId;
    }
    const events = [
      record(ids['Hotový']!, start, '2026-07-17T08:00:00.000Z'),
      record(ids['Natrati']!, start, '2026-07-17T08:00:00.000Z'),
      record(ids['Skrytý']!, start, '2026-07-17T08:00:00.000Z'),
      record(ids['Hotový']!, finish, '2026-07-17T08:40:00.000Z'),
      record(ids['Skrytý']!, finish, '2026-07-17T08:45:00.000Z'),
    ];
    const res = await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      { events },
      finisher.token,
    );
    assert.ok(res.body.every((r: { status: string }) => r.status === 'accepted'));
  });

  after(async () => {
    await t.prisma.timeEvent.deleteMany({ where: { participant: { raceId: race.id } } });
    await t.prisma.participant.deleteMany({ where: { raceId: race.id } });
    await t.prisma.race.deleteMany({ where: { id: race.id } });
    await t.close();
  });

  it('ředitele určuje admin; ředitel vidí závod i bez checkpointu', async () => {
    const before = await t.request('GET', `/races/${race.id}`, undefined, director.token);
    assert.equal(before.status, 403);

    const set = await t.request(
      'PUT',
      `/races/${race.id}/directors/${director.id}`,
      { director: true },
      admin,
    );
    assert.deepEqual(set.body, [director.id]);
    const denied = await t.request(
      'PUT',
      `/races/${race.id}/directors/${finisher.id}`,
      { director: true },
      director.token,
    );
    assert.equal(denied.status, 403);

    const detail = await t.request('GET', `/races/${race.id}`, undefined, director.token);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.isDirector, true);
    const other = await t.request('GET', `/races/${race.id}`, undefined, finisher.token);
    assert.equal(other.body.isDirector, false);
  });

  it('uzavřít kategorii smí jen ředitel; kdo je na trati, je DNF; zápisy organizátorů se odmítnou', async () => {
    const path = `/races/${race.id}/categories/${categoryId}`;
    const empty = race.categories.find((c) => c.id !== categoryId)!;
    const notStarted = await t.request(
      'POST',
      `/races/${race.id}/categories/${empty.id}/close`,
      undefined,
      director.token,
    );
    assert.equal(notStarted.status, 409);
    assert.equal((await t.request('POST', `${path}/close`, undefined, finisher.token)).status, 403);
    assert.equal((await t.request('POST', `${path}/close`, undefined, director.token)).status, 204);
    assert.equal((await t.request('POST', `${path}/close`, undefined, director.token)).status, 409);

    const results: RaceResultsDto = (
      await t.request('GET', `/races/${race.id}/results?categoryId=${categoryId}`, undefined, admin)
    ).body;
    const cat = results.categories[0]!;
    assert.ok(cat.closedAt);
    assert.equal(cat.closedBy, director.id);
    assert.equal(cat.rows.find((r) => r.participantId === ids['Natrati'])!.state, 'dnf');
    assert.equal(cat.counts.dnf, 1);

    const late = await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      { events: [record(ids['Natrati']!, finish, '2026-07-17T09:00:00.000Z')] },
      finisher.token,
    );
    assert.equal(late.body[0].status, 'rejected');
    assert.match(late.body[0].reason, /uzavřená/);

    // Ostatní kategorie jsou prázdné, ale otevřené → závod ještě není dokončený.
    const detail: RaceDetailDto = (await t.request('GET', `/races/${race.id}`, undefined, admin))
      .body;
    assert.notEqual(detail.status, 'finished');
    assert.ok(detail.categories.find((c) => c.id === categoryId)!.closedAt);
  });

  it('znovuotevření vyžaduje důvod a vrátí závodníka na trať', async () => {
    const path = `/races/${race.id}/categories/${categoryId}/reopen`;
    assert.equal((await t.request('POST', path, {}, director.token)).status, 400);
    assert.equal(
      (await t.request('POST', path, { reason: 'Chybí čas z cíle' }, director.token)).status,
      204,
    );
    const results: RaceResultsDto = (
      await t.request('GET', `/races/${race.id}/results?categoryId=${categoryId}`, undefined, admin)
    ).body;
    assert.equal(results.categories[0]!.closedAt, null);
    assert.equal(
      results.categories[0]!.rows.find((r) => r.participantId === ids['Natrati'])!.state,
      'racing',
    );
  });

  it('veřejná tabule: bez přihlášení, jen po startu závodu, bez skrytých jmen a interních údajů', async () => {
    const path = `/public/races/${race.id}/results`;
    // První zapsaný čas (v before) přepnul plánovaný závod na „probíhá“ → je veřejný.
    const detail = await t.request('GET', `/races/${race.id}`, undefined, admin);
    assert.equal(detail.body.status, 'running');
    // Plánovaný závod veřejný není.
    await t.request('PATCH', `/races/${race.id}`, { status: 'planned' }, admin);
    assert.equal((await t.request('GET', path)).status, 404);
    await t.request('PATCH', `/races/${race.id}`, { status: 'running' }, admin);

    const list = await t.request('GET', '/public/races');
    assert.ok(list.body.some((r: { id: string }) => r.id === race.id));
    const res = await t.request('GET', path);
    assert.equal(res.status, 200);
    const board: PublicRaceResultsDto = res.body;
    const cat = board.categories.find((c) => c.id === categoryId)!;
    assert.equal(board.categories.length, 1, 'prázdné kategorie se nezobrazují');
    assert.deepEqual(
      cat.rows.map((r) => [r.bib, r.name, r.rank]),
      [
        [1, 'Hotový Testovací', 1],
        [3, null, 2],
        [2, 'Natrati Testovací', 3],
      ],
    );
    const json = JSON.stringify(board);
    for (const secret of ['1990', 'participantId', 'userId', 'Skrytý']) {
      assert.ok(!json.includes(secret), `veřejná data nesmí obsahovat ${secret}`);
    }
  });

  it('veřejná cache se po změně výsledků obnoví', async () => {
    const path = `/public/races/${race.id}/results`;
    await t.request('GET', path);
    await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      { events: [record(ids['Natrati']!, finish, '2026-07-17T08:50:00.000Z')] },
      finisher.token,
    );
    const board: PublicRaceResultsDto = (await t.request('GET', path)).body;
    const row = board.categories[0]!.rows.find((r) => r.bib === 2)!;
    assert.equal(row.state, 'finished');
  });

  it('veřejná tabule: domácí a hosté v jedné tabulce se společným pořadím a D/H', async () => {
    const res = await t.request(
      'POST',
      `/races/${race.id}/participants`,
      { ...person('Host', 1), locality: 'guest' },
      admin,
    );
    const guest = res.body;
    await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      {
        events: [
          record(guest.id, start, '2026-07-17T08:10:00.000Z'),
          record(guest.id, finish, '2026-07-17T08:45:00.000Z'), // 35 min = nejrychlejší
        ],
      },
      finisher.token,
    );
    const board: PublicRaceResultsDto = (await t.request('GET', `/public/races/${race.id}/results`))
      .body;
    assert.equal(board.categories.length, 2, 'kategorie zvlášť zůstávají k dispozici');
    assert.equal(board.groups.length, 1);
    const group = board.groups[0]!;
    assert.equal(group.name, '31–40 muži');
    assert.deepEqual(new Set(group.categoryIds), new Set([categoryId, guest.categoryId]));
    assert.deepEqual(
      group.rows.slice(0, 2).map((r) => [r.bib, r.locality, r.rank, r.categoryRank]),
      [
        [1, 'guest', 1, 1],
        [1, 'local', 2, 1],
      ],
    );
    // V kategorii domácích zůstává vlastní pořadí.
    const local = board.categories.find((c) => c.id === categoryId)!;
    assert.equal(local.rows[0]!.rank, 1);
    // Údaje pro vizualizace (pohled Domácí / Hosté, „právě v cíli“, vývoj pořadí).
    assert.equal(group.locality, null);
    assert.equal(local.locality, 'local');
    assert.equal(group.rows[0]!.startedAt, '2026-07-17T08:10:00.000Z');
    const transitions = board.checkpoints.filter((c) => c.kind === 'transition');
    assert.deepEqual([transitions[0]!.id, transitions.at(-1)!.id], [start, finish]);
  });

  it('přezdívka a oslovení: formální Jméno "Nick" Příjmení, neformální rozlišení při shodě', async () => {
    const add = async (body: Record<string, unknown>) =>
      (await t.request('POST', `/races/${race.id}/participants`, body, admin)).body;
    const formal = await add({ ...person('Jan', 20), lastName: 'Novák', nickname: 'Honza' });
    const local = await add({
      ...person('Jan', 21),
      lastName: 'Nosek',
      nickname: 'Honza',
      formal: false,
    });
    const guest = await add({
      ...person('Jan', 21),
      lastName: 'Nedoma',
      nickname: 'Honza',
      formal: false,
      locality: 'guest',
    });
    assert.equal(formal.formal, true);
    assert.equal(local.nickname, 'Honza');
    await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      {
        events: [formal, local, guest].map((p) => record(p.id, start, '2026-07-17T08:00:00.000Z')),
      },
      finisher.token,
    );
    const board: PublicRaceResultsDto = (await t.request('GET', `/public/races/${race.id}/results`))
      .body;
    const names = new Map(board.groups[0]!.rows.map((r) => [`${r.locality}-${r.bib}`, r.name]));
    assert.equal(names.get('local-20'), 'Jan "Honza" Novák');
    // Domácí a host se shodují ve společné tabulce → 2 písmena příjmení.
    assert.equal(names.get('local-21'), 'Honza No');
    assert.equal(names.get('guest-21'), 'Honza Ne');
    const results: RaceResultsDto = (
      await t.request('GET', `/races/${race.id}/results?categoryId=${categoryId}`, undefined, admin)
    ).body;
    assert.equal(
      results.categories[0]!.rows.find((r) => r.participantId === local.id)!.displayName,
      'Honza No',
      'i výsledky jedné kategorie rozlišují podle společné tabulky',
    );

    await t.request(
      'POST',
      `/races/${race.id}/participants/${local.id}/anonymize`,
      { reason: 'Žádost závodníka' },
      admin,
    );
    const stored = await t.prisma.participant.findUniqueOrThrow({ where: { id: local.id } });
    assert.equal(stored.nickname, null);
  });

  it('GDPR: export údajů a anonymizace (časy a pořadí zůstanou)', async () => {
    const id = ids['Hotový']!;
    const exp = await t.request(
      'GET',
      `/races/${race.id}/participants/${id}/export`,
      undefined,
      admin,
    );
    assert.equal(exp.body.participant.firstName, 'Hotový');
    assert.equal(exp.body.times.length, 2);
    assert.equal(
      (
        await t.request(
          'GET',
          `/races/${race.id}/participants/${id}/export`,
          undefined,
          finisher.token,
        )
      ).status,
      403,
    );

    const anon = await t.request(
      'POST',
      `/races/${race.id}/participants/${id}/anonymize`,
      { reason: 'Žádost závodníka' },
      admin,
    );
    assert.equal(anon.body.anonymized, true);
    assert.equal(anon.body.publicName, false);
    const audit = await t.prisma.auditLog.findMany({
      where: { entity: 'participant', entityId: id },
    });
    assert.ok(!JSON.stringify(audit).includes('Hotový'), 'audit nesmí držet původní jméno');

    const board: PublicRaceResultsDto = (await t.request('GET', `/public/races/${race.id}/results`))
      .body;
    const row = board.categories.find((c) => c.id === categoryId)!.rows.find((r) => r.bib === 1)!;
    assert.equal(row.name, null);
    assert.equal(row.rank, 1);
  });
});
