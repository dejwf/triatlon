/**
 * Offline fronta akcí (CLAUDE.md, sekce 5 bod 7). Každá akce se nejdřív uloží do telefonu,
 * UI ji hned ukáže a fronta ji odešle, jakmile je spojení. Odesílá se přísně v pořadí
 * vzniku (registrace na místě musí dorazit dřív než časy toho závodníka); sousední zápisy
 * časů se posílají dávkou. Server je idempotentní podle klientského UUID, takže opakované
 * odeslání po výpadku nic nezduplikuje.
 */
import type {
  CheckInStatus,
  OnSiteRegistrationInput,
  OnSiteRegistrationResult,
  TimeEventInput,
  TimeEventResult,
} from '@triatlon/shared';

export type OutboxState = 'pending' | 'sent' | 'rejected';

interface OutboxBase {
  id: string;
  raceId: string;
  /** Kdo akci zadal — po přihlášení jiného uživatele se cizí akce neodesílají. */
  userId: string;
  createdAt: string;
  state: OutboxState;
  /** Důvod odmítnutí serverem. */
  error?: string;
  /** Přijato, ale s upozorněním pro obsluhu (např. změněné startovní číslo). */
  warning?: string;
  attempts: number;
}

export type OutboxItem = OutboxBase &
  (
    | { kind: 'event'; event: TimeEventInput }
    | { kind: 'status'; participantId: string; status: CheckInStatus }
    | { kind: 'register'; registration: OnSiteRegistrationInput }
  );

export interface Transport {
  sendEvents(raceId: string, events: TimeEventInput[]): Promise<TimeEventResult[]>;
  setStatus(raceId: string, participantId: string, status: CheckInStatus): Promise<void>;
  register(raceId: string, input: OnSiteRegistrationInput): Promise<OnSiteRegistrationResult>;
}

/** Chyba HTTP odpovědi (server odpověděl). Síťová chyba je jakákoli jiná výjimka. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Trvalé odmítnutí: opakování nepomůže (validace, oprávnění, konflikt). */
const isPermanent = (err: unknown) =>
  err instanceof HttpError &&
  err.status >= 400 &&
  err.status < 500 &&
  ![401, 408, 429].includes(err.status);

const MAX_BATCH = 500;

export interface SyncResult {
  items: OutboxItem[];
  /** Synchronizace se zastavila (bez signálu, chyba serveru) — zkusí se znovu později. */
  error?: string;
  sent: number;
}

/**
 * Odešle čekající akce uživatele `userId` v pořadí vzniku. Po každém kroku zavolá `persist`
 * s aktuálním stavem fronty, aby se nic neztratilo při pádu appky uprostřed.
 */
export async function syncOutbox(
  input: readonly OutboxItem[],
  userId: string,
  transport: Transport,
  persist: (items: OutboxItem[]) => void = () => undefined,
): Promise<SyncResult> {
  const items = input.map((i) => ({ ...i }));
  let sent = 0;
  const pending = () =>
    items.filter((i) => i.state === 'pending' && i.userId === userId).map((i) => items.indexOf(i));

  let queue = pending();
  while (queue.length) {
    const first = items[queue[0]!]!;
    // Dávka = souvislá řada zápisů časů téhož závodu.
    const chunk: number[] = [queue[0]!];
    if (first.kind === 'event') {
      for (const idx of queue.slice(1)) {
        const it = items[idx]!;
        if (it.kind !== 'event' || it.raceId !== first.raceId || chunk.length >= MAX_BATCH) break;
        chunk.push(idx);
      }
    }
    try {
      for (const idx of chunk) items[idx]!.attempts++;
      if (first.kind === 'event') {
        const events = chunk.map(
          (idx) => (items[idx] as Extract<OutboxItem, { kind: 'event' }>).event,
        );
        const results = new Map(
          (await transport.sendEvents(first.raceId, events)).map((r) => [r.id, r]),
        );
        for (const idx of chunk) {
          const it = items[idx] as Extract<OutboxItem, { kind: 'event' }>;
          const r = results.get(it.event.id);
          if (!r) continue; // server o akci neví — zkusí se příště
          if (r.status === 'rejected') {
            it.state = 'rejected';
            it.error = r.reason ?? 'Akce byla odmítnuta.';
          } else {
            it.state = 'sent';
            sent++;
          }
        }
      } else if (first.kind === 'status') {
        await transport.setStatus(first.raceId, first.participantId, first.status);
        first.state = 'sent';
        sent++;
      } else {
        const r = await transport.register(first.raceId, first.registration);
        first.state = 'sent';
        sent++;
        if (r.bibChanged) {
          first.warning =
            `Číslo ${r.requestedBib} bylo obsazené — ${r.participant.firstName} ` +
            `${r.participant.lastName} má číslo ${r.participant.bib}. Vyměňte startovní číslo!`;
        }
      }
    } catch (err) {
      if (!isPermanent(err)) {
        persist(items);
        return { items, sent, error: err instanceof Error ? err.message : String(err) };
      }
      for (const idx of chunk) {
        items[idx]!.state = 'rejected';
        items[idx]!.error = (err as Error).message;
      }
    }
    persist(items);
    queue = pending();
    // Pojistka proti zacyklení: položka bez výsledku zůstává pending → ukončit kolo.
    if (queue[0] === chunk[0]) break;
  }
  return { items, sent };
}
