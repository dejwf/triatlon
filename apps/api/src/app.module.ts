import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { TokenService } from './auth/token.service';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { HealthController } from './health.controller';
import { MailService } from './mail/mail.service';
import { ParticipantsController } from './participants/participants.controller';
import { ParticipantsService } from './participants/participants.service';
import { PrismaService } from './prisma.service';
import { RacesController } from './races/races.controller';
import { RacesService } from './races/races.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  controllers: [
    HealthController,
    AuthController,
    RacesController,
    ParticipantsController,
    UsersController,
  ],
  providers: [
    PrismaService,
    MailService,
    AuditService,
    TokenService,
    AuthService,
    RacesService,
    ParticipantsService,
    UsersService,
    // Všechny endpointy vyžadují přihlášení, pokud nejsou označené @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
