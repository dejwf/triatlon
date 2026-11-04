import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@triatlon/shared';
import { api, auth } from './api';
import { Login } from './Login';

const roleLabel: Record<AuthUser['role'], string> = {
  super_admin: 'super admin',
  admin: 'admin',
  organizer: 'organizátor',
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(auth.user);

  // Ověření uložené session při načtení (účet mohl být mezitím deaktivován).
  useEffect(() => {
    if (!auth.user) return;
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const onLogin = useCallback((u: AuthUser) => {
    setUser(u);
    history.replaceState(null, '', '/');
  }, []);

  return (
    <main>
      <h1>Vlkančický triatlon</h1>
      {user ? (
        <>
          <p>
            Přihlášen: <strong>{user.name}</strong> ({user.email}, {roleLabel[user.role]})
          </p>
          <button
            onClick={() => {
              void auth.logout().then(() => setUser(null));
            }}
          >
            Odhlásit
          </button>
        </>
      ) : (
        <Login onLogin={onLogin} />
      )}
    </main>
  );
}
