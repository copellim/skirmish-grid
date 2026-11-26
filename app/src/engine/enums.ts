// SRD 3.5 enumerations. Modelled as string-literal unions whose members match the C# enum
// names verbatim, so golden transcripts serialise identically across the two engines.

/** Which team a combatant fights for. Two fixed sides for now; extend to N teams later. */
export type Side = 'A' | 'B';

/** Whether a weapon strikes in melee or fires at range. */
export type WeaponKind = 'Melee' | 'Ranged';

/**
 * SRD "Weapons and Handedness": a melee weapon is light, one-handed or two-handed. Two-handed
 * weapons add 1.5× the Strength *bonus* to damage instead of 1× — a penalty is not multiplied.
 */
export type WeaponHandedness = 'Light' | 'OneHanded' | 'TwoHanded';

/** SRD: the ranged weapon families that carry their own rules (Strength on damage, firing prone). */
export type RangedWeaponFamily = 'Bow' | 'Crossbow' | 'Sling';

/** SRD armor weight class. Drives proficiency and speed reduction. */
export type ArmorCategory = 'Light' | 'Medium' | 'Heavy';

/** The three SRD saving throws. */
export type SavingThrowKind = 'Fortitude' | 'Reflex' | 'Will';

/** What stat a typed bonus applies to. */
export type BonusTarget = 'ArmorClass';

/**
 * The SRD bonus type (the "source" of a modifier). Same-type bonuses do not stack (largest
 * applies); different types do. Untyped modifiers always stack, and so do dodge bonuses:
 * "Dodge bonuses […] stack with each other, unlike most other types of bonuses."
 */
export type BonusType =
  | 'Armor'
  | 'Shield'
  | 'Natural'
  | 'Deflection'
  | 'Dodge'
  | 'Size'
  | 'Untyped';

/** SRD Injury and Death: the vitality state of a combatant. */
export type VitalStatus = 'Conscious' | 'Staggered' | 'Dying' | 'Stable' | 'Dead';

/**
 * How long an Effect lasts. `UntilStartOfNextTurn` covers the SRD "until the start of your next
 * turn" window; `Permanent` stays until removed explicitly.
 */
export type EffectDuration = 'UntilStartOfNextTurn' | 'Permanent';

/** The SRD school of magic a spell belongs to. */
export type SpellSchool = 'Evocation' | 'Abjuration';

/** How a successful saving throw modifies a spell's outcome. */
export type SpellSaveEffect = 'None' | 'Half' | 'Negates';
