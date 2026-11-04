/**
 * Co appka zobrazuje na checkpointu: stav ze serveru (snapshot) + lokální akce z offline
 * fronty, které server ještě nepotvrdil. Výpočet je stejná projekce logu jako na serveru
 * (`projectEvents` ze `@triatlon/shared`), takže telefon bez signálu ukazuje totéž, co
 * ukáže server po synchronizaci.
 */
import {
  projectEvents,
  resolveCategory,
  type CategoryDto,
  type EffectiveTime,
  type OnSiteRegistrationInput,
  type ParticipantDto,
  type ParticipantNote,
  type RaceDetailDto,
  type ResultEvent,
  type TimeEventInput,
} from '@triatlon/shared';
import type { OutboxItem } from './outbox';

/** Data závodu stažená ze serveru a uložená v telefonu pro offline režim. */
export interface RaceSnapshot {
  race: RaceDetailDto;
  participants: ParticipantDto[];
  events: ResultEvent[];
  fetchedAt: string;
}

export interface LocalParticipant extends ParticipantDto {
  /** Registrován na místě a ještě nepotvrzen serverem (číslo je předběžné). */
  unconfirmed?: boolean;
  /** Stav check-inu čeká na odeslání. */
  statusPending?: boolean;
}

export type SyncMark = 'synced' | 'pending';

export interface CheckpointEntry {
  participant: LocalParticipant;
  category: CategoryDto;
  /** Platný čas na checkpointu (po zrušení a korekcích), nebo null. */
  time: EffectiveTime | null;
  /** Platný záznam zadal přihlášený uživatel → smí ho vrátit. */
  mine: boolean;
  sync: SyncMark;
  /** Poslední odmítnutý záznam na tomto checkpointu (když žádný platný není). */
  rejected?: string;
  notes: ParticipantNote[];
}

const raceItems = (outbox: readonly OutboxItem[], raceId: string) =>
  outbox.filter((i) => i.raceId === raceId);

/** Závodníci včetně registrací na místě a check-inů, které ještě nejsou na serveru. */
export function localParticipants(
  snapshot: RaceSnapshot,
  outbox: readonly OutboxItem[],
): LocalParticipant[] {
  const byId = new Map<string, LocalParticipant>(
    snapshot.participants.map((p) => [p.id, { ...p }]),
  );
  for (const it of raceItems(outbox, snapshot.race.id)) {
    if (it.state === 'rejected') continue;
    if (it.kind === 'register' && !byId.has(it.registration.id)) {
      const p = registrationToParticipant(snapshot.race, it.registration);
      if (p) byId.set(p.id, { ...p, unconfirmed: true });
    } else if (it.kind === 'status' && it.state === 'pending') {
      const p = byId.get(it.participantId);
      if (p) byId.set(p.id, { ...p, status: it.status, statusPending: true });
    }
  }
  return [...byId.values()];
}

/** Předběžný závodník z registrace na místě — kategorie se určí stejně jako na serveru. */
export function registrationToParticipant(
  race: RaceDetailDto,
  r: OnSiteRegistrationInput,
): ParticipantDto | null {
  const resolved = resolveCategory(r, race.year, race.ageGroups, race.categories);
  if ('error' in resolved) return null;
  return {
    id: r.id,
    categoryId: resolved.category.id,
    bib: r.bib ?? 0,
    firstName: r.firstName,
    lastName: r.lastName,
    birthYear: r.birthYear,
    gender: r.gender,
    locality: r.locality,
    status: 'checked_in',
    registrationSource: 'on_site',
  };
}

/** Navržené startovní číslo pro registraci na místě: další volné v kategorii. */
export function nextFreeBib(participants: readonly ParticipantDto[], categoryId: string): number {
  return (
    Math.max(0, ...participants.filter((p) => p.categoryId === categoryId).map((p) => p.bib)) + 1
  );
}

/** Log ze serveru doplněný o lokální akce, které v něm ještě nejsou. */
export function mergedEvents(snapshot: RaceSnapshot, outbox: readonly OutboxItem[]): ResultEvent[] {
  const known = new Set(snapshot.events.map((e) => e.id));
  const local: ResultEvent[] = [];
  for (const it of raceItems(outbox, snapshot.race.id)) {
    if (it.kind !== 'event' || it.state === 'rejected' || known.has(it.event.id)) continue;
    local.push(toResultEvent(it.event, it.userId, it.createdAt));
  }
  return [...snapshot.events, ...local];
}

function toResultEvent(e: TimeEventInput, userId: string, createdAt: string): ResultEvent {
  // Lokální akce se řadí za vše ze serveru (server je přijme až po synchronizaci).
  return { ...e, userId, serverReceivedAt: `~${createdAt}` };
}

/**
 * Položky gridu na checkpointu: přítomní závodníci kategorií, pro které checkpoint platí,
 * seřazení podle kategorie a čísla. Nepřítomní a diskvalifikovaní se nezobrazují.
 */
export function checkpointEntries(
  snapshot: RaceSnapshot,
  outbox: readonly OutboxItem[],
  checkpointId: string,
  userId: string,
): { entries: CheckpointEntry[]; hidden: number } {
  const race = snapshot.race;
  const categories = race.categories.filter((c) => c.checkpointIds.includes(checkpointId));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const events = mergedEvents(snapshot, outbox);
  const author = new Map(events.map((e) => [e.id, e.userId]));
  const projection = projectEvents(events);
  const pendingIds = new Set(
    raceItems(outbox, race.id)
      .filter((i) => i.kind === 'event' && i.state === 'pending')
      .map((i) => (i as Extract<OutboxItem, { kind: 'event' }>).event.id),
  );
  const rejected = new Map<string, string>();
  for (const it of raceItems(outbox, race.id)) {
    if (
      it.kind === 'event' &&
      it.state === 'rejected' &&
      it.event.type === 'record' &&
      it.event.checkpointId === checkpointId
    ) {
      rejected.set(it.event.participantId, it.error ?? 'odmítnuto');
    }
  }

  let hidden = 0;
  const entries: CheckpointEntry[] = [];
  for (const p of localParticipants(snapshot, outbox)) {
    const category = categoryById.get(p.categoryId);
    if (!category) continue;
    if (p.status === 'absent' || p.status === 'disqualified') {
      hidden++;
      continue;
    }
    const time = projection.times.get(p.id)?.get(checkpointId) ?? null;
    const mine = !!time && author.get(time.recordId) === userId;
    const relatedPending =
      !!time &&
      events.some(
        (e) =>
          pendingIds.has(e.id) &&
          e.participantId === p.id &&
          e.checkpointId === checkpointId &&
          (e.id === time.recordId || e.refEventId === time.recordId),
      );
    const cancelPending = events.some(
      (e) =>
        pendingIds.has(e.id) &&
        e.type === 'cancel' &&
        e.participantId === p.id &&
        e.checkpointId === checkpointId,
    );
    entries.push({
      participant: p,
      category,
      time,
      mine,
      sync: relatedPending || cancelPending ? 'pending' : 'synced',
      rejected: time ? undefined : rejected.get(p.id),
      notes: (projection.notes.get(p.id) ?? []).filter((n) => n.checkpointId === checkpointId),
    });
  }
  entries.sort(
    (a, b) =>
      (order.get(a.category.id) ?? 0) - (order.get(b.category.id) ?? 0) ||
      a.participant.bib - b.participant.bib,
  );
  return { entries, hidden };
}

export interface CategoryStart {
  category: CategoryDto;
  entries: CheckpointEntry[];
  /** Kdo ještě nemá čas startu. */
  waiting: CheckpointEntry[];
  /** Nejdřívější platný čas startu v kategorii (= hromadný start). */
  startedAt: string | null;
}

/** Přehled pro checkpoint start: po kategoriích, kdo odstartoval a kdo ještě ne. */
export function startOverview(entries: readonly CheckpointEntry[]): CategoryStart[] {
  const groups = new Map<string, CategoryStart>();
  for (const e of entries) {
    let g = groups.get(e.category.id);
    if (!g) {
      g = { category: e.category, entries: [], waiting: [], startedAt: null };
      groups.set(e.category.id, g);
    }
    g.entries.push(e);
    if (!e.time) g.waiting.push(e);
    else if (!g.startedAt || e.time.ts < g.startedAt) g.startedAt = e.time.ts;
  }
  return [...groups.values()];
}

/** Hromadný start kategorie: stejný čas startu všem, kdo ho ještě nemají. */
export function massStartEvents(
  waiting: readonly CheckpointEntry[],
  checkpointId: string,
  ts: string,
  deviceId: string,
  uuid: () => string,
): TimeEventInput[] {
  return waiting.map((e) => ({
    id: uuid(),
    type: 'record' as const,
    participantId: e.participant.id,
    checkpointId,
    ts,
    deviceId,
  }));
}

/** Vrácení hromadného startu: zruší platné starty kategorie, které zadal tento uživatel. */
export function undoStartEvents(
  group: CategoryStart,
  checkpointId: string,
  ts: string,
  deviceId: string,
  uuid: () => string,
): TimeEventInput[] {
  return group.entries
    .filter((e) => e.time && e.mine)
    .map((e) => ({
      id: uuid(),
      type: 'cancel' as const,
      participantId: e.participant.id,
      checkpointId,
      ts,
      refEventId: e.time!.recordId,
      deviceId,
    }));
}
