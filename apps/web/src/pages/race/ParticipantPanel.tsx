import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatDuration,
  type CategoryResultsDto,
  type RaceDetailDto,
  type ResultRow,
  type ResultSplit,
  type TimeEventInput,
  type TimeEventResult,
} from '@triatlon/shared';
import { http } from '../../api';
import { keys, useHistory, useIsAdmin } from '../../hooks';
import { formatClock, parseClock, toTimeInput } from '../../time';
import { ErrorBox, Loading } from '../../ui';

const TYPE_LABEL: Record<TimeEventInput['type'], string> = {
  record: 'záznam času',
  cancel: 'vrácení / zrušení',
  note: 'poznámka',
  admin_correction: 'korekce admina',
};

/** Detail závodníka ve výsledcích: časy na checkpointech, korekce admina a úplná historie akcí. */
export function ParticipantPanel({
  race,
  category,
  row,
  users,
  onClose,
}: {
  race: RaceDetailDto;
  category: CategoryResultsDto;
  row: ResultRow;
  users: Record<string, string>;
  onClose: () => void;
}) {
  const isAdmin = useIsAdmin();
  const history = useHistory(race.id, row.participantId);
  const splits = new Map(row.splits.map((s) => [s.checkpointId, s]));
  const checkpoints = category.checkpointIds
    .map((id) => race.checkpoints.find((c) => c.id === id)!)
    .filter(Boolean);
  const cpName = (id: string) => race.checkpoints.find((c) => c.id === id)?.name ?? '?';

  return (
    <section className="card stack">
      <div className="page-head">
        <h2>
          {row.bib} · {row.displayName}
        </h2>
        <span className="muted">
          {category.name} · pořadí {row.rank ?? '—'} · celkem {formatDuration(row.totalMs, true)}
        </span>
        <button className="link" onClick={onClose}>
          Zavřít
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Checkpoint</th>
            <th>Čas dne</th>
            <th className="num">Od startu</th>
            <th />
            {isAdmin && <th>Korekce</th>}
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((c) => {
            const s = splits.get(c.id);
            return (
              <tr key={c.id} className={c.kind === 'intermediate' ? 'sub-row' : undefined}>
                <td>{c.name}</td>
                <td>{formatClock(s?.ts ?? null)}</td>
                <td className="num">{s ? formatDuration(s.elapsedMs, true) : ''}</td>
                <td>
                  {s?.corrected && <span className="flag">✎ opraveno</span>}
                  {s?.conflict && <span className="flag warn">⚠ víc záznamů, platí dřívější</span>}
                </td>
                {isAdmin && (
                  <td>
                    <Correction
                      race={race}
                      participantId={row.participantId}
                      checkpointId={c.id}
                      split={s}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {row.notes.length > 0 && (
        <>
          <h3>Poznámky</h3>
          <ul>
            {row.notes.map((n) => (
              <li key={n.eventId}>
                <strong>{cpName(n.checkpointId)}:</strong> {n.text}{' '}
                <span className="muted">
                  ({users[n.userId] ?? '?'}, {formatClock(n.at, false)})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Historie akcí (audit)</h3>
      {history.isPending ? (
        <Loading />
      ) : history.error ? (
        <ErrorBox error={history.error} />
      ) : history.data.length === 0 ? (
        <p className="muted">Zatím žádné akce.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Přijato</th>
              <th>Akce</th>
              <th>Checkpoint</th>
              <th>Čas</th>
              <th>Kdo / zařízení</th>
              <th>Důvod / poznámka</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((e) => (
              <tr key={e.id}>
                <td className="muted">{formatClock(e.serverReceivedAt, false)}</td>
                <td>
                  {TYPE_LABEL[e.type]}
                  {e.type === 'admin_correction' && !e.refEventId && ' (doplnění)'}
                </td>
                <td>{cpName(e.checkpointId)}</td>
                <td>
                  {e.type === 'record' || e.type === 'admin_correction' ? formatClock(e.ts) : ''}
                </td>
                <td>
                  {e.userName} <span className="muted">/ {e.deviceId}</span>
                </td>
                <td>{e.reason ?? e.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Korekce jednoho času: oprava, doplnění chybějícího nebo zrušení — vždy s důvodem. */
function Correction({
  race,
  participantId,
  checkpointId,
  split,
}: {
  race: RaceDetailDto;
  participantId: string;
  checkpointId: string;
  split?: ResultSplit;
}) {
  const [mode, setMode] = useState<'edit' | 'cancel' | null>(null);
  const [time, setTime] = useState(split ? toTimeInput(split.ts) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const send = useMutation({
    mutationFn: async (event: TimeEventInput) => {
      const [result] = await http.post<TimeEventResult[]>(`/races/${race.id}/time-events`, {
        events: [event],
      });
      if (result?.status === 'rejected') throw new Error(result.reason ?? 'Akce byla odmítnuta.');
    },
    onSuccess: () => {
      setMode(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: keys.results(race.id) });
      void queryClient.invalidateQueries({ queryKey: keys.history(race.id, participantId) });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const base = {
      id: crypto.randomUUID(),
      participantId,
      checkpointId,
      reason,
      deviceId: 'web-admin',
    };
    if (mode === 'cancel') {
      send.mutate({
        ...base,
        type: 'cancel',
        ts: new Date().toISOString(),
        refEventId: split!.recordId,
      });
      return;
    }
    const ts = parseClock(race.date, time);
    if (!ts) {
      setError('Zadejte čas ve formátu HH:MM:SS (případně s desetinami).');
      return;
    }
    send.mutate({ ...base, type: 'admin_correction', ts, refEventId: split?.recordId });
  }

  if (!mode) {
    return (
      <div className="actions">
        <button className="link" onClick={() => setMode('edit')}>
          {split ? 'Opravit' : 'Doplnit'}
        </button>
        {split && (
          <button className="link danger" onClick={() => setMode('cancel')}>
            Zrušit
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="row" onSubmit={submit}>
      {mode === 'edit' && (
        <input
          type="time"
          step="0.1"
          required
          aria-label="Čas dne"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      )}
      <input
        required
        minLength={3}
        placeholder="Důvod (povinný, auditováno)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button className={mode === 'cancel' ? 'danger' : 'primary'} disabled={send.isPending}>
        {mode === 'cancel' ? 'Zrušit čas' : 'Uložit'}
      </button>
      <button type="button" className="link" onClick={() => setMode(null)}>
        Zpět
      </button>
      {(error || send.error) && <ErrorBox error={error ? new Error(error) : send.error} />}
    </form>
  );
}
