/**
 * Situational modifiers applied to an attack (flanking, charge, range penalty, sneak, power
 * attack). Computed by `Battle` and passed into the combat engine. Port of `AttackModifiers`.
 */
export interface AttackModifiers {
  readonly attackBonus: number;
  readonly sneakAttackApplies: boolean;
  readonly powerAttackDamageBonus: number;
}

export const NO_ATTACK_MODIFIERS: AttackModifiers = {
  attackBonus: 0,
  sneakAttackApplies: false,
  powerAttackDamageBonus: 0,
};

/**
 * Outcome of a single attack: the attack-roll breakdown, the damage split (dice vs modifier, both
 * already multiplied on a confirmed critical), and the sneak-attack damage. `confirmationRoll` is
 * set only when the attack hit and threatened a critical. Port of `AttackResult`.
 */
export interface AttackResult {
  readonly attackRoll: number;
  readonly attackTotal: number;
  readonly baseAttackBonus: number;
  readonly abilityAttackModifier: number;
  readonly situationalAttackBonus: number;
  readonly hit: boolean;
  readonly wasCritical: boolean;
  readonly confirmationRoll: number | null;
  readonly damage: number;
  readonly damageDiceRoll: number;
  readonly damageModifier: number;
  readonly sneakAttackDamage: number;
}
