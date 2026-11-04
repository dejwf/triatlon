import type { AuthTokens, AuthUser } from '@triatlon/shared';

const STORAGE_KEY = 'triatlon.auth';

/**
 * Tokeny v localStorage — pro MVP stačí; před ostrým provozem zvážit refresh token
 * v httpOnly cookie (ochrana proti XSS).
 */
function load(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

function save(tokens: AuthTokens | null): void {
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // úložiště nedostupné (privátní okno) — session vydrží jen do zavření stránky
  }
  current = tokens;
}

let current = load();
let refreshing: Promise<AuthTokens | null> | null = null;

export class ApiError extends Error {
  readonly status: number;
  /** Tělo chybové odpovědi (např. výsledek validace importu nebo seznam chyb polí). */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /** Srozumitelný popis chyby včetně chyb jednotlivých polí. */
  get details(): string {
    const issues = (this.body as { issues?: { path: string; message: string }[] } | undefined)
      ?.issues;
    return issues?.length
      ? `${this.message} ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')}`
      : this.message;
  }
}

async function raw<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === 'string' ? body.message : `Chyba ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function refresh(): Promise<AuthTokens | null> {
  if (!current) return null;
  // Souběžné požadavky sdílí jedno obnovení (refresh token je jednorázový).
  refreshing ??= raw<AuthTokens>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  })
    .then((t) => (save(t), t))
    .catch(() => (save(null), null))
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Volání API s přihlášením; při vypršení access tokenu ho jednou obnoví. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (current && Date.parse(current.accessTokenExpiresAt) - Date.now() < 30_000) await refresh();
  try {
    return await raw<T>(path, init, current?.accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && current && (await refresh())) {
      return raw<T>(path, init, current?.accessToken);
    }
    throw err;
  }
}

/** Zkratky pro volání API s JSON tělem. */
export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    api<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    api<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path: string) => api<void>(path, { method: 'DELETE' }),
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.details;
  return err instanceof Error ? err.message : 'Neznámá chyba.';
}

export const auth = {
  get user(): AuthUser | null {
    return current?.user ?? null;
  },
  request: (email: string) =>
    raw<void>('/auth/request', { method: 'POST', body: JSON.stringify({ email }) }),
  async verify(body: { token: string } | { email: string; code: string }): Promise<AuthUser> {
    const tokens = await raw<AuthTokens>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    save(tokens);
    return tokens.user;
  },
  async logout(): Promise<void> {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    save(null);
  },
};
