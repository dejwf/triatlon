import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthUser } from '@triatlon/shared';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { api, auth } from './api';
import { ROLE_LABEL } from './labels';
import { Login } from './Login';

/** Rozvržení aplikace; nepřihlášenému uživateli ukáže přihlášení. */
export function Layout() {
  const [user, setUser] = useState<AuthUser | null>(auth.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Ověření uložené session při načtení (účet mohl být mezitím deaktivován).
  useEffect(() => {
    if (!auth.user) return;
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const onLogin = useCallback(
    (u: AuthUser) => {
      setUser(u);
      void navigate('/zavody', { replace: true });
    },
    [navigate],
  );

  async function logout() {
    await auth.logout();
    queryClient.clear();
    setUser(null);
  }

  if (!user) {
    return (
      <main className="container">
        <h1>Vlkančický triatlon</h1>
        <Login onLogin={onLogin} />
      </main>
    );
  }

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  return (
    <>
      <header className="topbar">
        <strong>Vlkančický triatlon</strong>
        <nav>
          <NavLink to="/zavody">Závody</NavLink>
          {isAdmin && <NavLink to="/uzivatele">Uživatelé</NavLink>}
        </nav>
        <span className="muted user">
          {user.name} ({ROLE_LABEL[user.role]})
        </span>
        <button className="link" onClick={() => void logout()}>
          Odhlásit
        </button>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}
