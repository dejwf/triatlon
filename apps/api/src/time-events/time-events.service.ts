import { Injectable } from '@nestjs/common';
import type { TimeEventInput, TimeEventResult } from '@triatlon/shared';
import type { RequestUser } from '../auth/decorators';
import type { TimeEvent } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { RacesService } from '../races/races.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Tolerance pro čas akce v budoucnosti (rozjeté hodiny zařízení). */
const MAX_FUTURE_MS = 5 * 60 * 1000;

const isAdmin = (u: RequestUser) => u.role === 'admin' || u.role === 'super_admin';

class Rejected extends Error {}

/**
 * Příjem akcí z checkpointů (CLAUDE.md, sekce 4 a 8). Log je append-only: nic se
 * nepřepisuje ani nemaže, zrušení a korekce jsou nové události. Zápis je idempotentní
 * podle klientského UUID — opakované odeslání po výpadku sítě nic nezduplikuje.
 */
@Injectable()
export class TimeEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly races: RacesService,
    private readonly realtime: RealtimeService,
  ) {}

  async ingest(
    user: RequestUser,
    raceId: string,
    events: TimeEventInput[],
  ): Promise<TimeEventResult[]> {
    await this.races.assertAccess(user, raceId);

    const participantIds = [...new Set(events.map((e) => e.participantId))];
    const [participants, checkpoints, assignments, existing] = await Promise.all([
      this.prisma.participant.findMany({
        where: { raceId, id: { in: participantIds } },
        include: { category: { include: { checkpoints: true } } },
      }),
      this.prisma.checkpoint.findMany({ where: { raceId } }),
      this.prisma.assignment.findMany({ where: { raceId, userId: user.id } }),
      // Dosavadní události dotčených závodníků — kvůli duplicitám a odkazům (cancel/korekce).
      this.prisma.timeEvent.findMany({ where: { participantId: { in: participantIds } } }),
    ]);
    const participantById = new Map(participants.map((p) => [p.id, p]));
    const checkpointIds = new Set(checkpoints.map((c) => c.id));
    const assigned = new Set(assignments.map((a) => a.checkpointId));
    const known = new Map<
      string,
      Pick<TimeEvent, 'id' | 'type' | 'participantId' | 'checkpointId' | 'userId' | 'refEventId'>
    >(existing.map((e) => [e.id, e]));
    // ID mimo dotčené závodníky (kolize UUID nebo jiný závod) — duplicitu odhalí i tak.
    const otherIds = new Set(
      (
        await this.prisma.timeEvent.findMany({
          where: { id: { in: events.map((e) => e.id) }, participantId: { notIn: participantIds } },
          select: { id: true },
        })
      ).map((e) => e.id),
    );

    const results: TimeEventResult[] = [];
    const changedCategories = new Set<string>();

    // Sekvenčně: akce v dávce na sebe mohou odkazovat (offline: zaznamenat → vrátit akci).
    for (const e of events) {
      if (known.has(e.id) || otherIds.has(e.id)) {
        results.push({ id: e.id, status: 'duplicate' });
        continue;
      }
      try {
        const participant = participantById.get(e.participantId);
        if (!participant) throw new Rejected('Závodník nepatří k tomuto závodu.');
        if (!checkpointIds.has(e.checkpointId))
          throw new Rejected('Checkpoint nepatří k tomuto závodu.');
        if (!participant.category.checkpoints.some((c) => c.checkpointId === e.checkpointId)) {
          throw new Rejected('Checkpoint neplatí pro kategorii závodníka.');
        }
        this.authorize(user, e, assigned, known);
        if (Date.parse(e.ts) > Date.now() + MAX_FUTURE_MS) {
          throw new Rejected('Čas akce je v budoucnosti — zkontrolujte hodiny zařízení.');
        }
        if (e.type === 'record' && participant.status === 'absent') {
          throw new Rejected('Závodník je označen jako nepřítomný.');
        }

        const { count } = await this.prisma.timeEvent.createMany({
          data: [
            {
              id: e.id,
              type: e.type,
              participantId: e.participantId,
              checkpointId: e.checkpointId,
              ts: new Date(e.ts),
              note: e.note,
              refEventId: e.refEventId,
              reason: e.reason,
              userId: user.id,
              deviceId: e.deviceId,
            },
          ],
          skipDuplicates: true,
        });
        known.set(e.id, { ...e, userId: user.id, refEventId: e.refEventId ?? null });
        results.push({ id: e.id, status: count ? 'accepted' : 'duplicate' });
        if (count) changedCategories.add(participant.categoryId);
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        results.push({ id: e.id, status: 'rejected', reason: err.message });
      }
    }

    this.realtime.resultsChanged(raceId, changedCategories);
    return results;
  }

  private authorize(
    user: RequestUser,
    e: TimeEventInput,
    assigned: Set<string>,
    known: Map<
      string,
      Pick<TimeEvent, 'type' | 'participantId' | 'checkpointId' | 'userId' | 'refEventId'>
    >,
  ): void {
    const admin = isAdmin(user);
    if (!admin && !assigned.has(e.checkpointId)) {
      throw new Rejected('Na tento checkpoint nejste přiřazen.');
    }

    const ref = e.refEventId ? known.get(e.refEventId) : undefined;
    if (e.refEventId) {
      if (!ref) throw new Rejected('Odkazovaný záznam neexistuje.');
      if (ref.participantId !== e.participantId || ref.checkpointId !== e.checkpointId) {
        throw new Rejected('Odkazovaný záznam patří jinému závodníkovi nebo checkpointu.');
      }
      const isTimeRecord =
        ref.type === 'record' || (ref.type === 'admin_correction' && !ref.refEventId);
      if (!isTimeRecord) throw new Rejected('Odkaz musí mířit na záznam času.');
    }

    switch (e.type) {
      case 'record':
        if (e.refEventId) throw new Rejected('Záznam času nemůže na nic odkazovat.');
        return;
      case 'note':
        if (!e.note?.trim()) throw new Rejected('Poznámka je prázdná.');
        return;
      case 'cancel':
        if (!ref) throw new Rejected('Chybí záznam, který se má zrušit.');
        // Organizátor smí vrátit jen vlastní záznam; admin cizí jen s důvodem.
        if (ref.userId !== user.id) {
          if (!admin) throw new Rejected('Nelze rušit záznam jiného organizátora.');
          if (!e.reason?.trim()) throw new Rejected('Zrušení cizího záznamu vyžaduje důvod.');
        }
        return;
      case 'admin_correction':
        if (!admin) throw new Rejected('Korekce času smí provést jen admin.');
        if (!e.reason?.trim()) throw new Rejected('Korekce času vyžaduje důvod.');
        return;
    }
  }
}
