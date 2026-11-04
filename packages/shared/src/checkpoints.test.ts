import { describe, expect, it } from 'vitest';
import { CheckpointInput } from './admin.js';
import {
  intermediateInsertIndex,
  validateCheckpointOrder,
  type CheckpointShape,
} from './checkpoints.js';

const t = (name: string, disciplineId: string | null): CheckpointShape => ({
  name,
  kind: 'transition',
  disciplineId,
});
const sub = (name: string, disciplineId: string): CheckpointShape => ({
  name,
  kind: 'intermediate',
  disciplineId,
});

const base = [
  t('Start', null),
  t('Konec plavání', 'swim'),
  t('Konec kola', 'bike'),
  t('Cíl', 'run'),
];

describe('checkpointy', () => {
  it('sub-checkpointy uvnitř cyklistiky jsou v pořádku', () => {
    const cps = [
      base[0]!,
      base[1]!,
      sub('Otočka na kopci', 'bike'),
      sub('Pod kopcem', 'bike'),
      base[2]!,
      base[3]!,
    ];
    expect(validateCheckpointOrder(cps)).toBeNull();
  });

  it('sub-checkpoint za koncem své disciplíny nebo před startem je chyba', () => {
    expect(validateCheckpointOrder([...base.slice(0, 3), sub('Otočka', 'bike'), base[3]!])).toMatch(
      /Otočka/,
    );
    expect(validateCheckpointOrder([sub('Bója', 'swim'), ...base])).toMatch(/Bója/);
  });

  it('nový sub-checkpoint se vkládá před konec své disciplíny', () => {
    expect(intermediateInsertIndex(base, 'bike')).toBe(2);
    expect(intermediateInsertIndex(base, 'neexistuje')).toBe(-1);
  });

  it('sub-checkpoint musí mít disciplínu, hranice nemusí (start)', () => {
    expect(
      CheckpointInput.safeParse({ name: 'X', kind: 'intermediate', disciplineId: null }).success,
    ).toBe(false);
    expect(CheckpointInput.safeParse({ name: 'Start', disciplineId: null }).success).toBe(true);
  });
});
