import { describe, expect, it } from 'vitest';
import {
  barScaleMs,
  checkpointRanks,
  currentLeg,
  disciplineMedians,
  estimatedRestMs,
  gapMs,
  latestFinishers,
  median,
  trackCounts,
  type BoardRow,
} from './board.js';

const s = (sec: number) => sec * 1000;
/** Řádek se třemi disciplínami; splity = start, T1, T2, cíl. */
function row(legs: (number | null)[], state?: BoardRow['state']): BoardRow {
  const splits: (number | null)[] = [0];
  let acc = 0;
  for (const l of legs) {
    if (l == null) splits.push(null);
    else splits.push(s((acc += l)));
  }
  const done = legs.every((l) => l != null);
  return {
    state: state ?? (done ? 'finished' : 'racing'),
    totalMs: done ? s(acc) : null,
    splitsMs: splits,
    disciplinesMs: legs.map((l) => (l == null ? null : s(l))),
  };
}

describe('board', () => {
  const a = row([400, 1300, 900]); // 2600
  const b = row([380, 1400, 950]); // 2730
  const c = row([450, 1200, 1000]); // 2650
  const d = row([420, null, null]);
  const e = row([500, null, null], 'dnf');
  const rows = [a, c, b, d, e];

  it('medián', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(disciplineMedians(rows)).toEqual([s(400), s(1300), s(950)]);
  });

  it('aktuální úsek a odhad zbytku', () => {
    expect(currentLeg(d)).toBe(1);
    expect(currentLeg(a)).toBe(3);
    expect(estimatedRestMs(d, disciplineMedians(rows))).toBe(s(1300 + 950));
    expect(estimatedRestMs(e, disciplineMedians(rows))).toBeNull();
    expect(estimatedRestMs(d, [s(1), null, null])).toBeNull();
  });

  it('měřítko pruhů a ztráta', () => {
    expect(barScaleMs(rows)).toBe(Math.round(s(2730) * 1.05));
    expect(gapMs(a, rows)).toBe(0);
    expect(gapMs(b, rows)).toBe(s(130));
    expect(gapMs(d, rows)).toBeNull();
  });

  it('pořadí na checkpointech včetně remízy', () => {
    const tie = row([400, 1350, 900]);
    const r = checkpointRanks([a, b, c, tie, d]);
    // T1: b 380 s, a + tie 400 s (remíza), d 420 s, c 450 s.
    expect(r[0]).toEqual([null, 2, 2, 1]);
    expect(r[1]).toEqual([null, 1, 4, 4]);
    expect(r[2]).toEqual([null, 5, 1, 2]);
    expect(r[3]).toEqual([null, 2, 3, 2]);
    expect(r[4]).toEqual([null, 4, null, null]);
  });

  it('kde jsou závodníci', () => {
    expect(trackCounts(rows, 3)).toEqual({ legs: [0, 1, 0], finished: 3 });
  });

  it('právě v cíli', () => {
    const t0 = '2027-08-07T10:00:00.000Z';
    const tables = [
      {
        table: 'X',
        rows: [
          { ...a, startedAt: t0 },
          { ...d, startedAt: t0 },
        ],
      },
      { table: 'Y', rows: [{ ...b, startedAt: t0 }] },
    ];
    const latest = latestFinishers(tables, 3);
    expect(latest.map((l) => l.table)).toEqual(['Y', 'X']);
    expect(latest[0]!.at).toBe(Date.parse(t0) + s(2730));
  });
});
