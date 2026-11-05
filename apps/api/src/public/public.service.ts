import { Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type {
  PublicCategoryDto,
  PublicRaceResultsDto,
  PublicRaceSummaryDto,
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

  raceResults(raceId: string): Promise<PublicRaceResultsDto> {
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
    const [results, hidden] = await Promise.all([
      this.results.compute(raceId),
      this.prisma.participant.findMany({
        where: { raceId, publicName: false },
        select: { id: true },
      }),
    ]);
    const hiddenIds = new Set(hidden.map((p) => p.id));

    const categories: PublicCategoryDto[] = results.categories
      .filter((c) => c.counts.registered > 0)
      .map((c) => ({
        id: c.categoryId,
        name: c.name,
        startedAt: c.startedAt,
        closedAt: c.closedAt,
        counts: { started: c.counts.started, finished: c.counts.finished, dnf: c.counts.dnf },
        checkpointIds: c.checkpointIds,
        rows: c.rows.map((r) => {
          const splits = new Map(r.splits.map((s) => [s.checkpointId, s.elapsedMs]));
          return {
            bib: r.bib,
            name: hiddenIds.has(r.participantId) ? null : `${r.lastName} ${r.firstName}`,
            state: r.state,
            rank: r.rank,
            tied: r.tied,
            totalMs: r.totalMs,
            splitsMs: c.checkpointIds.map((id) => splits.get(id) ?? null),
            disciplinesMs: r.disciplines.map((d) => d.ms),
          };
        }),
      }));

    return {
      race: {
        id: race.id,
        name: race.name,
        year: race.year,
        date: race.date.toISOString().slice(0, 10),
        status: race.status,
      },
      generatedAt: results.generatedAt,
      checkpoints: race.checkpoints.map((c) => ({ id: c.id, name: c.name })),
      disciplines: race.disciplines.map((d) => ({ id: d.id, name: d.name })),
      categories,
    };
  }
}
