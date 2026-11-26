// What the arena shows after an action: the combat-log lines that action produced, in the engine's
// own words, plus the error when `Battle` refused it, plus who lost hit points and how many. One
// mechanism for the human, the CPU, the attacks of opportunity and the cleaves they trigger,
// because it reads the log and the combatants instead of describing the action a second time — so
// it can never disagree with the log.

import type { Battle } from '../engine/battle';
import type { Character } from '../engine/character';

/** Hit points one combatant lost during the act, whatever took them. */
export interface DamageDealt {
  readonly victim: Character;
  readonly amount: number;
}

export interface Narration {
  /** The log lines the act produced, round separators left out. */
  readonly lines: readonly string[];
  /** The engine's refusal, when the act threw. The lines before it are still real: an executor may
   * resolve an attack of opportunity before finding out the action cannot be paid for. */
  readonly error: string | null;
  /** Everyone who came out of the act with fewer hit points, in initiative order. */
  readonly damage: readonly DamageDealt[];
}

/** Runs `act` and reports what it wrote to the log. Rethrows nothing: the caller renders, not handles. */
export function narrated(battle: Battle, act: () => void): Narration {
  const linesBefore = battle.log.length;
  const hitPointsBefore = new Map(battle.combatants.map((c) => [c, c.currentHitPoints]));
  let error: string | null = null;
  try {
    act();
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  const lines = battle.log
    .slice(linesBefore)
    .filter((entry) => entry.event !== 'RoundSeparator')
    .map((entry) => entry.message);
  const damage = battle.combatants
    .map((victim) => ({ victim, amount: (hitPointsBefore.get(victim) ?? victim.currentHitPoints) - victim.currentHitPoints }))
    .filter((dealt) => dealt.amount > 0);
  return { lines, error, damage };
}
