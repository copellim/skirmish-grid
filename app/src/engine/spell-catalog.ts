import type { Spell } from './spell';
import { DiceExpression } from './dice-expression';

// SRD combat spells available to arcane casters. Only combat-applicable spells (project filter).
// SRD spell list: https://www.d20srd.org/srd/spells/

// SRD range categories fixed at the value used until caster levels scale ranges.
const MEDIUM_RANGE_IN_FEET = 110; // 100 + 10/level → 110 at level 1
const CLOSE_RANGE_IN_FEET = 25; // 25 + 5/2 levels → 25 at level 1
const LONG_RANGE_IN_FEET = 400; // 400 + 40/level → 400 at level 1

export const SpellCatalog = {
  /** Magic Missile: auto-hits, 1d4+1 force. Single-missile version (per-level scaling is not implemented yet). */
  magicMissile: (): Spell => ({
    name: 'Magic Missile',
    spellLevel: 1,
    school: 'Evocation',
    targeting: 'AutoHit',
    rangeInFeet: MEDIUM_RANGE_IN_FEET,
    areaRadiusInFeet: 0,
    savingThrow: null,
    saveEffect: 'None',
    damage: new DiceExpression(1, 4, 1),
    appliedEffect: null,
    srdReference: 'https://www.d20srd.org/srd/spells/magicMissile.htm',
  }),

  /** Scorching Ray: ranged touch, 4d6 fire, close range. Multi-ray scaling is not implemented yet. */
  scorchingRay: (): Spell => ({
    name: 'Scorching Ray',
    spellLevel: 2,
    school: 'Evocation',
    targeting: 'RangedTouch',
    rangeInFeet: CLOSE_RANGE_IN_FEET,
    areaRadiusInFeet: 0,
    savingThrow: null,
    saveEffect: 'None',
    damage: new DiceExpression(4, 6, 0),
    appliedEffect: null,
    srdReference: 'https://www.d20srd.org/srd/spells/scorchingRay.htm',
  }),

  /** Fireball: 20-ft burst, Reflex half, 5d6 fire (models a 5th-level caster). */
  fireball: (): Spell => ({
    name: 'Fireball',
    spellLevel: 3,
    school: 'Evocation',
    targeting: 'Area',
    rangeInFeet: LONG_RANGE_IN_FEET,
    areaRadiusInFeet: 20,
    savingThrow: 'Reflex',
    saveEffect: 'Half',
    damage: new DiceExpression(5, 6, 0),
    appliedEffect: null,
    srdReference: 'https://www.d20srd.org/srd/spells/fireball.htm',
  }),

  /** Mage Armor: self-buff, +4 armor bonus to AC. Duration modeled as Permanent (whole combat). */
  mageArmor: (): Spell => ({
    name: 'Mage Armor',
    spellLevel: 1,
    school: 'Abjuration',
    targeting: 'SelfBuff',
    rangeInFeet: 0,
    areaRadiusInFeet: 0,
    savingThrow: null,
    saveEffect: 'None',
    damage: null,
    appliedEffect: { type: 'Armor', target: 'ArmorClass', value: 4, duration: 'Permanent' },
    srdReference: 'https://www.d20srd.org/srd/spells/mageArmor.htm',
  }),

  /** Shield: self-buff, +4 shield bonus to AC. Duration modeled as Permanent (whole combat). */
  shield: (): Spell => ({
    name: 'Shield',
    spellLevel: 1,
    school: 'Abjuration',
    targeting: 'SelfBuff',
    rangeInFeet: 0,
    areaRadiusInFeet: 0,
    savingThrow: null,
    saveEffect: 'None',
    damage: null,
    appliedEffect: { type: 'Shield', target: 'ArmorClass', value: 4, duration: 'Permanent' },
    srdReference: 'https://www.d20srd.org/srd/spells/shield.htm',
  }),
};
