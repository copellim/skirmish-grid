import type { SpellSchool, SpellSaveEffect, SavingThrowKind } from './enums';
import type { Effect } from './item';
import type { DiceExpression } from './dice-expression';

/**
 * How a spell selects and resolves against its target(s). Determines what the caster must
 * provide and what the resolver rolls. Port of `SpellTargeting`.
 */
export type SpellTargeting = 'AutoHit' | 'RangedTouch' | 'Area' | 'SelfBuff';

/**
 * Static definition of an SRD spell. Describes what a spell does; resolution lives in the spell
 * resolver. Damage and applied-effect are optional fields rather than a hierarchy. Port of `Spell`.
 */
export interface Spell {
  readonly name: string;
  readonly spellLevel: number;
  readonly school: SpellSchool;
  readonly targeting: SpellTargeting;
  /** Maximum distance in feet from caster to target (or area center). */
  readonly rangeInFeet: number;
  /** Radius of the affected area in feet (0 for non-area spells). */
  readonly areaRadiusInFeet: number;
  /** The type of saving throw the target makes, if any. */
  readonly savingThrow: SavingThrowKind | null;
  /** How a successful saving throw reduces the outcome. */
  readonly saveEffect: SpellSaveEffect;
  /** Damage expression rolled on resolution (null for buff/debuff spells). */
  readonly damage: DiceExpression | null;
  /** A persistent effect applied to the target instead of (or with) damage. */
  readonly appliedEffect: Effect | null;
  readonly srdReference: string;
}
