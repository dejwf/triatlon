import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Gender,
  Locality,
  ParticipantDto,
  ParticipantInput,
  ParticipantStatus,
  ParticipantUpdateInput,
  RaceDetailDto,
} from '@triatlon/shared';
import { http } from '../../api';
import { keys, useIsAdmin, useParticipants, useRace, useRaceId } from '../../hooks';
import { GENDER_LABEL, LOCALITY_LABEL, PARTICIPANT_STATUS_LABEL } from '../../labels';
import { ErrorBox, Loading } from '../../ui';

const SOURCE_LABEL = { manual: 'ručně', import: 'import', online: 'online', on_site: 'na místě' };

export function ParticipantsTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const participants = useParticipants(raceId);
  const isAdmin = useIsAdmin();
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const categories = useMemo(
    () => new Map(race.data?.categories.map((c) => [c.id, c]) ?? []),
    [race.data],
  );
  const order = useMemo(
    () => new Map(race.data?.categories.map((c, i) => [c.id, i]) ?? []),
    [race.data],
  );

  if (participants.error) return <ErrorBox error={participants.error} />;
  if (!race.data || !participants.data) return <Loading />;

  const q = search.trim().toLocaleLowerCase('cs');
  const rows = participants.data
    .filter((p) => !categoryId || p.categoryId === categoryId)
    .filter(
      (p) =>
        !q ||
        `${p.firstName} ${p.lastName}`.toLocaleLowerCase('cs').includes(q) ||
        String(p.bib) === q,
    )
    .sort(
      (a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0) || a.bib - b.bib,
    );

  return (
    <div className="stack">
      <div className="row">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Všechny kategorie</option>
          {race.data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.participantCount})
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Hledat jméno nebo číslo"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isAdmin && !adding && <button onClick={() => setAdding(true)}>Přidat závodníka</button>}
      </div>

      {adding && <AddParticipant race={race.data} onDone={() => setAdding(false)} />}

      <p className="muted">
        Zobrazeno {rows.length} z {participants.data.length} závodníků. Kategorie se přiřazuje
        automaticky podle ročníku, pohlaví a lokality.
      </p>
      <table>
        <thead>
          <tr>
            <th className="num">Číslo</th>
            <th>Jméno</th>
            <th className="num">Ročník</th>
            <th>Kategorie</th>
            <th>Stav</th>
            <th>Registrace</th>
            {isAdmin && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) =>
            editing === p.id ? (
              <EditParticipant
                key={p.id}
                raceId={raceId}
                participant={p}
                onDone={() => setEditing(null)}
              />
            ) : (
              <tr key={p.id} className={p.status === 'absent' ? 'dimmed' : undefined}>
                <td className="num">
                  <strong>{p.bib}</strong>
                </td>
                <td>
                  {p.lastName} {p.firstName}
                </td>
                <td className="num">{p.birthYear}</td>
                <td>{categories.get(p.categoryId)?.name}</td>
                <td>{PARTICIPANT_STATUS_LABEL[p.status]}</td>
                <td className="muted">{SOURCE_LABEL[p.registrationSource]}</td>
                {isAdmin && (
                  <td>
                    <button className="link" onClick={() => setEditing(p.id)}>
                      Upravit
                    </button>
                  </td>
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function AddParticipant({ race, onDone }: { race: RaceDetailDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (input: ParticipantInput) =>
      http.post<ParticipantDto>(`/races/${race.id}/participants`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.participants(race.id) });
      void queryClient.invalidateQueries({ queryKey: keys.race(race.id) });
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const bib = String(d.get('bib') ?? '').trim();
    add.mutate(
      {
        firstName: String(d.get('firstName')),
        lastName: String(d.get('lastName')),
        birthYear: Number(d.get('birthYear')),
        gender: d.get('gender') as Gender,
        locality: d.get('locality') as Locality,
        bib: bib ? Number(bib) : undefined,
      },
      // Formulář zůstává otevřený pro zadání dalšího závodníka.
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row">
        <input name="firstName" required placeholder="Jméno" />
        <input name="lastName" required placeholder="Příjmení" />
        <input
          name="birthYear"
          type="number"
          required
          min={1900}
          max={race.year}
          placeholder="Ročník"
          className="short"
        />
        <select name="gender" required defaultValue="">
          <option value="" disabled>
            Pohlaví
          </option>
          <option value="male">muž</option>
          <option value="female">žena</option>
        </select>
        <select name="locality" required defaultValue="">
          <option value="" disabled>
            Lokalita
          </option>
          <option value="local">místní</option>
          <option value="guest">host</option>
        </select>
        <input name="bib" type="number" min={1} placeholder="Číslo (auto)" className="short" />
      </div>
      <ErrorBox error={add.error} />
      {add.isSuccess && (
        <p className="ok">
          Přidán(a) {add.data.firstName} {add.data.lastName} s číslem {add.data.bib}.
        </p>
      )}
      <div className="actions">
        <button className="primary" disabled={add.isPending}>
          Přidat
        </button>
        <button type="button" onClick={onDone}>
          Zavřít
        </button>
      </div>
    </form>
  );
}

function EditParticipant({
  raceId,
  participant: p,
  onDone,
}: {
  raceId: string;
  participant: ParticipantDto;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ ...p });
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.participants(raceId) });
    await queryClient.invalidateQueries({ queryKey: keys.race(raceId) });
  };
  const save = useMutation({
    mutationFn: (input: ParticipantUpdateInput) =>
      http.patch(`/races/${raceId}/participants/${p.id}`, input),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/races/${raceId}/participants/${p.id}`),
    onSuccess: invalidate,
  });

  return (
    <tr className="editing">
      <td>
        <input
          type="number"
          min={1}
          className="short"
          value={form.bib}
          onChange={(e) => setForm({ ...form, bib: Number(e.target.value) })}
        />
      </td>
      <td>
        <input
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
        />
        <input
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
        />
      </td>
      <td>
        <input
          type="number"
          className="short"
          value={form.birthYear}
          onChange={(e) => setForm({ ...form, birthYear: Number(e.target.value) })}
        />
      </td>
      <td>
        <select
          value={form.gender}
          onChange={(e) => setForm({ ...form, gender: e.target.value as Gender })}
        >
          {Object.entries(GENDER_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={form.locality}
          onChange={(e) => setForm({ ...form, locality: e.target.value as Locality })}
        >
          {Object.entries(LOCALITY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as ParticipantStatus })}
        >
          {Object.entries(PARTICIPANT_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td colSpan={2} className="actions">
        <button
          className="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              bib: form.bib,
              firstName: form.firstName,
              lastName: form.lastName,
              birthYear: form.birthYear,
              gender: form.gender,
              locality: form.locality,
              status: form.status,
            })
          }
        >
          Uložit
        </button>
        <button className="link" onClick={onDone}>
          Zrušit
        </button>
        <button
          className="link danger"
          onClick={() => {
            if (window.confirm(`Smazat závodníka ${p.firstName} ${p.lastName}?`)) remove.mutate();
          }}
        >
          Smazat
        </button>
        <ErrorBox error={save.error ?? remove.error} />
      </td>
    </tr>
  );
}
