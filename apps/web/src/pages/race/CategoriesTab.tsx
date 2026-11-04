import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CategoryDto, CategoryUpdateInput, RaceDetailDto } from '@triatlon/shared';
import { http } from '../../api';
import { keys, useIsAdmin, useRace, useRaceId } from '../../hooks';
import { ErrorBox, Loading } from '../../ui';

const birthYears = (c: CategoryDto) =>
  c.birthYearFrom === null ? `${c.birthYearTo} a starší` : `${c.birthYearFrom}–${c.birthYearTo}`;

export function CategoriesTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const isAdmin = useIsAdmin();
  const [editing, setEditing] = useState<string | null>(null);

  if (!race.data) return <Loading />;
  const r = race.data;

  return (
    <table>
      <thead>
        <tr>
          <th>Kategorie</th>
          <th>Ročníky</th>
          <th>Tratě (m) plavání / kolo / běh</th>
          <th>Checkpointy</th>
          <th className="num">Závodníků</th>
          {isAdmin && <th />}
        </tr>
      </thead>
      <tbody>
        {r.categories.map((c) =>
          editing === c.id ? (
            <CategoryEditor key={c.id} race={r} category={c} onDone={() => setEditing(null)} />
          ) : (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{birthYears(c)}</td>
              <td>
                {c.distances
                  ? [c.distances.swim, c.distances.bike, c.distances.run]
                      .map((d) => d ?? '—')
                      .join(' / ')
                  : '—'}
              </td>
              <td>
                {r.checkpoints
                  .filter((cp) => c.checkpointIds.includes(cp.id))
                  .map((cp) => cp.name)
                  .join(', ')}
              </td>
              <td className="num">{c.participantCount}</td>
              {isAdmin && (
                <td>
                  <button className="link" onClick={() => setEditing(c.id)}>
                    Upravit
                  </button>
                </td>
              )}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function CategoryEditor({
  race,
  category,
  onDone,
}: {
  race: RaceDetailDto;
  category: CategoryDto;
  onDone: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [distances, setDistances] = useState({
    swim: category.distances?.swim ?? null,
    bike: category.distances?.bike ?? null,
    run: category.distances?.run ?? null,
  });
  const [checkpointIds, setCheckpointIds] = useState(new Set(category.checkpointIds));
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (input: CategoryUpdateInput) =>
      http.patch(`/races/${race.id}/categories/${category.id}`, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.race(race.id) });
      onDone();
    },
  });

  const distanceInput = (key: keyof typeof distances) => (
    <input
      type="number"
      min={0}
      className="short"
      value={distances[key] ?? ''}
      onChange={(e) =>
        setDistances({ ...distances, [key]: e.target.value === '' ? null : Number(e.target.value) })
      }
    />
  );

  return (
    <tr className="editing">
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td>{birthYears(category)}</td>
      <td>
        {distanceInput('swim')} {distanceInput('bike')} {distanceInput('run')}
      </td>
      <td>
        {race.checkpoints.map((cp) => (
          <label key={cp.id} className="check">
            <input
              type="checkbox"
              checked={checkpointIds.has(cp.id)}
              onChange={(e) => {
                const next = new Set(checkpointIds);
                if (e.target.checked) next.add(cp.id);
                else next.delete(cp.id);
                setCheckpointIds(next);
              }}
            />
            {cp.name}
          </label>
        ))}
      </td>
      <td className="num">{category.participantCount}</td>
      <td className="actions">
        <button
          className="primary"
          disabled={save.isPending}
          onClick={() => save.mutate({ name, distances, checkpointIds: [...checkpointIds] })}
        >
          Uložit
        </button>
        <button className="link" onClick={onDone}>
          Zrušit
        </button>
        <ErrorBox error={save.error} />
      </td>
    </tr>
  );
}
