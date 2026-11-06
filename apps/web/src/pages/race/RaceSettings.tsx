import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RaceDetailDto, RaceStatus, RaceUpdateInput } from '@triatlon/shared';
import { useNavigate } from 'react-router';
import { http } from '../../api';
import { AgeGroupsEditor } from '../../AgeGroupsEditor';
import { keys, useRace, useRaceId } from '../../hooks';
import { RACE_STATUS_LABEL } from '../../labels';
import { ErrorBox, Field, Loading } from '../../ui';

export function RaceSettings() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  if (!race.data) return <Loading />;
  return <SettingsForm race={race.data} key={race.dataUpdatedAt} />;
}

function SettingsForm({ race }: { race: RaceDetailDto }) {
  const [form, setForm] = useState({
    name: race.name,
    date: race.date,
    status: race.status,
    ageGroups: race.ageGroups,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const locked = race.participantCount > 0;

  const save = useMutation({
    mutationFn: (input: RaceUpdateInput) => http.patch<RaceDetailDto>(`/races/${race.id}`, input),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.race(race.id), data);
      void queryClient.invalidateQueries({ queryKey: keys.races });
    },
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/races/${race.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.races });
      void navigate('/zavody');
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    // Rok a věkové skupiny posíláme jen když jdou měnit (bez závodníků).
    save.mutate(
      locked
        ? { name: form.name, status: form.status }
        : { name: form.name, status: form.status, date: form.date, ageGroups: form.ageGroups },
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row">
        <Field label="Název">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field
          label="Datum konání"
          hint={locked ? 'Po registraci závodníků nelze měnit rok.' : undefined}
        >
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
        <Field label="Stav">
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as RaceStatus })}
          >
            {Object.entries(RACE_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h3>Věkové skupiny</h3>
      {locked ? (
        <p className="muted">
          Závod už má zaregistrované závodníky, věkové skupiny proto nelze měnit (rozbilo by to
          jejich zařazení do kategorií).
        </p>
      ) : (
        <p className="muted">
          Uložením změny věkových skupin se kategorie vytvoří znovu (délky tratí se nastaví podle
          skupin, úpravy délek a checkpointů v kategoriích se ztratí).
        </p>
      )}
      <AgeGroupsEditor
        value={form.ageGroups}
        disabled={locked}
        onChange={(ageGroups) => setForm({ ...form, ageGroups })}
      />

      <ErrorBox error={save.error} />
      {save.isSuccess && <p className="ok">Uloženo.</p>}
      <div className="actions">
        <button className="primary" disabled={save.isPending}>
          Uložit
        </button>
        {!locked && (
          <button
            type="button"
            className="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Opravdu smazat závod ${race.name} ${race.year}?`))
                remove.mutate();
            }}
          >
            Smazat závod
          </button>
        )}
      </div>
      <ErrorBox error={remove.error} />
    </form>
  );
}
