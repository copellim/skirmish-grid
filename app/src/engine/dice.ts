import type { Random } from './random';
import { DiceExpression } from './dice-expression';

/**
 * Rolls dice through a {@link Random} source. Stateless: the randomness lives in the injected
 * source so rolls stay reproducible and testable. Port of `Dice` (the C# engine's Dice.cs).
 */

/** SRD d%: the percentile die, yielding 1–100. */
const PERCENTILE_SIDES = 100;

/** Rolls a single die, yielding a face in [1, sides]. */
export function rollDie(random: Random, sides: number): number {
  return random.next(1, sides + 1);
}

/** Rolls every die in the expression and applies its modifier. */
export function roll(random: Random, expression: DiceExpression | string): number {
  const expr =
    typeof expression === 'string' ? DiceExpression.parse(expression) : expression;
  let total = expr.modifier;
  for (let die = 0; die < expr.count; die++) {
    total += rollDie(random, expr.sides);
  }
  return total;
}

/** Rolls a percentile die (d%), yielding 1–100. */
export function rollPercentile(random: Random): number {
  return rollDie(random, PERCENTILE_SIDES);
}
