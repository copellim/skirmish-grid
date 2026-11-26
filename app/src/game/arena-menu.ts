// The context menu the arena opens on a tapped square: which actions the combatant on turn can
// take there, each already wrapped in the `CombatAction` that performs it. Pure — it only asks
// `Battle` its read-only predicates, so the screen never decides a rule and a test can walk the
// whole table without React. The menu pre-filters; `Battle.execute()` remains the authority and its
// error is the last word on anything the predicates do not cover.

import { Battle } from '../engine/battle';
import { Character } from '../engine/character';
import { Grid } from '../engine/grid';
import type { Position } from '../engine/position';
import { positionsEqual } from '../engine/position';
import type { Spell } from '../engine/spell';
import {
  aidAnotherAction,
  attackAction,
  bullRushAction,
  castSpellAction,
  chargeAction,
  coupDeGraceAction,
  disarmAction,
  doubleMoveAction,
  endRageAction,
  fiveFootStepAction,
  fullAttackAction,
  moveAction,
  rageAction,
  retrieveWeaponAction,
  setOverrunStanceAction,
  standUpAction,
  tripAction,
  withdrawAction,
  type CombatAction,
} from '../engine/combat-action';

/**
 * One line of the menu. `act` executes on tap; the other two open a second step (the square to
 * overrun into, the benefit to grant), because the action is not complete until it is chosen.
 */
export type MenuEntry =
  | { readonly kind: 'act'; readonly label: string; readonly action: CombatAction }
  | { readonly kind: 'chooseOverrunDestination'; readonly label: string; readonly target: Character }
  | { readonly kind: 'chooseAidBenefit'; readonly label: string; readonly ally: Character };

const FIVE_FOOT_STEP_COST_IN_FEET = 5;

/** The combatant shown on a square: anyone not dead, so a dying body still takes the square. */
export function occupantOf(battle: Battle, square: Position): Character | null {
  return battle.combatants.find((c) => c.isAlive && positionsEqual(c.position, square)) ?? null;
}

/** The menu for a tap on `square` by the combatant on turn. Empty when there is nothing to do there. */
export function menuFor(battle: Battle, square: Position): MenuEntry[] {
  const actor = battle.currentActor;
  const occupant = occupantOf(battle, square);
  if (occupant === null) {
    return emptySquareMenu(battle, square);
  }
  if (occupant === actor) {
    return selfMenu(battle);
  }
  if (Character.areEnemies(actor, occupant)) {
    return enemyMenu(battle, occupant);
  }
  return allyMenu(battle, occupant);
}

/** The second step of an aid: the same two SRD benefits, as menu entries. */
export function aidBenefitMenu(ally: Character): MenuEntry[] {
  return [
    act('Bonus al tiro per colpire', aidAnotherAction(ally, 'AttackRoll')),
    act('Bonus alla CA', aidAnotherAction(ally, 'ArmorClass')),
  ];
}

/**
 * Where an overrun can end: the free squares next to the target on its far side, the "move
 * through" the SRD describes. A UI heuristic — the engine accepts any square nobody stands on.
 */
export function overrunDestinations(battle: Battle, target: Character): Position[] {
  const actor = battle.currentActor;
  const distanceToTarget = Grid.movementCost(actor.position, target.position);
  return battle
    .threatenedSquaresOf(target)
    .filter((square) => isFreeToStandOn(battle, square))
    .filter((square) => Grid.movementCost(actor.position, square) > distanceToTarget);
}

/** Mirrors the `isBlocked` check of `executeOverrun`: only a combatant still standing blocks. */
function isFreeToStandOn(battle: Battle, square: Position): boolean {
  return !battle.combatants.some((c) => !c.isDefeated && positionsEqual(c.position, square));
}

/** The tapped square is the destination: every movement here goes exactly there. */
function emptySquareMenu(battle: Battle, square: Position): MenuEntry[] {
  const actor = battle.currentActor;
  const entries: MenuEntry[] = [];
  const singleMove = battle.isReachable(square);
  const doubleMove = battle.doubleMoveReachableSquares().some((s) => positionsEqual(s, square));
  if (singleMove) {
    entries.push(act('Muovi qui', moveAction(square)));
  }
  if (isFiveFootStepAway(battle, square)) {
    entries.push(act('Passo di 5 ft', fiveFootStepAction(square)));
  }
  if (doubleMove && !singleMove) {
    entries.push(act('Doppio movimento', doubleMoveAction(square)));
  }
  if (doubleMove) {
    entries.push(act('Ritirata qui', withdrawAction(square)));
  }
  for (const spell of castableSpells(battle, 'Area')) {
    if (isWithinSpellRange(actor, square, spell)) {
      entries.push(act(`Lancia ${spell.name} qui`, castSpellAction(spell, null, square, false)));
    }
  }
  return entries;
}

function enemyMenu(battle: Battle, target: Character): MenuEntry[] {
  const actor = battle.currentActor;
  const entries: MenuEntry[] = [];
  if (canAttack(battle, target)) {
    entries.push(act(`Attacca ${target.name}`, attackAction(target)));
  }
  if (battle.canFullAttack(target)) {
    entries.push(act(`Attacco completo su ${target.name}`, fullAttackAction(target)));
  }
  if (battle.canCharge(target)) {
    entries.push(act(`Carica ${target.name}`, chargeAction(target)));
  }
  if (battle.canTrip(target)) {
    entries.push(act(`Sgambetto a ${target.name}`, tripAction(target)));
  }
  if (battle.canBullRush(target)) {
    entries.push(act(`Spingi ${target.name}`, bullRushAction(target)));
  }
  if (battle.canDisarm(target)) {
    entries.push(act(`Disarma ${target.name}`, disarmAction(target)));
  }
  if (canOverrun(battle, target)) {
    entries.push({ kind: 'chooseOverrunDestination', label: `Travolgi ${target.name}`, target });
  }
  if (battle.canCoupDeGrace(target)) {
    entries.push(act(`Colpo di grazia a ${target.name}`, coupDeGraceAction(target)));
  }
  for (const spell of castableSpells(battle, 'Targeted')) {
    if (!target.isDefeated && isWithinSpellRange(actor, target.position, spell)) {
      entries.push(act(`Lancia ${spell.name} su ${target.name}`, castSpellAction(spell, target, null, false)));
    }
  }
  for (const spell of castableSpells(battle, 'Area')) {
    if (isWithinSpellRange(actor, target.position, spell)) {
      entries.push(act(`Lancia ${spell.name} centrata su ${target.name}`, castSpellAction(spell, null, target.position, false)));
    }
  }
  const approach = closestReachableSquareTo(battle, target);
  if (approach !== null) {
    entries.push(act(`Avvicinati a ${target.name}`, moveAction(approach)));
  }
  return entries;
}

function allyMenu(battle: Battle, ally: Character): MenuEntry[] {
  if (!battle.canAidAnother(ally)) {
    return [];
  }
  return [{ kind: 'chooseAidBenefit', label: `Aiuta ${ally.name}`, ally }];
}

function selfMenu(battle: Battle): MenuEntry[] {
  const actor = battle.currentActor;
  const entries: MenuEntry[] = [];
  if (actor.isProne && battle.canMove) {
    entries.push(act('Rialzati', standUpAction()));
  }
  if (actor.isDisarmed && battle.canMove) {
    entries.push(act('Recupera arma', retrieveWeaponAction()));
  }
  if (canRage(actor)) {
    entries.push(act('Furia', rageAction()));
  }
  if (actor.isRaging) {
    entries.push(act('Fine furia', endRageAction()));
  }
  for (const spell of castableSpells(battle, 'SelfBuff')) {
    entries.push(act(`Lancia ${spell.name}`, castSpellAction(spell, null, null, false)));
  }
  entries.push(
    actor.avoidsOverruns
      ? act('Blocca i travolgimenti', setOverrunStanceAction(false))
      : act('Scansati dai travolgimenti', setOverrunStanceAction(true)),
  );
  return entries;
}

const act = (label: string, action: CombatAction): MenuEntry => ({ kind: 'act', label, action });

/** Mirrors `executeAttack` with `prepareMeleeAttack` / `prepareRangedAttack`. */
function canAttack(battle: Battle, target: Character): boolean {
  const actor = battle.currentActor;
  if (!battle.hasStandardActionAvailable || target.vitalStatus === 'Dead') {
    return false;
  }
  const weapon = actor.activeWeapon;
  if (!weapon.isRanged) {
    return Grid.areAdjacent(actor.position, target.position);
  }
  // SRD Prone: "cannot use a ranged weapon (except for a crossbow)".
  if (actor.isProne && weapon.rangedFamily !== 'Crossbow') {
    return false;
  }
  return Grid.movementCost(actor.position, target.position) <= weapon.maximumRangeInFeet;
}

/** Mirrors `executeOverrun`; a downed target is left out because there is nothing to push through. */
function canOverrun(battle: Battle, target: Character): boolean {
  return battle.canMove && !target.isDefeated && Grid.areAdjacent(battle.currentActor.position, target.position);
}

/** Mirrors `executeRage`. */
function canRage(actor: Character): boolean {
  return actor.barbarianLevels > 0 && actor.ragesRemaining > 0 && !actor.isRaging && !actor.isFatigued;
}

/** Mirrors `executeFiveFootStep`: one square, exactly 5 ft, free, with the move still unspent. */
export function isFiveFootStepAway(battle: Battle, square: Position): boolean {
  const from = battle.currentActor.position;
  return (
    battle.hasMovementAvailable &&
    battle.grid.contains(square) &&
    occupantOf(battle, square) === null &&
    Grid.areAdjacent(from, square) &&
    Grid.movementCost(from, square) === FIVE_FOOT_STEP_COST_IN_FEET
  );
}

type SpellShape = 'Area' | 'SelfBuff' | 'Targeted';

/** Known spells with a slot left, of the given shape, while the standard action is still there. */
function castableSpells(battle: Battle, shape: SpellShape): Spell[] {
  const actor = battle.currentActor;
  if (!battle.hasStandardActionAvailable) {
    return [];
  }
  return actor.knownSpells.filter((spell) => shapeOf(spell) === shape && actor.spellSlots.remaining(spell.spellLevel) > 0);
}

function shapeOf(spell: Spell): SpellShape {
  if (spell.targeting === 'Area' || spell.targeting === 'SelfBuff') {
    return spell.targeting;
  }
  return 'Targeted';
}

function isWithinSpellRange(caster: Character, position: Position, spell: Spell): boolean {
  return Grid.movementCost(caster.position, position) <= spell.rangeInFeet;
}

/** The reachable square nearest the target, when it is nearer than where the actor stands. */
function closestReachableSquareTo(battle: Battle, target: Character): Position | null {
  const actor = battle.currentActor;
  if (Grid.areAdjacent(actor.position, target.position)) {
    return null;
  }
  let best: Position | null = null;
  let bestDistance = Grid.movementCost(actor.position, target.position);
  for (const square of battle.reachableSquares()) {
    const distance = Grid.movementCost(square, target.position);
    if (distance < bestDistance) {
      best = square;
      bestDistance = distance;
    }
  }
  return best;
}
