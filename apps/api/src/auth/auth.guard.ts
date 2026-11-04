import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@triatlon/shared';
import { IS_PUBLIC, ROLES, type RequestUser } from './decorators';
import { TokenService } from './token.service';

/** Globální guard: ověří Bearer access token a případně roli (@Roles). Výjimky přes @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: RequestUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Nepřihlášen.');

    const user = await this.tokens.verifyAccessToken(token);
    if (!user) throw new UnauthorizedException('Neplatný nebo prošlý token.');
    req.user = user;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles && user.role !== 'super_admin' && !roles.includes(user.role)) {
      throw new ForbiddenException('Nedostatečná oprávnění.');
    }
    return true;
  }
}
