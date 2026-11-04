/**
 * Výpočet výsledků z append-only logu událostí (CLAUDE.md, sekce 7). Čisté funkce — počítá
 * se stejně na serveru i v klientech.
 */
import type { CheckpointKind, ParticipantStatus, TimeEventType } from './domain.js';

/** Pořadí se určuje na celé sekundy; stejná sekunda = remíza (rozhodne admin). */
export const RANK_PRECISION_MS = 1000;

export interface ResultEvent {
  id: string;
  type: TimeEventType;
  participantId: string;
  checkpointId: string;
  /** ISO čas akce. */
  ts: string;
  note?: string | null;
  refEventId?: string | null;
  reason?: string | null;
  userId: string;
  /** ISO čas přijetí serverem — určuje pořadí korekcí. */
  serverReceivedAt: string;
}

export interface ResultCheckpoint {
  id: string;
  name: string;
  seq: number;
  kind: CheckpointKind;
  disciplineId: string | null;
}

export interface ResultDiscipline {
  id: string;
  name: string;
  seq: number;
}

export interface ResultParticipant {
  id: string;
  bib: number;
  firstName: string;
  lastName: string;
  status: ParticipantStatus;
}

/** Platný čas závodníka na checkpointu po aplikaci zrušení a korekcí. */
export interface EffectiveTime {
  checkpointId: string;
  ts: string;
  /** ID záznamu (record nebo adminem doplněného času), ke kterému čas patří. */
  recordId: string;
  /** Čas byl adminem opraven nebo doplněn. */
  corrected: boolean;
  /** Na checkpointu je víc platných záznamů (např. dva organizátoři) — platí nejdřívější. */
  conflict: boolean;
}

export interface ParticipantNote {
  eventId: string;
  checkpointId: string;
  text: string;
  at: string;
  userId: string;
}

export interface Projection {
  times: Map<string, Map<string, EffectiveTime>>;
  notes: Map<string, ParticipantNote[]>;
}

const byReceived = (a: ResultEvent, b: ResultEvent) =>
  a.serverReceivedAt.localeCompare(b.serverReceivedAt) || a.id.localeCompare(b.id);

/**
 * Projekce logu na platné časy:
 * - `record` založí záznam; `admin_correction` bez `refEventId` = čas doplněný adminem,
 * - `cancel` (refEventId = záznam) záznam zruší — vrácená akce, zůstává v logu,
 * - `admin_correction` s `refEventId` nastaví záznamu nový čas (platí poslední korekce),
 * - `note` přidá poznámku.
 */
export function projectEvents(events: readonly ResultEvent[]): Projection {
  const sorted = [...events].sort(byReceived);
  const records = new Map<string, { event: ResultEvent; ts: string; corrected: boolean }>();
  const cancelled = new Set<string>();
  const notes = new Map<string, ParticipantNote[]>();

  for (const e of sorted) {
    switch (e.type) {
      case 'record':
        records.set(e.id, { event: e, ts: e.ts, corrected: false });
        break;
      case 'admin_correction': {
        const target = e.refEventId ? records.get(e.refEventId) : undefined;
        if (target) {
          target.ts = e.ts;
          target.corrected = true;
        } else if (!e.refEventId) {
          records.set(e.id, { event: e, ts: e.ts, corrected: true });
        }
        break;
      }
      case 'cancel':
        if (e.refEventId) cancelled.add(e.refEventId);
        break;
      case 'note':
        if (e.note) {
          const list = notes.get(e.participantId) ?? [];
          list.push({
            eventId: e.id,
            checkpointId: e.checkpointId,
            text: e.note,
            at: e.serverReceivedAt,
            userId: e.userId,
          });
          notes.set(e.participantId, list);
        }
        break;
    }
  }

  const times = new Map<string, Map<string, EffectiveTime>>();
  for (const [id, r] of records) {
    if (cancelled.has(id)) continue;
    const { participantId, checkpointId } = r.event;
    const perParticipant = times.get(participantId) ?? new Map<string, EffectiveTime>();
    const existing = perParticipant.get(checkpointId);
    const candidate: EffectiveTime = {
      checkpointId,
      ts: r.ts,
      recordId: id,
      corrected: r.corrected,
      conflict: false,
    };
    if (!existing) {
      perParticipant.set(checkpointId, candidate);
    } else {
      const earlier = candidate.ts < existing.ts ? candidate : existing;
      perParticipant.set(checkpointId, { ...earlier, conflict: true });
    }
    times.set(participantId, perParticipant);
  }
  return { times, notes };
}

// ---------- Výsledky kategorie ----------

export type ResultState = 'finished' | 'racing' | 'not_started' | 'disqualified';

export interface ResultSplit {
  checkpointId: string;
  ts: string;
  /** Čas od startu závodníka (null bez startu). */
  elapsedMs: number | null;
  recordId: string;
  corrected: boolean;
  conflict: boolean;
}

export interface ResultRow {
  participantId: string;
  bib: number;
  firstName: string;
  lastName: string;
  status: ParticipantStatus;
  state: ResultState;
  /** Pořadí (průběžné u nedokončených); null = nestartoval / diskvalifikován. */
  rank: number | null;
  /** Sdílí pořadí s jiným závodníkem (remíza na RANK_PRECISION_MS). */
  tied: boolean;
  /** Pořadí v remíze určil admin. */
  rankOverridden: boolean;
  startTs: string | null;
  splits: ResultSplit[];
  /** Čas jednotlivých disciplín (mezi hranicemi), null = úsek nedokončen. */
  disciplines: { disciplineId: string; ms: number | null }[];
  totalMs: number | null;
  lastCheckpointId: string | null;
  notes: ParticipantNote[];
}

export interface CategoryResults {
  /** Nejdřívější start v kategorii (hromadný start). */
  startedAt: string | null;
  counts: {
    registered: number;
    absent: number;
    started: number;
    finished: number;
    disqualified: number;
  };
  /** Checkpointy platné pro kategorii, seřazené podle trasy. */
  checkpointIds: string[];
  rows: ResultRow[];
}

export interface RankingOverride {
  id: string;
  /** Seřazená ID závodníků v remíze. */
  participantIds: string[];
}

const toMs = (iso: string) => Date.parse(iso);
const rounded = (ms: number) => Math.floor(ms / RANK_PRECISION_MS);

export function computeCategoryResults(input: {
  /** Checkpointy platné pro kategorii (libovolné pořadí, seřadí se podle seq). */
  checkpoints: readonly ResultCheckpoint[];
  disciplines: readonly ResultDiscipline[];
  participants: readonly ResultParticipant[];
  projection: Projection;
  overrides?: readonly RankingOverride[];
}): CategoryResults {
  const checkpoints = [...input.checkpoints].sort((a, b) => a.seq - b.seq);
  const transitions = checkpoints.filter((c) => c.kind === 'transition');
  const startCp = transitions[0];
  const finishCp = transitions.length > 1 ? transitions.at(-1) : undefined;
  const seqOf = new Map(checkpoints.map((c) => [c.id, c.seq]));
  const disciplineOrder = new Map(input.disciplines.map((d) => [d.id, d.seq]));

  // Úseky disciplín: od předchozí hranice k hranici, která disciplínu ukončuje.
  const legs = transitions
    .map((t, i) => ({ end: t, from: transitions[i - 1] }))
    .filter(
      (l): l is { end: ResultCheckpoint; from: ResultCheckpoint } =>
        !!l.from && !!l.end.disciplineId,
    )
    .sort(
      (a, b) =>
        (disciplineOrder.get(a.end.disciplineId!) ?? 0) -
        (disciplineOrder.get(b.end.disciplineId!) ?? 0),
    );

  const rows: ResultRow[] = [];
  let absent = 0;
  for (const p of input.participants) {
    if (p.status === 'absent') {
      absent++;
      continue;
    }
    const times = input.projection.times.get(p.id) ?? new Map<string, EffectiveTime>();
    const start = startCp ? times.get(startCp.id) : undefined;
    const startMs = start ? toMs(start.ts) : null;

    const splits: ResultSplit[] = checkpoints
      .filter((c) => times.has(c.id))
      .map((c) => {
        const t = times.get(c.id)!;
        return {
          checkpointId: c.id,
          ts: t.ts,
          elapsedMs: startMs === null ? null : toMs(t.ts) - startMs,
          recordId: t.recordId,
          corrected: t.corrected,
          conflict: t.conflict,
        };
      });

    const finish = finishCp ? times.get(finishCp.id) : undefined;
    const totalMs = start && finish ? toMs(finish.ts) - toMs(start.ts) : null;
    const last = splits.at(-1);
    const state: ResultState =
      p.status === 'disqualified'
        ? 'disqualified'
        : totalMs !== null
          ? 'finished'
          : splits.length
            ? 'racing'
            : 'not_started';

    rows.push({
      participantId: p.id,
      bib: p.bib,
      firstName: p.firstName,
      lastName: p.lastName,
      status: p.status,
      state,
      rank: null,
      tied: false,
      rankOverridden: false,
      startTs: start?.ts ?? null,
      splits,
      disciplines: legs.map((l) => {
        const a = times.get(l.from.id);
        const b = times.get(l.end.id);
        return { disciplineId: l.end.disciplineId!, ms: a && b ? toMs(b.ts) - toMs(a.ts) : null };
      }),
      totalMs,
      lastCheckpointId: last?.checkpointId ?? null,
      notes: input.projection.notes.get(p.id) ?? [],
    });
  }

  rank(rows, seqOf, input.overrides ?? []);

  return {
    startedAt:
      rows
        .map((r) => r.startTs)
        .filter((t): t is string => t !== null)
        .sort()[0] ?? null,
    counts: {
      registered: input.participants.length,
      absent,
      started: rows.filter((r) => r.startTs !== null && r.state !== 'disqualified').length,
      finished: rows.filter((r) => r.state === 'finished').length,
      disqualified: rows.filter((r) => r.state === 'disqualified').length,
    },
    checkpointIds: checkpoints.map((c) => c.id),
    rows,
  };
}

/**
 * Pořadí v kategorii (CLAUDE.md, sekce 7): dokončení podle celkového času; průběžně podle
 * posledního dosaženého checkpointu (dál = lépe) a času od startu na něm. Remíza (stejná
 * sekunda) = stejné pořadí, pokud ji admin nerozhodl (override musí pokrýt celou skupinu).
 */
function rank(
  rows: ResultRow[],
  seqOf: Map<string, number>,
  overrides: readonly RankingOverride[],
): void {
  const key = (r: ResultRow): number[] | null => {
    if (r.state === 'finished') return [0, rounded(r.totalMs!)];
    if (r.state === 'racing') {
      const last = r.splits.at(-1)!;
      const elapsed = last.elapsedMs ?? toMs(last.ts);
      return [1, -(seqOf.get(last.checkpointId) ?? 0), rounded(elapsed)];
    }
    return null;
  };
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  const stateOrder: Record<ResultState, number> = {
    finished: 0,
    racing: 1,
    not_started: 2,
    disqualified: 3,
  };
  const keys = new Map(rows.map((r) => [r.participantId, key(r)]));

  rows.sort((a, b) => {
    const ka = keys.get(a.participantId);
    const kb = keys.get(b.participantId);
    if (ka && kb) return cmp(ka, kb) || a.bib - b.bib;
    return stateOrder[a.state] - stateOrder[b.state] || a.bib - b.bib;
  });

  let i = 0;
  let position = 1;
  while (i < rows.length) {
    const k = keys.get(rows[i]!.participantId);
    if (!k) break;
    let j = i + 1;
    while (j < rows.length) {
      const kj = keys.get(rows[j]!.participantId);
      if (!kj || cmp(k, kj) !== 0) break;
      j++;
    }
    const group = rows.slice(i, j);
    const ids = new Set(group.map((r) => r.participantId));
    const override =
      group.length > 1
        ? [...overrides]
            .reverse()
            .find(
              (o) =>
                o.participantIds.length === ids.size && o.participantIds.every((id) => ids.has(id)),
            )
        : undefined;

    if (override) {
      group.sort(
        (a, b) =>
          override.participantIds.indexOf(a.participantId) -
          override.participantIds.indexOf(b.participantId),
      );
      group.forEach((r, n) =>
        Object.assign(r, { rank: position + n, tied: false, rankOverridden: true }),
      );
    } else {
      group.forEach((r) => Object.assign(r, { rank: position, tied: group.length > 1 }));
    }
    rows.splice(i, group.length, ...group);
    position += group.length;
    i = j;
  }
}

/** Formát času „h:mm:ss“ (nebo „m:ss“), volitelně s desetinami. */
export function formatDuration(ms: number | null, tenths = false): string {
  if (ms === null) return '—';
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const frac = tenths ? `.${Math.floor((abs % 1000) / 100)}` : '';
  const ss = String(s).padStart(2, '0');
  return h > 0
    ? `${sign}${h}:${String(m).padStart(2, '0')}:${ss}${frac}`
    : `${sign}${m}:${ss}${frac}`;
}
