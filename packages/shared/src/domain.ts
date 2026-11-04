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

/** Věková skupina konfigurovaná na úrovni závodu; `maxAge` null = bez horní hranice (např. 50+). */
export const AgeGroup = z.object({
  label: z.string().min(1),
  minAge: z.number().int().min(0),
  maxAge: z.number().int().min(0).nullable(),
});
export type AgeGroup = z.infer<typeof AgeGroup>;

/**
 * Sada věkových skupin závodu, jak ji definuje admin. Hranice jsou včetně (6–8 = 6, 7 i 8 let)
 * a skupiny se nesmí překrývat — každý věk patří nejvýš do jedné skupiny.
 */
export const AgeGroups = z
  .array(
    AgeGroup.refine((g) => g.maxAge === null || g.maxAge >= g.minAge, {
      message: 'Horní hranice věkové skupiny nesmí být menší než dolní.',
    }),
  )
  .superRefine((groups, ctx) => {
    const sorted = [...groups].sort((a, b) => a.minAge - b.minAge);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.maxAge === null || prev.maxAge >= cur.minAge) {
        ctx.addIssue({
          code: 'custom',
          message: `Věkové skupiny „${prev.label}“ a „${cur.label}“ se překrývají.`,
        });
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
