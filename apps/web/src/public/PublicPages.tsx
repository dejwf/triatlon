/**
 * Veřejná výsledková tabule (bez přihlášení): seznam závodů, živé výsledky po kategoriích
 * a informace o zpracování osobních údajů. Data jen z `/api/public/*` (minimum osobních údajů).
 */
import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  barScaleMs,
  checkpointRanks,
  disciplineMedians,
  formatDuration,
  gapMs,
  type PublicCategoryDto,
  type PublicRaceResultsDto,
  type PublicRaceSummaryDto,
  type PublicResultRowDto,
} from '@triatlon/shared';
import { Link, Outlet, useParams, useSearchParams } from 'react-router';
import { useNow } from '../hooks';
import { ErrorBox, Loading } from '../ui';
import { DisciplineBar, DisciplineLegend, LocBadge } from './board';
import {
  agoText,
  clock,
  disciplineVar,
  distancesText,
  publicGet,
  stateText,
  usePublicResults,
} from './board-utils';

const RACE_STATUS: Record<PublicRaceSummaryDto['status'], string> = {
  planned: 'plánovaný',
  running: 'probíhá',
  finished: 'dokončen',
};

/** Pořadatel (správce osobních údajů) — nastavuje se při buildu webu. */
const ORGANIZER = import.meta.env.VITE_ORGANIZER_NAME ?? 'pořadatel závodu';
const CONTACT = import.meta.env.VITE_ORGANIZER_CONTACT ?? '';

export function PublicLayout() {
  return (
    <>
      <header className="topbar">
        <Link to="/vysledky" className="brand">
          <strong>Vlkančický triatlon</strong>
        </Link>
        <nav>
          <Link to="/vysledky">Výsledky</Link>
          <Link to="/ochrana-osobnich-udaju">Osobní údaje</Link>
        </nav>
      </header>
      <main className="container public">
        <Outlet />
      </main>
    </>
  );
}

export function PublicRaces() {
  const races = useQuery({
    queryKey: ['public', 'races'],
    queryFn: () => publicGet<PublicRaceSummaryDto[]>('/races'),
  });
  if (races.error) return <ErrorBox error={races.error} />;
  if (!races.data) return <Loading />;
  return (
    <div className="stack">
      <h1>Výsledky</h1>
      {races.data.length === 0 && <p className="muted">Zatím žádný závod neprobíhá.</p>}
      <ul className="race-list">
        {races.data.map((r) => (
          <li key={r.id}>
            <Link to={`/vysledky/${r.id}`}>
              <strong>
                {r.name} {r.year}
              </strong>
            </Link>{' '}
            <span className="muted">
              {new Date(r.date).toLocaleDateString('cs')} · {RACE_STATUS[r.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type View = 'spolecne' | 'domaci' | 'hoste';
const VIEW_LOCALITY = { domaci: 'local', hoste: 'guest' } as const;

export function PublicBoard() {
  const { raceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { results, live } = usePublicResults(raceId);
  const now = useNow();

  if (results.error) return <ErrorBox error={results.error} />;
  if (!results.data) return <Loading />;
  const data = results.data;
  const { race } = data;
  const groups = data.groups;
  const group = groups.find((g) => g.id === params.get('kategorie')) ?? groups[0];
  const view = (
    ['domaci', 'hoste'].includes(params.get('pohled') ?? '') ? params.get('pohled') : 'spolecne'
  ) as View;
  // Domácí / hosté = jednotlivá kategorie skupiny s pořadím v kategorii.
  const partOf = (g: PublicCategoryDto | undefined, v: Exclude<View, 'spolecne'>) =>
    data.categories.find((c) => g?.categoryIds.includes(c.id) && c.locality === VIEW_LOCALITY[v]);
  const table = view === 'spolecne' ? group : partOf(group, view);
  const go = (next: { kategorie?: string; pohled?: View }) => {
    const k = next.kategorie ?? group?.id;
    const v = next.pohled ?? view;
    setParams(
      { ...(k ? { kategorie: k } : {}), ...(v === 'spolecne' ? {} : { pohled: v }) },
      {
        replace: true,
      },
    );
  };

  return (
    <div className="board">
      <header className="board-head">
        <div>
          <div className="muted small">{longDate(race.date)}</div>
          <h1>
            {race.name} {race.year}
          </h1>
        </div>
        <div className="actions">
          {race.status === 'running' &&
            (live ? (
              <span className="live-badge">
                <span className="dot" />
                ŽIVĚ
              </span>
            ) : (
              <span className="badge">připojuji…</span>
            ))}
          {race.status === 'finished' && <span className="badge">dokončen</span>}
          <span className="muted small">
            Aktualizováno {agoText(new Date(results.dataUpdatedAt).toISOString(), now)}
          </span>
        </div>
      </header>

      {groups.length === 0 || !group ? (
        <p className="muted">Zatím nejsou žádné výsledky.</p>
      ) : (
        <>
          <nav className="chips" aria-label="Kategorie">
            {groups.map((g) => (
              <button
                key={g.id}
                className={g.id === group.id ? 'chip active' : 'chip'}
                aria-current={g.id === group.id ? 'true' : undefined}
                onClick={() => go({ kategorie: g.id })}
              >
                {g.closedAt ? '✓ ' : ''}
                {g.name}
                <span className="chip-count"> · {g.rows.length}</span>
              </button>
            ))}
          </nav>
          <section className="board-card">
            <div className="board-card-head">
              <div className="stack-tight">
                <h2>{table?.name ?? group.name}</h2>
                <CategoryMeta category={table ?? group} now={now} />
              </div>
              {table && <Counts category={table} />}
            </div>
            <div className="board-toolbar">
              <div role="group" aria-label="Pohled" className="segmented">
                {(
                  [
                    ['spolecne', 'Společně (D + H)'],
                    ['domaci', 'Domácí'],
                    ['hoste', 'Hosté'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    className={v === view ? 'active' : ''}
                    aria-pressed={v === view}
                    disabled={v !== 'spolecne' && !partOf(group, v)}
                    onClick={() => go({ pohled: v })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <DisciplineLegend names={data.disciplines.map((d) => d.name)} />
            </div>
            {table ? (
              <ResultsGrid
                key={table.id}
                data={data}
                category={table}
                combined={view === 'spolecne'}
              />
            ) : (
              <p className="muted pad">V této skupině nejsou žádní závodníci.</p>
            )}
          </section>
        </>
      )}
      <p className="muted small">
        Oficiální pořadí pro vyhlášení je pořadí v kategorii (domácí a hosté zvlášť):{' '}
        <strong>D 1.</strong> / <strong>H 1.</strong> Pořadí na celé sekundy; u závodníků na trati
        je průběžné (podle posledního checkpointu). Jména zobrazujeme jen se souhlasem závodníka.
        Kliknutím na řádek zobrazíte detail.{' '}
        <Link to={`/vysledky/${raceId}/kiosk`}>Zobrazení pro TV / kiosk</Link>
      </p>
    </div>
  );
}

const longDate = (iso: string) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function CategoryMeta({ category, now }: { category: PublicCategoryDto; now: number }) {
  const parts = [distancesText(category)];
  if (category.startedAt) parts.push(`start ${clock(Date.parse(category.startedAt))}`);
  return (
    <div className="muted small">
      {parts.filter(Boolean).join(' · ')}
      {parts.some(Boolean) && ' · '}
      {category.closedAt ? (
        <strong className="ok">✓ oficiální výsledky</strong>
      ) : category.startedAt ? (
        <>
          od startu {formatDuration(now - Date.parse(category.startedAt))} ·{' '}
          <strong className="warn-text">průběžné výsledky</strong> (kategorie zatím není uzavřená)
        </>
      ) : (
        'kategorie ještě nestartovala'
      )}
    </div>
  );
}

function Counts({ category }: { category: PublicCategoryDto }) {
  const { started, finished, dnf } = category.counts;
  return (
    <div className="kpis">
      <div className="kpi">
        <span>Odstartovalo</span>
        <strong>{started}</strong>
      </div>
      <div className="kpi ok">
        <span>V cíli</span>
        <strong>{finished}</strong>
      </div>
      <div className="kpi info">
        <span>Na trati</span>
        <strong>{Math.max(0, started - finished - dnf)}</strong>
      </div>
      <div className="kpi">
        <span>DNF</span>
        <strong>{dnf}</strong>
      </div>
    </div>
  );
}

const MEDAL = ['gold', 'silver', 'bronze'];

/**
 * Tabulka výsledků (design_claude.md 4.1): pořadí, číslo, D/H, závodník, pruh rozložení času,
 * časy disciplín, celkem, ztráta a vývoj pořadí. Klik na řádek rozbalí detail.
 */
function ResultsGrid({
  data,
  category,
  combined,
}: {
  data: PublicRaceResultsDto;
  category: PublicCategoryDto;
  /** Domácí i hosté v jedné tabulce → D/H hned u čísla (čísla se opakují) + pořadí v kategorii. */
  combined: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = category.rows;
  const scale = barScaleMs(rows);
  const medians = disciplineMedians(rows);
  const ranks = checkpointRanks(rows);
  const kindOf = new Map(data.checkpoints.map((c) => [c.id, c.kind]));
  // Vývoj pořadí jen na hranicích disciplín (bez startu).
  const transitionIdx = category.checkpointIds
    .map((id, i) => (i > 0 && kindOf.get(id) === 'transition' ? i : -1))
    .filter((i) => i > 0);
  const legNames = data.disciplines.map((d) => d.name);
  const legCount = Math.max(0, ...rows.map((r) => r.disciplinesMs.length));
  const short = (n: string) => (n.length > 6 ? `${n.slice(0, 4)}.` : n);

  return (
    <div className="rgrid-wrap">
      <div
        className="rgrid"
        role="table"
        aria-label={`Výsledky ${category.name}`}
        style={{ '--legs': legCount } as CSSProperties}
      >
        <div className="rrow rhead" role="row">
          <span role="columnheader" className="c-rank">
            Poř.
          </span>
          <span role="columnheader" className="c-bib">
            Č.
          </span>
          <span role="columnheader" className="c-loc" title="Domácí / host">
            {combined ? 'D/H' : ''}
          </span>
          <span role="columnheader" className="c-name">
            Závodník
          </span>
          <span role="columnheader" className="c-bar">
            Rozložení času
          </span>
          {Array.from({ length: legCount }, (_, i) => (
            <span key={i} role="columnheader" className={`c-leg c-leg${i}`} title={legNames[i]}>
              {short(legNames[i] ?? `Úsek ${i + 1}`)}
            </span>
          ))}
          <span role="columnheader" className="c-total">
            Celkem
          </span>
          <span role="columnheader" className="c-gap">
            Ztráta
          </span>
          <span role="columnheader" className="c-trend">
            Vývoj poř.
          </span>
        </div>
        {rows.map((r, i) => {
          const key = `${r.locality}-${r.bib}`;
          const expanded = open === key;
          const gap = gapMs(r, rows);
          const progress = transitionIdx.map((k) => ranks[i]![k]);
          const reached = progress.filter((p) => p != null);
          const trend =
            r.state === 'finished'
              ? reached.join(' → ')
              : r.state === 'racing' && reached.length
                ? `${reached.join(' → ')} → …`
                : '—';
          const done = r.state === 'finished';
          return (
            <div
              key={key}
              className={`rbody ${expanded ? 'expanded' : ''} ${done ? '' : 'pending'}`}
              role="rowgroup"
            >
              <div
                className="rrow"
                role="row"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpen(expanded ? null : key);
                  }
                }}
              >
                <span
                  role="cell"
                  className={`c-rank ${done && r.rank && r.rank <= 3 ? MEDAL[r.rank - 1] : ''} ${r.state}`}
                >
                  {r.state === 'dnf' ? (
                    'DNF'
                  ) : r.rank === null ? (
                    '–'
                  ) : done ? (
                    `${r.rank}.${r.tied ? '=' : ''}`
                  ) : (
                    <span title="Průběžné pořadí">({r.rank}.)</span>
                  )}
                </span>
                <span role="cell" className="c-bib">
                  {r.bib}
                </span>
                <span role="cell" className="c-loc">
                  {combined && <LocBadge locality={r.locality} />}
                </span>
                <span role="cell" className="c-name">
                  <span className={r.name ? 'name' : 'name hidden-name'}>
                    {r.name ?? 'Jméno nezveřejněno'}
                  </span>
                  <span className="muted small">
                    {done && combined && r.categoryRank !== null
                      ? `Pořadí v kategorii: ${r.locality === 'local' ? 'D' : 'H'} ${r.categoryRank}.${r.categoryTied ? '=' : ''}`
                      : stateText(r, category, data)}
                  </span>
                </span>
                <span role="cell" className="c-bar">
                  <DisciplineBar row={r} scale={scale} medians={medians} />
                </span>
                {Array.from({ length: legCount }, (_, k) => (
                  <span key={k} role="cell" className={`c-leg c-leg${k}`}>
                    {r.disciplinesMs[k] == null ? '–' : formatDuration(r.disciplinesMs[k]!)}
                  </span>
                ))}
                <span role="cell" className="c-total">
                  {done
                    ? formatDuration(r.totalMs)
                    : r.state === 'racing'
                      ? 'na trati'
                      : r.state === 'dnf'
                        ? 'DNF'
                        : '–'}
                </span>
                <span role="cell" className="c-gap muted">
                  {gap ? `+${formatDuration(gap)}` : ''}
                </span>
                <span role="cell" className="c-trend muted">
                  {trend}
                </span>
              </div>
              {expanded && (
                <RowDetail
                  data={data}
                  category={category}
                  row={r}
                  ranks={ranks[i]!}
                  medians={medians}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Detail závodníka (3.3): úseky proti mediánu dokončených a časová osa checkpointů. */
function RowDetail({
  data,
  category,
  row,
  ranks,
  medians,
}: {
  data: PublicRaceResultsDto;
  category: PublicCategoryDto;
  row: PublicResultRowDto;
  ranks: (number | null)[];
  medians: (number | null)[];
}) {
  const names = new Map(data.checkpoints.map((c) => [c.id, c.name]));
  const legs = row.disciplinesMs.map((ms, k) => ({ ms, med: medians[k] ?? null, k }));
  return (
    <div className="rdetail">
      <div className="stack-tight">
        <strong className="small">Úseky proti mediánu kategorie</strong>
        {legs.map(({ ms, med, k }) => {
          const max = Math.max(ms ?? 0, med ?? 0) * 1.1 || 1;
          const diff = ms != null && med != null ? ms - med : null;
          return (
            <div key={k} className="leg-cmp">
              <span className="muted">{data.disciplines[k]?.name ?? `Úsek ${k + 1}`}</span>
              <span className="leg-bars">
                <span
                  style={{ width: `${((ms ?? 0) / max) * 100}%`, background: disciplineVar(k) }}
                />
                <span
                  className="median"
                  style={{ width: `${((med ?? 0) / max) * 100}%`, background: disciplineVar(k) }}
                />
              </span>
              <span className={diff == null ? 'muted' : diff <= 0 ? 'faster' : 'slower'}>
                {ms == null ? '–' : formatDuration(ms)}
                {diff != null && ` (${diff <= 0 ? '−' : '+'}${formatDuration(Math.abs(diff))})`}
              </span>
            </div>
          );
        })}
        <span className="muted small">Plný pruh = závodník, světlý = medián dokončených</span>
      </div>
      <div className="stack-tight">
        <strong className="small">Čas od startu na checkpointech</strong>
        <ol className="timeline">
          {category.checkpointIds.map((id, k) => {
            const ms = row.splitsMs[k];
            return (
              <li key={id} className={ms == null ? 'todo' : ''}>
                <span className="tl-dot" />
                <span className="muted small">{names.get(id)}</span>
                <strong>
                  {k === 0
                    ? row.startedAt
                      ? clock(Date.parse(row.startedAt))
                      : '–'
                    : ms == null
                      ? '–'
                      : formatDuration(ms)}
                </strong>
                <span className="muted small">
                  {k > 0 && ranks[k] != null ? `${ranks[k]}. místo` : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Informace o zpracování osobních údajů (GDPR, čl. 13). Text je třeba nechat ověřit. */
export function PrivacyPage() {
  return (
    <article className="stack prose">
      <h1>Ochrana osobních údajů</h1>
      <p>
        Správcem osobních údajů závodníků je {ORGANIZER}
        {CONTACT && (
          <>
            {' '}
            (kontakt: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>)
          </>
        )}
        .
      </p>
      <h2>Jaké údaje zpracováváme a proč</h2>
      <ul>
        <li>
          <strong>Jméno, příjmení, ročník narození, pohlaví, místní / host</strong> — zařazení do
          kategorie a vyhodnocení závodu (plnění smlouvy o účasti v závodě). Volitelně{' '}
          <strong>přezdívka</strong> a volba oslovení ve výsledcích (formálně / neformálně).
        </li>
        <li>
          <strong>Startovní číslo a naměřené časy</strong> — měření a výsledky.
        </li>
        <li>
          <strong>Zveřejnění výsledků</strong> (jméno, případně přezdívka, kategorie, číslo, časy)
          na této stránce — oprávněný zájem pořadatele na zveřejnění výsledků sportovní akce. Ročník
          narození se nezveřejňuje; jen u neformálního oslovení se při shodě jmen v tabulce doplní
          začátek příjmení a případně poslední dvojčíslí ročníku (např. „Honza No 99“).
        </li>
      </ul>
      <h2>Vaše práva</h2>
      <ul>
        <li>
          <strong>Nezveřejnění jména</strong> — na požádání se ve výsledcích zobrazí jen startovní
          číslo.
        </li>
        <li>
          <strong>Přístup a přenositelnost</strong> — na požádání vám pošleme všechny údaje, které o
          vás vedeme.
        </li>
        <li>
          <strong>Výmaz</strong> — údaje (i přezdívku) anonymizujeme; časy zůstanou bez jména, aby
          se nezměnilo pořadí ostatních.
        </li>
        <li>Stížnost u Úřadu pro ochranu osobních údajů (uoou.gov.cz).</li>
      </ul>
      <h2>Kde a jak dlouho</h2>
      <p>
        Data jsou uložena na serverech v EU. Osobní údaje uchováváme po dobu nezbytnou pro
        vyhodnocení a archiv výsledků ročníku; o výmaz můžete kdykoli požádat.
      </p>
    </article>
  );
}
