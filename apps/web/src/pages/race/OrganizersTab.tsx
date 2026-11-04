import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssignmentDto } from '@triatlon/shared';
import { Link } from 'react-router';
import { http } from '../../api';
import { keys, useAssignments, useRace, useRaceId, useUsers } from '../../hooks';
import { ROLE_LABEL } from '../../labels';
import { ErrorBox, Loading } from '../../ui';

/** Matice uživatel × checkpoint — přiřazení určuje, kde smí organizátor zapisovat časy. */
export function OrganizersTab() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const users = useUsers();
  const assignments = useAssignments(raceId);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: ({ userId, checkpointIds }: { userId: string; checkpointIds: string[] }) =>
      http.put<AssignmentDto[]>(`/races/${raceId}/assignments/${userId}`, { checkpointIds }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.assignments(raceId), data);
    },
  });

  if (users.error ?? assignments.error)
    return <ErrorBox error={users.error ?? assignments.error} />;
  if (!race.data || !users.data || !assignments.data) return <Loading />;

  const assigned = new Set(assignments.data.map((a) => `${a.userId}:${a.checkpointId}`));
  const active = users.data.filter((u) => u.active);

  function toggle(userId: string, checkpointId: string, on: boolean) {
    const current = assignments.data!.filter((a) => a.userId === userId).map((a) => a.checkpointId);
    save.mutate({
      userId,
      checkpointIds: on ? [...current, checkpointId] : current.filter((id) => id !== checkpointId),
    });
  }

  return (
    <div className="stack">
      <p className="muted">
        Zaškrtněte, na kterých checkpointech uživatel v tomto závodě zapisuje. Přiřazení ke{' '}
        <strong>startu</strong> zpřístupní check-in, registraci na místě a hromadný start kategorií.
        Organizátor vidí jen závody, ke kterým je přiřazen. Nové uživatele založíte v{' '}
        <Link to="/uzivatele">Uživatelích</Link>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Uživatel</th>
            {race.data.checkpoints.map((cp) => (
              <th key={cp.id} className="center">
                {cp.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((u) => (
            <tr key={u.id}>
              <td>
                {u.name} <span className="muted">({ROLE_LABEL[u.role]})</span>
              </td>
              {race.data.checkpoints.map((cp) => (
                <td key={cp.id} className="center">
                  <input
                    type="checkbox"
                    aria-label={`${u.name} – ${cp.name}`}
                    checked={assigned.has(`${u.id}:${cp.id}`)}
                    disabled={save.isPending}
                    onChange={(e) => toggle(u.id, cp.id, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorBox error={save.error} />
    </div>
  );
}
