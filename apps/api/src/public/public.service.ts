import { Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import {
  AgeGroups,
  Distances,
  GENDER_LABEL,
  groupName,
  rankCombined,
  type CategoryResultsDto,
  type PublicCategoryDto,
  type PublicRaceResultsDto,
  type PublicRaceSummaryDto,
  type ResultRow,
} from '@triatlon/shared';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ResultsService } from '../results/results.service';

/** Veřejně viditelné jsou závody, které už začaly (plánované se nezobrazují). */
const VISIBLE = { status: { in: ['running' as const, 'finished' as const] } };

/** Pojistka, kdyby se změna nepropsala přes realtime (např. víc instancí API). */
const CACHE_TTL_MS = 15_000;

/**
 * Veřejná výsledková tabule. Výsledky se počítají jednou a sdílí se mezi všemi diváky
 * (cache po závodech, zneplatněná při každé změně) — stovky diváků = jeden výpočet.
 */
@Injectable()
export class PublicService implements OnModuleDestroy {
  private readonly cache = new Map<string, { at: number; value: Promise<PublicRaceResultsDto> }>();
  private readonly sub: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly results: ResultsService,
    realtime: RealtimeService,
  ) {
    this.sub = realtime.all().subscribe(({ raceId }) => this.cache.delete(raceId));
  }

  onModuleDestroy(): void {
    this.sub.unsubscribe();
  }

  async races(): Promise<PublicRaceSummaryDto[]> {
    const races = await this.prisma.race.findMany({
      where: VISIBLE,
      orderBy: [{ year: 'desc' }, { name: 'asc' }],
    });
    return races.map((r) => ({
      id: r.id,
      name: r.name,
      year: r.year,
      date: r.date.toISOString().slice(0, 10),
      status: r.status,
    }));
  }

  async assertVisible(raceId: string): Promise<void> {
    const race = await this.prisma.race.findFirst({ where: { id: raceId, ...VISIBLE } });
    if (!race) throw new NotFoundException('Závod nenalezen.');
  }

  async raceResults(raceId: string): Promise<PublicRaceResultsDto> {
    // Viditelnost se ověřuje vždy (levný dotaz) — závod mohl být mezitím vrácen do „plánovaný“.
    await this.assertVisible(raceId);
    const hit = this.cache.get(raceId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = this.build(raceId);
    this.cache.set(raceId, { at: Date.now(), value });
    value.catch(() => this.cache.delete(raceId));
    return value;
  }

  private async build(raceId: string): Promise<PublicRaceResultsDto> {
    const race = await this.prisma.race.findFirst({
      where: { id: raceId, ...VISIBLE },
      include: {
        checkpoints: { orderBy: { seq: 'asc' } },
        disciplines: { orderBy: { seq: 'asc' } },
      },
    });
    if (!race) throw new NotFoundException('Závod nenalezen.');
    const [results, hidden, meta] = await Promise.all([
      this.results.compute(raceId),
      this.prisma.participant.findMany({
        where: { raceId, publicName: false },
        select: { id: true },
      }),
      this.prisma.category.findMany({
        where: { raceId },
        select: { id: true, ageGroupLabel: true, gender: true, locality: true, distances: true },
      }),
    ]);
    const hiddenIds = new Set(hidden.map((p) => p.id));
    const ageGroups = AgeGroups.parse(race.ageGroups);
    const metaById = new Map(meta.map((c) => [c.id, c]));
    const distancesOf = (categoryId: string): Distances | null => {
      const parsed = Distances.safeParse(metaById.get(categoryId)?.distances);
      return parsed.success ? parsed.data : null;
    };
    const seqOf = new Map(race.checkpoints.map((c) => [c.id, c.seq]));
    const shown = results.categories.filter((c) => c.counts.registered > 0);
    // Pořadí v kategorii — ve společné tabulce domácích a hostů se zobrazí vedle společného.
    const inCategory = new Map(
      shown.flatMap((c) => c.rows.map((r) => [r.participantId, { rank: r.rank, tied: r.tied }])),
    );

    type Row = ResultRow & { locality: 'local' | 'guest' };
    const withLocality = (c: CategoryResultsDto): Row[] =>
      c.rows.map((r) => ({ ...r, locality: metaById.get(c.categoryId)!.locality }));

    const toDto = (
      id: string,
      name: string,
      cats: CategoryResultsDto[],
      rows: Row[],
      locality: 'local' | 'guest' | null,
    ): PublicCategoryDto => {
      const checkpointIds = [...new Set(cats.flatMap((c) => c.checkpointIds))].sort(
        (a, b) => seqOf.get(a)! - seqOf.get(b)!,
      );
      const starts = cats.map((c) => c.startedAt).filter((t): t is string => !!t);
      const closed = cats.map((c) => c.closedAt);
      return {
        id,
        name,
        categoryIds: cats.map((c) => c.categoryId),
        locality,
        distances: distancesOf(cats[0]!.categoryId),
        startedAt: starts.sort()[0] ?? null,
        closedAt: closed.every((t) => t) ? (closed as string[]).sort().at(-1)! : null,
        counts: {
          started: cats.reduce((n, c) => n + c.counts.started, 0),
          finished: cats.reduce((n, c) => n + c.counts.finished, 0),
          dnf: cats.reduce((n, c) => n + c.counts.dnf, 0),
        },
        checkpointIds,
        rows: rows.map((r) => {
          const splits = new Map(r.splits.map((s) => [s.checkpointId, s.elapsedMs]));
          return {
            bib: r.bib,
            locality: r.locality,
            name: hiddenIds.has(r.participantId) ? null : r.displayName,
            state: r.state,
            rank: r.rank,
            tied: r.tied,
            categoryRank: inCategory.get(r.participantId)?.rank ?? null,
            categoryTied: inCategory.get(r.participantId)?.tied ?? false,
            totalMs: r.totalMs,
            startedAt: r.startTs,
            splitsMs: checkpointIds.map((id) => splits.get(id) ?? null),
            disciplinesMs: r.disciplines.map((d) => d.ms),
          };
        }),
      };
    };

    const categories = shown.map((c) =>
      toDto(c.categoryId, c.name, [c], withLocality(c), metaById.get(c.categoryId)!.locality),
    );

    // Výchozí pohled: domácí + hosté téže věkové skupiny a pohlaví v jedné tabulce.
    const grouped = new Map<string, CategoryResultsDto[]>();
    for (const c of shown) {
      const m = metaById.get(c.categoryId)!;
      const key = `${m.ageGroupLabel}|${m.gender}`;
      grouped.set(key, [...(grouped.get(key) ?? []), c]);
    }
    const groups = [...grouped].map(([key, cats]) => {
      const m = metaById.get(cats[0]!.categoryId)!;
      // Domácí před hosty (stejné pořadí jako ve sloupci D/H).
      const order = (c: CategoryResultsDto) =>
        metaById.get(c.categoryId)!.locality === 'local' ? 0 : 1;
      cats.sort((a, b) => order(a) - order(b));
      const rows = rankCombined(
        cats.flatMap(withLocality),
        race.checkpoints,
        cats.flatMap((c) => c.overrides),
      );
      const group = ageGroups.find((g) => g.label === m.ageGroupLabel);
      const name = group
        ? groupName(group, m.gender)
        : `${m.ageGroupLabel} ${GENDER_LABEL[m.gender]}`;
      return toDto(key, name, cats, rows, null);
    });

    return {
      race: {
        id: race.id,
        name: race.name,
        year: race.year,
        date: race.date.toISOString().slice(0, 10),
        status: race.status,
      },
      generatedAt: results.generatedAt,
      checkpoints: race.checkpoints.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        disciplineId: c.disciplineId,
      })),
      disciplines: race.disciplines.map((d) => ({ id: d.id, name: d.name })),
      groups,
      categories,
    };
  }
}
