/** Integrační testy F2: zápis časů (idempotence, oprávnění), výsledky, korekce, remízy, živý kanál. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type {
  CategoryResultsDto,
  RaceDetailDto,
  RaceResultsDto,
  TimeEventInput,
  TimeEventResult,
} from '@triatlon/shared';
import { createTestApp, type TestApp } from './test-utils';

let t: TestApp;
let admin: string;
let org: { id: string; token: string };
let race: RaceDetailDto;
const P: Record<string, string> = {};
const cp: Record<string, string> = {};
let categoryId: string;

const T0 = Date.parse('2026-07-17T08:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

function event(
  type: TimeEventInput['type'],
  who: string,
  checkpoint: string,
  sec: number,
  extra: Partial<TimeEventInput> = {},
): TimeEventInput {
  return {
    id: crypto.randomUUID(),
    type,
    participantId: P[who]!,
    checkpointId: cp[checkpoint]!,
    ts: at(sec),
    deviceId: 'test-device',
    ...extra,
  };
}

async function send(token: string, events: TimeEventInput[]): Promise<TimeEventResult[]> {
  const res = await t.request('POST', `/races/${race.id}/time-events`, { events }, token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function results(): Promise<CategoryResultsDto> {
  const res = await t.request(
    'GET',
    `/races/${race.id}/results?categoryId=${categoryId}`,
    undefined,
    admin,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body as RaceResultsDto).categories[0]!;
}

describe('výsledky a zápis časů', () => {
  before(async () => {
    t = await createTestApp();
    admin = (await t.login('admin')).token;
    org = await t.login('organizer');
    const created = await t.request(
      'POST',
      '/races',
      {
        name: `Test výsledky ${crypto.randomUUID().slice(0, 8)}`,
        date: '2026-07-17',
        ageGroups: [{ label: '31–40', minAge: 31, maxAge: 40 }],
      },
      admin,
    );
    race = created.body;
    for (const c of race.checkpoints) cp[c.name] = c.id;
    for (const name of ['a', 'b', 'c', 'd']) {
      const res = await t.request(
        'POST',
        `/races/${race.id}/participants`,
        { firstName: name, lastName: 'Test', birthYear: 1990, gender: 'male', locality: 'guest' },
        admin,
      );
      P[name] = res.body.id;
      categoryId = res.body.categoryId;
    }
    await t.request('PATCH', `/races/${race.id}/participants/${P.d}`, { status: 'absent' }, admin);
    await t.request(
      'PUT',
      `/races/${race.id}/assignments/${org.id}`,
      { checkpointIds: [cp.Start, cp['Cíl']] },
      admin,
    );
  });

  after(async () => {
    await t.prisma.timeEvent.deleteMany({ where: { participant: { raceId: race.id } } });
    await t.prisma.participant.deleteMany({ where: { raceId: race.id } });
    await t.prisma.race.delete({ where: { id: race.id } });
    await t.close();
  });

  it('hromadný start: dávka je idempotentní (opakované odeslání = duplicate)', async () => {
    const batch = ['a', 'b', 'c'].map((p) => event('record', p, 'Start', 0));
    const first = await send(org.token, batch);
    assert.deepEqual(
      first.map((r) => r.status),
      ['accepted', 'accepted', 'accepted'],
    );
    const again = await send(org.token, batch);
    assert.deepEqual(
      again.map((r) => r.status),
      ['duplicate', 'duplicate', 'duplicate'],
    );
    assert.equal(
      await t.prisma.timeEvent.count({ where: { participant: { raceId: race.id } } }),
      3,
    );
  });

  it('odmítne nepřiřazený checkpoint, nepřítomného závodníka a čas v budoucnosti', async () => {
    const [notAssigned, absent, future] = await send(org.token, [
      event('record', 'a', 'Konec plavání', 300),
      event('record', 'd', 'Cíl', 300),
      { ...event('record', 'a', 'Cíl', 0), ts: new Date(Date.now() + 3_600_000).toISOString() },
    ]);
    assert.match(notAssigned!.reason!, /nejste přiřazen/);
    assert.match(absent!.reason!, /nepřítomný/);
    assert.match(future!.reason!, /budoucnosti/);
  });

  it('vrácení akce: organizátor smí jen svůj záznam, i v rámci jedné offline dávky', async () => {
    const rec = event('record', 'a', 'Cíl', 1999);
    const undo = event('cancel', 'a', 'Cíl', 2000, { refEventId: rec.id });
    assert.deepEqual(
      (await send(org.token, [rec, undo])).map((r) => r.status),
      ['accepted', 'accepted'],
    );

    const adminRec = event('record', 'b', 'Cíl', 2400);
    await send(admin, [adminRec]);
    const [foreign] = await send(org.token, [
      event('cancel', 'b', 'Cíl', 2401, { refEventId: adminRec.id }),
    ]);
    assert.equal(foreign!.status, 'rejected');
    assert.match(foreign!.reason!, /jiného organizátora/);
  });

  it('výsledky: dokončení, průběžné pořadí, remíza a ruční určení pořadí', async () => {
    await send(admin, [
      event('record', 'a', 'Konec plavání', 300),
      event('record', 'a', 'Konec kola', 1500),
      event('record', 'a', 'Cíl', 2400.3),
      event('record', 'b', 'Konec plavání', 290),
      event('record', 'b', 'Konec kola', 1450),
      event('record', 'c', 'Konec plavání', 310),
      event('note', 'c', 'Konec plavání', 311, { note: 'křeč v lýtku' }),
    ]);
    let r = await results();
    assert.deepEqual(r.counts, {
      registered: 4,
      absent: 1,
      started: 3,
      finished: 2,
      disqualified: 0,
    });
    assert.deepEqual(
      r.rows.map((x) => [x.firstName, x.rank, x.tied, x.state]),
      [
        ['a', 1, true, 'finished'],
        ['b', 1, true, 'finished'],
        ['c', 3, false, 'racing'],
      ],
    );
    assert.equal(r.rows[0]!.totalMs, 2400_300);
    assert.deepEqual(
      r.rows[1]!.disciplines.map((d) => d.ms),
      [290_000, 1160_000, 950_000],
    );
    assert.equal(r.rows[2]!.notes[0]!.text, 'křeč v lýtku');

    // Organizátor remízu rozhodnout nesmí, admin ano (s důvodem).
    const url = `/races/${race.id}/categories/${categoryId}/ranking-overrides`;
    const body = { participantIds: [P.b, P.a], reason: 'cílová fotografie' };
    assert.equal((await t.request('POST', url, body, org.token)).status, 403);
    assert.equal((await t.request('POST', url, { ...body, reason: '' }, admin)).status, 400);
    assert.equal((await t.request('POST', url, body, admin)).status, 204);
    r = await results();
    assert.deepEqual(
      r.rows.slice(0, 2).map((x) => [x.firstName, x.rank, x.rankOverridden]),
      [
        ['b', 1, true],
        ['a', 2, true],
      ],
    );
    assert.equal(r.overrides[0]!.reason, 'cílová fotografie');
  });

  it('korekce času: jen admin a jen s důvodem; projeví se ve výsledcích a historii', async () => {
    const r = await results();
    const finishOfB = r.rows
      .find((x) => x.firstName === 'b')!
      .splits.find((s) => s.checkpointId === cp['Cíl'])!;
    const correction = (extra: Partial<TimeEventInput>) =>
      event('admin_correction', 'b', 'Cíl', 2450, { refEventId: finishOfB.recordId, ...extra });

    const [byOrg] = await send(org.token, [correction({ reason: 'x' })]);
    assert.equal(byOrg!.status, 'rejected');
    const [noReason] = await send(admin, [correction({})]);
    assert.match(noReason!.reason!, /důvod/);
    const [ok] = await send(admin, [correction({ reason: 'chybně kliknuto, ověřeno z videa' })]);
    assert.equal(ok!.status, 'accepted');

    const after = await results();
    const b = after.rows.find((x) => x.firstName === 'b')!;
    assert.equal(b.totalMs, 2450_000);
    assert.equal(b.splits.at(-1)!.corrected, true);
    // Remíza zmizela → ruční rozhodnutí se už neuplatní, pořadí je dané časy.
    assert.deepEqual(
      after.rows.slice(0, 2).map((x) => [x.firstName, x.rank]),
      [
        ['a', 1],
        ['b', 2],
      ],
    );

    const history = await t.request(
      'GET',
      `/races/${race.id}/participants/${P.b}/history`,
      undefined,
      admin,
    );
    assert.equal(history.status, 200);
    const last = history.body.at(-1);
    assert.equal(last.type, 'admin_correction');
    assert.equal(last.reason, 'chybně kliknuto, ověřeno z videa');
    assert.equal(last.deviceId, 'test-device');
  });

  it('živý kanál pošle zprávu po zápisu času', async () => {
    const controller = new AbortController();
    const res = await fetch(`${t.base}/races/${race.id}/stream`, {
      headers: { authorization: `Bearer ${org.token}` },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const received = (async () => {
      let text = '';
      while (!text.includes('categoryIds')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();
    await new Promise((r) => setTimeout(r, 50));
    await send(org.token, [event('record', 'c', 'Cíl', 2600)]);
    const text = await received;
    controller.abort();
    assert.match(text, /event: results/);
    assert.match(text, new RegExp(categoryId));
  });
});
