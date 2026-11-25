function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Chybí proměnná prostředí ${name}.`);
  return value;
}

/** Konfigurace z proměnných prostředí (viz .env.example). Čte se líně, aby šla v testech přepsat. */
export const config = {
  get webUrl(): string {
    return process.env.WEB_URL ?? 'http://localhost:5173';
  },
  get authSecret(): Uint8Array {
    const secret = required('AUTH_SECRET');
    if (secret.length < 32) throw new Error('AUTH_SECRET musí mít alespoň 32 znaků.');
    if (process.env.NODE_ENV === 'production' && secret.startsWith('dev-secret')) {
      throw new Error('AUTH_SECRET je vývojový — v produkci nastavte vlastní náhodný klíč.');
    }
    return new TextEncoder().encode(secret);
  },
  get smtp(): { host: string; port: number; from: string; user?: string; password?: string } {
    return {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      from: process.env.MAIL_FROM ?? 'Vlkančický triatlon <noreply@localhost>',
      // Přihlášení k SMTP poskytovatele v produkci (v dev Mailpit bez přihlášení).
      user: process.env.SMTP_USER || undefined,
      password: process.env.SMTP_PASSWORD || undefined,
    };
  },
};

export const AUTH = {
  /** Platnost magic linku / kódu. */
  loginTokenTtlMs: 30 * 60 * 1000, // pošta (Webglobe) občas chodí se zpožděním
  /** Max. neúspěšných pokusů o zadání kódu na jeden token. */
  maxCodeAttempts: 5,
  /** Max. vyžádaných přihlašovacích e-mailů na uživatele za okno loginTokenTtlMs. */
  maxRequestsPerWindow: 5,
  accessTokenTtlSec: 15 * 60,
  /** Dlouhá session — organizátor nemá být odhlášen v den závodu bez signálu. */
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
};
