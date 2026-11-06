import { z } from 'zod';

export const UserRole = z.enum(['super_admin', 'admin', 'organizer']);
export type UserRole = z.infer<typeof UserRole>;

export const RaceStatus = z.enum(['planned', 'running', 'finished']);
export type RaceStatus = z.infer<typeof RaceStatus>;

export const Gender = z.enum(['male', 'female']);
export type Gender = z.infer<typeof Gender>;

export const Locality = z.enum(['local', 'guest']);
export type Locality = z.infer<typeof Locality>;

export const ParticipantStatus = z.enum(['registered', 'checked_in', 'absent', 'disqualified']);
export type ParticipantStatus = z.infer<typeof ParticipantStatus>;

export const RegistrationSource = z.enum(['manual', 'import', 'online', 'on_site']);
export type RegistrationSource = z.infer<typeof RegistrationSource>;

/** `transition` = hranice disciplíny (start, konec plavání, …); `intermediate` = sub-checkpoint (TBD, zatím se nepoužívá). */
export const CheckpointKind = z.enum(['transition', 'intermediate']);
export type CheckpointKind = z.infer<typeof CheckpointKind>;

export const TimeEventType = z.enum(['record', 'cancel', 'note', 'admin_correction']);
export type TimeEventType = z.infer<typeof TimeEventType>;

/** Délky tratí v metrech (pro tempo); null = neuvedeno. */
export const Distances = z.object({
  swim: z.number().int().min(0).nullish(),
  bike: z.number().int().min(0).nullish(),
  run: z.number().int().min(0).nullish(),
});
export type Distances = z.infer<typeof Distances>;

/**
 * Věková skupina konfigurovaná na úrovni závodu; `maxAge` null = bez horní hranice (např. 50+).
 * Z každé skupiny vzniknou kategorie pro pohlaví × lokalitu.
 */
export const AgeGroup = z.object({
  label: z.string().trim().min(1),
  minAge: z.number().int().min(0),
  maxAge: z.number().int().min(0).nullable(),
  /** Skupina jen pro jedno pohlaví (např. „Muži do 40“); bez hodnoty = muži i ženy. */
  gender: Gender.nullish(),
  /**
   * Volitelná skupina (např. „Super ženy“ = ženy na dlouhé trati): závodník se do ní nezařadí
   * automaticky podle věku, ale jen výslovnou volbou při registraci / importu. Může se proto
   * věkem překrývat s běžnou skupinou.
   */
  elective: z.boolean().optional(),
  /** Výchozí délky tratí pro kategorie skupiny (v kategorii se dají změnit). */
  distances: Distances.nullish(),
});
export type AgeGroup = z.infer<typeof AgeGroup>;

const GENDERS = ['male', 'female'] as const;

/** Platí skupina pro dané pohlaví? */
export const groupHasGender = (g: AgeGroup, gender: Gender) => !g.gender || g.gender === gender;

/**
 * Sada věkových skupin závodu, jak ji definuje admin. Hranice jsou včetně (6–8 = 6, 7 i 8 let).
 * Běžné (nevolitelné) skupiny se pro žádné pohlaví nesmí překrývat — každý věk patří nejvýš do
 * jedné; volitelné skupiny se překrývat smí. Popisky musí být jedinečné.
 */
export const AgeGroups = z
  .array(
    AgeGroup.refine((g) => g.maxAge === null || g.maxAge >= g.minAge, {
      message: 'Horní hranice věkové skupiny nesmí být menší než dolní.',
    }),
  )
  .superRefine((groups, ctx) => {
    const labels = new Set<string>();
    for (const g of groups) {
      const key = g.label.toLocaleLowerCase('cs');
      if (labels.has(key)) {
        ctx.addIssue({ code: 'custom', message: `Popisek „${g.label}“ je použitý dvakrát.` });
      }
      labels.add(key);
    }
    const reported = new Set<string>();
    for (const gender of GENDERS) {
      const sorted = groups
        .filter((g) => !g.elective && groupHasGender(g, gender))
        .sort((a, b) => a.minAge - b.minAge);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        const key = `${prev.label}|${cur.label}`;
        if ((prev.maxAge === null || prev.maxAge >= cur.minAge) && !reported.has(key)) {
          reported.add(key);
          ctx.addIssue({
            code: 'custom',
            message: `Věkové skupiny „${prev.label}“ a „${cur.label}“ se překrývají.`,
          });
        }
      }
    }
  });

/**
 * Akce z klienta (mobil/web). `id` generuje klient (UUID) → opakované odeslání je idempotentní.
 * `ts` je čas akce na klientovi už opravený o offset hodin vůči serveru.
 */
export const TimeEventInput = z.object({
  id: z.string().uuid(),
  type: TimeEventType,
  participantId: z.string().uuid(),
  checkpointId: z.string().uuid(),
  ts: z.string().datetime(),
  note: z.string().max(1000).optional(),
  refEventId: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
  deviceId: z.string().min(1).max(200),
});
export type TimeEventInput = z.infer<typeof TimeEventInput>;
