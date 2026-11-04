import { describe, expect, it } from 'vitest';
import type {
  CategoryDto,
  OnSiteRegistrationInput,
  ParticipantDto,
  RaceDetailDto,
  ResultEvent,
  TimeEventInput,
  TimeEventResult,
} from '@triatlon/shared';
import { estimateOffset } from './clock';
import { HttpError, syncOutbox, type OutboxItem, type Transport } from './outbox';
import {
  checkpointEntries,
  massStartEvents,
  nextFreeBib,
  startOverview,
  undoStartEvents,
  type RaceSnapshot,
} from './view';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const ME = 'user-me';
const OTHER = 'user-other';
const START = 'cp-start';
const FINISH = 'cp-finish';

function category(id: string, gender: 'male' | 'female'): CategoryDto {
  return {
    id,
    name: id,
    ageGroupLabel: '31–40',
    birthYearFrom: 1986,
    birthYearTo: 1995,
    gender,
    locality: 'local',
    distances: null,
    checkpointIds: [START, FINISH],
    participantCount: 0,
  };
}

function participant(
  id: string,
  categoryId: string,
  bib: number,
  status = 'checked_in',
): ParticipantDto {
  return {
    id,
    categoryId,
    bib,
    firstName: id,
    lastName: 'Test',
    birthYear: 1990,
    gender: categoryId === 'm' ? 'male' : 'female',
    locality: 'local',
    status: status as ParticipantDto['status'],
    registrationSource: 'manual',
  };
}

function snapshot(events: ResultEvent[] = []): RaceSnapshot {
  const race: RaceDetailDto = {
    id: 'race',
    name: 'Test',
    year: 2026,
    date: '2026-07-17',
    status: 'running',
    participantCount: 4,
    ageGroups: [{ label: '31–40', minAge: 31, maxAge: 40 }],
    disciplines: [],
    checkpoints: [
      { id: START, name: 'Start', seq: 1, kind: 'transition', disciplineId: null },
      { id: FINISH, name: 'Cíl', seq: 2, kind: 'transition', disciplineId: 'run' },
    ],
    categories: [category('m', 'male'), category('f', 'female')],
    myCheckpointIds: [START],
  };
  return {
    race,
    participants: [
      participant('m1', 'm', 1),
      participant('m2', 'm', 2),
      participant('m3', 'm', 3, 'absent'),
      participant('f1', 'f', 1),
    ],
    events,
    fetchedAt: '2026-07-17T07:00:00.000Z',
  };
}

function eventItem(event: TimeEventInput, state: OutboxItem['state'] = 'pending'): OutboxItem {
  return {
    id: event.id,
    raceId: 'race',
    userId: ME,
    createdAt: new Date().toISOString(),
    state,
    attempts: 0,
    kind: 'event',
    event,
  };
}

const record = (participantId: string, checkpointId: string, ts: string): TimeEventInput => ({
  id: uuid(),
  type: 'record',
  participantId,
  checkpointId,
  ts,
  deviceId: 'phone',
});

describe('hodiny', () => {
  it('bere vzorek s nejkratší odezvou', () => {
    const est = estimateOffset([
      { sentAt: 1000, serverTime: 6000, receivedAt: 1400 }, // rtt 400 → offset 4800
      { sentAt: 2000, serverTime: 7050, receivedAt: 2100 }, // rtt 100 → offset 5000
    ]);
    expect(est).toEqual({ offsetMs: 5000, rttMs: 100 });
    expect(estimateOffset([])).toBeNull();
  });
});

describe('grid checkpointu', () => {
  it('skryje nepřítomné, řadí podle kategorie a čísla, ukáže lokální záznam jako čekající', () => {
    const ev = record('m2', FINISH, '2026-07-17T09:00:00.000Z');
    const { entries, hidden } = checkpointEntries(snapshot(), [eventItem(ev)], FINISH, ME);
    expect(hidden).toBe(1);
    expect(entries.map((e) => e.participant.id)).toEqual(['m1', 'm2', 'f1']);
    const m2 = entries.find((e) => e.participant.id === 'm2')!;
    expect(m2.time?.ts).toBe(ev.ts);
    expect(m2.mine).toBe(true);
    expect(m2.sync).toBe('pending');
  });

  it('záznam z jiného zařízení je hotový, ale vrátit ho nejde', () => {
    const server: ResultEvent = {
      ...record('m1', FINISH, '2026-07-17T09:00:00.000Z'),
      userId: OTHER,
      serverReceivedAt: '2026-07-17T09:00:01.000Z',
    };
    const { entries } = checkpointEntries(snapshot([server]), [], FINISH, ME);
    const m1 = entries.find((e) => e.participant.id === 'm1')!;
    expect(m1.time).not.toBeNull();
    expect(m1.mine).toBe(false);
    expect(m1.sync).toBe('synced');
  });

  it('vrácení akce offline uvolní tlačítko; odmítnutý záznam se ukáže', () => {
    const ev = record('m1', FINISH, '2026-07-17T09:00:00.000Z');
    const cancel: TimeEventInput = {
      ...record('m1', FINISH, '2026-07-17T09:00:05.000Z'),
      type: 'cancel',
      refEventId: ev.id,
    };
    const bad = { ...eventItem(record('f1', FINISH, ev.ts), 'rejected'), error: 'nepřítomen' };
    const { entries } = checkpointEntries(
      snapshot(),
      [eventItem(ev), eventItem(cancel), bad],
      FINISH,
      ME,
    );
    expect(entries.find((e) => e.participant.id === 'm1')!.time).toBeNull();
    expect(entries.find((e) => e.participant.id === 'f1')!.rejected).toBe('nepřítomen');
  });

  it('registrace na místě se hned objeví v gridu s předběžným číslem', () => {
    const s = snapshot();
    const registration: OnSiteRegistrationInput = {
      id: uuid(),
      firstName: 'Nový',
      lastName: 'Test',
      birthYear: 1990,
      gender: 'male',
      locality: 'local',
      bib: nextFreeBib(s.participants, 'm'),
    };
    const item: OutboxItem = {
      ...eventItem(record('x', START, '2026-07-17T08:00:00.000Z')),
      kind: 'register',
      registration,
    } as OutboxItem;
    const { entries } = checkpointEntries(s, [item], START, ME);
    const p = entries.find((e) => e.participant.id === registration.id)!;
    expect(p.participant.bib).toBe(4);
    expect(p.participant.unconfirmed).toBe(true);
    expect(p.category.id).toBe('m');
  });
});

describe('hromadný start', () => {
  it('zapíše start jen čekajícím přítomným a umí ho vrátit', () => {
    const late = record('m1', START, '2026-07-17T08:00:00.000Z');
    const s = snapshot();
    let outbox = [eventItem(late)];
    const before = startOverview(checkpointEntries(s, outbox, START, ME).entries);
    const men = before.find((g) => g.category.id === 'm')!;
    expect(men.waiting.map((e) => e.participant.id)).toEqual(['m2']);

    const events = massStartEvents(men.waiting, START, '2026-07-17T08:05:00.000Z', 'phone', uuid);
    outbox = [...outbox, ...events.map((e) => eventItem(e))];
    const after = startOverview(checkpointEntries(s, outbox, START, ME).entries);
    expect(after.find((g) => g.category.id === 'm')!.waiting).toEqual([]);
    expect(after.find((g) => g.category.id === 'f')!.startedAt).toBeNull();

    const undo = undoStartEvents(
      after.find((g) => g.category.id === 'm')!,
      START,
      late.ts,
      'p',
      uuid,
    );
    expect(undo).toHaveLength(2);
    outbox = [...outbox, ...undo.map((e) => eventItem(e))];
    const reverted = startOverview(checkpointEntries(s, outbox, START, ME).entries);
    expect(reverted.find((g) => g.category.id === 'm')!.waiting).toHaveLength(2);
  });
});

describe('offline fronta', () => {
  function transport(overrides: Partial<Transport> = {}): Transport & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async sendEvents(_race, events): Promise<TimeEventResult[]> {
        calls.push(`events:${events.length}`);
        return events.map((e) => ({ id: e.id, status: 'accepted' }));
      },
      async setStatus(_race, id, status) {
        calls.push(`status:${id}:${status}`);
      },
      async register(_race, input) {
        calls.push(`register:${input.id}`);
        return {
          participant: { ...participant(input.id, 'm', 7), firstName: input.firstName },
          requestedBib: input.bib ?? null,
          bibChanged: input.bib !== 7,
        };
      },
      ...overrides,
    };
  }

  const statusItem = (): OutboxItem =>
    ({
      ...eventItem(record('m1', START, '2026-07-17T08:00:00.000Z')),
      kind: 'status',
      participantId: 'm3',
      status: 'checked_in',
    }) as OutboxItem;

  it('posílá v pořadí, časy po dávkách, a hlásí změněné číslo', async () => {
    const reg = {
      ...statusItem(),
      kind: 'register',
      registration: {
        id: 'r1',
        firstName: 'Nový',
        lastName: 'T',
        birthYear: 1990,
        gender: 'male',
        locality: 'local',
        bib: 4,
      },
    } as OutboxItem;
    const items = [
      eventItem(record('m1', START, 'a')),
      eventItem(record('m2', START, 'a')),
      statusItem(),
      reg,
      eventItem(record('r1', START, 'b')),
    ];
    const t = transport();
    const persisted: number[] = [];
    const res = await syncOutbox(items, ME, t, (i) => persisted.push(i.length));
    expect(t.calls).toEqual(['events:2', 'status:m3:checked_in', 'register:r1', 'events:1']);
    expect(res.items.every((i) => i.state === 'sent')).toBe(true);
    expect(res.items[3]!.warning).toMatch(/číslo 7/);
    expect(persisted).toHaveLength(4);
    expect(items[0]!.state).toBe('pending'); // vstup se nemění
  });

  it('bez signálu se zastaví a nic neztratí; trvalé odmítnutí označí a pokračuje', async () => {
    const items = [eventItem(record('m1', START, 'a')), statusItem()];
    const offline = await syncOutbox(
      items,
      ME,
      transport({
        sendEvents: async () => {
          throw new TypeError('Network request failed');
        },
      }),
    );
    expect(offline.error).toMatch(/Network/);
    expect(offline.items.map((i) => i.state)).toEqual(['pending', 'pending']);

    const forbidden = await syncOutbox(
      items,
      ME,
      transport({
        sendEvents: async () => {
          throw new HttpError(403, 'K tomuto závodu nemáte přístup.');
        },
      }),
    );
    expect(forbidden.items.map((i) => i.state)).toEqual(['rejected', 'sent']);
    expect(forbidden.items[0]!.error).toMatch(/přístup/);
  });

  it('akce jiného uživatele neposílá', async () => {
    const t = transport();
    const res = await syncOutbox([{ ...statusItem(), userId: OTHER }], ME, t);
    expect(t.calls).toEqual([]);
    expect(res.items[0]!.state).toBe('pending');
  });
});
