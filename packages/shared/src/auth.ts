import { z } from 'zod';
import { UserRole } from './domain.js';

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Neplatný e-mail.' }));

/** Žádost o přihlašovací e-mail (odkaz + 6místný kód). */
export const AuthRequestInput = z.object({ email: Email });
export type AuthRequestInput = z.infer<typeof AuthRequestInput>;

/** Ověření buď tokenem z odkazu (web/deep link), nebo e-mailem + kódem (ruční zadání v appce). */
export const AuthVerifyInput = z.union([
  z.object({ token: z.string().min(20).max(200), deviceId: z.string().max(200).optional() }),
  z.object({
    email: Email,
    code: z.string().regex(/^\d{6}$/, 'Kód musí mít 6 číslic.'),
    deviceId: z.string().max(200).optional(),
  }),
]);
export type AuthVerifyInput = z.infer<typeof AuthVerifyInput>;

export const RefreshInput = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshInput = z.infer<typeof RefreshInput>;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  /** ISO čas expirace access tokenu. */
  accessTokenExpiresAt: string;
  refreshToken: string;
  user: AuthUser;
}
