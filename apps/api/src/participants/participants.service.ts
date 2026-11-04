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
  type ImportResult,
  type ImportRowResult,
  type ParticipantDto,
  type ParticipantInput,
  type ParticipantUpdateInput,
  type RegistrationSource,
} from '@triatlon/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../auth/decorators';
import type { Participant, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { RacesService } from '../races/races.service';
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
      const category = await this.resolve(tx, raceId, merged);
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
        data: { ...merged, categoryId: category.id, bib, status: input.status },
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

  // ---------- pomocné ----------

  private async find(tx: Tx, raceId: string, id: string): Promise<Participant> {
    const p = await tx.participant.findFirst({ where: { id, raceId } });
    if (!p) throw new NotFoundException('Závodník nenalezen.');
    return p;
  }

  private async resolve(
    tx: Tx,
    raceId: string,
    p: Pick<ParticipantInput, 'birthYear' | 'gender' | 'locality'>,
  ) {
    const race = await tx.race.findUnique({ where: { id: raceId } });
    if (!race) throw new NotFoundException('Závod nenalezen.');
    const categories = await tx.category.findMany({ where: { raceId } });
    const r = resolveCategory(p, race.year, AgeGroups.parse(race.ageGroups), categories);
    if ('error' in r) throw new UnprocessableEntityException(r.error);
    return r.category;
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
  };
}
