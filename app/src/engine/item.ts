import type {
  BonusType,
  BonusTarget,
  EffectDuration,
  WeaponKind,
  WeaponHandedness,
  RangedWeaponFamily,
  ArmorCategory,
} from './enums';
import { DiceExpression } from './dice-expression';

/**
 * A single typed bonus an item grants: how much, to what stat, of which SRD type. The type
 * governs stacking when several bonuses apply to the same target. Port of `ItemBonus`.
 */
export interface ItemBonus {
  readonly type: BonusType;
  readonly target: BonusTarget;
  readonly value: number;
}

/**
 * A transient typed modifier on a character (charging's -2 AC, Aid Another's +2 AC, …) with a
 * value, the stat it changes, its SRD type, and how long it lasts. Port of `Effect`.
 */
export interface Effect {
  readonly type: BonusType;
  readonly target: BonusTarget;
  readonly value: number;
  readonly duration: EffectDuration;
}

/**
 * Base for anything a character can carry or wear. An item has a name and the typed bonuses it
 * grants while equipped (empty for a mundane weapon). Port of the `Item` abstract base.
 */
export abstract class Item {
  readonly name: string;
  readonly bonuses: readonly ItemBonus[];

  protected constructor(name: string, bonuses: readonly ItemBonus[] = []) {
    if (!name || name.trim().length === 0) {
      throw new Error('Item name must not be empty.');
    }
    this.name = name;
    this.bonuses = bonuses;
  }
}

/**
 * A SRD 3.5 suit of armor. Grants an armor-type bonus to AC and caps the wearer's Dexterity
 * bonus to AC. Port of `Armor`.
 */
export class Armor extends Item {
  readonly armorBonus: number;
  readonly maximumDexterityBonus: number;
  readonly category: ArmorCategory;
  readonly armorCheckPenalty: number;
  readonly reducedSpeed: boolean;

  constructor(
    name: string,
    armorBonus: number,
    maximumDexterityBonus: number,
    category: ArmorCategory,
    armorCheckPenalty = 0,
    reducedSpeed = false,
  ) {
    super(name, [{ type: 'Armor', target: 'ArmorClass', value: armorBonus }]);
    if (armorBonus < 0) {
      throw new RangeError('Armor bonus must not be negative.');
    }
    if (maximumDexterityBonus < 0) {
      throw new RangeError('Maximum Dexterity bonus must not be negative.');
    }
    if (armorCheckPenalty > 0) {
      throw new RangeError('Armor check penalty must not be positive.');
    }
    this.armorBonus = armorBonus;
    this.maximumDexterityBonus = maximumDexterityBonus;
    this.category = category;
    this.armorCheckPenalty = armorCheckPenalty;
    this.reducedSpeed = reducedSpeed;
  }
}

/**
 * A SRD 3.5 shield. Grants a shield-type bonus to AC and does not limit Dexterity. Port of `Shield`.
 */
export class Shield extends Item {
  readonly shieldBonus: number;

  constructor(name: string, shieldBonus: number) {
    super(name, [{ type: 'Shield', target: 'ArmorClass', value: shieldBonus }]);
    if (shieldBonus < 0) {
      throw new RangeError('Shield bonus must not be negative.');
    }
    this.shieldBonus = shieldBonus;
  }
}

/**
 * A SRD 3.5 weapon: damage dice, critical profile, and whether it strikes in melee (with a reach)
 * or fires at range (with a range increment). Port of `Weapon`.
 */
export class Weapon extends Item {
  private static readonly LOWEST_POSSIBLE_THREAT = 2;
  private static readonly NATURAL_TWENTY = 20;
  private static readonly MINIMUM_CRITICAL_MULTIPLIER = 2;
  private static readonly MAX_RANGE_INCREMENTS = 10;

  readonly damageDice: DiceExpression;
  readonly threatRangeMin: number;
  readonly criticalMultiplier: number;
  readonly kind: WeaponKind;
  readonly reachInFeet: number;
  readonly rangeIncrementInFeet: number;
  /** Which SRD family a ranged weapon belongs to; `null` for a melee weapon. */
  readonly rangedFamily: RangedWeaponFamily | null;
  readonly handedness: WeaponHandedness;
  /**
   * SRD: unarmed strikes and natural weapons are the explicit exception to the rules that penalise
   * light weapons (Power Attack). Marked on the weapon rather than matched by name.
   */
  readonly isUnarmed: boolean;

  constructor(
    name: string,
    damageDice: DiceExpression,
    threatRangeMin: number,
    criticalMultiplier: number,
    kind: WeaponKind = 'Melee',
    reachInFeet = 5,
    rangeIncrementInFeet = 0,
    rangedFamily: RangedWeaponFamily | null = null,
    handedness: WeaponHandedness = 'OneHanded',
    isUnarmed = false,
  ) {
    super(name);
    if (
      threatRangeMin < Weapon.LOWEST_POSSIBLE_THREAT ||
      threatRangeMin > Weapon.NATURAL_TWENTY
    ) {
      throw new RangeError(
        `Threat range must be between ${Weapon.LOWEST_POSSIBLE_THREAT} and ${Weapon.NATURAL_TWENTY}.`,
      );
    }
    if (criticalMultiplier < Weapon.MINIMUM_CRITICAL_MULTIPLIER) {
      throw new RangeError(
        `Critical multiplier must be at least ${Weapon.MINIMUM_CRITICAL_MULTIPLIER}.`,
      );
    }
    if (kind === 'Ranged' && rangeIncrementInFeet <= 0) {
      throw new RangeError('A ranged weapon needs a positive range increment.');
    }
    if (kind === 'Ranged' && rangedFamily === null) {
      throw new RangeError('A ranged weapon must declare its family (bow, crossbow or sling).');
    }
    if (kind === 'Melee' && rangedFamily !== null) {
      throw new RangeError('A melee weapon has no ranged family.');
    }
    this.damageDice = damageDice;
    this.threatRangeMin = threatRangeMin;
    this.criticalMultiplier = criticalMultiplier;
    this.kind = kind;
    this.reachInFeet = reachInFeet;
    this.rangeIncrementInFeet = rangeIncrementInFeet;
    this.rangedFamily = rangedFamily;
    this.handedness = handedness;
    this.isUnarmed = isUnarmed;
  }

  get isRanged(): boolean {
    return this.kind === 'Ranged';
  }

  /** Maximum distance the weapon can strike: its reach (melee) or ten increments (ranged). */
  get maximumRangeInFeet(): number {
    return this.isRanged
      ? this.rangeIncrementInFeet * Weapon.MAX_RANGE_INCREMENTS
      : this.reachInFeet;
  }

  threatensCriticalOn(naturalRoll: number): boolean {
    return naturalRoll >= this.threatRangeMin && naturalRoll <= Weapon.NATURAL_TWENTY;
  }
}
