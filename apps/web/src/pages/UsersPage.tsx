import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserCreateInput, UserDto, UserUpdateInput } from '@triatlon/shared';
import { auth, http } from '../api';
import { keys, useIsAdmin, useUsers } from '../hooks';
import { ROLE_LABEL } from '../labels';
import { ErrorBox, Loading } from '../ui';

export function UsersPage() {
  const users = useUsers();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<UserDto | null>(null);

  const create = useMutation({
    mutationFn: (input: UserCreateInput) => http.post<UserDto>('/users', input),
    onSuccess: (u) => {
      setCreated(u);
      void queryClient.invalidateQueries({ queryKey: keys.users });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: UserUpdateInput & { id: string }) =>
      http.patch<UserDto>(`/users/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.users }),
  });

  if (!isAdmin) return <p>Správa uživatelů je jen pro administrátory.</p>;
  if (users.error) return <ErrorBox error={users.error} />;
  if (!users.data) return <Loading />;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    create.mutate(
      {
        email: String(d.get('email')),
        name: String(d.get('name')),
        role: d.get('role') as UserCreateInput['role'],
      },
      { onSuccess: () => form.reset() },
    );
  }

  const me = auth.user?.id;
  return (
    <div className="stack">
      <h1>Uživatelé</h1>
      <form className="card row" onSubmit={submit}>
        <input name="name" required placeholder="Jméno" />
        <input name="email" type="email" required placeholder="E-mail" />
        <select name="role" defaultValue="organizer">
          <option value="organizer">organizátor</option>
          <option value="admin">admin</option>
        </select>
        <button className="primary" disabled={create.isPending}>
          Pozvat
        </button>
      </form>
      <ErrorBox error={create.error} />
      {created && (
        <p className="ok">
          Pozvánka odeslána na {created.email}. Přiřazení ke checkpointům nastavíte v detailu závodu
          (záložka Organizátoři).
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>Jméno</th>
            <th>E-mail</th>
            <th>Role</th>
            <th>Stav</th>
          </tr>
        </thead>
        <tbody>
          {users.data.map((u) => {
            const locked = u.id === me || u.role === 'super_admin';
            return (
              <tr key={u.id} className={u.active ? undefined : 'dimmed'}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  {locked ? (
                    ROLE_LABEL[u.role]
                  ) : (
                    <select
                      value={u.role}
                      disabled={update.isPending}
                      onChange={(e) =>
                        update.mutate({ id: u.id, role: e.target.value as UserCreateInput['role'] })
                      }
                    >
                      <option value="organizer">organizátor</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
                </td>
                <td>
                  {locked ? (
                    'aktivní'
                  ) : (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={u.active}
                        disabled={update.isPending}
                        onChange={(e) => update.mutate({ id: u.id, active: e.target.checked })}
                      />
                      aktivní
                    </label>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ErrorBox error={update.error} />
    </div>
  );
}
