import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatDuration,
  type CategoryResultsDto,
  type RaceDetailDto,
  type RankingOverrideInput,
  type ResultRow,
} from '@triatlon/shared';
import { useSearchParams } from 'react-router';
import { http } from '../../api';
import { keys, useIsAdmin, useRace, useRaceId, useRaceStream, useResults } from '../../hooks';
import { ErrorBox, Loading } from '../../ui';
import { LiveBadge } from './OverviewTab';
import { ParticipantPanel } from './ParticipantPanel';

const STATE_LABEL: Record<ResultRow['state'], string> = {
  finished: 'v cíli',
  racing: 'na trati',
  dnf: 'nedokončil (DNF)',
  not_started: 'nestartoval',
  disqualified: 'DSQ',
};

export function ResultsTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const results = useResults(raceId);
  const live = useRaceStream(raceId);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);

  if (results.error) return <ErrorBox error={results.error} />;
  if (!race.data || !results.data) return <Loading />;

  const withParticipants = results.data.categories.filter((c) => c.counts.registered > 0);
  const order = new Map(race.data.categories.map((c, i) => [c.id, i]));
  withParticipants.sort((a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0));
  const categoryId = params.get('kategorie') ?? withParticipants[0]?.categoryId;
  const category = results.data.categories.find((c) => c.categoryId === categoryId);

  return (
    <div className="stack">
      <div className="row">
        <select
          value={categoryId ?? ''}
          onChange={(e) => {
            setSelected(null);
            setParams({ kategorie: e.target.value });
          }}
        >
          {withParticipants.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              {c.closedAt ? '✓ ' : ''}
              {c.name} ({c.counts.finished}/{c.counts.registered - c.counts.absent} v cíli)
            </option>
          ))}
        </select>
        <LiveBadge live={live} />
        <span className="muted">
          Pořadí na celé sekundy; u nedokončených průběžné (poslední checkpoint, čas od startu).
        </span>
      </div>
      {!category ? (
        <p className="muted">Žádná kategorie se závodníky.</p>
      ) : (
        <>
          <CloseCategory race={race.data} category={category} users={results.data.users} />
          <Ties race={race.data} category={category} />
          <ResultsTable
            race={race.data}
            category={category}
            selected={selected}
            onSelect={(id) => setSelected(id === selected ? null : id)}
          />
          {selected && category.rows.some((r) => r.participantId === selected) && (
            <ParticipantPanel
              race={race.data}
              category={category}
              row={category.rows.find((r) => r.participantId === selected)!}
              users={results.data.users}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ResultsTable({
  race,
  category,
  selected,
  onSelect,
}: {
  race: RaceDetailDto;
  category: CategoryResultsDto;
  selected: string | null;
  onSelect: (participantId: string) => void;
}) {
  const checkpoints = category.checkpointIds
    .map((id) => race.checkpoints.find((c) => c.id === id)!)
    .filter(Boolean)
    .slice(1); // start má elapsed 0 — nezobrazuje se
  const disciplines =
    category.rows[0]?.disciplines.map((d) =>
      race.disciplines.find((x) => x.id === d.disciplineId)!,
    ) ?? [];

  return (
    <table className="results">
      <thead>
        <tr>
          <th className="num">Poř.</th>
          <th className="num">Č.</th>
          <th>Jméno</th>
          {checkpoints.map((c) => (
            <th
              key={c.id}
              className={`num ${c.kind === 'intermediate' ? 'sub-col' : ''}`}
              title="Čas od startu"
            >
              {c.name}
            </th>
          ))}
          {disciplines.map((d) => (
            <th key={d.id} className="num discipline-col">
              {d.name}
            </th>
          ))}
          <th className="num">Celkem</th>
          <th>Stav</th>
        </tr>
      </thead>
      <tbody>
        {category.rows.map((r) => {
          const split = new Map(r.splits.map((s) => [s.checkpointId, s]));
          return (
            <tr
              key={r.participantId}
              className={`clickable ${selected === r.participantId ? 'selected' : ''} ${r.state === 'disqualified' ? 'dimmed' : ''}`}
              onClick={() => onSelect(r.participantId)}
            >
              <td className="num">
                <strong>{r.rank ?? '—'}</strong>
                {r.tied && (
                  <span className="flag warn" title="Remíza — čeká na rozhodnutí admina">
                    =
                  </span>
                )}
                {r.rankOverridden && (
                  <span className="flag" title="Pořadí v remíze určil admin">
                    ✓
                  </span>
                )}
              </td>
              <td className="num">{r.bib}</td>
              <td>
                {r.lastName} {r.firstName}
                {r.notes.length > 0 && (
                  <span className="flag" title={r.notes.map((n) => n.text).join('\n')}>
                    💬
                  </span>
                )}
              </td>
              {checkpoints.map((c) => {
                const s = split.get(c.id);
                return (
                  <td key={c.id} className={`num ${c.kind === 'intermediate' ? 'sub-col' : ''}`}>
                    {s ? formatDuration(s.elapsedMs) : ''}
                    {s?.corrected && (
                      <span className="flag" title="Opraveno adminem">
                        ✎
                      </span>
                    )}
                    {s?.conflict && (
                      <span className="flag warn" title="Víc záznamů — platí dřívější, ověřte">
                        ⚠
                      </span>
                    )}
                  </td>
                );
              })}
              {r.disciplines.map((d) => (
                <td key={d.disciplineId} className="num discipline-col">
                  {d.ms === null ? '' : formatDuration(d.ms)}
                </td>
              ))}
              <td className="num">
                <strong>{formatDuration(r.totalMs, true)}</strong>
              </td>
              <td className="muted">{STATE_LABEL[r.state]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Uzavření kategorie ředitelem závodu (nebo adminem): výsledky se stanou oficiálními, kdo je
 * ještě na trati, nedokončil (DNF), organizátoři už do kategorie nezapisují.
 */
function CloseCategory({
  race,
  category,
  users,
}: {
  race: RaceDetailDto;
  category: CategoryResultsDto;
  users: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const path = `/races/${race.id}/categories/${category.categoryId}`;
  const done = async () => {
    setReason('');
    await queryClient.invalidateQueries({ queryKey: keys.results(race.id) });
    await queryClient.invalidateQueries({ queryKey: keys.race(race.id) });
  };
  const close = useMutation({ mutationFn: () => http.post(`${path}/close`), onSuccess: done });
  const reopen = useMutation({
    mutationFn: () => http.post(`${path}/reopen`, { reason }),
    onSuccess: done,
  });
  const onCourse = category.rows.filter((r) => r.state === 'racing');

  if (category.closedAt) {
    return (
      <div className="card stack">
        <p className="ok">
          ✓ Oficiální výsledky — kategorie uzavřena{' '}
          {new Date(category.closedAt).toLocaleString('cs')}
          {category.closedBy && ` (${users[category.closedBy] ?? 'neznámý'})`}. Organizátoři už do
          ní nezapisují; admin může časy korigovat.
        </p>
        {race.isDirector && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              reopen.mutate();
            }}
          >
            <input
              required
              minLength={3}
              placeholder="Důvod znovuotevření"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button disabled={reopen.isPending}>Znovu otevřít</button>
          </form>
        )}
        <ErrorBox error={reopen.error} />
      </div>
    );
  }
  if (!race.isDirector || !category.startedAt) return null;
  return (
    <div className="card row">
      <span className="muted">
        {onCourse.length
          ? `Na trati: ${onCourse.map((r) => `${r.bib} ${r.lastName}`).join(', ')} — po uzavření nedokončili (DNF).`
          : 'Na trati už nikdo není.'}
      </span>
      <button
        className="primary"
        disabled={close.isPending}
        onClick={() => {
          const msg = onCourse.length
            ? `Uzavřít kategorii ${category.name}? ${onCourse.length} závodníků na trati bude DNF.`
            : `Uzavřít kategorii ${category.name}? Výsledky budou oficiální.`;
          if (window.confirm(msg)) close.mutate();
        }}
      >
        Uzavřít kategorii
      </button>
      <ErrorBox error={close.error} />
    </div>
  );
}

/** Remízy v kategorii a jejich ruční rozhodnutí adminem (s důvodem). */
function Ties({ race, category }: { race: RaceDetailDto; category: CategoryResultsDto }) {
  const isAdmin = useIsAdmin();
  const groups = new Map<number, ResultRow[]>();
  for (const r of category.rows) {
    if (r.tied && r.rank !== null) groups.set(r.rank, [...(groups.get(r.rank) ?? []), r]);
  }
  const active = category.overrides.filter((o) =>
    category.rows.some((r) => r.rankOverridden && o.participantIds.includes(r.participantId)),
  );
  if (!groups.size && !active.length) return null;

  const name = (id: string) => {
    const r = category.rows.find((x) => x.participantId === id);
    return r ? `${r.bib} ${r.lastName} ${r.firstName}` : '?';
  };

  return (
    <div className="card stack">
      {[...groups].map(([rank, rows]) => (
        <TieGroup
          key={rows.map((r) => r.participantId).join()}
          race={race}
          category={category}
          rank={rank}
          rows={rows}
          isAdmin={isAdmin}
        />
      ))}
      {active.map((o) => (
        <p key={o.id} className="muted">
          Pořadí v remíze určeno: {o.participantIds.map(name).join(' → ')} — důvod: „{o.reason}“
        </p>
      ))}
    </div>
  );
}

function TieGroup({
  race,
  category,
  rank,
  rows,
  isAdmin,
}: {
  race: RaceDetailDto;
  category: CategoryResultsDto;
  rank: number;
  rows: ResultRow[];
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [orderIds, setOrderIds] = useState(rows.map((r) => r.participantId));
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (input: RankingOverrideInput) =>
      http.post(`/races/${race.id}/categories/${category.categoryId}/ranking-overrides`, input),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: keys.results(race.id) });
    },
  });
  const byId = new Map(rows.map((r) => [r.participantId, r]));
  const label = (r: ResultRow) => `${r.bib} ${r.lastName} ${r.firstName}`;

  return (
    <div className="stack">
      <p className="error">
        Remíza na {rank}. místě (
        {formatDuration(rows[0]!.totalMs ?? rows[0]!.splits.at(-1)?.elapsedMs ?? null)}):{' '}
        {rows.map(label).join(', ')}
        {isAdmin && !editing && (
          <>
            {' '}
            <button className="link" onClick={() => setEditing(true)}>
              Určit pořadí
            </button>
          </>
        )}
      </p>
      {editing && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ participantIds: orderIds, reason });
          }}
        >
          <ol>
            {orderIds.map((id, i) => (
              <li key={id}>
                {label(byId.get(id)!)}{' '}
                <button
                  type="button"
                  className="link"
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...orderIds];
                    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                    setOrderIds(next);
                  }}
                >
                  ↑
                </button>
              </li>
            ))}
          </ol>
          <input
            required
            minLength={3}
            placeholder="Důvod (např. cílová fotografie)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="actions">
            <button className="primary" disabled={save.isPending}>
              Uložit pořadí
            </button>
            <button type="button" className="link" onClick={() => setEditing(false)}>
              Zrušit
            </button>
          </div>
          <ErrorBox error={save.error} />
        </form>
      )}
    </div>
  );
}
