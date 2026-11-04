import { Injectable } from '@nestjs/common';
import { UserRole } from '@triatlon/shared';
import { jwtVerify, SignJWT } from 'jose';
import { AUTH, config } from '../config';
import type { RequestUser } from './decorators';

const ISSUER = 'triatlon-api';

/** Krátkodobé access tokeny (JWT HS256). Obnovují se přes refresh token uložený v Session. */
@Injectable()
export class TokenService {
  async signAccessToken(user: RequestUser): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + AUTH.accessTokenTtlSec * 1000);
    const token = await new SignJWT({ role: user.role, sid: user.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(config.authSecret);
    return { token, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<RequestUser | null> {
    try {
      const { payload } = await jwtVerify(token, config.authSecret, {
        issuer: ISSUER,
        algorithms: ['HS256'],
      });
      const role = UserRole.safeParse(payload.role);
      if (!payload.sub || typeof payload.sid !== 'string' || !role.success) return null;
      return { id: payload.sub, role: role.data, sessionId: payload.sid };
    } catch {
      return null;
    }
  }
}
