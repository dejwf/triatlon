import { describe, expect, it } from 'vitest';
import {
  computeCategoryResults,
  formatDuration,
  projectEvents,
  type ResultCheckpoint,
  type ResultEvent,
  type ResultParticipant,
} from './results.js';

const disciplines = [
  { id: 'swim', name: 'plavání', seq: 1 },
  { id: 'bike', name: 'cyklistika', seq: 2 },
  { id: 'run', name: 'běh', seq: 3 },
];
const cps: ResultCheckpoint[] = [
  { id: 'start', name: 'Start', seq: 1, kind: 'transition', disciplineId: null },
  { id: 'swimEnd', name: 'Konec plavání', seq: 2, kind: 'transition', disciplineId: 'swim' },
  { id: 'hill', name: 'Otočka', seq: 3, kind: 'intermediate', disciplineId: 'bike' },
  { id: 'bikeEnd', name: 'Konec kola', seq: 4, kind: 'transition', disciplineId: 'bike' },
  { id: 'finish', name: 'Cíl', seq: 5, kind: 'transition', disciplineId: 'run' },
];

const T0 = Date.parse('2027-07-17T08:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
let n = 0;
function ev(
  type: ResultEvent['type'],
  participantId: string,
  checkpointId: string,
  sec: number,
  extra: Partial<ResultEvent> = {},
): ResultEvent {
  n++;
  return {
    id: extra.id ?? `e${n}`,
    type,
    participantId,
    checkpointId,
    ts: at(sec),
    userId: 'u1',
    serverReceivedAt: new Date(T0 + n).toISOString(),
    ...extra,
  };
}
const p = (
  id: string,
  bib: number,
  status: ResultParticipant['status'] = 'checked_in',
): ResultParticipant => ({
  id,
  bib,
  firstName: id,
  lastName: 'X',
  status,
});

function results(events: ResultEvent[], participants: ResultParticipant[], overrides = []) {
  return computeCategoryResults({
    checkpoints: cps,
    disciplines,
    participants,
    projection: projectEvents(events),
    overrides,
  });
}

const fullRace = (pid: string, swim: number, bike: number, finish: number) => [
  ev('record', pid, 'start', 0),
  ev('record', pid, 'swimEnd', swim),
  ev('record', pid, 'bikeEnd', bike),
  ev('record', pid, 'finish', finish),
];

describe('projekce událostí', () => {
  it('zrušený záznam neplatí, opravený platí s novým časem', () => {
    const events = [
      ev('record', 'a', 'start', 0, { id: 'r1' }),
      ev('cancel', 'a', 'start', 5, { refEventId: 'r1' }),
      ev('record', 'a', 'start', 10, { id: 'r2' }),
      ev('admin_correction', 'a', 'start', 8, { refEventId: 'r2', reason: 'reakční doba' }),
    ];
    const t = projectEvents(events).times.get('a')!.get('start')!;
    expect(t).toMatchObject({ ts: at(8), recordId: 'r2', corrected: true, conflict: false });
  });

  it('dva platné záznamy = konflikt, platí dřívější', () => {
    const t = projectEvents([ev('record', 'a', 'start', 3), ev('record', 'a', 'start', 1)])
      .times.get('a')!
      .get('start')!;
    expect(t).toMatchObject({ ts: at(1), conflict: true });
  });

  it('admin může doplnit chybějící čas a poznámky se sbírají', () => {
    const proj = projectEvents([
      ev('admin_correction', 'a', 'finish', 100, { reason: 'zapomenuto' }),
      ev('note', 'a', 'finish', 100, { note: 'spadl z kola' }),
    ]);
    expect(proj.times.get('a')!.get('finish')).toMatchObject({ corrected: true });
    expect(proj.notes.get('a')![0]!.text).toBe('spadl z kola');
  });
});

describe('výsledky kategorie', () => {
  it('celkový čas, časy disciplín a mezičas sub-checkpointu', () => {
    const r = results(
      [...fullRace('a', 300, 1500, 2400), ev('record', 'a', 'hill', 900)],
      [p('a', 1)],
    );
    const row = r.rows[0]!;
    expect(row.state).toBe('finished');
    expect(row.totalMs).toBe(2400_000);
    expect(row.disciplines).toEqual([
      { disciplineId: 'swim', ms: 300_000 },
      { disciplineId: 'bike', ms: 1200_000 },
      { disciplineId: 'run', ms: 900_000 },
    ]);
    expect(row.splits.find((s) => s.checkpointId === 'hill')!.elapsedMs).toBe(900_000);
    expect(r.startedAt).toBe(at(0));
  });

  it('pořadí: dokončení podle času, pak průběžné podle posledního checkpointu, pak nestartovaní', () => {
    const r = results(
      [
        ...fullRace('slow', 300, 1500, 2500),
        ...fullRace('fast', 280, 1400, 2300),
        ev('record', 'bike1', 'start', 0),
        ev('record', 'bike1', 'swimEnd', 250),
        ev('record', 'bike1', 'bikeEnd', 1600),
        ev('record', 'swim1', 'start', 0),
        ev('record', 'swim1', 'swimEnd', 200),
      ],
      [
        p('slow', 1),
        p('fast', 2),
        p('swim1', 3),
        p('bike1', 4),
        p('dns', 5),
        p('abs', 6, 'absent'),
        p('dq', 7, 'disqualified'),
      ],
    );
    expect(r.rows.map((x) => [x.participantId, x.rank])).toEqual([
      ['fast', 1],
      ['slow', 2],
      ['bike1', 3],
      ['swim1', 4],
      ['dns', null],
      ['dq', null],
    ]);
    expect(r.counts).toEqual({
      registered: 7,
      absent: 1,
      started: 4,
      finished: 2,
      disqualified: 1,
    });
  });

  it('nedokončení na stejném checkpointu se řadí podle času od startu', () => {
    const r = results(
      [
        ev('record', 'a', 'start', 0),
        ev('record', 'a', 'swimEnd', 320),
        ev('record', 'b', 'start', 10),
        ev('record', 'b', 'swimEnd', 320),
      ],
      [p('a', 1), p('b', 2)],
    );
    expect(r.rows.map((x) => x.participantId)).toEqual(['b', 'a']);
  });

  it('remíza na celé sekundy = stejné pořadí; admin ji rozhodne overridem', () => {
    const events = [
      ...fullRace('a', 300, 1500, 2400),
      ...fullRace('b', 300, 1500, 2400.4),
      ...fullRace('c', 300, 1500, 2500),
    ];
    const tie = results(events, [p('a', 1), p('b', 2), p('c', 3)]);
    expect(tie.rows.map((x) => [x.participantId, x.rank, x.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false],
    ]);

    const decided = computeCategoryResults({
      checkpoints: cps,
      disciplines,
      participants: [p('a', 1), p('b', 2), p('c', 3)],
      projection: projectEvents(events),
      overrides: [{ id: 'o1', participantIds: ['b', 'a'] }],
    });
    expect(decided.rows.map((x) => [x.participantId, x.rank, x.rankOverridden])).toEqual([
      ['b', 1, true],
      ['a', 2, true],
      ['c', 3, false],
    ]);
  });

  it('override, který nepokrývá celou remízu, se neuplatní', () => {
    const events = [
      ...fullRace('a', 1, 2, 100),
      ...fullRace('b', 1, 2, 100),
      ...fullRace('c', 1, 2, 100),
    ];
    const r = computeCategoryResults({
      checkpoints: cps,
      disciplines,
      participants: [p('a', 1), p('b', 2), p('c', 3)],
      projection: projectEvents(events),
      overrides: [{ id: 'o1', participantIds: ['b', 'a'] }],
    });
    expect(r.rows.every((x) => x.rank === 1 && x.tied)).toBe(true);
  });
});

describe('formatDuration', () => {
  it('formátuje h:mm:ss a m:ss', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(65_400, true)).toBe('1:05.4');
    expect(formatDuration(null)).toBe('—');
  });
});
