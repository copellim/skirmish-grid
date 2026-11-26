import type { Random } from './random';
import { rollD20Check } from './d20-check';

/**
 * Outcome of an SRD opposed d20 check. The attacker wins ties. Port of `OpposedCheckResult`.
 */
export interface OpposedCheckResult {
  readonly attackerTotal: number;
  readonly defenderTotal: number;
}

export function attackerWins(result: OpposedCheckResult): boolean {
  return result.attackerTotal >= result.defenderTotal;
}

/**
 * Resolves an SRD opposed check: attacker then defender each roll d20 + modifier. Attacker rolls
 * first to keep the dice-draw order stable for seed reproducibility. Port of `OpposedCheck.Resolve`.
 */
export function resolveOpposedCheck(
  random: Random,
  attackerModifier: number,
  defenderModifier: number,
): OpposedCheckResult {
  const attacker = rollD20Check(random, attackerModifier);
  const defender = rollD20Check(random, defenderModifier);
  return { attackerTotal: attacker.total, defenderTotal: defender.total };
}
