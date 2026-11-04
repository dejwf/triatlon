import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AuthTokens, AuthUser, AuthVerifyInput } from '@triatlon/shared';
import { AUTH, config } from '../config';
import type { User } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma.service';
import { hashCode, randomCode, randomToken, safeEqualHex, sha256 } from './crypto';
import { TokenService } from './token.service';

const INVALID = 'Neplatný nebo prošlý přihlašovací odkaz či kód.';

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Pošle přihlašovací e-mail s odkazem a kódem. Navenek se chová stejně, ať účet existuje
   * nebo ne (neprozrazuje, které e-maily jsou v systému).
   */
  async requestLogin(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active) return;

    const since = new Date(Date.now() - AUTH.loginTokenTtlMs);
    const recent = await this.prisma.loginToken.count({
      where: { userId: user.id, createdAt: { gte: since } },
    });
    if (recent >= AUTH.maxRequestsPerWindow) {
      this.log.warn(`Překročen limit přihlašovacích e-mailů pro uživatele ${user.id}.`);
      return;
    }

    const token = randomToken();
    const code = randomCode();
    const id = crypto.randomUUID();
    await this.prisma.loginToken.create({
      data: {
        id,
        userId: user.id,
        tokenHash: sha256(token),
        codeHash: hashCode(config.authSecret, id, code),
        expiresAt: new Date(Date.now() + AUTH.loginTokenTtlMs),
      },
    });

    const link = `${config.webUrl}/prihlaseni?token=${encodeURIComponent(token)}`;
    const minutes = AUTH.loginTokenTtlMs / 60_000;
    await this.mail.send({
      to: user.email,
      subject: `Přihlášení — kód ${code}`,
      text:
        `Dobrý den,\n\npro přihlášení do systému Vlkančického triatlonu klikněte na odkaz:\n${link}\n\n` +
        `nebo v mobilní aplikaci zadejte kód: ${code}\n\n` +
        `Odkaz i kód platí ${minutes} minut a lze je použít jen jednou.\n` +
        `Pokud jste o přihlášení nežádali, e-mail ignorujte.`,
    });
  }

  async verify(input: AuthVerifyInput): Promise<AuthTokens> {
    const userId =
      'token' in input
        ? await this.consumeByToken(input.token)
        : await this.consumeByCode(input.email, input.code);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.active) throw new UnauthorizedException(INVALID);
    return this.createSession(user, input.deviceId);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.prisma.session.findUnique({
      where: { refreshHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) {
      throw new UnauthorizedException('Session vypršela, přihlaste se znovu.');
    }

    // Rotace refresh tokenu; podmínka na starý hash brání dvojímu použití při souběhu.
    const next = randomToken();
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshHash: session.refreshHash, revokedAt: null },
      data: { refreshHash: sha256(next) },
    });
    if (count !== 1) throw new UnauthorizedException('Session vypršela, přihlaste se znovu.');

    return this.issue(session.user, session.id, next);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.active) throw new UnauthorizedException('Účet neexistuje nebo je deaktivován.');
    return toAuthUser(user);
  }

  private async consumeByToken(token: string): Promise<string> {
    const row = await this.prisma.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row) throw new UnauthorizedException(INVALID);
    await this.consume(row.id);
    return row.userId;
  }

  private async consumeByCode(email: string, code: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException(INVALID);

    // Platí jen kód z posledního vyžádaného e-mailu.
    const row = await this.prisma.loginToken.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new UnauthorizedException(INVALID);

    if (!safeEqualHex(row.codeHash, hashCode(config.authSecret, row.id, code))) {
      const attempts = row.attempts + 1;
      await this.prisma.loginToken.update({
        where: { id: row.id },
        data: {
          attempts,
          consumedAt: attempts >= AUTH.maxCodeAttempts ? new Date() : undefined,
        },
      });
      throw new UnauthorizedException(INVALID);
    }

    await this.consume(row.id);
    return row.userId;
  }

  /** Atomicky spotřebuje token — odkaz i kód jdou použít jen jednou. */
  private async consume(id: string): Promise<void> {
    const { count } = await this.prisma.loginToken.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (count !== 1) throw new UnauthorizedException(INVALID);
  }

  private async createSession(user: User, deviceId?: string): Promise<AuthTokens> {
    const refreshToken = randomToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: sha256(refreshToken),
        deviceId,
        expiresAt: new Date(Date.now() + AUTH.sessionTtlMs),
      },
    });
    return this.issue(user, session.id, refreshToken);
  }

  private async issue(user: User, sessionId: string, refreshToken: string): Promise<AuthTokens> {
    const access = await this.tokens.signAccessToken({ id: user.id, role: user.role, sessionId });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      user: toAuthUser(user),
    };
  }
}

function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
