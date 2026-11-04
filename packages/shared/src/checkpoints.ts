import type { CheckpointKind } from './domain.js';

export interface CheckpointShape {
  name: string;
  kind: CheckpointKind;
  disciplineId: string | null;
}

/**
 * Ověří pořadí checkpointů závodu (seřazených podle seq). Sub-checkpoint musí ležet uvnitř
 * své disciplíny: za nějakou hranicí (start nebo konec předchozí disciplíny) a nejbližší
 * následující hranice musí být ta, která jeho disciplínu ukončuje.
 * Vrací českou chybovou hlášku, nebo null, když je pořadí v pořádku.
 */
export function validateCheckpointOrder(checkpoints: readonly CheckpointShape[]): string | null {
  for (const [i, cp] of checkpoints.entries()) {
    if (cp.kind !== 'intermediate') continue;
    const before = checkpoints.slice(0, i).some((c) => c.kind === 'transition');
    const next = checkpoints.slice(i + 1).find((c) => c.kind === 'transition');
    if (!before || !next || next.disciplineId !== cp.disciplineId) {
      return `Sub-checkpoint „${cp.name}“ musí ležet uvnitř své disciplíny — před checkpointem, který ji ukončuje.`;
    }
  }
  return null;
}

/**
 * Index, na který se má vložit nový sub-checkpoint disciplíny: těsně před checkpoint,
 * který disciplínu ukončuje. -1 = disciplína nemá ukončující checkpoint.
 */
export function intermediateInsertIndex(
  checkpoints: readonly CheckpointShape[],
  disciplineId: string,
): number {
  return checkpoints.findIndex((c) => c.kind === 'transition' && c.disciplineId === disciplineId);
}
