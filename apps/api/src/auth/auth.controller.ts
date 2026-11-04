import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  AuthRequestInput,
  AuthVerifyInput,
  RefreshInput,
  type AuthTokens,
  type AuthUser,
} from '@triatlon/shared';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { CurrentUser, Public, type RequestUser } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Vždy 202 — odpověď neprozrazuje, jestli účet existuje. */
  @Public()
  @Post('request')
  @HttpCode(202)
  async request(@Body(new ZodPipe(AuthRequestInput)) body: AuthRequestInput): Promise<void> {
    await this.auth.requestLogin(body.email);
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  verify(@Body(new ZodPipe(AuthVerifyInput)) body: AuthVerifyInput): Promise<AuthTokens> {
    return this.auth.verify(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(RefreshInput)) body: RefreshInput): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentUser() user: RequestUser): Promise<void> {
    return this.auth.logout(user.sessionId);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.me(user.id);
  }
}
