import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AssignmentDto, UserCreateInput, UserDto, UserUpdateInput } from '@triatlon/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/decorators';
import { config } from '../config';
import type { User } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return users.map(toDto);
  }

  /** Založí účet a pošle pozvánku (přihlašuje se magic linkem, heslo neexistuje). */
  async create(actor: RequestUser, input: UserCreateInput): Promise<UserDto> {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException(`Uživatel s e-mailem ${input.email} už existuje.`);
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: input });
      await this.audit.record(
        { userId: actor.id, action: 'create', entity: 'user', entityId: u.id, after: input },
        tx,
      );
      return u;
    });

    const role = input.role === 'admin' ? 'administrátor' : 'organizátor';
    await this.mail
      .send({
        to: user.email,
        subject: 'Pozvánka do systému Vlkančického triatlonu',
        text:
          `Dobrý den,\n\nbyl vám založen účet v systému Vlkančického triatlonu (role: ${role}).\n` +
          `Přihlásíte se bez hesla — zadejte svůj e-mail na ${config.webUrl}/prihlaseni ` +
          `a pošleme vám přihlašovací odkaz a kód.\n`,
      })
      // Účet vznikl i při výpadku e-mailu; pozvánku lze nahradit běžným přihlášením.
      .catch((err: unknown) =>
        this.log.error(`Pozvánku pro ${user.email} se nepodařilo odeslat.`, err),
      );
    return toDto(user);
  }

  async update(actor: RequestUser, id: string, input: UserUpdateInput): Promise<UserDto> {
    if (id === actor.id && (input.active === false || (input.role && input.role !== actor.role))) {
      throw new BadRequestException('Vlastní účet nelze deaktivovat ani mu měnit roli.');
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Uživatel nenalezen.');
      if (before.role === 'super_admin') {
        throw new BadRequestException('Super admina nelze upravovat přes administraci.');
      }
      const user = await tx.user.update({ where: { id }, data: input });
      // Deaktivace = okamžité zneplatnění všech session (refresh tokenů).
      if (input.active === false) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        { userId: actor.id, action: 'update', entity: 'user', entityId: id, before, after: input },
        tx,
      );
      return toDto(user);
    });
  }

  async assignments(raceId: string): Promise<AssignmentDto[]> {
    const rows = await this.prisma.assignment.findMany({ where: { raceId } });
    return rows.map((a) => ({ userId: a.userId, checkpointId: a.checkpointId }));
  }

  /** Nastaví checkpointy, ke kterým je uživatel v daném závodě přiřazen (nahradí původní). */
  async setAssignments(
    actor: RequestUser,
    raceId: string,
    userId: string,
    checkpointIds: string[],
  ): Promise<AssignmentDto[]> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Uživatel nenalezen.');
      const ids = [...new Set(checkpointIds)];
      const valid = await tx.checkpoint.count({ where: { raceId, id: { in: ids } } });
      if (valid !== ids.length)
        throw new BadRequestException('Některý checkpoint nepatří k tomuto závodu.');

      const before = await tx.assignment.findMany({ where: { raceId, userId } });
      await tx.assignment.deleteMany({ where: { raceId, userId, checkpointId: { notIn: ids } } });
      await tx.assignment.createMany({
        data: ids.map((checkpointId) => ({ raceId, userId, checkpointId })),
        skipDuplicates: true,
      });
      await this.audit.record(
        {
          userId: actor.id,
          action: 'assign',
          entity: 'user',
          entityId: userId,
          before: before.map((a) => a.checkpointId),
          after: { raceId, checkpointIds: ids },
        },
        tx,
      );
    });
    return this.assignments(raceId);
  }

  async directors(raceId: string): Promise<string[]> {
    const rows = await this.prisma.raceDirector.findMany({ where: { raceId } });
    return rows.map((r) => r.userId);
  }

  /** Udělí / odebere oprávnění ředitele závodu (uzavírání kategorií). */
  async setDirector(
    actor: RequestUser,
    raceId: string,
    userId: string,
    director: boolean,
  ): Promise<string[]> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Uživatel nenalezen.');
      const key = { raceId_userId: { raceId, userId } };
      const was = !!(await tx.raceDirector.findUnique({ where: key }));
      if (was === director) return;
      if (director) await tx.raceDirector.create({ data: { raceId, userId } });
      else await tx.raceDirector.delete({ where: key });
      await this.audit.record(
        {
          userId: actor.id,
          action: director ? 'director_grant' : 'director_revoke',
          entity: 'user',
          entityId: userId,
          after: { raceId },
        },
        tx,
      );
    });
    return this.directors(raceId);
  }
}

function toDto(u: User): UserDto {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active };
}
