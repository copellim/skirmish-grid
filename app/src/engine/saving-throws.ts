import type { Random } from './random';
import type { Character } from './character';
import type { SavingThrowKind } from './enums';
import { rollD20Check } from './d20-check';

/** The natural d20 face, the resolved total, and the outcome of a saving throw. */
export interface SavingThrowResult {
  readonly naturalRoll: number;
  readonly total: number;
  readonly succeeded: boolean;
}

const NATURAL_FAILURE = 1;
const NATURAL_SUCCESS = 20;

/**
 * Resolves an SRD 3.5 saving throw: d20 + base save + governing ability modifier vs a DC. Natural 1
 * always fails, natural 20 always succeeds. Port of `SavingThrows.Resolve`.
 */
export function resolveSavingThrow(
  random: Random,
  character: Character,
  kind: SavingThrowKind,
  difficultyClass: number,
): SavingThrowResult {
  const check = rollD20Check(random, character.savingThrowModifier(kind));
  let succeeded: boolean;
  if (check.naturalRoll === NATURAL_FAILURE) {
    succeeded = false;
  } else if (check.naturalRoll === NATURAL_SUCCESS) {
    succeeded = true;
  } else {
    succeeded = check.total >= difficultyClass;
  }
  return { naturalRoll: check.naturalRoll, total: check.total, succeeded };
}
