/** Integrační testy: výchozí kategorie Vlkančic (skupiny podle pohlaví, volitelné Super ženy). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_AGE_GROUPS, type RaceDetailDto } from '@triatlon/shared';
import { createTestApp, type TestApp } from './test-utils';

let t: TestApp;
let admin: string;
let race: RaceDetailDto;

describe('výchozí kategorie a volitelná kategorie', () => {
  before(async () => {
    t = await createTestApp();
    admin = (await t.login('admin')).token;
    race = (
      await t.request(
        'POST',
        '/races',
        {
          name: `Test kategorie ${crypto.randomUUID().slice(0, 8)}`,
          date: '2027-08-07',
          ageGroups: DEFAULT_AGE_GROUPS,
        },
        admin,
      )
    ).body;
  });

  after(async () => {
    await t.prisma.participant.deleteMany({ where: { raceId: race.id } });
    await t.prisma.race.deleteMany({ where: { id: race.id } });
    await t.close();
  });

  it('kategorie: děti dívky / hoši, dospělí jen pro své pohlaví, s délkami tratí', () => {
    const names = race.categories.map((c) => c.name);
    // 6 dětských skupin × 2 pohlaví × 2 lokality + 4 dospělé skupiny × 2 lokality.
    assert.equal(names.length, 6 * 4 + 4 * 2);
    assert.ok(names.includes('6–8 hoši místní'));
    assert.ok(names.includes('Super ženy hosté'));
    assert.ok(
      !race.categories.some((c) => c.ageGroupLabel === 'Super ženy' && c.gender === 'male'),
    );
    const superZeny = race.categories.find((c) => c.name === 'Super ženy místní')!;
    assert.equal(superZeny.elective, true);
    assert.equal(superZeny.groupName, 'Super ženy');
    assert.deepEqual(superZeny.distances, { swim: 400, bike: 12000, run: 4000 });
    assert.equal(names[0], '0–5 dívky místní', 'pořadí podle věkových skupin');
  });

  it('Super ženy jen volbou; volba vydrží úpravu, null vrátí kategorii podle věku', async () => {
    const path = `/races/${race.id}/participants`;
    const base = {
      firstName: 'Eva',
      lastName: 'Rychlá',
      birthYear: 1990,
      gender: 'female',
      locality: 'local',
    };
    const name = (id: string) => race.categories.find((c) => c.id === id)?.name;

    const auto = (await t.request('POST', path, base, admin)).body;
    assert.equal(name(auto.categoryId), 'Ženy místní');

    const chosen = (
      await t.request(
        'POST',
        path,
        { ...base, firstName: 'Iva', bib: 2, electiveGroup: 'Super ženy' },
        admin,
      )
    ).body;
    assert.equal(name(chosen.categoryId), 'Super ženy místní');

    const kept = (
      await t.request('PATCH', `${path}/${chosen.id}`, { lastName: 'Rychlejší' }, admin)
    ).body;
    assert.equal(name(kept.categoryId), 'Super ženy místní');

    const back = (await t.request('PATCH', `${path}/${chosen.id}`, { electiveGroup: null }, admin))
      .body;
    assert.equal(name(back.categoryId), 'Ženy místní');

    const man = await t.request(
      'POST',
      path,
      { ...base, firstName: 'Petr', gender: 'male', electiveGroup: 'Super ženy' },
      admin,
    );
    assert.equal(man.status, 422);
    assert.match(man.body.message, /není určená pro muže/);
  });
});
