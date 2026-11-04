/** Integrační testy administrace (F1): závody, checkpointy, kategorie, závodníci, import, uživatelé. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { CategoryDto, RaceDetailDto } from '@triatlon/shared';
import { createTestApp, type TestApp } from './test-utils';

let t: TestApp;
let admin: string;
let organizer: { id: string; token: string };
let race: RaceDetailDto;
const raceName = `Test závod ${crypto.randomUUID().slice(0, 8)}`;

const ageGroups = [
  { label: '6–8', minAge: 6, maxAge: 8 },
  { label: '31–40', minAge: 31, maxAge: 40 },
];

function category(gender: string, locality: string, group = '31–40'): CategoryDto {
  return race.categories.find(
    (c) => c.ageGroupLabel === group && c.gender === gender && c.locality === locality,
  )!;
}

describe('administrace', () => {
  before(async () => {
    t = await createTestApp();
    admin = (await t.login('admin')).token;
    organizer = await t.login('organizer');
  });

  after(async () => {
    if (race) {
      await t.prisma.participant.deleteMany({ where: { raceId: race.id } });
      await t.prisma.race.deleteMany({ where: { id: race.id } });
    }
    await t.close();
  });

  it('organizátor nemůže zakládat závody', async () => {
    const res = await t.request(
      'POST',
      '/races',
      { name: raceName, date: '2027-07-17', ageGroups },
      organizer.token,
    );
    assert.equal(res.status, 403);
  });

  it('admin založí závod s výchozími checkpointy a kategoriemi', async () => {
    const res = await t.request(
      'POST',
      '/races',
      { name: raceName, date: '2027-07-17', ageGroups },
      admin,
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    race = res.body;
    assert.equal(race.year, 2027);
    assert.deepEqual(
      race.checkpoints.map((c) => c.name),
      ['Start', 'Konec plavání', 'Konec kola', 'Cíl'],
    );
    assert.equal(race.categories.length, 2 * 2 * 2);
    assert.deepEqual(
      { from: category('male', 'guest').birthYearFrom, to: category('male', 'guest').birthYearTo },
      { from: 1987, to: 1996 },
    );
    assert.ok(race.categories.every((c) => c.checkpointIds.length === 4));

    const dup = await t.request(
      'POST',
      '/races',
      { name: raceName, date: '2027-01-01', ageGroups },
      admin,
    );
    assert.equal(dup.status, 409);
  });

  it('odmítne překrývající se věkové skupiny', async () => {
    const res = await t.request(
      'PATCH',
      `/races/${race.id}`,
      {
        ageGroups: [
          { label: 'a', minAge: 6, maxAge: 8 },
          { label: 'b', minAge: 8, maxAge: 10 },
        ],
      },
      admin,
    );
    assert.equal(res.status, 400);
  });

  it('checkpoint: přidání, přejmenování, přeřazení, smazání', async () => {
    const added = await t.request(
      'POST',
      `/races/${race.id}/checkpoints`,
      { name: 'Otočka', disciplineId: null },
      admin,
    );
    assert.equal(added.status, 201);
    assert.equal(added.body.seq, 5);

    const ids = race.checkpoints.map((c) => c.id);
    ids.splice(2, 0, added.body.id);
    const reordered = await t.request(
      'PUT',
      `/races/${race.id}/checkpoints/order`,
      { checkpointIds: ids },
      admin,
    );
    assert.equal(reordered.status, 200);
    assert.deepEqual(
      reordered.body.map((c: { name: string }) => c.name),
      ['Start', 'Konec plavání', 'Otočka', 'Konec kola', 'Cíl'],
    );

    const removed = await t.request(
      'DELETE',
      `/races/${race.id}/checkpoints/${added.body.id}`,
      undefined,
      admin,
    );
    assert.equal(removed.status, 204);
    const detail = await t.request('GET', `/races/${race.id}`, undefined, admin);
    assert.deepEqual(
      detail.body.checkpoints.map((c: { seq: number }) => c.seq),
      [1, 2, 3, 4],
    );
  });

  it('kategorie: délky tratí a mapování checkpointů', async () => {
    const cat = category('female', 'local', '6–8');
    const cps = race.checkpoints.map((c) => c.id);
    const res = await t.request(
      'PATCH',
      `/races/${race.id}/categories/${cat.id}`,
      { distances: { swim: 50, bike: 2000, run: 500 }, checkpointIds: [cps[0], cps[3]] },
      admin,
    );
    assert.equal(res.status, 204);
    const detail: RaceDetailDto = (await t.request('GET', `/races/${race.id}`, undefined, admin))
      .body;
    const updated = detail.categories.find((c) => c.id === cat.id)!;
    assert.deepEqual(updated.distances, { swim: 50, bike: 2000, run: 500 });
    assert.deepEqual(new Set(updated.checkpointIds), new Set([cps[0], cps[3]]));
  });

  it('závodník: automatické zařazení do kategorie a přidělení čísla', async () => {
    const p = {
      firstName: 'Jan',
      lastName: 'Novák',
      birthYear: 1990,
      gender: 'male',
      locality: 'guest',
    };
    const first = await t.request('POST', `/races/${race.id}/participants`, p, admin);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.categoryId, category('male', 'guest').id);
    assert.equal(first.body.bib, 1);

    const second = await t.request(
      'POST',
      `/races/${race.id}/participants`,
      { ...p, firstName: 'Petr' },
      admin,
    );
    assert.equal(second.body.bib, 2);

    // Stejné číslo v jiné kategorii je v pořádku, ve stejné ne.
    const otherCat = await t.request(
      'POST',
      `/races/${race.id}/participants`,
      { ...p, firstName: 'Eva', gender: 'female', bib: 1 },
      admin,
    );
    assert.equal(otherCat.status, 201);
    const clash = await t.request(
      'POST',
      `/races/${race.id}/participants`,
      { ...p, firstName: 'Karel', bib: 2 },
      admin,
    );
    assert.equal(clash.status, 409);

    const tooOld = await t.request(
      'POST',
      `/races/${race.id}/participants`,
      { ...p, birthYear: 1950 },
      admin,
    );
    assert.equal(tooOld.status, 422);
  });

  it('změna ročníku a věkových skupin po registraci', async () => {
    const res = await t.request(
      'PATCH',
      `/races/${race.id}`,
      { ageGroups: [{ label: 'x', minAge: 0, maxAge: null }] },
      admin,
    );
    assert.equal(res.status, 409);
  });

  it('import: náhled s chybami, nic se neuloží', async () => {
    const rows = [
      { jméno: 'Ája', příjmení: 'Malá', ročník: '2020', pohlaví: 'Ž', lokalita: 'místní' },
      {
        jméno: 'Bob',
        příjmení: 'Velký',
        ročník: '1990',
        pohlaví: 'M',
        lokalita: 'host',
        číslo: '1',
      },
      { jméno: 'Cyril', příjmení: 'Starý', ročník: '1940', pohlaví: 'M', lokalita: 'host' },
    ];
    const preview = await t.request(
      'POST',
      `/races/${race.id}/participants/import/preview`,
      { rows },
      admin,
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.ok, false);
    assert.deepEqual(preview.body.rows[0].errors, []);
    assert.match(preview.body.rows[1].errors[0], /obsazené/);
    assert.match(preview.body.rows[2].errors[0], /nespadá do žádné věkové skupiny/);

    const commit = await t.request(
      'POST',
      `/races/${race.id}/participants/import`,
      { rows },
      admin,
    );
    assert.equal(commit.status, 422);
    const count = await t.prisma.participant.count({ where: { raceId: race.id } });
    assert.equal(count, 3);
  });

  it('import: všechny řádky v pořádku → uloží se s dalšími volnými čísly', async () => {
    const rows = [
      { jmeno: 'Dan', prijmeni: 'Rychlý', rocnik: 1988, pohlavi: 'muž', lokalita: 'host' },
      {
        jmeno: 'Ema',
        prijmeni: 'Hbitá',
        rocnik: 2019,
        pohlavi: 'žena',
        lokalita: 'místní',
        cislo: 7,
      },
    ];
    const res = await t.request('POST', `/races/${race.id}/participants/import`, { rows }, admin);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.imported, 2);
    assert.equal(res.body.rows[0].participant.bib, 3);
    assert.equal(res.body.rows[1].participant.bib, 7);

    const list = await t.request('GET', `/races/${race.id}/participants`, undefined, admin);
    assert.equal(list.body.length, 5);
    assert.ok(
      list.body.some((p: { registrationSource: string }) => p.registrationSource === 'import'),
    );

    const again = await t.request(
      'POST',
      `/races/${race.id}/participants/import/preview`,
      { rows },
      admin,
    );
    assert.match(again.body.rows[0].errors[0], /už je zaregistrován/);
  });

  it('přiřazení organizátora ke checkpointu zpřístupní závod', async () => {
    assert.equal(
      (await t.request('GET', `/races/${race.id}`, undefined, organizer.token)).status,
      403,
    );
    assert.equal((await t.request('GET', '/races', undefined, organizer.token)).body.length, 0);

    const start = race.checkpoints[0]!.id;
    const res = await t.request(
      'PUT',
      `/races/${race.id}/assignments/${organizer.id}`,
      { checkpointIds: [start] },
      admin,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [{ userId: organizer.id, checkpointId: start }]);

    assert.equal(
      (await t.request('GET', `/races/${race.id}`, undefined, organizer.token)).status,
      200,
    );
    const list = await t.request('GET', '/races', undefined, organizer.token);
    assert.deepEqual(
      list.body.map((r: { id: string }) => r.id),
      [race.id],
    );
    // Organizátor ale nesmí měnit data.
    assert.equal(
      (await t.request('POST', `/races/${race.id}/participants`, {}, organizer.token)).status,
      403,
    );
  });

  it('uživatelé: pozvánka, deaktivace zneplatní session, vlastní účet chráněn', async () => {
    const email = `pozvany-${crypto.randomUUID()}@example.com`;
    const created = await t.request(
      'POST',
      '/users',
      { email, name: 'Pozvaný', role: 'organizer' },
      admin,
    );
    assert.equal(created.status, 201);
    assert.equal(t.outbox.at(-1)?.to, email);
    assert.equal(
      (await t.request('POST', '/users', { email, name: 'X', role: 'organizer' }, admin)).status,
      409,
    );

    const deactivated = await t.request(
      'PATCH',
      `/users/${organizer.id}`,
      { active: false },
      admin,
    );
    assert.equal(deactivated.status, 200);
    const sessions = await t.prisma.session.count({
      where: { userId: organizer.id, revokedAt: null },
    });
    assert.equal(sessions, 0);

    const me = (await t.request('GET', '/auth/me', undefined, admin)).body;
    assert.equal(
      (await t.request('PATCH', `/users/${me.id}`, { active: false }, admin)).status,
      400,
    );

    await t.prisma.user.delete({ where: { id: created.body.id } });
  });

  it('změny se zapisují do auditu', async () => {
    const entries = await t.prisma.auditLog.findMany({ where: { entityId: race.id } });
    assert.ok(entries.some((e) => e.action === 'create' && e.entity === 'race'));
    assert.ok(entries.some((e) => e.action === 'import'));
  });
});
