import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@triatlon/shared';

export interface RequestUser {
  id: string;
  role: UserRole;
  sessionId: string;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Endpoint přístupný bez přihlášení (výchozí je přihlášení vyžadovat). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Omezení endpointu na role. `super_admin` projde vždy. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser =>
    ctx.switchToHttp().getRequest<{ user: RequestUser }>().user,
);
