/**
 * Veřejná výsledková tabule (bez přihlášení): seznam závodů, živé výsledky po kategoriích
 * a informace o zpracování osobních údajů. Data jen z `/api/public/*` (minimum osobních údajů).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatDuration,
  type PublicCategoryDto,
  type PublicRaceResultsDto,
  type PublicRaceSummaryDto,
  type ResultState,
} from '@triatlon/shared';
import { Link, Outlet, useParams, useSearchParams } from 'react-router';
import { useNow } from '../hooks';
import { ErrorBox, Loading } from '../ui';

const STATE_LABEL: Record<ResultState, string> = {
  finished: 'v cíli',
  racing: 'na trati',
  dnf: 'nedokončil',
  not_started: 'nestartoval',
  disqualified: 'diskvalifikován',
};

const RACE_STATUS: Record<PublicRaceSummaryDto['status'], string> = {
  planned: 'plánovaný',
  running: 'probíhá',
  finished: 'dokončen',
};

/** Pořadatel (správce osobních údajů) — nastavuje se při buildu webu. */
const ORGANIZER = import.meta.env.VITE_ORGANIZER_NAME ?? 'pořadatel závodu';
const CONTACT = import.meta.env.VITE_ORGANIZER_CONTACT ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/public${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Chyba ${res.status}`);
  }
  return (await res.json()) as T;
}

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
    queryFn: () => get<PublicRaceSummaryDto[]>('/races'),
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

/** Živé aktualizace: EventSource na veřejný kanál, při změně se výsledky načtou znovu. */
function useLive(raceId: string): boolean {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    const es = new EventSource(`/api/public/races/${raceId}/stream`);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['public', raceId] });
    es.onopen = () => {
      setLive(true);
      refresh();
    };
    es.onerror = () => setLive(false);
    es.addEventListener('results', refresh);
    return () => es.close();
  }, [raceId, queryClient]);
  return live;
}

export function PublicBoard() {
  const { raceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const results = useQuery({
    queryKey: ['public', raceId],
    queryFn: () => get<PublicRaceResultsDto>(`/races/${raceId}/results`),
    // Pojistka, kdyby živý kanál vypadl (mobilní data diváků).
    refetchInterval: 60_000,
  });
  const live = useLive(raceId);

  if (results.error) return <ErrorBox error={results.error} />;
  if (!results.data) return <Loading />;
  const { race, categories } = results.data;
  const category = categories.find((c) => c.id === params.get('kategorie')) ?? categories[0];

  return (
    <div className="stack">
      <div className="row">
        <h1>
          {race.name} {race.year}
        </h1>
        {race.status === 'running' && (
          <span className={`badge ${live ? 'live' : ''}`}>{live ? '● živě' : '○ připojuji…'}</span>
        )}
      </div>
      {categories.length === 0 ? (
        <p className="muted">Zatím nejsou žádné výsledky.</p>
      ) : (
        <>
          <nav className="chips" aria-label="Kategorie">
            {categories.map((c) => (
              <button
                key={c.id}
                className={c.id === category?.id ? 'chip active' : 'chip'}
                onClick={() => setParams({ kategorie: c.id }, { replace: true })}
              >
                {c.closedAt ? '✓ ' : ''}
                {c.name}
              </button>
            ))}
          </nav>
          {category && <CategoryBoard data={results.data} category={category} />}
        </>
      )}
      <p className="muted small">
        Pořadí na celé sekundy. U závodníků na trati je pořadí průběžné (podle posledního
        checkpointu). Aktualizováno {new Date(results.data.generatedAt).toLocaleTimeString('cs')}.
      </p>
    </div>
  );
}

function CategoryBoard({
  data,
  category,
}: {
  data: PublicRaceResultsDto;
  category: PublicCategoryDto;
}) {
  const now = useNow();
  const names = new Map(data.checkpoints.map((c) => [c.id, c.name]));
  // Start má čas od startu 0 — nezobrazuje se.
  const columns = category.checkpointIds.slice(1);

  return (
    <div className="stack">
      <p>
        {category.closedAt ? (
          <strong className="ok">✓ Oficiální výsledky</strong>
        ) : category.startedAt ? (
          <>
            Od startu <strong>{formatDuration(now - Date.parse(category.startedAt))}</strong>
          </>
        ) : (
          <span className="muted">Kategorie ještě nestartovala.</span>
        )}
        <span className="muted">
          {' '}
          · v cíli {category.counts.finished} z {category.counts.started}
          {category.counts.dnf ? ` · nedokončili ${category.counts.dnf}` : ''}
        </span>
      </p>
      <table className="results public-results">
        <thead>
          <tr>
            <th className="num">Poř.</th>
            <th className="num">Č.</th>
            <th>Jméno</th>
            {columns.map((id) => (
              <th key={id} className="num split-col" title="Čas od startu">
                {names.get(id)}
              </th>
            ))}
            <th className="num">Celkem</th>
          </tr>
        </thead>
        <tbody>
          {category.rows.map((r) => {
            const splits = category.checkpointIds.map((id, i) => [id, r.splitsMs[i]] as const);
            return (
              <tr
                key={r.bib}
                className={r.state === 'finished' || r.state === 'racing' ? undefined : 'dimmed'}
              >
                <td className="num">
                  <strong>{r.rank ?? '—'}</strong>
                  {r.tied ? '=' : ''}
                </td>
                <td className="num">{r.bib}</td>
                <td>
                  {r.name ?? <span className="muted">závodník č. {r.bib}</span>}
                  {r.state !== 'finished' && (
                    <span className="muted small"> · {STATE_LABEL[r.state]}</span>
                  )}
                </td>
                {splits.slice(1).map(([id, ms]) => (
                  <td key={id} className="num split-col">
                    {ms === null || ms === undefined ? '' : formatDuration(ms)}
                  </td>
                ))}
                <td className="num">
                  <strong>{r.totalMs === null ? '' : formatDuration(r.totalMs, true)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          kategorie a vyhodnocení závodu (plnění smlouvy o účasti v závodě).
        </li>
        <li>
          <strong>Startovní číslo a naměřené časy</strong> — měření a výsledky.
        </li>
        <li>
          <strong>Zveřejnění výsledků</strong> (jméno, kategorie, číslo, časy) na této stránce —
          oprávněný zájem pořadatele na zveřejnění výsledků sportovní akce. Ročník narození se
          nezveřejňuje.
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
          <strong>Výmaz</strong> — údaje anonymizujeme; časy zůstanou bez jména, aby se nezměnilo
          pořadí ostatních.
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
