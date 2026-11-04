import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CheckpointDto, CheckpointInput, RaceDetailDto } from '@triatlon/shared';
import { http } from '../../api';
import { keys, useIsAdmin, useRace, useRaceId } from '../../hooks';
import { ErrorBox, Loading } from '../../ui';

export function CheckpointsTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.race(raceId) });

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      http.put(`/races/${raceId}/checkpoints/order`, { checkpointIds: ids }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => http.delete(`/races/${raceId}/checkpoints/${id}`),
    onSettled: refresh,
  });
  const add = useMutation({
    mutationFn: (input: CheckpointInput) => http.post(`/races/${raceId}/checkpoints`, input),
    onSuccess: refresh,
  });

  if (!race.data) return <Loading />;
  const r = race.data;
  const ids = r.checkpoints.map((c) => c.id);

  function move(i: number, dir: -1 | 1) {
    const next = [...ids];
    [next[i], next[i + dir]] = [next[i + dir]!, next[i]!];
    reorder.mutate(next);
  }

  return (
    <div className="stack">
      <p className="muted">
        Checkpointy jsou společné pro celý závod; které platí pro kterou kategorii, se nastavuje v
        záložce Kategorie. Checkpoint s disciplínou ji ukončuje (např. „Konec plavání“ → plavání).
      </p>
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Název</th>
            <th>Ukončuje disciplínu</th>
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {r.checkpoints.map((cp, i) => (
            <CheckpointRow
              key={`${cp.id}-${cp.name}-${cp.disciplineId}`}
              cp={cp}
              race={r}
              isAdmin={isAdmin}
              onSaved={refresh}
              onUp={i > 0 ? () => move(i, -1) : undefined}
              onDown={i < ids.length - 1 ? () => move(i, 1) : undefined}
              onDelete={() => {
                if (window.confirm(`Smazat checkpoint „${cp.name}“?`)) remove.mutate(cp.id);
              }}
            />
          ))}
        </tbody>
      </table>
      <ErrorBox error={reorder.error ?? remove.error} />
      {isAdmin && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            add.mutate({
              name: String(data.get('name')),
              disciplineId: (data.get('disciplineId') as string) || null,
            });
            e.currentTarget.reset();
          }}
        >
          <input name="name" required placeholder="Název nového checkpointu" />
          <DisciplineSelect race={r} name="disciplineId" defaultValue={null} />
          <button disabled={add.isPending}>Přidat checkpoint</button>
        </form>
      )}
      <ErrorBox error={add.error} />
    </div>
  );
}

function DisciplineSelect({
  race,
  name,
  defaultValue,
  onChange,
}: {
  race: RaceDetailDto;
  name?: string;
  defaultValue: string | null;
  onChange?: (value: string | null) => void;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ''}
      onChange={(e) => onChange?.(e.target.value || null)}
    >
      <option value="">— (start)</option>
      {race.disciplines.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

function CheckpointRow({
  cp,
  race,
  isAdmin,
  onSaved,
  onUp,
  onDown,
  onDelete,
}: {
  cp: CheckpointDto;
  race: RaceDetailDto;
  isAdmin: boolean;
  onSaved: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(cp.name);
  const [disciplineId, setDisciplineId] = useState(cp.disciplineId);
  const save = useMutation({
    mutationFn: () => http.patch(`/races/${race.id}/checkpoints/${cp.id}`, { name, disciplineId }),
    onSuccess: onSaved,
  });
  const dirty = name !== cp.name || disciplineId !== cp.disciplineId;
  const discipline = race.disciplines.find((d) => d.id === cp.disciplineId);

  if (!isAdmin) {
    return (
      <tr>
        <td className="num">{cp.seq}</td>
        <td>{cp.name}</td>
        <td>{discipline?.name ?? '—'}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="num">{cp.seq}</td>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td>
        <DisciplineSelect race={race} defaultValue={cp.disciplineId} onChange={setDisciplineId} />
      </td>
      <td className="actions">
        {dirty && (
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Uložit
          </button>
        )}
        <button className="link" disabled={!onUp} onClick={onUp} title="Posunout výš">
          ↑
        </button>
        <button className="link" disabled={!onDown} onClick={onDown} title="Posunout níž">
          ↓
        </button>
        <button className="link danger" onClick={onDelete}>
          Smazat
        </button>
        <ErrorBox error={save.error} />
      </td>
    </tr>
  );
}
