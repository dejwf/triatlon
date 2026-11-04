import { formatDuration } from '@triatlon/shared';
import { Link } from 'react-router';
import { useNow, useRace, useRaceId, useRaceStream, useResults } from '../../hooks';
import { formatClock } from '../../time';
import { ErrorBox, Loading } from '../../ui';

/** Admin dashboard: stav kategorií — kolik času uplynulo od startu, kolik závodníků je na trati a v cíli. */
export function OverviewTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const results = useResults(raceId);
  const live = useRaceStream(raceId);
  const now = useNow();

  if (results.error) return <ErrorBox error={results.error} />;
  if (!race.data || !results.data) return <Loading />;

  const categories = results.data.categories.filter((c) => c.counts.registered > 0);
  const order = new Map(race.data.categories.map((c, i) => [c.id, i]));
  categories.sort((a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0));

  const total = categories.reduce(
    (acc, c) => ({
      started: acc.started + c.counts.started,
      finished: acc.finished + c.counts.finished,
      registered: acc.registered + c.counts.registered - c.counts.absent,
    }),
    { started: 0, finished: 0, registered: 0 },
  );

  return (
    <div className="stack">
      <div className="row">
        <LiveBadge live={live} />
        <span className="muted">
          Na trati {total.started - total.finished} · v cíli {total.finished} ·
          přítomných/registrovaných {total.registered}
        </span>
      </div>
      {categories.length === 0 ? (
        <p className="muted">Závod zatím nemá žádné závodníky.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kategorie</th>
              <th>Start</th>
              <th className="num">Od startu</th>
              <th className="num">Závodníků</th>
              <th className="num">Na trati</th>
              <th className="num">V cíli</th>
              <th className="num">Nepřítomní</th>
              <th className="num">DSQ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const racing = c.counts.started - c.counts.finished;
              const done = c.counts.started > 0 && racing === 0;
              const active = c.counts.registered - c.counts.absent - c.counts.disqualified;
              return (
                <tr key={c.categoryId}>
                  <td>{c.name}</td>
                  <td>{formatClock(c.startedAt, false)}</td>
                  <td className="num">
                    {c.startedAt ? (
                      done ? (
                        <span className="ok">dokončeno</span>
                      ) : (
                        <strong>{formatDuration(now - Date.parse(c.startedAt))}</strong>
                      )
                    ) : (
                      <span className="muted">nestartovala</span>
                    )}
                  </td>
                  <td className="num">{active}</td>
                  <td className="num">{racing}</td>
                  <td className="num">{c.counts.finished}</td>
                  <td className="num">{c.counts.absent}</td>
                  <td className="num">{c.counts.disqualified}</td>
                  <td>
                    <Link to={`../vysledky?kategorie=${c.categoryId}`}>výsledky</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
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
