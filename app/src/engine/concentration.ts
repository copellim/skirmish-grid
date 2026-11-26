import type { Random } from './random';
import type { Character } from './character';
import type { Spell } from './spell';
import { rollD20Check } from './d20-check';

/** The natural d20 face, the resolved total, and whether the check succeeded. */
export interface ConcentrationResult {
  readonly naturalRoll: number;
  readonly total: number;
  readonly succeeded: boolean;
}

// SRD Concentration: key ability is Constitution. Max ranks = caster level + 3 (modeled as maxed).
function concentrationModifier(caster: Character): number {
  return caster.casterLevel + 3 + caster.abilities.constitution.modifier;
}

/** SRD: DC 15 + spell level when casting defensively. */
export function defensiveConcentrationDc(spell: Spell): number {
  return 15 + spell.spellLevel;
}

/** SRD: DC 10 + damage dealt + spell level when damaged during casting. */
export function damageConcentrationDc(damageTaken: number, spell: Spell): number {
  return 10 + damageTaken + spell.spellLevel;
}

/** Resolves an SRD Concentration check: d20 + modifier vs DC. Port of `Concentration.Resolve`. */
export function resolveConcentration(
  random: Random,
  caster: Character,
  difficultyClass: number,
): ConcentrationResult {
  const check = rollD20Check(random, concentrationModifier(caster));
  return { naturalRoll: check.naturalRoll, total: check.total, succeeded: check.total >= difficultyClass };
}
