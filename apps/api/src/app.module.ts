import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { TokenService } from './auth/token.service';
import { HealthController } from './health.controller';
import { MailService } from './mail/mail.service';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [HealthController, AuthController],
  providers: [
    PrismaService,
    MailService,
    TokenService,
    AuthService,
    // Všechny endpointy vyžadují přihlášení, pokud nejsou označené @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
