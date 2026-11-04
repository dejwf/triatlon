/** Rozhraní pro mobilní appku na checkpointu (F3): check-in, registrace na místě, start. */
import { z } from 'zod';
import { ParticipantInput, type CategoryDto, type ParticipantDto } from './admin.js';
import type { CheckpointKind } from './domain.js';

/** Stav, který smí nastavit organizátor na startu při check-inu (diskvalifikace jen admin). */
export const CheckInStatus = z.enum(['registered', 'checked_in', 'absent']);
export type CheckInStatus = z.infer<typeof CheckInStatus>;

export const ParticipantStatusInput = z.object({ status: CheckInStatus });
export type ParticipantStatusInput = z.infer<typeof ParticipantStatusInput>;

/**
 * Registrace na místě z mobilu. `id` generuje klient → opakované odeslání z offline fronty
 * závodníka nezdvojí a časy zapsané offline na něj mohou rovnou odkazovat.
 */
export const OnSiteRegistrationInput = ParticipantInput.extend({ id: z.uuid() });
export type OnSiteRegistrationInput = z.infer<typeof OnSiteRegistrationInput>;

export interface OnSiteRegistrationResult {
  participant: ParticipantDto;
  /** Číslo navržené v appce (null = nechat přidělit). */
  requestedBib: number | null;
  /** Navržené číslo bylo mezitím obsazené → server přidělil jiné; organizátor musí vyměnit číslo. */
  bibChanged: boolean;
}

/** Start = první hraniční checkpoint, který žádnou disciplínu neukončuje. */
export function startCheckpointId(
  checkpoints: readonly {
    id: string;
    seq: number;
    kind: CheckpointKind;
    disciplineId: string | null;
  }[],
): string | null {
  return (
    [...checkpoints]
      .sort((a, b) => a.seq - b.seq)
      .find((c) => c.kind === 'transition' && c.disciplineId === null)?.id ?? null
  );
}

/** Krátké označení kategorie na tlačítko s číslem, např. „M 31–40“ nebo „Ž 9–10 H“ (hosté). */
export function categoryShortLabel(
  c: Pick<CategoryDto, 'gender' | 'ageGroupLabel' | 'locality'>,
): string {
  return `${c.gender === 'male' ? 'M' : 'Ž'} ${c.ageGroupLabel}${c.locality === 'guest' ? ' H' : ''}`;
}
