import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

export interface AuditEntry {
  userId: string;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

type Db = PrismaService | Prisma.TransactionClient;

/** Auditní stopa administrativních změn (kdo, kdy, co, proč) — CLAUDE.md, sekce 8. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Zapíše záznam; v transakci předejte `tx`, aby se audit uložil atomicky se změnou. */
  async record(entry: AuditEntry, tx: Db = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
