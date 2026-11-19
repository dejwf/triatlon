/**
 * Přehled závodu v administraci (design/navrh/Admin.dc.html, design_claude.md 4.3): KPI, stav
 * kategorií s uzavíráním, telefony na checkpointech, průchody checkpointem, ke kontrole a audit.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEVICE_OFFLINE_AFTER_MS,
  formatDuration,
  type AuditKind,
  type CategoryResultsDto,
  type DeviceStatusDto,
  type RaceDetailDto,
  type RaceOverviewDto,
  type RaceResultsDto,
} from '@triatlon/shared';
import { Link } from 'react-router';
import { http } from '../../api';
import {
  keys,
  useNow,
  useParticipants,
  useRace,
  useRaceId,
  useRaceStream,
  useResults,
} from '../../hooks';
import { formatClock } from '../../time';
import { ErrorBox, Loading } from '../../ui';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('cs-CZ', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
const hm = (ms: number) =>
  new Date(ms).toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' });
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`;
};
/** „Jana Králová“ → „Jana K.“ */
const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)!.charAt(0)}.` : (first ?? name);
};
const pct = (n: number, total: number) => `${total ? ((n / total) * 100).toFixed(1) : 0}%`;

export function OverviewTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const results = useResults(raceId);
  const participants = useParticipants(raceId);
  const live = useRaceStream(raceId);
  const overview = useQuery({
    queryKey: ['overview', raceId],
    queryFn: () => http.get<RaceOverviewDto>(`/races/${raceId}/overview`),
    refetchInterval: 10_000,
  });
  const now = useNow();

  if (results.error) return <ErrorBox error={results.error} />;
  if (!race.data || !results.data) return <Loading />;

  const groups = groupCategories(race.data, results.data);
  const all = results.data.categories;
  const sum = (f: (c: CategoryResultsDto) => number) => all.reduce((n, c) => n + f(c), 0);
  const registered = sum((c) => c.counts.registered);
  const absent = sum((c) => c.counts.absent);
  const present = registered - absent;
  const finished = sum((c) => c.counts.finished);
  const dnf = sum((c) => c.counts.dnf);
  const racing = sum((c) => racingOf(c));
  const racingCats = all.filter((c) => racingOf(c) > 0).length;
  const onSite = participants.data?.filter((p) => p.registrationSource === 'on_site').length ?? 0;
  const closed = groups.filter((g) => g.status === 'closed').length;
  const ready = groups.filter((g) => g.status === 'ready').length;

  return (
    <div className="overview">
      <div className="row">
        <LiveBadge live={live} />
        <span className="muted small">
          {race.data.status === 'running'
            ? 'Závod probíhá'
            : race.data.status === 'finished'
              ? 'Závod dokončen'
              : 'Závod je plánovaný'}{' '}
          · {hm(now)}
        </span>
      </div>

      <div className="ov-kpis">
        <Kpi label="Registrováno" value={registered} note={onSite ? `${onSite} na místě` : ''} />
        <Kpi label="Přítomno" value={present} note={absent ? `${absent} nepřítomných` : ''} />
        <Kpi
          label="Na trati"
          value={racing}
          note={racing ? `v ${racingCats} kategoriích` : ''}
          tone="info"
        />
        <Kpi
          label="V cíli"
          value={finished}
          note={present ? `${Math.round((finished / present) * 100)} % přítomných` : ''}
          tone="ok"
        />
        <Kpi label="DNF" value={dnf} tone={dnf ? 'danger' : undefined} />
        <Kpi
          label="Uzavřené kategorie"
          value={`${closed} / ${groups.length}`}
          note={ready ? `${ready} připravené k uzavření` : ''}
        />
      </div>

      <div className="ov-grid two">
        <CategoryStatus raceId={raceId} groups={groups} />
        <Devices overview={overview.data} error={overview.error} now={now} />
      </div>
      <div className="ov-grid two">
        <Passes race={race.data} results={results.data} now={now} />
        <Issues race={race.data} results={results.data} />
      </div>
      <AuditList overview={overview.data} now={now} />
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  note?: string;
  tone?: 'ok' | 'info' | 'danger';
}) {
  return (
    <div className="ov-kpi">
      <span className="muted small">{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      <span className="muted small">{note || ' '}</span>
    </div>
  );
}

const racingOf = (c: CategoryResultsDto) =>
  Math.max(0, c.counts.started - c.counts.finished - c.counts.dnf - c.counts.disqualified);

type Status = 'closed' | 'ready' | 'running' | 'waiting';
const STATUS: Record<Status, string> = {
  closed: 'Uzavřená',
  ready: 'Doběhnuto',
  running: 'Probíhá',
  waiting: 'Nestartovala',
};

interface Group {
  key: string;
  name: string;
  categories: CategoryResultsDto[];
  startedAt: string | null;
  status: Status;
  finished: number;
  racing: number;
  dnf: number;
  waiting: number;
  total: number;
}

/** Kategorie téže věkové skupiny a pohlaví (domácí + hosté) — jako na veřejné tabuli. */
function groupCategories(race: RaceDetailDto, results: RaceResultsDto): Group[] {
  const map = new Map<string, Group>();
  for (const cat of race.categories) {
    const c = results.categories.find((r) => r.categoryId === cat.id);
    if (!c || c.counts.registered === 0) continue;
    const key = `${cat.ageGroupLabel}|${cat.gender}`;
    const g =
      map.get(key) ??
      ({
        key,
        name: cat.groupName,
        categories: [],
        startedAt: null,
        status: 'waiting',
        finished: 0,
        racing: 0,
        dnf: 0,
        waiting: 0,
        total: 0,
      } satisfies Group);
    g.categories.push(c);
    map.set(key, g);
  }
  return [...map.values()].map((g) => {
    const active = (c: CategoryResultsDto) =>
      c.counts.registered - c.counts.absent - c.counts.disqualified;
    const total = g.categories.reduce((n, c) => n + active(c), 0);
    const finished = g.categories.reduce((n, c) => n + c.counts.finished, 0);
    const dnf = g.categories.reduce((n, c) => n + c.counts.dnf, 0);
    const racing = g.categories.reduce((n, c) => n + racingOf(c), 0);
    const started = g.categories.reduce((n, c) => n + c.counts.started, 0);
    const starts = g.categories
      .map((c) => c.startedAt)
      .filter((s): s is string => !!s)
      .sort();
    const status: Status = g.categories.every((c) => c.closedAt)
      ? 'closed'
      : started === 0
        ? 'waiting'
        : racing === 0
          ? 'ready'
          : 'running';
    return {
      ...g,
      startedAt: starts[0] ?? null,
      status,
      finished,
      racing,
      dnf,
      waiting: Math.max(0, total - started),
      total,
    };
  });
}

function CategoryStatus({ raceId, groups }: { raceId: string; groups: Group[] }) {
  const queryClient = useQueryClient();
  const close = useMutation({
    mutationFn: async (g: Group) => {
      for (const c of g.categories.filter((c) => !c.closedAt)) {
        await http.post(`/races/${raceId}/categories/${c.categoryId}/close`);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.results(raceId) });
      void queryClient.invalidateQueries({ queryKey: keys.race(raceId) });
      void queryClient.invalidateQueries({ queryKey: ['overview', raceId] });
    },
  });
  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Stav kategorií</h2>
        <div className="legend">
          <span>
            <span className="swatch" style={{ background: 'var(--ok)' }} />V cíli
          </span>
          <span>
            <span className="swatch" style={{ background: 'var(--on-track)' }} />
            Na trati
          </span>
          <span>
            <span className="swatch" style={{ background: 'var(--danger)' }} />
            DNF
          </span>
          <span>
            <span className="swatch" style={{ background: 'var(--line)' }} />
            Čeká na start
          </span>
        </div>
      </div>
      <ErrorBox error={close.error} />
      {groups.length === 0 && <p className="muted pad">Závod zatím nemá žádné závodníky.</p>}
      {groups.map((g) => (
        <div key={g.key} className="ov-cat">
          <span className="ov-cat-name">
            <Link to={`../vysledky?kategorie=${g.categories[0]!.categoryId}`}>
              <strong>{g.name}</strong>
            </Link>
            <span className="muted small">
              {g.startedAt ? `start ${formatClock(g.startedAt, false)}` : 'bez startu'}
              {g.categories.length > 1 ? ' · D + H' : ''}
            </span>
          </span>
          <span className={`status-badge ${g.status}`}>{STATUS[g.status]}</span>
          <span
            className="stack-bar"
            aria-label={`V cíli ${g.finished}, na trati ${g.racing}, DNF ${g.dnf}, čeká ${g.waiting}`}
          >
            <span style={{ width: pct(g.finished, g.total), background: 'var(--ok)' }} />
            <span style={{ width: pct(g.racing, g.total), background: 'var(--on-track)' }} />
            <span style={{ width: pct(g.dnf, g.total), background: 'var(--danger)' }} />
          </span>
          <span className="num small">
            <strong>{g.finished}</strong> / {g.total}
          </span>
          <span className="ov-cat-action">
            {g.status === 'ready' ? (
              <button
                className="primary small-btn"
                disabled={close.isPending}
                onClick={() => {
                  const msg = `Uzavřít ${g.name}? Výsledky se stanou oficiálními a organizátoři už do kategorie nebudou zapisovat.`;
                  if (window.confirm(msg)) close.mutate(g);
                }}
              >
                Uzavřít
              </button>
            ) : (
              <span className="muted small">
                {g.status === 'closed'
                  ? 'oficiální'
                  : g.status === 'running'
                    ? `${g.racing} na trati`
                    : 'hromadný start v appce'}
              </span>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}

type DeviceState = 'ok' | 'warn' | 'idle';

function deviceState(d: DeviceStatusDto, now: number): DeviceState {
  const seen = d.lastSeenAt ? now - Date.parse(d.lastSeenAt) : Infinity;
  if (seen <= DEVICE_OFFLINE_AFTER_MS && d.pending === 0) return 'ok';
  if (d.pending > 0) return 'warn';
  return seen <= DEVICE_OFFLINE_AFTER_MS * 5 ? 'warn' : 'idle';
}

function Devices({
  overview,
  error,
  now,
}: {
  overview: RaceOverviewDto | undefined;
  error: unknown;
  now: number;
}) {
  const devices = overview?.devices ?? [];
  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Telefony na checkpointech</h2>
        <span className="muted small">{devices.length} zařízení</span>
      </div>
      <ErrorBox error={error} />
      {!overview && !error && <Loading />}
      {overview && devices.length === 0 && (
        <p className="muted pad">Zatím se nepřipojil žádný telefon.</p>
      )}
      {devices.map((d) => {
        const st = deviceState(d, now);
        const since = d.oldestPendingAt ?? d.lastSeenAt;
        const sync =
          st === 'ok'
            ? `před ${ago(d.lastSeenAt!, now)}`
            : st === 'warn'
              ? d.pending > 0 && since
                ? `bez signálu ${ago(since, now)}`
                : `naposledy před ${ago(d.lastSeenAt!, now)}`
              : d.lastSeenAt
                ? `neaktivní ${ago(d.lastSeenAt, now)}`
                : 'bez stavu z appky';
        const meta =
          st === 'warn' && d.pending > 0
            ? `${d.pending} ${d.pending === 1 ? 'akce' : d.pending < 5 ? 'akce' : 'akcí'} ve frontě`
            : st === 'idle'
              ? d.lastEventAt
                ? `poslední záznam ${hm(Date.parse(d.lastEventAt))}`
                : 'bez záznamů'
              : d.clockOffsetMs != null
                ? `hodiny ${d.clockOffsetMs >= 0 ? '+' : '−'}${(Math.abs(d.clockOffsetMs) / 1000).toFixed(1).replace('.', ',')} s`
                : 'hodiny neověřené';
        return (
          <div key={`${d.deviceId}-${d.user.id}`} className={`ov-device ${st}`}>
            <span className={`dot ${st}`} />
            <span className="ov-device-main">
              <strong>{d.checkpoint?.name ?? 'Mimo checkpoint'}</strong>
              <span className="muted small">
                {shortName(d.user.name)}
                {d.appVersion
                  ? ` · appka ${d.appVersion}`
                  : d.lastSeenAt
                    ? ''
                    : ' · web / starší appka'}
              </span>
            </span>
            <span className="ov-device-sync">
              <span className={`sync ${st}`}>{sync}</span>
              <span className="muted small">{meta}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

const BUCKET_MS = 5 * 60_000;
const BUCKETS = 12;

/** Průchody checkpointem po 5 minutách (počet zapsaných časů v intervalu). */
function Passes({
  race,
  results,
  now,
}: {
  race: RaceDetailDto;
  results: RaceResultsDto;
  now: number;
}) {
  const measured = race.checkpoints.slice(1);
  const [cpId, setCpId] = useState(measured.at(-1)?.id ?? '');
  const cp = race.checkpoints.find((c) => c.id === cpId);
  const times = results.categories
    .flatMap((c) => c.rows.flatMap((r) => r.splits))
    .filter((s) => s.checkpointId === cpId)
    .map((s) => Date.parse(s.ts));
  const running = race.status === 'running';
  const last = times.length ? Math.max(...times) : now;
  // Živě končí osa „teď“; když poslední průchod je starší než hodina (nebo závod neběží),
  // končí posledním průchodem — jinak by graf ukázal jen prázdné intervaly.
  const live = running && now - last < 60 * 60_000;
  const end = Math.floor((live ? Math.max(now, last) : last) / BUCKET_MS) * BUCKET_MS + BUCKET_MS;
  const buckets = Array.from({ length: BUCKETS }, (_, i) => {
    const from = end - (BUCKETS - i) * BUCKET_MS;
    return { from, n: times.filter((t) => t >= from && t < from + BUCKET_MS).length };
  });
  const max = Math.max(4, ...buckets.map((b) => b.n));
  const scale = Math.ceil(max / 4) * 4;
  const currentFrom = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Průchody checkpointem {cp?.name ?? ''}</h2>
        <select aria-label="Checkpoint" value={cpId} onChange={(e) => setCpId(e.target.value)}>
          {measured
            .slice()
            .reverse()
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <div className="hist">
        <div className="hist-axis">
          {[scale, (scale * 3) / 4, scale / 2, scale / 4, 0].map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div className="hist-plot">
          <div className="hist-bars">
            {buckets.map((b) => (
              <span
                key={b.from}
                title={`${hm(b.from)} – ${b.n} průchodů`}
                className={live && b.from === currentFrom ? 'current' : ''}
                style={{ height: `${(b.n / scale) * 100}%` }}
              />
            ))}
          </div>
          <div className="hist-labels">
            {buckets.map((b, i) => (
              <span key={b.from}>{i % 2 === 0 ? hm(b.from) : ''}</span>
            ))}
          </div>
        </div>
      </div>
      <span className="muted small pad-x">
        Počet zapsaných časů za 5 minut{live ? '. Tmavší sloupec = probíhající interval.' : '.'}{' '}
        Celkem {times.length}.
      </span>
    </section>
  );
}

interface Issue {
  kind: 'Remíza' | 'Anomálie' | 'Chybí' | 'Konflikt';
  title: string;
  desc: string;
  action: string;
  to: string;
}

/**
 * Ke kontrole: nerozhodnuté remízy, časy mimo pořadí checkpointů (anomálie), chybějící průjezd
 * před pozdějším checkpointem a více platných záznamů na jednom checkpointu (konflikt).
 */
function findIssues(race: RaceDetailDto, results: RaceResultsDto): Issue[] {
  const cpName = new Map(race.checkpoints.map((c) => [c.id, c.name]));
  const out: Issue[] = [];
  for (const c of results.categories) {
    const link = (pid?: string) =>
      `../vysledky?kategorie=${c.categoryId}${pid ? `&zavodnik=${pid}` : ''}`;
    const ties = new Map<number, typeof c.rows>();
    for (const r of c.rows) {
      if (r.tied && !r.rankOverridden && r.rank !== null && r.state === 'finished') {
        ties.set(r.rank, [...(ties.get(r.rank) ?? []), r]);
      }
    }
    for (const [rank, rows] of ties) {
      out.push({
        kind: 'Remíza',
        title: `${c.name} · ${rows.map((r) => `č. ${r.bib}`).join(' a ')}`,
        desc: `Shodný čas ${formatDuration(rows[0]!.totalMs)} na ${rank}.–${rank + rows.length - 1}. místě. Rozhodněte pořadí.`,
        action: 'Rozhodnout',
        to: link(),
      });
    }
    for (const r of c.rows) {
      const at = new Map(r.splits.map((s) => [s.checkpointId, s]));
      const passed = c.checkpointIds.filter((id) => at.has(id));
      for (let i = 1; i < passed.length; i++) {
        const a = at.get(passed[i - 1]!)!;
        const b = at.get(passed[i]!)!;
        if (b.ts < a.ts) {
          out.push({
            kind: 'Anomálie',
            title: `${c.name} · č. ${r.bib}`,
            desc: `Čas na ${cpName.get(b.checkpointId)} (${formatClock(b.ts, false)}) je dřív než na ${cpName.get(a.checkpointId)} (${formatClock(a.ts, false)}). Pravděpodobně přehozený zápis.`,
            action: 'Opravit',
            to: link(r.participantId),
          });
          break;
        }
      }
      const lastIdx = c.checkpointIds.indexOf(passed.at(-1) ?? '');
      const missing = c.checkpointIds.slice(0, lastIdx).filter((id) => !at.has(id));
      if (missing.length && r.startTs) {
        out.push({
          kind: 'Chybí',
          title: `${c.name} · č. ${r.bib}`,
          desc: `Má čas na ${cpName.get(passed.at(-1)!)}, ale chybí ${missing.map((id) => cpName.get(id)).join(', ')}.`,
          action: 'Detail',
          to: link(r.participantId),
        });
      }
      const conflict = r.splits.find((s) => s.conflict);
      if (conflict) {
        out.push({
          kind: 'Konflikt',
          title: `${c.name} · č. ${r.bib}`,
          desc: `Víc platných záznamů na ${cpName.get(conflict.checkpointId)} — platí dřívější. Ověřte.`,
          action: 'Ověřit',
          to: link(r.participantId),
        });
      }
    }
  }
  return out;
}

const ISSUE_TONE: Record<Issue['kind'], string> = {
  Remíza: 'info',
  Anomálie: 'danger',
  Chybí: 'warn',
  Konflikt: 'warn',
};

function Issues({ race, results }: { race: RaceDetailDto; results: RaceResultsDto }) {
  const issues = findIssues(race, results);
  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Ke kontrole</h2>
        <span className="muted small">
          {issues.length ? `${issues.length} otevřené` : 'vše v pořádku'}
        </span>
      </div>
      {issues.length === 0 && (
        <p className="muted pad">Žádné remízy, chybějící ani podezřelé časy.</p>
      )}
      <div className="ov-scroll">
        {issues.map((i, n) => (
          <div key={n} className="ov-issue">
            <span className={`tag ${ISSUE_TONE[i.kind]}`}>{i.kind}</span>
            <span className="ov-issue-main">
              <strong>{i.title}</strong>
              <span className="muted small">{i.desc}</span>
            </span>
            <Link className="button-link" to={i.to}>
              {i.action}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

const AUDIT_LABEL: Record<AuditKind, [string, string]> = {
  correction: ['Korekce', 'warn'],
  cancel: ['Zrušení', 'danger'],
  mass_start: ['Start', 'neutral'],
  close: ['Uzavření', 'ok'],
  reopen: ['Otevření', 'warn'],
  tie: ['Remíza', 'info'],
  registration: ['Registrace', 'info'],
  check_in: ['Check-in', 'neutral'],
  gdpr: ['GDPR', 'neutral'],
  change: ['Změna', 'neutral'],
};

function AuditList({ overview, now }: { overview: RaceOverviewDto | undefined; now: number }) {
  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <h2>Audit – poslední zásahy</h2>
      </div>
      {!overview && <Loading />}
      {overview?.audit.length === 0 && <p className="muted pad">Zatím žádné zásahy.</p>}
      <div className="ov-audit">
        {overview?.audit.map((a, i) => {
          const [label, tone] = AUDIT_LABEL[a.kind];
          return (
            <div key={i} className="ov-audit-row">
              <span className="num muted">
                {new Date(a.at).toDateString() === new Date(now).toDateString()
                  ? clock(a.at)
                  : `${new Date(a.at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} ${hm(Date.parse(a.at))}`}
              </span>
              <span className="small">{a.user ? shortName(a.user) : 'systém'}</span>
              <span className={`tag ${tone}`}>{label}</span>
              <span className="small">
                {a.text}
                {a.reason && <span className="muted"> Důvod: {a.reason}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`badge ${live ? 'live' : ''}`}
      title={live ? 'Výsledky se aktualizují živě.' : 'Připojuji živé aktualizace…'}
    >
      {live ? '● živě' : '○ offline'}
    </span>
  );
}
