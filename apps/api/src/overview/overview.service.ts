import { Injectable } from '@nestjs/common';
import type {
  AuditItemDto,
  AuditKind,
  DeviceHeartbeatInput,
  DeviceStatusDto,
  RaceOverviewDto,
} from '@triatlon/shared';
import type { RequestUser } from '../auth/decorators';
import { PrismaService } from '../prisma.service';
import { RacesService } from '../races/races.service';

const AUDIT_LIMIT = 30;

/**
 * Přehled závodu pro administraci (design_claude.md 4.3): telefony na checkpointech
 * (heartbeat z appky + poslední přijaté akce) a poslední zásahy napříč auditem a logem časů.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly races: RacesService,
  ) {}

  async heartbeat(user: RequestUser, raceId: string, input: DeviceHeartbeatInput): Promise<void> {
    await this.races.assertAccess(user, raceId);
    // Checkpoint jiného závodu (nebo smazaný) se neukládá.
    const checkpointId =
      input.checkpointId &&
      (await this.prisma.checkpoint.count({ where: { id: input.checkpointId, raceId } }))
        ? input.checkpointId
        : null;
    const data = {
      userId: user.id,
      checkpointId,
      clockOffsetMs: input.clockOffsetMs ?? null,
      clockCheckedAt: input.clockCheckedAt ? new Date(input.clockCheckedAt) : null,
      pending: input.pending,
      oldestPendingAt: input.oldestPendingAt ? new Date(input.oldestPendingAt) : null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: new Date(),
    };
    await this.prisma.deviceStatus.upsert({
      where: { raceId_deviceId: { raceId, deviceId: input.deviceId } },
      create: { raceId, deviceId: input.deviceId, ...data },
      update: data,
    });
  }

  async overview(user: RequestUser, raceId: string): Promise<RaceOverviewDto> {
    await this.races.assertAccess(user, raceId);
    const [devices, audit] = await Promise.all([this.devices(raceId), this.audit(raceId)]);
    return { generatedAt: new Date().toISOString(), devices, audit };
  }

  private async devices(raceId: string): Promise<DeviceStatusDto[]> {
    const [statuses, lastEvents] = await Promise.all([
      this.prisma.deviceStatus.findMany({
        where: { raceId },
        include: { user: true, checkpoint: true },
      }),
      this.prisma.timeEvent.groupBy({
        by: ['deviceId', 'userId'],
        where: { participant: { raceId } },
        _max: { serverReceivedAt: true },
      }),
    ]);
    const lastAt = new Map(
      lastEvents.map((e) => [`${e.deviceId}|${e.userId}`, e._max.serverReceivedAt]),
    );
    const out: DeviceStatusDto[] = statuses.map((s) => ({
      deviceId: s.deviceId,
      user: { id: s.user.id, name: s.user.name, email: s.user.email },
      checkpoint: s.checkpoint ? { id: s.checkpoint.id, name: s.checkpoint.name } : null,
      lastSeenAt: s.lastSeenAt.toISOString(),
      lastEventAt: lastAt.get(`${s.deviceId}|${s.userId}`)?.toISOString() ?? null,
      clockOffsetMs: s.clockOffsetMs,
      clockCheckedAt: s.clockCheckedAt?.toISOString() ?? null,
      pending: s.pending,
      oldestPendingAt: s.oldestPendingAt?.toISOString() ?? null,
      appVersion: s.appVersion,
    }));

    // Zařízení bez heartbeatu (web admina, starší appka) — jen z přijatých akcí.
    const known = new Set(statuses.map((s) => `${s.deviceId}|${s.userId}`));
    const rest = lastEvents.filter((e) => !known.has(`${e.deviceId}|${e.userId}`));
    if (rest.length) {
      const [users, checkpoints] = await Promise.all([
        this.prisma.user.findMany({ where: { id: { in: rest.map((e) => e.userId) } } }),
        // Poslední checkpoint, na který zařízení zapisovalo.
        Promise.all(
          rest.map((e) =>
            this.prisma.timeEvent.findFirst({
              where: { deviceId: e.deviceId, userId: e.userId, participant: { raceId } },
              orderBy: { serverReceivedAt: 'desc' },
              select: { checkpoint: { select: { id: true, name: true } } },
            }),
          ),
        ),
      ]);
      const byId = new Map(users.map((u) => [u.id, u]));
      rest.forEach((e, i) => {
        const u = byId.get(e.userId);
        if (!u) return;
        out.push({
          deviceId: e.deviceId,
          user: { id: u.id, name: u.name, email: u.email },
          checkpoint: checkpoints[i]?.checkpoint ?? null,
          lastSeenAt: null,
          lastEventAt: e._max.serverReceivedAt?.toISOString() ?? null,
          clockOffsetMs: null,
          clockCheckedAt: null,
          pending: 0,
          oldestPendingAt: null,
          appVersion: null,
        });
      });
    }
    const seen = (d: DeviceStatusDto) => d.lastSeenAt ?? d.lastEventAt ?? '';
    return out.sort((a, b) => seen(b).localeCompare(seen(a)));
  }

  /** Poslední zásahy: audit administrativních změn + korekce, zrušení a hromadné starty. */
  private async audit(raceId: string): Promise<AuditItemDto[]> {
    const [race, categories, checkpoints, participants] = await Promise.all([
      this.prisma.race.findUniqueOrThrow({ where: { id: raceId }, select: { id: true } }),
      this.prisma.category.findMany({ where: { raceId }, select: { id: true, name: true } }),
      this.prisma.checkpoint.findMany({
        where: { raceId },
        select: { id: true, name: true, seq: true, kind: true, disciplineId: true },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.participant.findMany({
        where: { raceId },
        select: { id: true, bib: true, firstName: true, lastName: true, categoryId: true },
      }),
    ]);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const cpName = new Map(checkpoints.map((c) => [c.id, c.name]));
    const person = new Map(participants.map((p) => [p.id, p]));
    const who = (id: string) => {
      const p = person.get(id);
      return p ? `č. ${p.bib} (${catName.get(p.categoryId) ?? '?'})` : 'závodník';
    };
    const startId = checkpoints.find((c) => c.kind === 'transition')?.id;
    const entityIds = [
      race.id,
      ...categories.map((c) => c.id),
      ...checkpoints.map((c) => c.id),
      ...participants.map((p) => p.id),
    ];

    const [logs, events, starts] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entityId: { in: entityIds } },
        orderBy: { createdAt: 'desc' },
        take: AUDIT_LIMIT,
      }),
      this.prisma.timeEvent.findMany({
        where: { participant: { raceId }, type: { in: ['cancel', 'admin_correction'] } },
        orderBy: { serverReceivedAt: 'desc' },
        take: AUDIT_LIMIT,
        include: { refEvent: { select: { ts: true } } },
      }),
      startId
        ? this.prisma.timeEvent.groupBy({
            by: ['userId', 'ts'],
            where: { checkpointId: startId, type: 'record' },
            _count: { _all: true },
            _max: { serverReceivedAt: true },
            orderBy: { _max: { serverReceivedAt: 'desc' } },
            take: AUDIT_LIMIT,
          })
        : Promise.resolve([]),
    ]);
    const massStarts = starts.filter((s) => s._count._all > 1);
    const startCats = await Promise.all(
      massStarts.map((s) =>
        this.prisma.timeEvent.findFirst({
          where: { checkpointId: startId, type: 'record', userId: s.userId, ts: s.ts },
          select: { participant: { select: { categoryId: true } } },
        }),
      ),
    );

    const userIds = new Set([
      ...logs.map((l) => l.userId).filter((id): id is string => !!id),
      ...events.map((e) => e.userId),
      ...massStarts.map((s) => s.userId),
    ]);
    const users = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: [...userIds] } } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const clock = (d: Date) =>
      d.toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour12: false });

    const items: AuditItemDto[] = [];
    for (const l of logs) {
      const after = (l.after ?? {}) as Record<string, unknown>;
      const before = (l.before ?? {}) as Record<string, unknown>;
      const name =
        l.entity === 'category'
          ? (catName.get(l.entityId ?? '') ?? 'kategorie')
          : l.entity === 'participant'
            ? who(l.entityId ?? '')
            : l.entity === 'checkpoint'
              ? (cpName.get(l.entityId ?? '') ?? 'checkpoint')
              : 'závod';
      const [kind, text] = describe(l.action, l.entity, name, before, after);
      items.push({
        at: l.createdAt.toISOString(),
        user: l.userId ? (users.get(l.userId) ?? null) : null,
        kind,
        text,
        reason: l.reason,
      });
    }
    for (const e of events) {
      const cp = cpName.get(e.checkpointId) ?? 'checkpoint';
      const correction = e.type === 'admin_correction';
      items.push({
        at: e.serverReceivedAt.toISOString(),
        user: users.get(e.userId) ?? null,
        kind: correction ? 'correction' : 'cancel',
        text: correction
          ? e.refEvent
            ? `${who(e.participantId)} · ${cp} ${clock(e.refEvent.ts)} → ${clock(e.ts)}`
            : `${who(e.participantId)} · ${cp} doplněno ${clock(e.ts)}`
          : `${who(e.participantId)} · ${cp} — zápis vrácen`,
        reason: e.reason,
      });
    }
    massStarts.forEach((s, i) => {
      const cat = catName.get(startCats[i]?.participant.categoryId ?? '') ?? 'kategorie';
      items.push({
        at: (s._max.serverReceivedAt ?? s.ts).toISOString(),
        user: users.get(s.userId) ?? null,
        kind: 'mass_start',
        text: `${cat} · ${s._count._all} závodníků v ${clock(s.ts)}`,
        reason: null,
      });
    });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, AUDIT_LIMIT);
  }
}

function describe(
  action: string,
  entity: string,
  name: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): [AuditKind, string] {
  switch (action) {
    case 'category_close':
      return ['close', `${name} — kategorie uzavřena, výsledky oficiální`];
    case 'category_reopen':
      return ['reopen', `${name} — kategorie znovu otevřena`];
    case 'ranking_override':
      return ['tie', `${name} — rozhodnuto pořadí v remíze`];
    case 'ranking_override_remove':
      return ['tie', `${name} — zrušeno rozhodnutí remízy`];
    case 'check_in':
      return ['check_in', `${name} — ${after.status === 'absent' ? 'nepřítomen' : 'přítomen'}`];
    case 'anonymize':
      return ['gdpr', `${name} — anonymizace`];
    case 'gdpr_export':
      return ['gdpr', `${name} — export osobních údajů`];
    case 'import':
      return ['registration', `Import ${String(after.count ?? '')} závodníků`.replace('  ', ' ')];
    case 'create':
      if (entity === 'participant') {
        return [
          'registration',
          `${name} — ${after.registrationSource === 'on_site' ? 'registrace na místě' : 'nový závodník'}`,
        ];
      }
      return ['change', `${name} — vytvořeno`];
    case 'delete':
      return ['change', `${name} — smazáno`];
    default: {
      const changed = Object.keys(after).filter(
        (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]) && k !== 'updatedAt',
      );
      return [
        'change',
        `${name} — úprava${changed.length ? ` (${changed.slice(0, 3).join(', ')})` : ''}`,
      ];
    }
  }
}
