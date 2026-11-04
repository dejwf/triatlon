import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CheckpointDto,
  CheckpointInput,
  CheckpointKind,
  RaceDetailDto,
} from '@triatlon/shared';
import { http } from '../../api';
import { keys, useIsAdmin, useRace, useRaceId } from '../../hooks';
import { ErrorBox, Loading } from '../../ui';

const KIND_LABEL: Record<CheckpointKind, string> = {
  transition: 'hranice disciplíny',
  intermediate: 'sub-checkpoint',
};

/** Popis vztahu checkpointu k disciplíně: hranice ji ukončuje, sub-checkpoint v ní leží. */
function disciplineText(cp: CheckpointDto, race: RaceDetailDto): string {
  const d = race.disciplines.find((x) => x.id === cp.disciplineId);
  if (cp.kind === 'intermediate') return `během: ${d?.name ?? '?'}`;
  return d ? `ukončuje: ${d.name}` : 'start';
}

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
        <strong>Hranice disciplíny</strong> (start, konec plavání, konec kola, cíl) ukončuje
        disciplínu — z hranic se počítají časy disciplín. <strong>Sub-checkpoint</strong> je mezičas
        uvnitř disciplíny (např. otočka na kopci během cyklistiky), nic neukončuje a zařadí se
        automaticky před konec své disciplíny. Které checkpointy platí pro kterou kategorii, se
        nastavuje v záložce Kategorie.
      </p>
      <table className="checkpoints">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Název</th>
            <th>Typ</th>
            <th>Disciplína</th>
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {r.checkpoints.map((cp, i) => (
            <CheckpointRow
              key={`${cp.id}-${cp.name}-${cp.kind}-${cp.disciplineId}`}
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
      {isAdmin && <AddCheckpoint race={r} onAdded={refresh} />}
    </div>
  );
}

/** Výběr typu + disciplíny. U sub-checkpointu je disciplína povinná a nenabízí „start“. */
function KindAndDiscipline({
  race,
  kind,
  disciplineId,
  onChange,
}: {
  race: RaceDetailDto;
  kind: CheckpointKind;
  disciplineId: string | null;
  onChange: (kind: CheckpointKind, disciplineId: string | null) => void;
}) {
  return (
    <>
      <select
        aria-label="Typ checkpointu"
        value={kind}
        onChange={(e) => {
          const next = e.target.value as CheckpointKind;
          // Sub-checkpoint nemůže být „start“ — předvyplní se první disciplína.
          onChange(
            next,
            next === 'intermediate' && !disciplineId
              ? (race.disciplines[0]?.id ?? null)
              : disciplineId,
          );
        }}
      >
        {Object.entries(KIND_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label={kind === 'intermediate' ? 'Během disciplíny' : 'Ukončuje disciplínu'}
        value={disciplineId ?? ''}
        required={kind === 'intermediate'}
        onChange={(e) => onChange(kind, e.target.value || null)}
      >
        {kind === 'transition' && <option value="">start (nic neukončuje)</option>}
        {race.disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {kind === 'intermediate' ? `během: ${d.name}` : `ukončuje: ${d.name}`}
          </option>
        ))}
      </select>
    </>
  );
}

function AddCheckpoint({ race, onAdded }: { race: RaceDetailDto; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CheckpointKind>('intermediate');
  const [disciplineId, setDisciplineId] = useState<string | null>(race.disciplines[0]?.id ?? null);
  const add = useMutation({
    mutationFn: (input: CheckpointInput) => http.post(`/races/${race.id}/checkpoints`, input),
    onSuccess: () => {
      setName('');
      onAdded();
    },
  });

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ name, kind, disciplineId });
      }}
    >
      <h3>Přidat checkpoint</h3>
      <div className="row">
        <input
          required
          placeholder="Název, např. Otočka na kopci"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <KindAndDiscipline
          race={race}
          kind={kind}
          disciplineId={disciplineId}
          onChange={(k, d) => {
            setKind(k);
            setDisciplineId(d);
          }}
        />
        <button className="primary" disabled={add.isPending}>
          Přidat
        </button>
      </div>
      <ErrorBox error={add.error} />
    </form>
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
  const [kind, setKind] = useState(cp.kind);
  const [disciplineId, setDisciplineId] = useState(cp.disciplineId);
  const save = useMutation({
    mutationFn: () =>
      http.patch(`/races/${race.id}/checkpoints/${cp.id}`, { name, kind, disciplineId }),
    onSuccess: onSaved,
  });
  const dirty = name !== cp.name || kind !== cp.kind || disciplineId !== cp.disciplineId;
  const sub = cp.kind === 'intermediate';

  if (!isAdmin) {
    return (
      <tr className={sub ? 'sub' : undefined}>
        <td className="num">{cp.seq}</td>
        <td>{cp.name}</td>
        <td>{KIND_LABEL[cp.kind]}</td>
        <td>{disciplineText(cp, race)}</td>
      </tr>
    );
  }
  return (
    <tr className={sub ? 'sub' : undefined}>
      <td className="num">{cp.seq}</td>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td colSpan={2}>
        <KindAndDiscipline
          race={race}
          kind={kind}
          disciplineId={disciplineId}
          onChange={(k, d) => {
            setKind(k);
            setDisciplineId(d);
          }}
        />
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
