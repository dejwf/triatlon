import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgeGroups,
  parseImportRow,
  resolveCategory,
  type CheckInStatus,
  type ImportResult,
  type OnSiteRegistrationInput,
  type OnSiteRegistrationResult,
  type ImportRowResult,
  type ParticipantDto,
  type ParticipantExportDto,
  type ParticipantInput,
  type ParticipantUpdateInput,
  type RegistrationSource,
} from '@triatlon/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/decorators';
import { Prisma, type Participant } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { isAdmin, RacesService } from '../races/races.service';
import { RealtimeService } from '../realtime/realtime.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly races: RacesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(user: RequestUser, raceId: string, categoryId?: string): Promise<ParticipantDto[]> {
    await this.races.assertAccess(user, raceId);
    const rows = await this.prisma.participant.findMany({
      where: { raceId, ...(categoryId ? { categoryId } : {}) },
      orderBy: [{ categoryId: 'asc' }, { bib: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(
    user: RequestUser,
    raceId: string,
    input: ParticipantInput,
    source: RegistrationSource = 'manual',
  ): Promise<ParticipantDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      const category = await this.resolve(tx, raceId, input);
      const bib = input.bib ?? (await this.nextBib(tx, category.id));
      await this.assertBibFree(tx, category.id, category.name, bib);
      const p = await tx.participant.create({
        data: {
          raceId,
          categoryId: category.id,
          bib,
          firstName: input.firstName,
          lastName: input.lastName,
          birthYear: input.birthYear,
          gender: input.gender,
          locality: input.locality,
          registrationSource: source,
          publicName: input.publicName ?? true,
          nickname: input.nickname ?? null,
          formal: input.formal ?? true,
        },
      });
      await this.audit.record(
        { userId: user.id, action: 'create', entity: 'participant', entityId: p.id, after: p },
        tx,
      );
      return toDto(p);
    });
    this.realtime.resultsChanged(raceId, [created.categoryId]);
    return created;
  }

  async update(
    user: RequestUser,
    raceId: string,
    id: string,
    input: ParticipantUpdateInput,
  ): Promise<ParticipantDto> {
    let previousCategory = '';
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, raceId, id);
      previousCategory = before.categoryId;
      const merged = {
        firstName: input.firstName ?? before.firstName,
        lastName: input.lastName ?? before.lastName,
        birthYear: input.birthYear ?? before.birthYear,
        gender: input.gender ?? before.gender,
        locality: input.locality ?? before.locality,
      };
      // Zvolená volitelná kategorie (Super ženy) zůstává, dokud ji úprava výslovně nezmění.
      const electiveGroup =
        input.electiveGroup !== undefined
          ? input.electiveGroup
          : await this.currentElective(tx, raceId, before.categoryId);
      const category = await this.resolve(tx, raceId, { ...merged, electiveGroup });
      const bib = input.bib ?? before.bib;

      if (
        category.id !== before.categoryId &&
        (await tx.timeEvent.count({ where: { participantId: id } }))
      ) {
        throw new ConflictException(
          'Závodník už má zaznamenané časy — změna by ho přesunula do jiné kategorie.',
        );
      }
      if (category.id !== before.categoryId || bib !== before.bib) {
        await this.assertBibFree(tx, category.id, category.name, bib, id);
      }

      const p = await tx.participant.update({
        where: { id },
        data: {
          ...merged,
          categoryId: category.id,
          bib,
          status: input.status,
          publicName: input.publicName,
          nickname: input.nickname,
          formal: input.formal,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: 'update',
          entity: 'participant',
          entityId: id,
          before,
          after: p,
        },
        tx,
      );
      return toDto(p);
    });
    // Změna stavu (nepřítomen, diskvalifikace) mění výsledky.
    this.realtime.resultsChanged(raceId, [previousCategory, updated.categoryId]);
    return updated;
  }

  /** Check-in na startu: přítomen / nepřítomen (organizátor startu nebo admin). */
  async setStatus(
    user: RequestUser,
    raceId: string,
    id: string,
    status: CheckInStatus,
  ): Promise<ParticipantDto> {
    await this.races.assertStartAccess(user, raceId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, raceId, id);
      await this.assertOpen(tx, user, before.categoryId);
      if (before.status === 'disqualified') {
        throw new ConflictException('Závodník je diskvalifikován — stav může změnit jen admin.');
      }
      if (before.status === status) return toDto(before);
      const p = await tx.participant.update({ where: { id }, data: { status } });
      await this.audit.record(
        {
          userId: user.id,
          action: 'check_in',
          entity: 'participant',
          entityId: id,
          before: { status: before.status },
          after: { status },
        },
        tx,
      );
      return toDto(p);
    });
    this.realtime.resultsChanged(raceId, [updated.categoryId]);
    return updated;
  }

  /**
   * Registrace na místě z mobilu (i offline přes frontu). Idempotentní podle klientského `id`.
   * Když je navržené číslo mezitím obsazené, přidělí se další volné a klient to zobrazí.
   */
  async registerOnSite(
    user: RequestUser,
    raceId: string,
    input: OnSiteRegistrationInput,
  ): Promise<OnSiteRegistrationResult> {
    await this.races.assertStartAccess(user, raceId);
    const requestedBib = input.bib ?? null;
    const existing = await this.prisma.participant.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.raceId !== raceId) throw new ConflictException('Kolize identifikátoru.');
      return {
        participant: toDto(existing),
        requestedBib,
        bibChanged: requestedBib !== null && requestedBib !== existing.bib,
      };
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const category = await this.resolve(tx, raceId, input);
      await this.assertOpen(tx, user, category.id);
      let bib = input.bib ?? (await this.nextBib(tx, category.id));
      const taken = await tx.participant.findUnique({
        where: { categoryId_bib: { categoryId: category.id, bib } },
      });
      if (taken) bib = await this.nextBib(tx, category.id);
      const p = await tx.participant.create({
        data: {
          id: input.id,
          raceId,
          categoryId: category.id,
          bib,
          firstName: input.firstName,
          lastName: input.lastName,
          birthYear: input.birthYear,
          gender: input.gender,
          locality: input.locality,
          status: 'checked_in',
          registrationSource: 'on_site',
          nickname: input.nickname ?? null,
          formal: input.formal ?? true,
        },
      });
      await this.audit.record(
        { userId: user.id, action: 'create', entity: 'participant', entityId: p.id, after: p },
        tx,
      );
      return toDto(p);
    });
    this.realtime.resultsChanged(raceId, [created.categoryId]);
    return {
      participant: created,
      requestedBib,
      bibChanged: requestedBib !== null && requestedBib !== created.bib,
    };
  }

  async remove(user: RequestUser, raceId: string, id: string): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        const before = await this.find(tx, raceId, id);
        if (await tx.timeEvent.count({ where: { participantId: id } })) {
          throw new ConflictException(
            'Závodník už má zaznamenané časy, nelze ho smazat (lze ho označit jako nepřítomného).',
          );
        }
        await tx.participant.delete({ where: { id } });
        await this.audit.record(
          { userId: user.id, action: 'delete', entity: 'participant', entityId: id, before },
          tx,
        );
        return before.categoryId;
      })
      .then((categoryId) => this.realtime.resultsChanged(raceId, [categoryId]));
  }

  /**
   * Import z CSV/XLSX (řádky už rozparsované klientem). Validuje vše a importuje buď všechny
   * řádky, nebo žádný. `dryRun` = jen náhled s výsledkem validace.
   */
  async import(
    user: RequestUser,
    raceId: string,
    rows: Record<string, unknown>[],
    dryRun: boolean,
  ): Promise<ImportResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const race = await tx.race.findUnique({ where: { id: raceId } });
      if (!race) throw new NotFoundException('Závod nenalezen.');
      const ageGroups = AgeGroups.parse(race.ageGroups);
      const categories = await tx.category.findMany({ where: { raceId } });
      const existing = await tx.participant.findMany({
        where: { raceId },
        select: { categoryId: true, bib: true, firstName: true, lastName: true, birthYear: true },
      });

      const taken = new Map<string, Set<number>>(categories.map((c) => [c.id, new Set<number>()]));
      for (const p of existing) taken.get(p.categoryId)!.add(p.bib);
      const personKey = (p: { firstName: string; lastName: string; birthYear: number }) =>
        `${p.firstName}|${p.lastName}|${p.birthYear}`.toLocaleLowerCase('cs');
      const people = new Set(existing.map(personKey));

      // 1. průchod: parsování, kategorie, explicitní čísla, duplicity
      const results: ImportRowResult[] = rows.map((raw, i) => {
        const parsed = parseImportRow(raw);
        if (!parsed.ok) return { row: i + 1, errors: parsed.errors };
        const resolved = resolveCategory(parsed.value, race.year, ageGroups, categories);
        if ('error' in resolved) return { row: i + 1, errors: [resolved.error] };

        const errors: string[] = [];
        const key = personKey(parsed.value);
        if (people.has(key))
          errors.push('Závodník se stejným jménem a ročníkem už je zaregistrován.');
        people.add(key);

        const bibs = taken.get(resolved.category.id)!;
        const bib = parsed.value.bib;
        if (bib !== undefined) {
          if (bibs.has(bib)) {
            errors.push(
              `Startovní číslo ${bib} už je v kategorii ${resolved.category.name} obsazené.`,
            );
          }
          bibs.add(bib);
        }
        return {
          row: i + 1,
          errors,
          participant: {
            ...parsed.value,
            bib: bib ?? 0,
            categoryId: resolved.category.id,
            categoryName: resolved.category.name,
          },
        };
      });

      // 2. průchod: přidělení volných čísel tam, kde v souboru chybí
      for (const r of results) {
        if (r.participant && r.participant.bib === 0) {
          const bibs = taken.get(r.participant.categoryId)!;
          const next = Math.max(0, ...bibs) + 1;
          bibs.add(next);
          r.participant.bib = next;
        }
      }

      const ok = results.every((r) => r.errors.length === 0);
      if (!ok || dryRun) return { ok, imported: 0, rows: results };

      await tx.participant.createMany({
        data: results.map(({ participant: p }) => ({
          raceId,
          categoryId: p!.categoryId,
          bib: p!.bib,
          firstName: p!.firstName,
          lastName: p!.lastName,
          birthYear: p!.birthYear,
          gender: p!.gender,
          locality: p!.locality,
          nickname: p!.nickname ?? null,
          formal: p!.formal ?? true,
          registrationSource: 'import' as const,
        })),
      });
      await this.audit.record(
        {
          userId: user.id,
          action: 'import',
          entity: 'participant',
          entityId: raceId,
          after: { count: results.length },
        },
        tx,
      );
      return { ok, imported: results.length, rows: results };
    });

    if (!result.ok && !dryRun) throw new UnprocessableEntityException(result);
    if (result.imported) {
      this.realtime.resultsChanged(
        raceId,
        result.rows.map((r) => r.participant!.categoryId),
      );
    }
    return result;
  }

  // ---------- GDPR ----------

  /** Všechny osobní údaje závodníka v čitelné podobě (právo na přístup / přenositelnost). */
  async export(user: RequestUser, raceId: string, id: string): Promise<ParticipantExportDto> {
    const p = await this.prisma.participant.findFirst({
      where: { id, raceId },
      include: {
        race: true,
        category: true,
        timeEvents: { include: { checkpoint: true }, orderBy: { serverReceivedAt: 'asc' } },
      },
    });
    if (!p) throw new NotFoundException('Závodník nenalezen.');
    await this.audit.record({
      userId: user.id,
      action: 'gdpr_export',
      entity: 'participant',
      entityId: id,
    });
    return {
      exportedAt: new Date().toISOString(),
      race: { name: p.race.name, year: p.race.year },
      participant: {
        firstName: p.firstName,
        lastName: p.lastName,
        birthYear: p.birthYear,
        gender: p.gender,
        locality: p.locality,
        bib: p.bib,
        category: p.category.name,
        status: p.status,
        registrationSource: p.registrationSource,
        publicName: p.publicName,
        nickname: p.nickname,
        formal: p.formal,
        createdAt: p.createdAt.toISOString(),
      },
      times: p.timeEvents.map((e) => ({
        checkpoint: e.checkpoint.name,
        type: e.type,
        ts: e.ts.toISOString(),
        note: e.note,
      })),
    };
  }

  /**
   * Anonymizace (právo na výmaz): jméno se nahradí, jméno se skryje z veřejné tabule a z auditu
   * se odstraní kopie osobních údajů. Ročník, kategorie, číslo a časy zůstanou — výsledky
   * ostatních závodníků (pořadí) se nesmí změnit.
   */
  async anonymize(
    user: RequestUser,
    raceId: string,
    id: string,
    reason: string,
  ): Promise<ParticipantDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.find(tx, raceId, id);
      if (before.anonymizedAt) return toDto(before);
      const p = await tx.participant.update({
        where: { id },
        data: {
          firstName: 'Anonymizovaný',
          lastName: 'závodník',
          nickname: null,
          formal: true,
          publicName: false,
          anonymizedAt: new Date(),
        },
      });
      await tx.auditLog.updateMany({
        where: { entity: 'participant', entityId: id },
        data: { before: Prisma.DbNull, after: Prisma.DbNull },
      });
      await this.audit.record(
        { userId: user.id, action: 'anonymize', entity: 'participant', entityId: id, reason },
        tx,
      );
      return toDto(p);
    });
    this.realtime.resultsChanged(raceId, [updated.categoryId]);
    return updated;
  }

  // ---------- pomocné ----------

  /** Do uzavřené kategorie smí zasahovat už jen admin. */
  private async assertOpen(tx: Tx, user: RequestUser, categoryId: string): Promise<void> {
    if (isAdmin(user)) return;
    const c = await tx.category.findUnique({ where: { id: categoryId } });
    if (c?.closedAt) {
      throw new ConflictException(`Kategorie ${c.name} je uzavřená — obraťte se na admina.`);
    }
  }

  private async find(tx: Tx, raceId: string, id: string): Promise<Participant> {
    const p = await tx.participant.findFirst({ where: { id, raceId } });
    if (!p) throw new NotFoundException('Závodník nenalezen.');
    return p;
  }

  private async resolve(
    tx: Tx,
    raceId: string,
    p: Pick<ParticipantInput, 'birthYear' | 'gender' | 'locality' | 'electiveGroup'>,
  ) {
    const race = await tx.race.findUnique({ where: { id: raceId } });
    if (!race) throw new NotFoundException('Závod nenalezen.');
    const categories = await tx.category.findMany({ where: { raceId } });
    const r = resolveCategory(p, race.year, AgeGroups.parse(race.ageGroups), categories);
    if ('error' in r) throw new UnprocessableEntityException(r.error);
    return r.category;
  }

  /** Popisek volitelné skupiny, je-li závodník v její kategorii; jinak null. */
  private async currentElective(tx: Tx, raceId: string, categoryId: string) {
    const [race, category] = await Promise.all([
      tx.race.findUniqueOrThrow({ where: { id: raceId } }),
      tx.category.findUniqueOrThrow({ where: { id: categoryId } }),
    ]);
    const group = AgeGroups.parse(race.ageGroups).find((g) => g.label === category.ageGroupLabel);
    return group?.elective ? group.label : null;
  }

  private async nextBib(tx: Tx, categoryId: string): Promise<number> {
    const max = await tx.participant.aggregate({ where: { categoryId }, _max: { bib: true } });
    return (max._max.bib ?? 0) + 1;
  }

  private async assertBibFree(
    tx: Tx,
    categoryId: string,
    categoryName: string,
    bib: number,
    exceptId?: string,
  ): Promise<void> {
    const other = await tx.participant.findUnique({
      where: { categoryId_bib: { categoryId, bib } },
    });
    if (other && other.id !== exceptId) {
      throw new ConflictException(
        `Startovní číslo ${bib} už je v kategorii ${categoryName} obsazené.`,
      );
    }
  }
}

function toDto(p: Participant): ParticipantDto {
  return {
    id: p.id,
    categoryId: p.categoryId,
    bib: p.bib,
    firstName: p.firstName,
    lastName: p.lastName,
    birthYear: p.birthYear,
    gender: p.gender,
    locality: p.locality,
    status: p.status,
    registrationSource: p.registrationSource,
    publicName: p.publicName,
    nickname: p.nickname,
    formal: p.formal,
    anonymized: p.anonymizedAt !== null,
  };
}
