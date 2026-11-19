/**
 * Veřejná tabule pro kiosk / TV (design/navrh/Kiosk.dc.html, design_claude.md 4.2): tmavý režim,
 * velké písmo, bez interakce. Kategorie se samy střídají; vpravo „Právě v cíli“, kde jsou
 * závodníci a QR kód na veřejnou tabuli. Route `/vysledky/:raceId/kiosk`.
 *
 * Parametry v URL: `?interval=25` (sekundy na kategorii), `?radku=10` (počet řádků).
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  barScaleMs,
  disciplineMedians,
  formatDuration,
  gapMs,
  latestFinishers,
  trackCounts,
  type PublicCategoryDto,
} from '@triatlon/shared';
import { useNow } from '../hooks';
import { DisciplineBar, QrCode } from './board';
import { clock, disciplineVar, usePublicResults } from './board-utils';

const MEDAL = ['gold', 'silver', 'bronze'];

export function KioskBoard() {
  const { raceId = '' } = useParams();
  const [params] = useSearchParams();
  const { results, live } = usePublicResults(raceId);
  const now = useNow(500);
  const intervalS = Math.max(5, Number(params.get('interval')) || 25);
  const rowCount = Math.max(3, Math.min(20, Number(params.get('radku')) || 10));

  // Kiosk má vždy tmavý vzhled (nezávisle na nastavení systému).
  useEffect(() => {
    document.documentElement.classList.add('kiosk-root');
    return () => document.documentElement.classList.remove('kiosk-root');
  }, []);

  const data = results.data;
  // Střídají se skupiny, které už startovaly; dokud nestartoval nikdo, všechny.
  const rotation = useMemo(() => {
    const groups = data?.groups ?? [];
    const started = groups.filter((g) => g.counts.started > 0);
    return started.length ? started : groups;
  }, [data]);

  const [start] = useState(() => Date.now());
  const slot = Math.floor((now - start) / (intervalS * 1000));
  const index = rotation.length ? slot % rotation.length : 0;
  const remaining = intervalS - Math.floor(((now - start) / 1000) % intervalS);
  const progress = (((now - start) / 1000) % intervalS) / intervalS;

  if (results.error) return <div className="kiosk kiosk-msg">{String(results.error)}</div>;
  if (!data) return <div className="kiosk kiosk-msg">Načítám výsledky…</div>;

  const group = rotation[index];
  const next = rotation[(index + 1) % rotation.length];
  const publicUrl = `${window.location.origin}/vysledky/${raceId}`;
  const displayUrl = publicUrl.replace(/^https?:\/\//, '');
  const legNames = data.disciplines.map((d) => d.name);
  const legs = legNames.length;

  const totals = data.groups.reduce(
    (a, g) => ({
      racing: a.racing + Math.max(0, g.counts.started - g.counts.finished - g.counts.dnf),
      finished: a.finished + g.counts.finished,
      closed: a.closed + (g.closedAt ? 1 : 0),
    }),
    { racing: 0, finished: 0, closed: 0 },
  );
  const feed = latestFinishers(
    data.groups.map((g) => ({ table: g, rows: g.rows })),
    3,
  );
  const track = data.groups
    .filter((g) => g.counts.started > 0)
    .map((g) => ({ g, ...trackCounts(g.rows, legs) }));
  const maxCell = Math.max(1, ...track.flatMap((t) => t.legs));

  return (
    <div className="kiosk">
      <header className="k-head">
        <div>
          <div className="k-race">
            {data.race.name} {data.race.year}
            {data.race.status === 'running' && live && (
              <span className="live-badge">
                <span className="dot" />
                ŽIVĚ
              </span>
            )}
          </div>
          <h1>{group?.name ?? 'Zatím bez výsledků'}</h1>
        </div>
        <div className="k-clock">
          <div className="k-time">{clock(now)}</div>
          {rotation.length > 1 && next && (
            <>
              <div className="k-next">
                Kategorie {index + 1} / {rotation.length} · další <strong>{next.name}</strong> za{' '}
                {remaining} s
              </div>
              <div className="k-progress">
                <div style={{ width: `${progress * 100}%` }} />
              </div>
            </>
          )}
        </div>
      </header>

      <div className="k-main">
        <section aria-label="Pořadí" className="k-table">
          {group ? <KioskRows group={group} rowCount={rowCount} legNames={legNames} /> : null}
        </section>
        <aside className="k-side">
          <section className="k-panel">
            <h2>Právě v cíli</h2>
            {feed.length === 0 && <p className="k-muted">Zatím nikdo nedoběhl.</p>}
            {feed.map(({ table, row, at }) => (
              <div key={`${table.id}-${row.locality}-${row.bib}`} className="k-feed">
                <span
                  className={`k-feed-dot ${row.rank && row.rank <= 3 ? MEDAL[row.rank - 1] : ''}`}
                />
                <span className="k-feed-main">
                  <span>
                    <strong>{row.bib}</strong> · {row.name ?? 'Jméno nezveřejněno'}
                  </span>
                  <span className="k-muted">
                    {table.name} · {row.rank ? `${row.rank}. místo` : ''}
                  </span>
                </span>
                <span className="k-feed-time">
                  <strong>{formatDuration(row.totalMs)}</strong>
                  <span className="k-muted">{clock(at)}</span>
                </span>
              </div>
            ))}
          </section>

          {track.length > 0 && (
            <section className="k-panel">
              <h2>Kde jsou závodníci</h2>
              <div
                className="k-heat"
                style={{
                  gridTemplateColumns: `minmax(0, 2.2fr) repeat(${legs + 1}, minmax(0, 1fr))`,
                }}
              >
                <span />
                {legNames.map((n) => (
                  <span key={n} className="k-heat-h">
                    {n}
                  </span>
                ))}
                <span className="k-heat-h">Cíl</span>
                {track.map((t) => (
                  <div key={t.g.id} className="k-heat-row">
                    <span className="k-heat-cat">{t.g.name}</span>
                    {t.legs.map((n, k) => (
                      <span
                        key={k}
                        className="k-heat-cell"
                        style={{
                          background: n
                            ? `color-mix(in srgb, ${disciplineVar(k)} ${Math.round(25 + (n / maxCell) * 75)}%, transparent)`
                            : undefined,
                        }}
                      >
                        {n || ''}
                      </span>
                    ))}
                    <span className="k-heat-cell fin">{t.finished || ''}</span>
                  </div>
                ))}
              </div>
              <div className="k-muted small">Čísla = závodníci na úseku, sytější = víc lidí</div>
            </section>
          )}

          <section className="k-qr" aria-label="Výsledky v mobilu">
            <QrCode text={publicUrl} size={168} />
            <div>
              <strong>
                Výsledky
                <br />v mobilu
              </strong>
              <span>Naskenujte kód, nebo otevřete:</span>
              <span className="k-url">{displayUrl}</span>
            </div>
          </section>
        </aside>
      </div>

      <footer className="k-foot">
        <span>
          Na trati <strong>{totals.racing}</strong> · v cíli <strong>{totals.finished}</strong> ·
          uzavřené kategorie{' '}
          <strong>
            {totals.closed} / {data.groups.length}
          </strong>
        </span>
        <span>
          Živé výsledky všech kategorií: <strong>{displayUrl}</strong>
        </span>
      </footer>
    </div>
  );
}

function KioskRows({
  group,
  rowCount,
  legNames,
}: {
  group: PublicCategoryDto;
  rowCount: number;
  legNames: string[];
}) {
  const rows = group.rows.filter((r) => r.state !== 'not_started').slice(0, rowCount);
  const scale = barScaleMs(group.rows);
  const medians = disciplineMedians(group.rows);
  return (
    <>
      <div className="k-row k-row-head">
        <span>Poř.</span>
        <span>Číslo</span>
        <span>Závodník</span>
        <span>{legNames.join(' · ')}</span>
        <span className="r">Čas</span>
        <span className="r">Ztráta</span>
      </div>
      {rows.length === 0 && <p className="k-muted">Kategorie ještě nestartovala.</p>}
      {rows.map((r) => {
        const done = r.state === 'finished';
        const gap = gapMs(r, group.rows);
        return (
          <div key={`${r.locality}-${r.bib}`} className={`k-row ${done ? '' : 'pending'}`}>
            <span
              className={`k-rank ${done && r.rank && r.rank <= 3 ? MEDAL[r.rank - 1] : ''} ${r.state}`}
            >
              {r.state === 'dnf'
                ? 'DNF'
                : r.rank === null
                  ? '–'
                  : done
                    ? `${r.rank}.${r.tied ? '=' : ''}`
                    : `(${r.rank}.)`}
            </span>
            <span className="k-bib">{r.bib}</span>
            <span className="k-name">
              <span>{r.name ?? 'Jméno nezveřejněno'}</span>
              <span className={`loc-badge ${r.locality === 'local' ? 'local' : 'guest'}`}>
                {r.locality === 'local' ? 'D' : 'H'}
              </span>
            </span>
            <DisciplineBar row={r} scale={scale} medians={medians} className="k-bar" />
            <span className="r k-total">
              {done ? formatDuration(r.totalMs) : r.state === 'dnf' ? 'DNF' : 'na trati'}
            </span>
            <span className="r k-muted">{gap ? `+${formatDuration(gap)}` : ''}</span>
          </div>
        );
      })}
    </>
  );
}
