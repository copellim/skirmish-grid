import type { Position } from './position';
import { positionsEqual } from './position';
import type { Character } from './character';
import type { Spell } from './spell';

/** How an Aid Another success benefits the ally. */
export type AidAnotherBenefit = 'AttackRoll' | 'ArmorClass';

/**
 * An action a combatant can take on its turn, validated and applied by `Battle`. A discriminated
 * union (the C# `CombatAction` record hierarchy). Use the factory functions below to construct.
 */
export type CombatAction =
  | { readonly kind: 'move'; readonly destination: Position }
  | { readonly kind: 'attack'; readonly target: Character; readonly powerAttackPenalty: number }
  | { readonly kind: 'fiveFootStep'; readonly destination: Position }
  | { readonly kind: 'charge'; readonly target: Character }
  | { readonly kind: 'withdraw'; readonly destination: Position }
  | { readonly kind: 'fullAttack'; readonly target: Character; readonly powerAttackPenalty: number }
  | { readonly kind: 'doubleMove'; readonly destination: Position }
  | { readonly kind: 'standUp' }
  | { readonly kind: 'trip'; readonly target: Character }
  | { readonly kind: 'overrun'; readonly target: Character; readonly destination: Position }
  | { readonly kind: 'bullRush'; readonly target: Character }
  | { readonly kind: 'disarm'; readonly target: Character }
  | { readonly kind: 'retrieveWeapon' }
  | { readonly kind: 'aidAnother'; readonly ally: Character; readonly benefit: AidAnotherBenefit }
  | { readonly kind: 'coupDeGrace'; readonly target: Character }
  | { readonly kind: 'rage' }
  | { readonly kind: 'endRage' }
  | { readonly kind: 'setOverrunStance'; readonly avoids: boolean }
  | {
      readonly kind: 'castSpell';
      readonly spell: Spell;
      readonly target: Character | null;
      readonly areaCenter: Position | null;
      readonly defensive: boolean;
    };

export const moveAction = (destination: Position): CombatAction => ({ kind: 'move', destination });
export const attackAction = (target: Character, powerAttackPenalty = 0): CombatAction => ({
  kind: 'attack',
  target,
  powerAttackPenalty,
});
export const fiveFootStepAction = (destination: Position): CombatAction => ({
  kind: 'fiveFootStep',
  destination,
});
export const chargeAction = (target: Character): CombatAction => ({ kind: 'charge', target });
export const withdrawAction = (destination: Position): CombatAction => ({ kind: 'withdraw', destination });
export const fullAttackAction = (target: Character, powerAttackPenalty = 0): CombatAction => ({
  kind: 'fullAttack',
  target,
  powerAttackPenalty,
});
export const doubleMoveAction = (destination: Position): CombatAction => ({ kind: 'doubleMove', destination });
export const standUpAction = (): CombatAction => ({ kind: 'standUp' });
export const tripAction = (target: Character): CombatAction => ({ kind: 'trip', target });
export const overrunAction = (target: Character, destination: Position): CombatAction => ({
  kind: 'overrun',
  target,
  destination,
});
export const bullRushAction = (target: Character): CombatAction => ({ kind: 'bullRush', target });
export const disarmAction = (target: Character): CombatAction => ({ kind: 'disarm', target });
export const retrieveWeaponAction = (): CombatAction => ({ kind: 'retrieveWeapon' });
export const aidAnotherAction = (ally: Character, benefit: AidAnotherBenefit): CombatAction => ({
  kind: 'aidAnother',
  ally,
  benefit,
});
export const coupDeGraceAction = (target: Character): CombatAction => ({ kind: 'coupDeGrace', target });
export const rageAction = (): CombatAction => ({ kind: 'rage' });
export const endRageAction = (): CombatAction => ({ kind: 'endRage' });
export const castSpellAction = (
  spell: Spell,
  target: Character | null = null,
  areaCenter: Position | null = null,
  defensive = false,
): CombatAction => ({ kind: 'castSpell', spell, target, areaCenter, defensive });

/** Structural equality for actions — C# records compare by value; used by the AI and tests. */
export function actionsEqual(a: CombatAction | null, b: CombatAction | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'move':
    case 'fiveFootStep':
    case 'withdraw':
    case 'doubleMove':
      return positionsEqual(a.destination, (b as typeof a).destination);
    case 'attack':
    case 'fullAttack':
      return a.target === (b as typeof a).target && a.powerAttackPenalty === (b as typeof a).powerAttackPenalty;
    case 'charge':
    case 'trip':
    case 'bullRush':
    case 'disarm':
    case 'coupDeGrace':
      return a.target === (b as typeof a).target;
    case 'overrun':
      return a.target === (b as typeof a).target && positionsEqual(a.destination, (b as typeof a).destination);
    case 'aidAnother':
      return a.ally === (b as typeof a).ally && a.benefit === (b as typeof a).benefit;
    case 'castSpell': {
      const bb = b as typeof a;
      return (
        a.spell.name === bb.spell.name &&
        a.target === bb.target &&
        a.defensive === bb.defensive &&
        ((a.areaCenter === null) === (bb.areaCenter === null)) &&
        (a.areaCenter === null || positionsEqual(a.areaCenter, bb.areaCenter!))
      );
    }
    case 'setOverrunStance':
      return a.avoids === (b as typeof a).avoids;
    case 'standUp':
    case 'retrieveWeapon':
    case 'rage':
    case 'endRage':
      return true;
  }
}

/** SRD Overrun, Step 2: the defender's standing choice to step aside instead of blocking. Free. */
export const setOverrunStanceAction = (avoids: boolean): CombatAction => ({
  kind: 'setOverrunStance',
  avoids,
});
