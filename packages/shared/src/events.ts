import { z } from 'zod';
import { TimeEventInput } from './domain.js';
import type { CategoryResults } from './results.js';

/** Dávka akcí z klienta (mobilní offline fronta posílá víc akcí najednou). */
export const TimeEventsBatchInput = z.object({
  events: z.array(TimeEventInput).min(1).max(500, 'Najednou lze poslat nejvýše 500 akcí.'),
});
export type TimeEventsBatchInput = z.infer<typeof TimeEventsBatchInput>;

export type TimeEventStatus = 'accepted' | 'duplicate' | 'rejected';

export interface TimeEventResult {
  id: string;
  /** `duplicate` = akce už byla přijata dříve (idempotentní opakování) — pro klienta úspěch. */
  status: TimeEventStatus;
  reason?: string;
}

export const RankingOverrideInput = z.object({
  participantIds: z.array(z.uuid()).min(2, 'Pořadí se určuje alespoň pro dva závodníky.'),
  reason: z.string().trim().min(3, 'Uveďte důvod.').max(1000),
});
export type RankingOverrideInput = z.infer<typeof RankingOverrideInput>;

export interface RankingOverrideDto {
  id: string;
  participantIds: string[];
  reason: string;
  userId: string;
  createdAt: string;
}

export interface CategoryResultsDto extends CategoryResults {
  categoryId: string;
  name: string;
  overrides: RankingOverrideDto[];
  /** Uzavřeno (oficiální výsledky); null = otevřená. */
  closedAt: string | null;
  closedBy: string | null;
}

export interface RaceResultsDto {
  raceId: string;
  generatedAt: string;
  categories: CategoryResultsDto[];
  /** Jména uživatelů pro poznámky a historii (id → jméno). */
  users: Record<string, string>;
}

export interface TimeEventHistoryDto {
  id: string;
  type: TimeEventInput['type'];
  checkpointId: string;
  ts: string;
  note: string | null;
  refEventId: string | null;
  reason: string | null;
  userId: string;
  userName: string;
  deviceId: string;
  serverReceivedAt: string;
}

/** Zpráva živého kanálu (SSE): výsledky uvedených kategorií se změnily. */
export interface RealtimeMessage {
  type: 'results';
  categoryIds: string[];
}
