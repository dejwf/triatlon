/** Integrační testy: přehled závodu — heartbeat telefonů a poslední zásahy (audit). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { RaceDetailDto, RaceOverviewDto, TimeEventInput } from '@triatlon/shared';
import { createTestApp, type TestApp } from './test-utils';

let t: TestApp;
let admin: string;
let race: RaceDetailDto;

const record = (participantId: string, checkpointId: string, ts: string): TimeEventInput => ({
  id: crypto.randomUUID(),
  type: 'record',
  participantId,
  checkpointId,
  ts,
  deviceId: 'phone-1',
});

describe('přehled závodu', () => {
  before(async () => {
    t = await createTestApp();
    admin = (await t.login('admin')).token;
    race = (
      await t.request(
        'POST',
        '/races',
        {
          name: `Test přehled ${crypto.randomUUID().slice(0, 8)}`,
          date: '2026-07-17',
          ageGroups: [{ label: '31–40', minAge: 31, maxAge: 40 }],
        },
        admin,
      )
    ).body;
  });

  after(async () => {
    await t.prisma.timeEvent.deleteMany({ where: { participant: { raceId: race.id } } });
    await t.prisma.participant.deleteMany({ where: { raceId: race.id } });
    await t.prisma.race.deleteMany({ where: { id: race.id } });
    await t.close();
  });

  it('heartbeat, zařízení z přijatých akcí, hromadný start a korekce v auditu', async () => {
    const start = race.checkpoints[0]!.id;
    const finish = race.checkpoints.at(-1)!.id;
    const add = async (firstName: string) =>
      (
        await t.request(
          'POST',
          `/races/${race.id}/participants`,
          { firstName, lastName: 'Test', birthYear: 1990, gender: 'male', locality: 'local' },
          admin,
        )
      ).body as { id: string; bib: number };
    const a = await add('Adam');
    const b = await add('Bedřich');

    const hb = await t.request(
      'POST',
      `/races/${race.id}/devices/heartbeat`,
      {
        deviceId: 'phone-1',
        checkpointId: finish,
        clockOffsetMs: 400,
        clockCheckedAt: '2026-07-17T08:00:00.000Z',
        pending: 3,
        oldestPendingAt: '2026-07-17T08:05:00.000Z',
        appVersion: '1.0.0',
      },
      admin,
    );
    assert.equal(hb.status, 204);
    const bad = await t.request(
      'POST',
      `/races/${race.id}/devices/heartbeat`,
      { deviceId: 'phone-1', pending: -1 },
      admin,
    );
    assert.equal(bad.status, 400);

    const ts = '2026-07-17T08:00:00.000Z';
    const finishRec = record(a.id, finish, '2026-07-17T08:40:00.000Z');
    await t.request(
      'POST',
      `/races/${race.id}/time-events`,
      {
        events: [
          record(a.id, start, ts),
          record(b.id, start, ts),
          finishRec,
          {
            ...record(b.id, start, ts),
            deviceId: 'web-admin',
            type: 'admin_correction',
            refEventId: finishRec.id,
            checkpointId: finish,
            participantId: a.id,
            ts: '2026-07-17T08:39:58.000Z',
            reason: 'Video z cíle',
          },
        ],
      },
      admin,
    );

    const res = await t.request('GET', `/races/${race.id}/overview`, undefined, admin);
    assert.equal(res.status, 200);
    const o = res.body as RaceOverviewDto;
    const phone = o.devices.find((d) => d.deviceId === 'phone-1')!;
    assert.equal(phone.checkpoint?.id, finish);
    assert.equal(phone.clockOffsetMs, 400);
    assert.equal(phone.pending, 3);
    assert.ok(phone.lastSeenAt && phone.lastEventAt);
    const web = o.devices.find((d) => d.deviceId === 'web-admin')!;
    assert.equal(web.lastSeenAt, null, 'zařízení bez heartbeatu jen z přijatých akcí');

    const kinds = o.audit.map((i) => i.kind);
    assert.ok(kinds.includes('mass_start'));
    assert.ok(kinds.includes('registration'));
    const correction = o.audit.find((i) => i.kind === 'correction')!;
    assert.equal(correction.reason, 'Video z cíle');
    assert.match(correction.text, new RegExp(`č\\. ${a.bib} .*→`));
    assert.match(o.audit.find((i) => i.kind === 'mass_start')!.text, /2 závodníků/);
  });

  it('organizátor bez přiřazení přehled nevidí', async () => {
    const org = (await t.login('organizer')).token;
    const res = await t.request('GET', `/races/${race.id}/overview`, undefined, org);
    assert.equal(res.status, 403);
  });
});
