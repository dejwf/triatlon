/**
 * Přehled závodu v administraci (design_claude.md 4.3): stav telefonů na checkpointech
 * a poslední zásahy (audit). Stav kategorií, průchody a „ke kontrole“ se odvozují z výsledků.
 */
import { z } from 'zod';

/**
 * Stav telefonu, který appka posílá při synchronizaci (heartbeat). Server z něj ví, kdo je
 * online, jak moc jdou hodiny telefonu vedle a kolik akcí čeká ve frontě.
 */
export const DeviceHeartbeatInput = z.object({
  deviceId: z.string().trim().min(1).max(100),
  /** Checkpoint, na kterém je obsluha právě přepnutá (null = mimo obrazovku checkpointu). */
  checkpointId: z.uuid().nullish(),
  /** O kolik ms jdou hodiny serveru napřed oproti telefonu (null = zatím neměřeno). */
  clockOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).nullish(),
  clockCheckedAt: z.iso.datetime({ offset: true }).nullish(),
  /** Počet neodeslaných akcí tohoto závodu ve frontě telefonu. */
  pending: z.number().int().min(0).max(100_000),
  /** Nejstarší neodeslaná akce — od kdy je telefon bez spojení. */
  oldestPendingAt: z.iso.datetime({ offset: true }).nullish(),
  appVersion: z.string().trim().max(40).nullish(),
});
export type DeviceHeartbeatInput = z.infer<typeof DeviceHeartbeatInput>;

export interface DeviceStatusDto {
  deviceId: string;
  user: { id: string; name: string; email: string };
  checkpoint: { id: string; name: string } | null;
  /** Poslední heartbeat (null = zařízení heartbeat neposílá, např. web nebo starší appka). */
  lastSeenAt: string | null;
  /** Poslední akce ze zařízení přijatá serverem. */
  lastEventAt: string | null;
  clockOffsetMs: number | null;
  clockCheckedAt: string | null;
  pending: number;
  oldestPendingAt: string | null;
  appVersion: string | null;
}

export type AuditKind =
  | 'correction'
  | 'cancel'
  | 'mass_start'
  | 'close'
  | 'reopen'
  | 'tie'
  | 'registration'
  | 'check_in'
  | 'gdpr'
  | 'change';

export interface AuditItemDto {
  at: string;
  /** Jméno uživatele (null = systém). */
  user: string | null;
  kind: AuditKind;
  /** Popis zásahu, např. „č. 12 (Muži do 40) · Cíl 11:02:13 → 11:02:08“. */
  text: string;
  reason: string | null;
}

export interface RaceOverviewDto {
  generatedAt: string;
  devices: DeviceStatusDto[];
  audit: AuditItemDto[];
}

/** Telefon bez heartbeatu déle než tohle se v přehledu ukáže jako offline. */
export const DEVICE_OFFLINE_AFTER_MS = 60_000;
