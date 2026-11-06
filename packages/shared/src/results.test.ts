import { describe, expect, it } from 'vitest';
import {
  computeCategoryResults,
  formatDuration,
  projectEvents,
  rankCombined,
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
      dnf: 0,
      disqualified: 1,
    });
  });

  it('uzavřená kategorie: kdo je ještě na trati, nedokončil (DNF) a nemá pořadí', () => {
    const events = [
      ...fullRace('done', 300, 1500, 2500),
      ev('record', 'onCourse', 'start', 0),
      ev('record', 'onCourse', 'swimEnd', 250),
    ];
    const participants = [p('done', 1), p('onCourse', 2), p('dns', 3)];
    const open = results(events, participants);
    expect(open.rows.find((x) => x.participantId === 'onCourse')).toMatchObject({
      state: 'racing',
      rank: 2,
    });
    const closed = computeCategoryResults({
      checkpoints: cps,
      disciplines,
      participants,
      projection: projectEvents(events),
      closed: true,
    });
    expect(closed.rows.map((x) => [x.participantId, x.state, x.rank])).toEqual([
      ['done', 'finished', 1],
      ['onCourse', 'dnf', null],
      ['dns', 'not_started', null],
    ]);
    expect(closed.counts.dnf).toBe(1);
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

describe('společné pořadí více kategorií', () => {
  it('domácí a hosté v jednom pořadí; stejná čísla nevadí; každý od svého startu', () => {
    // Hosté startují o 10 min později — čas se počítá od vlastního startu.
    const local = results(
      [
        ...fullRace('l1', 300, 1800, 2400),
        ev('record', 'l2', 'start', 0),
        ev('record', 'l2', 'swimEnd', 320),
      ],
      [p('l1', 1), p('l2', 2)],
    );
    const guest = results(
      [
        ev('record', 'g1', 'start', 600),
        ev('record', 'g1', 'swimEnd', 900),
        ev('record', 'g1', 'bikeEnd', 2300),
        ev('record', 'g1', 'finish', 2900),
      ],
      [p('g1', 1), p('g2', 3, 'registered')],
    );
    const merged = rankCombined([...local.rows, ...guest.rows], cps);
    expect(merged.map((r) => [r.participantId, r.rank])).toEqual([
      ['g1', 1], // 2300 s
      ['l1', 2], // 2400 s
      ['l2', 3], // na trati
      ['g2', null],
    ]);
    // Původní řádky kategorií se nemění.
    expect(local.rows[0]!.rank).toBe(1);
  });

  it('remíza napříč kategoriemi', () => {
    const a = results(fullRace('a', 300, 1800, 2400), [p('a', 1)]);
    const b = results(fullRace('b', 300, 1800, 2400), [p('b', 1)]);
    const merged = rankCombined([...a.rows, ...b.rows], cps);
    expect(merged.map((r) => [r.rank, r.tied])).toEqual([
      [1, true],
      [1, true],
    ]);
  });
});

describe('formatDuration', () => {
  it('formátuje h:mm:ss a m:ss', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(65_400, true)).toBe('1:05.4');
    expect(formatDuration(null)).toBe('—');
  });
});
