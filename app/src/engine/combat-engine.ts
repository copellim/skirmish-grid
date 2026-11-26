import type { Random } from './random';
import type { Character } from './character';
import { type AttackModifiers, type AttackResult, NO_ATTACK_MODIFIERS } from './attack';
import { rollD20Check } from './d20-check';
import { rollDie, roll } from './dice';
import { resolveSavingThrow, type SavingThrowResult } from './saving-throws';

const NATURAL_MISS = 1;
const NATURAL_HIT = 20;
const MINIMUM_DAMAGE_ON_HIT = 1;
const SNEAK_ATTACK_DIE = 6;
const TWO_HANDED_STRENGTH_MULTIPLIER = 1.5;

/** The outcome of a coup de grâce: damage dealt (auto-crit) and the target's Fortitude save. */
export interface CoupDeGraceResult {
  readonly damage: number;
  readonly saveResult: SavingThrowResult;
}

/**
 * Resolves SRD 3.5 attacks: d20 + BAB + STR/DEX vs AC, natural-1 miss, natural-20 hit, critical
 * threat → confirm → multiply. Damage is weapon dice + ability modifier (two-handed melee adds
 * 1.5× STR), multiplied on a confirmed critical; sneak dice are never multiplied. Port of
 * `CombatEngine`.
 */
export class CombatEngine {
  constructor(private readonly random: Random) {}

  resolveAttack(
    attacker: Character,
    defender: Character,
    modifiers: AttackModifiers = NO_ATTACK_MODIFIERS,
  ): AttackResult {
    const abilityToHit = attacker.activeWeapon.isRanged
      ? attacker.effectiveDexterityModifier
      : attacker.effectiveStrengthModifier;
    const attackBonus = attacker.baseAttackBonus + abilityToHit + modifiers.attackBonus;
    const attack = rollD20Check(this.random, attackBonus);
    const attackRoll = attack.naturalRoll;
    const attackTotal = attack.total;

    const hit =
      attackRoll !== NATURAL_MISS &&
      (attackRoll === NATURAL_HIT || attackTotal >= defender.effectiveArmorClass);

    if (!hit) {
      return {
        attackRoll,
        attackTotal,
        baseAttackBonus: attacker.baseAttackBonus,
        abilityAttackModifier: abilityToHit,
        situationalAttackBonus: modifiers.attackBonus,
        hit: false,
        wasCritical: false,
        confirmationRoll: null,
        damage: 0,
        damageDiceRoll: 0,
        damageModifier: 0,
        sneakAttackDamage: 0,
      };
    }

    let confirmationRoll: number | null = null;
    let wasCritical = false;
    if (attacker.activeWeapon.threatensCriticalOn(attackRoll)) {
      const confirm = rollD20Check(this.random, attackBonus);
      confirmationRoll = confirm.naturalRoll;
      wasCritical =
        confirmationRoll === NATURAL_HIT ||
        (confirmationRoll !== NATURAL_MISS && confirm.total >= defender.effectiveArmorClass);
    }

    const { diceRoll: damageDiceRoll, modifier: damageModifier } = this.rollDamage(
      attacker,
      wasCritical,
    );
    const critMultiplier = wasCritical ? attacker.activeWeapon.criticalMultiplier : 1;
    let damage = Math.max(
      MINIMUM_DAMAGE_ON_HIT,
      damageDiceRoll + damageModifier + modifiers.powerAttackDamageBonus * critMultiplier,
    );

    // SRD Rogue: sneak attack dice are not multiplied on a critical hit.
    let sneakDamage = 0;
    if (attacker.sneakAttackDice > 0 && modifiers.sneakAttackApplies) {
      for (let i = 0; i < attacker.sneakAttackDice; i++) {
        sneakDamage += rollDie(this.random, SNEAK_ATTACK_DIE);
      }
      damage += sneakDamage;
    }

    defender.takeDamage(damage);

    return {
      attackRoll,
      attackTotal,
      baseAttackBonus: attacker.baseAttackBonus,
      abilityAttackModifier: abilityToHit,
      situationalAttackBonus: modifiers.attackBonus,
      hit: true,
      wasCritical,
      confirmationRoll,
      damage,
      damageDiceRoll,
      damageModifier,
      sneakAttackDamage: sneakDamage,
    };
  }

  private rollDamage(
    attacker: Character,
    wasCritical: boolean,
  ): { diceRoll: number; modifier: number } {
    const damageModifierPerHit = CombatEngine.computeDamageModifier(attacker);
    const multiplier = wasCritical ? attacker.activeWeapon.criticalMultiplier : 1;

    let diceRoll = 0;
    for (let r = 0; r < multiplier; r++) {
      diceRoll += roll(this.random, attacker.activeWeapon.damageDice);
    }

    return { diceRoll, modifier: damageModifierPerHit * multiplier };
  }

  /**
   * SRD Damage, Strength Bonus: "When you hit with a melee or thrown weapon, including a sling, add
   * your Strength modifier to the damage result. […] A Strength penalty, but not a bonus, applies
   * on attacks made with a bow that is not a composite bow." A crossbow takes neither.
   *
   * SRD Damage, Wielding a Weapon Two-Handed: "you add 1½ times your Strength bonus" — a penalty is
   * not a bonus, so it is never multiplied.
   */
  private static computeDamageModifier(attacker: Character): number {
    const weapon = attacker.activeWeapon;
    const strengthModifier = attacker.effectiveStrengthModifier;

    if (weapon.isRanged) {
      switch (weapon.rangedFamily) {
        case 'Sling':
          return strengthModifier;
        case 'Bow':
          return Math.min(strengthModifier, 0);
        default:
          return 0;
      }
    }

    if (weapon.handedness === 'TwoHanded' && strengthModifier > 0) {
      return Math.floor(strengthModifier * TWO_HANDED_STRENGTH_MULTIPLIER);
    }
    return strengthModifier;
  }

  // SRD Special Attacks — Coup de Grâce: auto-crit + Fort save (DC = 10 + damage) or instant death.
  resolveCoupDeGrace(attacker: Character, target: Character): CoupDeGraceResult {
    const { diceRoll, modifier } = this.rollDamage(attacker, true);

    // SRD: a helpless target is flat-footed and denied Dex — sneak attack applies.
    let sneakDamage = 0;
    for (let i = 0; i < attacker.sneakAttackDice; i++) {
      sneakDamage += rollDie(this.random, SNEAK_ATTACK_DIE);
    }

    const totalDamage = Math.max(1, diceRoll + modifier + sneakDamage);
    target.takeDamage(totalDamage);

    const saveResult = resolveSavingThrow(this.random, target, 'Fortitude', 10 + totalDamage);

    if (!saveResult.succeeded) {
      // Force instant death: bring HP to -10. takeDamage clamps there.
      const remainingToKill = target.currentHitPoints + 10;
      if (remainingToKill > 0) {
        target.takeDamage(remainingToKill);
      }
    }

    return { damage: totalDamage, saveResult };
  }
}
