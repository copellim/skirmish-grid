import type { Random } from './random';
import type { Character } from './character';
import type { Spell } from './spell';
import type { DiceExpression } from './dice-expression';
import { roll } from './dice';
import { rollD20Check, resolveTouchAttack } from './d20-check';
import { resolveSavingThrow } from './saving-throws';

/** The outcome of resolving a spell against a single target. */
export interface SpellTargetResult {
  readonly target: Character;
  /** True for AutoHit and Area (always attempted); false on a missed ranged touch. */
  readonly hit: boolean;
  /** Whether the target succeeded on its saving throw (false when no save was called). */
  readonly saveSucceeded: boolean;
  /** The natural d20 roll on the ranged touch attack (0 if no attack roll was made). */
  readonly attackRoll: number;
  /** Hit points of damage dealt after applying save effects (0 on a miss). */
  readonly damageDealt: number;
}

/** The complete outcome of a spell cast, covering every target resolved. */
export interface SpellResolution {
  readonly spell: Spell;
  readonly targetResults: readonly SpellTargetResult[];
}

const SPELL_DC_BASE = 10;

function rollDamage(random: Random, dice: DiceExpression): number {
  return roll(random, dice);
}

function resolveAutoHit(random: Random, target: Character, spell: Spell): SpellTargetResult {
  const damage = spell.damage !== null ? Math.max(1, rollDamage(random, spell.damage)) : 0;
  target.takeDamage(damage);
  return { target, hit: true, saveSucceeded: false, attackRoll: 0, damageDealt: damage };
}

function resolveRangedTouch(
  random: Random,
  caster: Character,
  target: Character,
  spell: Spell,
): SpellTargetResult {
  // SRD ranged touch attack: d20 + BAB + DEX vs touch AC (ignores armor and shield bonuses).
  const touchAttackModifier = caster.baseAttackBonus + caster.effectiveDexterityModifier;
  const r = resolveTouchAttack(random, touchAttackModifier, target.touchArmorClass);

  if (!r.hit) {
    return { target, hit: false, saveSucceeded: false, attackRoll: r.naturalRoll, damageDealt: 0 };
  }

  const damage = spell.damage !== null ? Math.max(1, rollDamage(random, spell.damage)) : 0;
  target.takeDamage(damage);
  return { target, hit: true, saveSucceeded: false, attackRoll: r.naturalRoll, damageDealt: damage };
}

function resolveAreaTarget(
  random: Random,
  target: Character,
  spell: Spell,
  saveDc: number,
  rawDamage: number,
): SpellTargetResult {
  const saveSucceeded =
    spell.savingThrow !== null &&
    resolveSavingThrow(random, target, spell.savingThrow, saveDc).succeeded;

  let damage: number;
  switch (spell.saveEffect) {
    case 'None':
      damage = Math.max(1, rawDamage);
      break;
    case 'Half':
      damage = saveSucceeded ? Math.max(1, Math.floor(rawDamage / 2)) : Math.max(1, rawDamage);
      break;
    case 'Negates':
      damage = saveSucceeded ? 0 : Math.max(1, rawDamage);
      break;
  }

  target.takeDamage(damage);
  return { target, hit: true, saveSucceeded, attackRoll: 0, damageDealt: damage };
}

function resolveSelfBuff(target: Character, spell: Spell): SpellTargetResult {
  if (spell.appliedEffect !== null) {
    target.addEffect(spell.appliedEffect);
  }
  return { target, hit: true, saveSucceeded: false, attackRoll: 0, damageDealt: 0 };
}

/**
 * Pure resolution of a spell cast: rolls dice, applies saves, deals damage. Stateless — randomness
 * flows through `random`; mutates only character HP and effects. For area spells, pass all creatures
 * in the burst; for single-target spells, pass exactly one. Port of `SpellResolver.Resolve`.
 */
export function resolveSpell(
  random: Random,
  caster: Character,
  targets: readonly Character[],
  spell: Spell,
): SpellResolution {
  // SRD: DC = 10 + spell level + casting ability modifier (Charisma for Sorcerers).
  const saveDc = SPELL_DC_BASE + spell.spellLevel + caster.abilities.charisma.modifier;

  // SRD Fireball: the whole burst shares one damage roll; each target saves independently.
  const sharedDamageRoll =
    spell.targeting === 'Area' && spell.damage !== null ? rollDamage(random, spell.damage) : null;

  const targetResults = targets.map((target): SpellTargetResult => {
    switch (spell.targeting) {
      case 'AutoHit':
        return resolveAutoHit(random, target, spell);
      case 'RangedTouch':
        return resolveRangedTouch(random, caster, target, spell);
      case 'Area':
        return resolveAreaTarget(random, target, spell, saveDc, sharedDamageRoll as number);
      case 'SelfBuff':
        return resolveSelfBuff(target, spell);
    }
  });

  return { spell, targetResults };
}
