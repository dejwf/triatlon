import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  computeCategoryResults,
  projectEvents,
  type CategoryResultsDto,
  type RaceResultsDto,
  type RankingOverrideInput,
  type ResultEvent,
  type TimeEventHistoryDto,
} from '@triatlon/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/decorators';
import { PrismaService } from '../prisma.service';
import { RacesService } from '../races/races.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly races: RacesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Průběžné / finální výsledky po kategoriích (počítáno z logu při každém dotazu). */
  async raceResults(
    user: RequestUser,
    raceId: string,
    categoryId?: string,
  ): Promise<RaceResultsDto> {
    await this.races.assertAccess(user, raceId);
    const [race, events, overrides] = await Promise.all([
      this.prisma.race.findUniqueOrThrow({
        where: { id: raceId },
        include: {
          disciplines: true,
          checkpoints: true,
          categories: {
            where: categoryId ? { id: categoryId } : {},
            include: { checkpoints: true, participants: true },
          },
        },
      }),
      this.prisma.timeEvent.findMany({
        where: { participant: { raceId, ...(categoryId ? { categoryId } : {}) } },
      }),
      this.prisma.rankingOverride.findMany({
        where: { category: { raceId }, supersededAt: null, ...(categoryId ? { categoryId } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (categoryId && race.categories.length === 0)
      throw new NotFoundException('Kategorie nenalezena.');

    const projection = projectEvents(
      events.map((e) => ({
        ...e,
        ts: e.ts.toISOString(),
        serverReceivedAt: e.serverReceivedAt.toISOString(),
      })),
    );
    const checkpointById = new Map(race.checkpoints.map((c) => [c.id, c]));

    const categories: CategoryResultsDto[] = race.categories
      .map((c) => {
        const own = overrides.filter((o) => o.categoryId === c.id);
        return {
          categoryId: c.id,
          name: c.name,
          overrides: own.map((o) => ({
            id: o.id,
            participantIds: o.participantIds,
            reason: o.reason,
            userId: o.userId,
            createdAt: o.createdAt.toISOString(),
          })),
          ...computeCategoryResults({
            checkpoints: c.checkpoints.map((cc) => checkpointById.get(cc.checkpointId)!),
            disciplines: race.disciplines,
            participants: c.participants,
            projection,
            overrides: own,
          }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'));

    const userIds = new Set([...events.map((e) => e.userId), ...overrides.map((o) => o.userId)]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    });

    return {
      raceId,
      generatedAt: new Date().toISOString(),
      categories,
      users: Object.fromEntries(users.map((u) => [u.id, u.name])),
    };
  }

  /**
   * Log akcí závodu (volitelně jen jednoho checkpointu) — mobilní appka z něj sdílenou projekcí
   * pozná, kdo už je zaznamenaný (i z jiných zařízení), a uloží si ho pro offline režim.
   */
  async events(user: RequestUser, raceId: string, checkpointId?: string): Promise<ResultEvent[]> {
    await this.races.assertAccess(user, raceId);
    const events = await this.prisma.timeEvent.findMany({
      where: { participant: { raceId }, ...(checkpointId ? { checkpointId } : {}) },
      orderBy: { serverReceivedAt: 'asc' },
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      participantId: e.participantId,
      checkpointId: e.checkpointId,
      ts: e.ts.toISOString(),
      note: e.note,
      refEventId: e.refEventId,
      reason: e.reason,
      userId: e.userId,
      serverReceivedAt: e.serverReceivedAt.toISOString(),
    }));
  }

  /** Kompletní historie akcí závodníka — auditní stopa (kdo, kdy, z jakého zařízení, proč). */
  async history(
    user: RequestUser,
    raceId: string,
    participantId: string,
  ): Promise<TimeEventHistoryDto[]> {
    await this.races.assertAccess(user, raceId);
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, raceId },
    });
    if (!participant) throw new NotFoundException('Závodník nenalezen.');
    const events = await this.prisma.timeEvent.findMany({
      where: { participantId },
      include: { user: { select: { name: true } } },
      orderBy: { serverReceivedAt: 'asc' },
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      checkpointId: e.checkpointId,
      ts: e.ts.toISOString(),
      note: e.note,
      refEventId: e.refEventId,
      reason: e.reason,
      userId: e.userId,
      userName: e.user.name,
      deviceId: e.deviceId,
      serverReceivedAt: e.serverReceivedAt.toISOString(),
    }));
  }

  /** Ruční určení pořadí v remíze (s důvodem, auditováno). Nahrazuje dřívější rozhodnutí stejné skupiny. */
  async createOverride(
    user: RequestUser,
    raceId: string,
    categoryId: string,
    input: RankingOverrideInput,
  ): Promise<void> {
    const ids = input.participantIds;
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Závodník je v pořadí dvakrát.');
    await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({ where: { id: categoryId, raceId } });
      if (!category) throw new NotFoundException('Kategorie nenalezena.');
      const count = await tx.participant.count({ where: { categoryId, id: { in: ids } } });
      if (count !== ids.length)
        throw new BadRequestException('Všichni závodníci musí být z této kategorie.');

      // Starší rozhodnutí o stejných závodnících přestávají platit.
      const previous = await tx.rankingOverride.findMany({
        where: { categoryId, supersededAt: null },
      });
      const overlapping = previous.filter((o) => o.participantIds.some((id) => ids.includes(id)));
      await tx.rankingOverride.updateMany({
        where: { id: { in: overlapping.map((o) => o.id) } },
        data: { supersededAt: new Date() },
      });
      const created = await tx.rankingOverride.create({
        data: { categoryId, participantIds: ids, reason: input.reason, userId: user.id },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: 'ranking_override',
          entity: 'category',
          entityId: categoryId,
          before: overlapping,
          after: created,
          reason: input.reason,
        },
        tx,
      );
    });
    this.realtime.resultsChanged(raceId, [categoryId]);
  }

  async removeOverride(
    user: RequestUser,
    raceId: string,
    categoryId: string,
    id: string,
    reason?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const override = await tx.rankingOverride.findFirst({
        where: { id, categoryId, category: { raceId }, supersededAt: null },
      });
      if (!override) throw new NotFoundException('Rozhodnutí o pořadí nenalezeno.');
      await tx.rankingOverride.update({ where: { id }, data: { supersededAt: new Date() } });
      await this.audit.record(
        {
          userId: user.id,
          action: 'ranking_override_remove',
          entity: 'category',
          entityId: categoryId,
          before: override,
          reason,
        },
        tx,
      );
    });
    this.realtime.resultsChanged(raceId, [categoryId]);
  }
}
