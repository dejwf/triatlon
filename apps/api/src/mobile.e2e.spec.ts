/** Integrační testy F3: rozhraní pro mobilní appku — přiřazené checkpointy, check-in, registrace na místě, log akcí. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { OnSiteRegistrationResult, RaceDetailDto, ResultEvent } from '@triatlon/shared';
import { createTestApp, type TestApp } from './test-utils';

let t: TestApp;
let admin: string;
let starter: { id: string; token: string };
let finisher: { id: string; token: string };
let race: RaceDetailDto;
let start: string;
let finish: string;
let participantId: string;

const person = {
  firstName: 'Karel',
  lastName: 'Místní',
  birthYear: 1990,
  gender: 'male',
  locality: 'local',
};

describe('mobilní appka', () => {
  before(async () => {
    t = await createTestApp();
    admin = (await t.login('admin')).token;
    starter = await t.login('organizer');
    finisher = await t.login('organizer');
    race = (
      await t.request(
        'POST',
        '/races',
        {
          name: `Test mobil ${crypto.randomUUID().slice(0, 8)}`,
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
      `/races/${race.id}/assignments/${starter.id}`,
      { checkpointIds: [start] },
      admin,
    );
    await t.request(
      'PUT',
      `/races/${race.id}/assignments/${finisher.id}`,
      { checkpointIds: [finish] },
      admin,
    );
    participantId = (
      await t.request('POST', `/races/${race.id}/participants`, { ...person, bib: 1 }, admin)
    ).body.id;
  });

  after(async () => {
    await t.request('DELETE', `/races/${race.id}`, undefined, admin).catch(() => undefined);
    await t.prisma.timeEvent.deleteMany({ where: { participant: { raceId: race.id } } });
    await t.prisma.participant.deleteMany({ where: { raceId: race.id } });
    await t.prisma.race.deleteMany({ where: { id: race.id } });
    await t.close();
  });

  it('detail závodu nese checkpointy, na které smí uživatel zapisovat', async () => {
    const mine = await t.request('GET', `/races/${race.id}`, undefined, finisher.token);
    assert.deepEqual(mine.body.myCheckpointIds, [finish]);
    const all = await t.request('GET', `/races/${race.id}`, undefined, admin);
    assert.equal(all.body.myCheckpointIds.length, race.checkpoints.length);
  });

  it('check-in smí jen organizátor startu', async () => {
    const path = `/races/${race.id}/participants/${participantId}/status`;
    const denied = await t.request('POST', path, { status: 'absent' }, finisher.token);
    assert.equal(denied.status, 403);
    const ok = await t.request('POST', path, { status: 'absent' }, starter.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'absent');
    // Opakované odeslání z fronty je neškodné.
    const again = await t.request('POST', path, { status: 'absent' }, starter.token);
    assert.equal(again.body.status, 'absent');
    const back = await t.request('POST', path, { status: 'checked_in' }, starter.token);
    assert.equal(back.body.status, 'checked_in');
  });

  it('registrace na místě je idempotentní a obsazené číslo nahradí volným', async () => {
    const id = crypto.randomUUID();
    const body = { ...person, firstName: 'Nový', id, bib: 1 };
    const path = `/races/${race.id}/participants/on-site`;
    const first = await t.request('POST', path, body, starter.token);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const r = first.body as OnSiteRegistrationResult;
    assert.equal(r.participant.id, id);
    assert.equal(r.participant.bib, 2);
    assert.equal(r.bibChanged, true);
    assert.equal(r.participant.status, 'checked_in');
    assert.equal(r.participant.registrationSource, 'on_site');

    const replay = await t.request('POST', path, body, starter.token);
    assert.equal(replay.body.participant.id, id);
    assert.equal(
      await t.prisma.participant.count({ where: { raceId: race.id, firstName: 'Nový' } }),
      1,
    );

    const denied = await t.request(
      'POST',
      path,
      { ...body, id: crypto.randomUUID() },
      finisher.token,
    );
    assert.equal(denied.status, 403);
  });

  it('log akcí checkpointu vrací záznamy všech zařízení', async () => {
    const ev = {
      id: crypto.randomUUID(),
      type: 'record',
      participantId,
      checkpointId: start,
      ts: new Date().toISOString(),
      deviceId: 'phone-1',
    };
    const sent = await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      { events: [ev] },
      starter.token,
    );
    assert.equal(sent.body[0].status, 'accepted');
    const res = await t.request(
      'GET',
      `/races/${race.id}/time-events?checkpointId=${start}`,
      undefined,
      finisher.token,
    );
    assert.equal(res.status, 200);
    const events = res.body as ResultEvent[];
    assert.deepEqual(
      events.map((e) => e.id),
      [ev.id],
    );
    assert.equal(events[0]!.userId, starter.id);
    const other = await t.request(
      'GET',
      `/races/${race.id}/time-events?checkpointId=${finish}`,
      undefined,
      finisher.token,
    );
    assert.deepEqual(other.body, []);
  });
});
