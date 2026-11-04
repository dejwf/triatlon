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
    return new TextEncoder().encode(secret);
  },
  get smtp(): { host: string; port: number; from: string } {
    return {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      from: process.env.MAIL_FROM ?? 'Vlkančický triatlon <noreply@localhost>',
    };
  },
};

export const AUTH = {
  /** Platnost magic linku / kódu. */
  loginTokenTtlMs: 15 * 60 * 1000,
  /** Max. neúspěšných pokusů o zadání kódu na jeden token. */
  maxCodeAttempts: 5,
  /** Max. vyžádaných přihlašovacích e-mailů na uživatele za okno loginTokenTtlMs. */
  maxRequestsPerWindow: 5,
  accessTokenTtlSec: 15 * 60,
  /** Dlouhá session — organizátor nemá být odhlášen v den závodu bez signálu. */
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
};
