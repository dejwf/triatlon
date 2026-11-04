import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RaceCreateInput, RaceDetailDto } from '@triatlon/shared';
import { Link, useNavigate } from 'react-router';
import { http } from '../api';
import { AgeGroupsEditor, DEFAULT_AGE_GROUPS } from '../AgeGroupsEditor';
import { keys, useIsAdmin, useRaces } from '../hooks';
import { formatDate, RACE_STATUS_LABEL } from '../labels';
import { ErrorBox, Field, Loading } from '../ui';

export function RacesPage() {
  const races = useRaces();
  const isAdmin = useIsAdmin();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="page-head">
        <h1>Závody</h1>
        {isAdmin && !creating && <button onClick={() => setCreating(true)}>Nový závod</button>}
      </div>
      {creating && <CreateRace onCancel={() => setCreating(false)} />}
      {races.isPending ? (
        <Loading />
      ) : races.error ? (
        <ErrorBox error={races.error} />
      ) : races.data.length === 0 ? (
        <p className="muted">
          {isAdmin ? 'Zatím žádné závody.' : 'Nejste přiřazen k žádnému závodu.'}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Závod</th>
              <th>Datum</th>
              <th>Stav</th>
              <th className="num">Závodníků</th>
            </tr>
          </thead>
          <tbody>
            {races.data.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/zavody/${r.id}`}>
                    {r.name} {r.year}
                  </Link>
                </td>
                <td>{formatDate(r.date)}</td>
                <td>{RACE_STATUS_LABEL[r.status]}</td>
                <td className="num">{r.participantCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CreateRace({ onCancel }: { onCancel: () => void }) {
  const [form, setForm] = useState<RaceCreateInput>({
    name: 'Vlkančický triatlon',
    date: '',
    ageGroups: DEFAULT_AGE_GROUPS,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: (input: RaceCreateInput) => http.post<RaceDetailDto>('/races', input),
    onSuccess: (race) => {
      void queryClient.invalidateQueries({ queryKey: keys.races });
      void navigate(`/zavody/${race.id}/nastaveni`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(form);
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Nový závod</h2>
      <div className="row">
        <Field label="Název">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Datum konání">
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
      </div>
      <h3>Věkové skupiny</h3>
      <p className="muted">
        Věk = rok závodu − ročník narození. Hranice jsou včetně a skupiny se nesmí překrývat. Z
        každé skupiny vzniknou 4 kategorie (muži/ženy × místní/hosté) a výchozí checkpointy start →
        konec plavání → konec kola → cíl.
      </p>
      <AgeGroupsEditor
        value={form.ageGroups}
        onChange={(ageGroups) => setForm({ ...form, ageGroups })}
      />
      <ErrorBox error={create.error} />
      <div className="actions">
        <button className="primary" disabled={create.isPending}>
          Založit závod
        </button>
        <button type="button" onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </form>
  );
}
