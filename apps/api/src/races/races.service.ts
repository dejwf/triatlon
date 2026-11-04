import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgeGroups,
  type CategoryDto,
  type CategoryUpdateInput,
  type CheckpointDto,
  type CheckpointData,
  intermediateInsertIndex,
  startCheckpointId,
  validateCheckpointOrder,
  type RaceCreateInput,
  type RaceDetailDto,
  type RaceSummaryDto,
  type RaceUpdateInput,
} from '@triatlon/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/decorators';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { createCategories, createRaceWithDefaults, raceYear } from './race-factory';

const isAdmin = (u: RequestUser) => u.role === 'admin' || u.role === 'super_admin';

@Injectable()
export class RacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Admin má přístup ke všem závodům, organizátor jen k těm, kde má přiřazení. */
  /** Check-in a registrace na místě: admin, nebo organizátor přiřazený ke startu. */
  async assertStartAccess(user: RequestUser, raceId: string): Promise<void> {
    await this.assertAccess(user, raceId);
    if (isAdmin(user)) return;
    const checkpoints = await this.prisma.checkpoint.findMany({ where: { raceId } });
    const start = startCheckpointId(checkpoints);
    const assigned =
      start &&
      (await this.prisma.assignment.count({
        where: { raceId, userId: user.id, checkpointId: start },
      }));
    if (!assigned) {
      throw new ForbiddenException('Check-in a registraci na místě smí jen organizátor startu.');
    }
  }

  async assertAccess(user: RequestUser, raceId: string): Promise<void> {
    const race = await this.prisma.race.findUnique({ where: { id: raceId }, select: { id: true } });
    if (!race) throw new NotFoundException('Závod nenalezen.');
    if (isAdmin(user)) return;
    const assigned = await this.prisma.assignment.count({ where: { raceId, userId: user.id } });
    if (!assigned) throw new ForbiddenException('K tomuto závodu nemáte přístup.');
  }

  async list(user: RequestUser): Promise<RaceSummaryDto[]> {
    const races = await this.prisma.race.findMany({
      where: isAdmin(user) ? {} : { assignments: { some: { userId: user.id } } },
      orderBy: [{ year: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { participants: true } } },
    });
    return races.map((r) => ({
      id: r.id,
      name: r.name,
      year: r.year,
      date: r.date.toISOString().slice(0, 10),
      status: r.status,
      participantCount: r._count.participants,
    }));
  }

  async get(user: RequestUser, id: string): Promise<RaceDetailDto> {
    await this.assertAccess(user, id);
    const race = await this.prisma.race.findUniqueOrThrow({
      where: { id },
      include: {
        disciplines: { orderBy: { seq: 'asc' } },
        checkpoints: { orderBy: { seq: 'asc' } },
        categories: {
          orderBy: { name: 'asc' },
          include: { checkpoints: true, _count: { select: { participants: true } } },
        },
        _count: { select: { participants: true } },
        assignments: { where: { userId: user.id }, select: { checkpointId: true } },
      },
    });
    const ageGroups = AgeGroups.parse(race.ageGroups);
    const groupOrder = new Map(ageGroups.map((g, i) => [g.label, i]));
    const categories: CategoryDto[] = race.categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        ageGroupLabel: c.ageGroupLabel,
        birthYearFrom: c.birthYearFrom,
        birthYearTo: c.birthYearTo,
        gender: c.gender,
        locality: c.locality,
        distances: c.distances as CategoryDto['distances'],
        checkpointIds: c.checkpoints.map((cc) => cc.checkpointId),
        participantCount: c._count.participants,
      }))
      .sort(
        (a, b) =>
          (groupOrder.get(a.ageGroupLabel) ?? 0) - (groupOrder.get(b.ageGroupLabel) ?? 0) ||
          a.gender.localeCompare(b.gender) ||
          a.locality.localeCompare(b.locality),
      );
    return {
      id: race.id,
      name: race.name,
      year: race.year,
      date: race.date.toISOString().slice(0, 10),
      status: race.status,
      participantCount: race._count.participants,
      ageGroups,
      disciplines: race.disciplines.map((d) => ({ id: d.id, name: d.name, seq: d.seq })),
      checkpoints: race.checkpoints.map(toCheckpointDto),
      categories,
      myCheckpointIds: isAdmin(user)
        ? race.checkpoints.map((c) => c.id)
        : race.assignments.map((a) => a.checkpointId),
    };
  }

  async create(user: RequestUser, input: RaceCreateInput): Promise<RaceDetailDto> {
    const race = await this.prisma.$transaction(async (tx) => {
      await this.assertUniqueName(tx, input.name, raceYear(input.date));
      const created = await createRaceWithDefaults(tx, input);
      await this.audit.record(
        { userId: user.id, action: 'create', entity: 'race', entityId: created.id, after: input },
        tx,
      );
      return created;
    });
    return this.get(user, race.id);
  }

  async update(user: RequestUser, id: string, input: RaceUpdateInput): Promise<RaceDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const race = await tx.race.findUnique({
        where: { id },
        include: { _count: { select: { participants: true } } },
      });
      if (!race) throw new NotFoundException('Závod nenalezen.');

      const year = input.date ? raceYear(input.date) : race.year;
      const groupsChanged =
        input.ageGroups !== undefined &&
        JSON.stringify(input.ageGroups) !== JSON.stringify(race.ageGroups);
      const yearChanged = year !== race.year;

      // Kategorie (rozsahy ročníků) závisí na roku a věkových skupinách — po registraci
      // závodníků by změna rozbila jejich zařazení.
      if ((groupsChanged || yearChanged) && race._count.participants > 0) {
        throw new ConflictException(
          'Rok závodu ani věkové skupiny nelze měnit, když už jsou zaregistrovaní závodníci.',
        );
      }
      if (input.name !== undefined || yearChanged) {
        await this.assertUniqueName(tx, input.name ?? race.name, year, id);
      }

      await tx.race.update({
        where: { id },
        data: {
          name: input.name,
          status: input.status,
          date: input.date ? new Date(input.date) : undefined,
          year,
          ageGroups: input.ageGroups,
        },
      });
      if (groupsChanged || yearChanged) {
        await tx.category.deleteMany({ where: { raceId: id } });
        await createCategories(tx, id, year, input.ageGroups ?? AgeGroups.parse(race.ageGroups));
      }
      await this.audit.record(
        {
          userId: user.id,
          action: 'update',
          entity: 'race',
          entityId: id,
          before: {
            name: race.name,
            date: race.date,
            status: race.status,
            ageGroups: race.ageGroups,
          },
          after: input,
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  async remove(user: RequestUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const race = await tx.race.findUnique({
        where: { id },
        include: { _count: { select: { participants: true } } },
      });
      if (!race) throw new NotFoundException('Závod nenalezen.');
      if (race._count.participants > 0) {
        throw new ConflictException('Závod se zaregistrovanými závodníky nelze smazat.');
      }
      await tx.race.delete({ where: { id } });
      await this.audit.record(
        { userId: user.id, action: 'delete', entity: 'race', entityId: id, before: race },
        tx,
      );
    });
  }

  // ---------- Checkpointy ----------

  async addCheckpoint(
    user: RequestUser,
    raceId: string,
    input: CheckpointData,
  ): Promise<CheckpointDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDiscipline(tx, raceId, input.disciplineId);
      const existing = await tx.checkpoint.findMany({ where: { raceId }, orderBy: { seq: 'asc' } });
      if (!existing.length) throw new NotFoundException('Závod nenalezen.');

      // Hranice disciplíny jde na konec; sub-checkpoint těsně před konec své disciplíny.
      let insertAt = existing.length;
      if (input.kind === 'intermediate') {
        insertAt = intermediateInsertIndex(existing, input.disciplineId!);
        if (insertAt < 0) {
          throw new BadRequestException(
            'Disciplína nemá checkpoint, který ji ukončuje — sub-checkpoint nelze zařadit.',
          );
        }
      }

      const categories = await tx.category.findMany({ where: { raceId }, select: { id: true } });
      const cp = await tx.checkpoint.create({
        data: {
          raceId,
          name: input.name,
          kind: input.kind,
          disciplineId: input.disciplineId,
          seq: existing.at(-1)!.seq + 1,
          // Nový checkpoint platí výchozí pro všechny kategorie.
          categories: { create: categories.map((c) => ({ categoryId: c.id })) },
        },
      });
      const ids = existing.map((c) => c.id);
      ids.splice(insertAt, 0, cp.id);
      await this.renumber(tx, raceId, ids);

      await this.audit.record(
        { userId: user.id, action: 'create', entity: 'checkpoint', entityId: cp.id, after: input },
        tx,
      );
      return toCheckpointDto({ ...cp, seq: insertAt + 1 });
    });
  }

  async updateCheckpoint(
    user: RequestUser,
    raceId: string,
    id: string,
    input: CheckpointData,
  ): Promise<CheckpointDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findCheckpoint(tx, raceId, id);
      await this.assertDiscipline(tx, raceId, input.disciplineId);
      const cp = await tx.checkpoint.update({
        where: { id },
        data: { name: input.name, kind: input.kind, disciplineId: input.disciplineId },
      });
      // Sub-checkpoint mimo svou disciplínu (např. po změně typu) se přesune těsně před
      // její konec, aby admin nemusel pořadí rovnat ručně.
      if (cp.kind === 'intermediate') {
        const all = await tx.checkpoint.findMany({ where: { raceId }, orderBy: { seq: 'asc' } });
        if (validateCheckpointOrder(all)) {
          const others = all.filter((c) => c.id !== id);
          const at = intermediateInsertIndex(others, cp.disciplineId!);
          if (at < 0) {
            throw new BadRequestException(
              'Disciplína nemá checkpoint, který ji ukončuje — sub-checkpoint nelze zařadit.',
            );
          }
          const ids = others.map((c) => c.id);
          ids.splice(at, 0, id);
          await this.renumber(tx, raceId, ids);
        }
      }
      await this.assertOrder(tx, raceId);
      await this.audit.record(
        {
          userId: user.id,
          action: 'update',
          entity: 'checkpoint',
          entityId: id,
          before,
          after: input,
        },
        tx,
      );
      return toCheckpointDto(cp);
    });
  }

  async removeCheckpoint(user: RequestUser, raceId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.findCheckpoint(tx, raceId, id);
      if (await tx.timeEvent.count({ where: { checkpointId: id } })) {
        throw new ConflictException('Checkpoint už má zaznamenané časy, nelze ho smazat.');
      }
      await tx.checkpoint.delete({ where: { id } });
      await this.renumber(tx, raceId, await this.checkpointIds(tx, raceId));
      // Smazání konce disciplíny by nechalo její sub-checkpointy „viset“.
      await this.assertOrder(tx, raceId);
      await this.audit.record(
        { userId: user.id, action: 'delete', entity: 'checkpoint', entityId: id, before },
        tx,
      );
    });
  }

  async reorderCheckpoints(
    user: RequestUser,
    raceId: string,
    ids: string[],
  ): Promise<CheckpointDto[]> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.checkpointIds(tx, raceId);
      if (
        ids.length !== current.length ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => current.includes(id))
      ) {
        throw new BadRequestException('Pořadí musí obsahovat právě všechny checkpointy závodu.');
      }
      await this.renumber(tx, raceId, ids);
      await this.assertOrder(tx, raceId);
      await this.audit.record(
        {
          userId: user.id,
          action: 'reorder',
          entity: 'checkpoint',
          entityId: raceId,
          before: current,
          after: ids,
        },
        tx,
      );
      const cps = await tx.checkpoint.findMany({ where: { raceId }, orderBy: { seq: 'asc' } });
      return cps.map(toCheckpointDto);
    });
  }

  // ---------- Kategorie ----------

  async updateCategory(
    user: RequestUser,
    raceId: string,
    id: string,
    input: CategoryUpdateInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findFirst({
        where: { id, raceId },
        include: { checkpoints: true },
      });
      if (!before) throw new NotFoundException('Kategorie nenalezena.');

      if (input.checkpointIds) {
        const valid = await tx.checkpoint.count({
          where: { raceId, id: { in: input.checkpointIds } },
        });
        if (valid !== new Set(input.checkpointIds).size) {
          throw new BadRequestException('Některý checkpoint nepatří k tomuto závodu.');
        }
        await tx.categoryCheckpoint.deleteMany({
          where: { categoryId: id, checkpointId: { notIn: input.checkpointIds } },
        });
        await tx.categoryCheckpoint.createMany({
          data: input.checkpointIds.map((checkpointId) => ({ categoryId: id, checkpointId })),
          skipDuplicates: true,
        });
      }
      await tx.category.update({
        where: { id },
        data: {
          name: input.name,
          distances: input.distances === null ? Prisma.DbNull : (input.distances ?? undefined),
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: 'update',
          entity: 'category',
          entityId: id,
          before,
          after: input,
        },
        tx,
      );
    });
  }

  // ---------- pomocné ----------

  private async assertUniqueName(
    tx: Prisma.TransactionClient,
    name: string,
    year: number,
    exceptId?: string,
  ): Promise<void> {
    const existing = await tx.race.findUnique({ where: { name_year: { name, year } } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`Závod „${name}“ pro rok ${year} už existuje.`);
    }
  }

  private async assertDiscipline(
    tx: Prisma.TransactionClient,
    raceId: string,
    disciplineId: string | null,
  ): Promise<void> {
    if (disciplineId && !(await tx.discipline.count({ where: { id: disciplineId, raceId } }))) {
      throw new BadRequestException('Disciplína nepatří k tomuto závodu.');
    }
  }

  private async findCheckpoint(tx: Prisma.TransactionClient, raceId: string, id: string) {
    const cp = await tx.checkpoint.findFirst({ where: { id, raceId } });
    if (!cp) throw new NotFoundException('Checkpoint nenalezen.');
    return cp;
  }

  /** Sub-checkpointy musí ležet uvnitř své disciplíny (jinak rollback celé transakce). */
  private async assertOrder(tx: Prisma.TransactionClient, raceId: string): Promise<void> {
    const cps = await tx.checkpoint.findMany({ where: { raceId }, orderBy: { seq: 'asc' } });
    const error = validateCheckpointOrder(cps);
    if (error) throw new BadRequestException(error);
  }

  private async checkpointIds(tx: Prisma.TransactionClient, raceId: string): Promise<string[]> {
    const cps = await tx.checkpoint.findMany({
      where: { raceId },
      orderBy: { seq: 'asc' },
      select: { id: true },
    });
    return cps.map((c) => c.id);
  }

  /** Přečísluje checkpointy 1..n; přes záporná čísla kvůli unikátnímu (raceId, seq). */
  private async renumber(
    tx: Prisma.TransactionClient,
    raceId: string,
    ids: string[],
  ): Promise<void> {
    for (const [i, id] of ids.entries()) {
      await tx.checkpoint.update({ where: { id }, data: { seq: -(i + 1) } });
    }
    for (const [i, id] of ids.entries()) {
      await tx.checkpoint.update({ where: { id }, data: { seq: i + 1 } });
    }
  }
}

function toCheckpointDto(cp: {
  id: string;
  name: string;
  seq: number;
  kind: CheckpointDto['kind'];
  disciplineId: string | null;
}): CheckpointDto {
  return { id: cp.id, name: cp.name, seq: cp.seq, kind: cp.kind, disciplineId: cp.disciplineId };
}
