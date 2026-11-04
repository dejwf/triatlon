/**
 * Stav appky: přihlášení, data závodů uložená pro offline režim, offline fronta akcí,
 * offset hodin a synchronizace se serverem. Jeden objekt mimo React; komponenty ho čtou
 * přes `useApp` (useSyncExternalStore).
 */
import { useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import type {
  AuthTokens,
  CheckInStatus,
  OnSiteRegistrationInput,
  OnSiteRegistrationResult,
  ParticipantDto,
  RaceDetailDto,
  RaceResultsDto,
  RaceSummaryDto,
  ResultEvent,
  TimeEventInput,
  TimeEventResult,
} from '@triatlon/shared';
import { estimateOffset, type ClockEstimate, type ClockSample } from './lib/clock';
import { HttpError, syncOutbox, type OutboxItem, type Transport } from './lib/outbox';
import type { RaceSnapshot } from './lib/view';
import { secure } from './secure';
import { load, save } from './storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api').replace(
  /\/$/,
  '',
);

export const uuid = (): string => Crypto.randomUUID();

export type Session = AuthTokens;

export interface AppState {
  ready: boolean;
  session: Session | null;
  /** Session vypršela, ale ve frontě zůstaly neodeslané akce — po přihlášení se odešlou. */
  sessionExpired: boolean;
  deviceId: string;
  clock: (ClockEstimate & { at: string }) | null;
  /** Odečet reakční doby obsluhy od času kliknutí (ms). */
  reactionMs: number;
  races: RaceSummaryDto[] | null;
  snapshots: Record<string, RaceSnapshot>;
  results: Record<string, RaceResultsDto>;
  outbox: OutboxItem[];
  net: {
    online: boolean | null;
    syncing: boolean;
    lastError?: string;
    lastSyncAt?: string;
  };
}

const K = {
  session: 'session',
  deviceId: 'deviceId',
  clock: 'clock',
  reaction: 'reactionMs',
  races: 'races',
  outbox: 'outbox',
  snapshot: (raceId: string) => `snapshot:${raceId}`,
  results: (raceId: string) => `results:${raceId}`,
};

let state: AppState = {
  ready: false,
  session: null,
  sessionExpired: false,
  deviceId: '',
  clock: null,
  reactionMs: 0,
  races: null,
  snapshots: {},
  results: {},
  outbox: [],
  net: { online: null, syncing: false },
};
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function setNet(patch: Partial<AppState['net']>): void {
  set({ net: { ...state.net, ...patch } });
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state),
  );
}

export const getState = (): AppState => state;

/** Aktuální čas podle serveru (lokální hodiny opravené o změřený offset). */
export function serverNow(): number {
  return Date.now() + (state.clock?.offsetMs ?? 0);
}

// ---------- HTTP ----------

let refreshing: Promise<boolean> | null = null;

async function rawFetch(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = data?.message;
    throw new HttpError(
      res.status,
      Array.isArray(msg) ? msg.join(', ') : (msg ?? `Chyba serveru (${res.status}).`),
    );
  }
  return data;
}

async function refreshSession(): Promise<boolean> {
  const session = state.session;
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const tokens: AuthTokens = await rawFetch('POST', '/auth/refresh', {
        refreshToken: session.refreshToken,
      });
      await setSession(tokens);
      return true;
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        await setSession(null);
        set({ sessionExpired: true });
      }
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Požadavek s přihlášením; při vypršení access tokenu ho jednou obnoví. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = state.session;
  if (!s) throw new HttpError(401, 'Nejste přihlášeni.');
  if (Date.parse(s.accessTokenExpiresAt) - Date.now() < 30_000) await refreshSession();
  try {
    const data = await rawFetch(method, path, body, state.session?.accessToken);
    setNet({ online: true });
    return data as T;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401 && (await refreshSession())) {
      return (await rawFetch(method, path, body, state.session?.accessToken)) as T;
    }
    if (!(err instanceof HttpError)) setNet({ online: false });
    throw err;
  }
}

export function errorText(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  return 'Server je nedostupný — zkontrolujte připojení.';
}

// ---------- start, přihlášení ----------

export async function init(): Promise<void> {
  let deviceId = load<string>(K.deviceId);
  if (!deviceId) {
    deviceId = `mobile-${uuid()}`;
    save(K.deviceId, deviceId);
  }
  const raw = await secure.get(K.session);
  set({
    ready: true,
    deviceId,
    session: raw ? (JSON.parse(raw) as Session) : null,
    clock: load(K.clock),
    reactionMs: load<number>(K.reaction) ?? 0,
    races: load(K.races),
    outbox: load<OutboxItem[]>(K.outbox) ?? [],
  });
}

async function setSession(session: Session | null): Promise<void> {
  set({ session, sessionExpired: session ? false : state.sessionExpired });
  await secure.set(K.session, session ? JSON.stringify(session) : null);
}

export async function requestCode(email: string): Promise<void> {
  await rawFetch('POST', '/auth/request', { email });
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const tokens: AuthTokens = await rawFetch('POST', '/auth/verify', {
    email,
    code,
    deviceId: state.deviceId,
  });
  await setSession(tokens);
  void syncClock();
  void sync();
}

export async function logout(): Promise<void> {
  try {
    await api('POST', '/auth/logout');
  } catch {
    // offline odhlášení — session na serveru vyprší sama
  }
  await setSession(null);
  set({ sessionExpired: false });
}

export function setReaction(ms: number): void {
  save(K.reaction, ms);
  set({ reactionMs: ms });
}

// ---------- data závodu ----------

export async function loadRaces(): Promise<void> {
  const races = await api<RaceSummaryDto[]>('GET', '/races');
  save(K.races, races);
  set({ races });
}

export function snapshotOf(raceId: string): RaceSnapshot | null {
  if (state.snapshots[raceId]) return state.snapshots[raceId];
  const stored = load<RaceSnapshot>(K.snapshot(raceId));
  if (stored) set({ snapshots: { ...state.snapshots, [raceId]: stored } });
  return stored;
}

const lastFetch = new Map<string, number>();

/** Stáhne závod, závodníky a log akcí a uloží je pro offline režim. */
export async function refreshRace(raceId: string): Promise<void> {
  const startedAt = new Date().toISOString();
  lastFetch.set(raceId, Date.now());
  const [race, participants, events] = await Promise.all([
    api<RaceDetailDto>('GET', `/races/${raceId}`),
    api<ParticipantDto[]>('GET', `/races/${raceId}/participants`),
    api<ResultEvent[]>('GET', `/races/${raceId}/time-events`),
  ]);
  const snapshot: RaceSnapshot = { race, participants, events, fetchedAt: startedAt };
  save(K.snapshot(raceId), snapshot);
  // Odeslané akce, které už jsou ve snapshotu, z fronty zmizí (upozornění zůstávají).
  const outbox = state.outbox.filter(
    (i) => !(i.raceId === raceId && i.state === 'sent' && !i.warning && i.createdAt < startedAt),
  );
  if (outbox.length !== state.outbox.length) saveOutbox(outbox);
  set({ snapshots: { ...state.snapshots, [raceId]: snapshot } });
}

export async function loadResults(raceId: string): Promise<void> {
  const results = await api<RaceResultsDto>('GET', `/races/${raceId}/results`);
  save(K.results(raceId), results);
  set({ results: { ...state.results, [raceId]: results } });
}

export function cachedResults(raceId: string): RaceResultsDto | null {
  return state.results[raceId] ?? load<RaceResultsDto>(K.results(raceId));
}

// ---------- hodiny ----------

export async function syncClock(): Promise<void> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < 5; i++) {
    const sentAt = Date.now();
    try {
      const { now } = await rawFetch('GET', '/time');
      samples.push({ sentAt, serverTime: Date.parse(now), receivedAt: Date.now() });
    } catch {
      break;
    }
  }
  const est = estimateOffset(samples);
  if (!est) return;
  const clock = { ...est, at: new Date().toISOString() };
  save(K.clock, clock);
  set({ clock });
}

// ---------- offline fronta ----------

function saveOutbox(outbox: OutboxItem[]): void {
  save(K.outbox, outbox);
  set({ outbox });
}

type NewItem =
  | { kind: 'event'; event: TimeEventInput }
  | { kind: 'status'; participantId: string; status: CheckInStatus }
  | { kind: 'register'; registration: OnSiteRegistrationInput };

/** Uloží akce do fronty (okamžitě a trvale) a zkusí je odeslat. */
export function enqueue(raceId: string, items: NewItem[]): void {
  const user = state.session?.user;
  if (!user || !items.length) return;
  const createdAt = new Date().toISOString();
  const added = items.map(
    (it) =>
      ({
        ...it,
        id: it.kind === 'event' ? it.event.id : uuid(),
        raceId,
        userId: user.id,
        createdAt,
        state: 'pending',
        attempts: 0,
      }) as OutboxItem,
  );
  saveOutbox([...state.outbox, ...added]);
  void sync();
}

/** Akce záznamu času s opraveným časem (offset hodin + reakční doba). */
export function newEvent(
  type: TimeEventInput['type'],
  participantId: string,
  checkpointId: string,
  extra: Partial<TimeEventInput> = {},
): TimeEventInput {
  const reaction = type === 'record' ? state.reactionMs : 0;
  return {
    id: uuid(),
    type,
    participantId,
    checkpointId,
    ts: new Date(serverNow() - reaction).toISOString(),
    deviceId: state.deviceId,
    ...extra,
  };
}

export function dismissItem(id: string): void {
  saveOutbox(
    state.outbox
      .map((i) => (i.id === id && i.state === 'sent' ? { ...i, warning: undefined } : i))
      .filter((i) => !(i.id === id && i.state === 'rejected')),
  );
}

const transport: Transport = {
  sendEvents: (raceId, events) =>
    api<TimeEventResult[]>('POST', `/races/${raceId}/time-events`, { events }),
  setStatus: async (raceId, participantId, status) => {
    await api('POST', `/races/${raceId}/participants/${participantId}/status`, { status });
  },
  register: (raceId, input) =>
    api<OnSiteRegistrationResult>('POST', `/races/${raceId}/participants/on-site`, input),
};

let syncing: Promise<void> | null = null;

export function sync(): Promise<void> {
  const user = state.session?.user;
  if (!user || !state.outbox.some((i) => i.state === 'pending' && i.userId === user.id)) {
    return syncing ?? Promise.resolve();
  }
  syncing ??= (async () => {
    setNet({ syncing: true });
    try {
      const res = await syncOutbox(state.outbox, user.id, transport, (items) => {
        // Mezitím mohly akce přibýt (nebo odeslané zmizet) — sloučit podle id.
        const updated = new Map(items.map((i) => [i.id, i]));
        saveOutbox(state.outbox.map((i) => updated.get(i.id) ?? i));
      });
      setNet({
        lastError: res.error,
        online: res.error ? false : true,
        lastSyncAt: res.error ? state.net.lastSyncAt : new Date().toISOString(),
      });
      if (res.sent) {
        const races = new Set(state.outbox.filter((i) => i.state === 'sent').map((i) => i.raceId));
        await Promise.all([...races].map((r) => refreshRace(r).catch(() => undefined)));
      }
    } finally {
      setNet({ syncing: false });
      syncing = null;
    }
  })();
  return syncing;
}

// ---------- smyčka na pozadí ----------

let activeRace: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function setActiveRace(raceId: string | null): void {
  activeRace = raceId;
}

/** Každých 5 s: odeslat frontu; každých 15 s obnovit aktivní závod; hodiny každých 5 min. */
export function startLoop(): () => void {
  timer ??= setInterval(() => {
    if (!state.session) return;
    void sync();
    if (activeRace && Date.now() - (lastFetch.get(activeRace) ?? 0) > 15_000) {
      void refreshRace(activeRace).catch(() => undefined);
    }
    const clockAge = state.clock ? Date.now() - Date.parse(state.clock.at) : Infinity;
    if (clockAge > 5 * 60_000) void syncClock();
  }, 5_000);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
