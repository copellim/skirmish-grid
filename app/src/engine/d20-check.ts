import type { Random } from './random';
import { rollDie } from './dice';

/** The natural d20 face and the resolved total of a single SRD d20 check. */
export interface D20CheckResult {
  readonly naturalRoll: number;
  readonly total: number;
}

const D_TWENTY = 20;

/**
 * The SRD 3.5 "Core Mechanic": roll a d20 and add the relevant modifiers
 * (https://www.d20srd.org/srd/theBasics.htm). This primitive only performs the roll-and-sum;
 * auto-success / auto-failure on natural 20 / 1 and the comparison against the target number
 * belong to the caller, since they differ per check. Port of `D20Check`
 * (the C# engine's D20Check.cs).
 */
export function rollD20Check(random: Random, modifier: number): D20CheckResult {
  const naturalRoll = rollDie(random, D_TWENTY);
  return { naturalRoll, total: naturalRoll + modifier };
}

const NATURAL_MISS = 1;
const NATURAL_HIT = 20;

/**
 * SRD Touch Attacks: a d20 roll against the target's touch AC, which ignores armor and shield.
 * A natural 20 always hits and a natural 1 always misses, as on any attack roll.
 */
export function resolveTouchAttack(
  random: Random,
  modifier: number,
  touchArmorClass: number,
): D20CheckResult & { readonly hit: boolean } {
  const check = rollD20Check(random, modifier);
  const hit =
    check.naturalRoll === NATURAL_HIT ||
    (check.naturalRoll !== NATURAL_MISS && check.total >= touchArmorClass);
  return { ...check, hit };
}
