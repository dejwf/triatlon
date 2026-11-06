import { z } from 'zod';
import {
  AgeGroups,
  CheckpointKind,
  Gender,
  Locality,
  ParticipantStatus,
  RaceStatus,
  RegistrationSource,
  UserRole,
} from './domain.js';

const Name = z.string().trim().min(1, 'Povinné pole.').max(200);
const Id = z.uuid();

// ---------- Závod ----------

export const RaceCreateInput = z.object({
  name: Name,
  /** Datum konání (YYYY-MM-DD); rok závodu se odvozuje z data. */
  date: z.iso.date('Neplatné datum.'),
  ageGroups: AgeGroups.min(1, 'Zadejte alespoň jednu věkovou skupinu.'),
});
export type RaceCreateInput = z.infer<typeof RaceCreateInput>;

export const RaceUpdateInput = RaceCreateInput.partial().extend({ status: RaceStatus.optional() });
export type RaceUpdateInput = z.infer<typeof RaceUpdateInput>;

// ---------- Checkpointy ----------

/**
 * - `transition` = hranice disciplíny: `disciplineId` je disciplína, kterou checkpoint
 *   **ukončuje** (null = start).
 * - `intermediate` = sub-checkpoint: mezičas **uvnitř** disciplíny `disciplineId` (povinná),
 *   nic neukončuje — např. otočka na kopci během cyklistiky.
 */
export const CheckpointInput = z
  .object({
    name: Name,
    kind: CheckpointKind.default('transition'),
    disciplineId: Id.nullable(),
  })
  .refine((c) => c.kind === 'transition' || c.disciplineId !== null, {
    message: 'Sub-checkpoint musí patřit do disciplíny.',
    path: ['disciplineId'],
  });
export type CheckpointInput = z.input<typeof CheckpointInput>;
/** Checkpoint po validaci (typ doplněný na výchozí). */
export type CheckpointData = z.output<typeof CheckpointInput>;

export const CheckpointOrderInput = z.object({ checkpointIds: z.array(Id).min(1) });
export type CheckpointOrderInput = z.infer<typeof CheckpointOrderInput>;

// ---------- Kategorie ----------

const Meters = z.number().int().min(0).max(1_000_000).nullable().optional();

export const CategoryUpdateInput = z.object({
  name: Name.optional(),
  /** Délky tratí v metrech (pro tempo). */
  distances: z.object({ swim: Meters, bike: Meters, run: Meters }).nullable().optional(),
  /** Checkpointy, které pro kategorii platí. */
  checkpointIds: z.array(Id).optional(),
});
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateInput>;

// ---------- Závodníci ----------

export const ParticipantInput = z.object({
  firstName: Name,
  lastName: Name,
  birthYear: z.number().int().min(1900, 'Neplatný ročník.').max(2100, 'Neplatný ročník.'),
  gender: Gender,
  locality: Locality,
  /** Startovní číslo; když chybí, přidělí se další volné v kategorii. */
  bib: z.number().int().min(1).max(99_999).optional(),
  /** Zobrazit jméno na veřejné výsledkové tabuli (GDPR — závodník může odmítnout). */
  publicName: z.boolean().optional(),
  /** Přezdívka („Honza“); prázdná = žádná. */
  nickname: z
    .string()
    .trim()
    .max(40, 'Přezdívka může mít nejvýš 40 znaků.')
    .nullish()
    .transform((v) => v || null),
  /**
   * Oslovení ve výsledcích: formální `Jan "Honza" Novák` (výchozí), neformální `Honza`
   * (při shodě `Honza No`, `Honza No 99`) — viz `displayNames`.
   */
  formal: z.boolean().optional(),
  /**
   * Zvolená volitelná kategorie (popisek věkové skupiny, např. „Super ženy“); bez hodnoty se
   * kategorie určí podle věku. Při úpravě: undefined = ponechat, null = zpět podle věku.
   */
  electiveGroup: z.string().trim().max(100).nullish(),
});
export type ParticipantInput = z.infer<typeof ParticipantInput>;

export const ParticipantUpdateInput = ParticipantInput.partial().extend({
  status: ParticipantStatus.optional(),
});
export type ParticipantUpdateInput = z.infer<typeof ParticipantUpdateInput>;

/** Řádky importu tak, jak přišly ze souboru (hodnoty jako text) — normalizuje `parseImportRow`. */
export const ImportRowsInput = z.object({
  rows: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
    .min(1, 'Soubor neobsahuje žádné řádky.')
    .max(5000, 'Najednou lze importovat nejvýše 5000 řádků.'),
});
export type ImportRowsInput = z.infer<typeof ImportRowsInput>;

export interface ImportRowResult {
  /** Číslo řádku v souboru (1 = první datový řádek). */
  row: number;
  participant?: ParticipantInput & { categoryId: string; categoryName: string; bib: number };
  errors: string[];
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  rows: ImportRowResult[];
}

// ---------- Uživatelé ----------

/** Admin zakládá adminy a organizátory; super admin se přes UI nezakládá (MVP). */
export const ManagedRole = UserRole.extract(['admin', 'organizer']);

export const UserCreateInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Neplatný e-mail.')),
  name: Name,
  role: ManagedRole,
});
export type UserCreateInput = z.infer<typeof UserCreateInput>;

export const UserUpdateInput = z.object({
  name: Name.optional(),
  role: ManagedRole.optional(),
  active: z.boolean().optional(),
});
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;

export const AssignmentsInput = z.object({ checkpointIds: z.array(Id) });
export type AssignmentsInput = z.infer<typeof AssignmentsInput>;

/** Ředitel závodu: uzavírá a znovu otevírá kategorie (výsledky se stávají oficiálními). */
export const DirectorInput = z.object({ director: z.boolean() });
export type DirectorInput = z.infer<typeof DirectorInput>;

/** Znovuotevření uzavřené kategorie — vždy s důvodem (auditováno). */
export const CategoryReopenInput = z.object({
  reason: z.string().trim().min(3, 'Uveďte důvod.').max(1000),
});
export type CategoryReopenInput = z.infer<typeof CategoryReopenInput>;

/** GDPR: anonymizace osobních údajů závodníka (výsledky a log časů zůstanou). */
export const AnonymizeInput = z.object({
  reason: z.string().trim().min(3, 'Uveďte důvod.').max(1000),
});
export type AnonymizeInput = z.infer<typeof AnonymizeInput>;

// ---------- Odpovědi API (DTO) ----------

export interface DisciplineDto {
  id: string;
  name: string;
  seq: number;
}

export interface CheckpointDto {
  id: string;
  name: string;
  seq: number;
  kind: 'transition' | 'intermediate';
  disciplineId: string | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  ageGroupLabel: string;
  /** Název skupiny bez lokality (např. „6–8 hoši“, „Super ženy“) = název společné tabulky. */
  groupName: string;
  /** Kategorie volitelné skupiny (např. Super ženy) — závodník se do ní zařazuje volbou. */
  elective: boolean;
  birthYearFrom: number | null;
  birthYearTo: number;
  gender: Gender;
  locality: Locality;
  distances: { swim?: number | null; bike?: number | null; run?: number | null } | null;
  checkpointIds: string[];
  participantCount: number;
  /** Kategorie uzavřená ředitelem závodu — výsledky jsou oficiální; null = otevřená. */
  closedAt: string | null;
}

export interface RaceSummaryDto {
  id: string;
  name: string;
  year: number;
  date: string;
  status: RaceStatus;
  participantCount: number;
}

export interface RaceDetailDto extends RaceSummaryDto {
  ageGroups: z.infer<typeof AgeGroups>;
  disciplines: DisciplineDto[];
  checkpoints: CheckpointDto[];
  categories: CategoryDto[];
  /** Checkpointy, na které smí přihlášený uživatel zapisovat (admin: všechny). */
  myCheckpointIds: string[];
  /** Přihlášený uživatel smí uzavírat kategorie (ředitel závodu nebo admin). */
  isDirector: boolean;
}

export interface ParticipantDto {
  id: string;
  categoryId: string;
  bib: number;
  firstName: string;
  lastName: string;
  birthYear: number;
  gender: Gender;
  locality: Locality;
  status: ParticipantStatus;
  registrationSource: RegistrationSource;
  publicName: boolean;
  nickname: string | null;
  formal: boolean;
  /** Osobní údaje byly anonymizovány (GDPR). */
  anonymized: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
}

export interface AssignmentDto {
  userId: string;
  checkpointId: string;
}
