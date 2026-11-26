// What the mat lights up for the combatant on turn: every square they can end a movement on, tagged
// with the cheapest way of getting there, and every enemy they can charge. Pure, like the menu:
// it only asks `Battle` the same predicates the menu uses, so the two can never disagree.

import type { Battle } from '../engine/battle';
import { Character } from '../engine/character';
import type { Position } from '../engine/position';
import { positionsEqual } from '../engine/position';
import { isFiveFootStepAway } from './arena-menu';

/**
 * The way a square can be reached, in order of preference: the step provokes nothing, the move
 * keeps the standard action, the double move (and the withdrawal, which shares its range and its
 * cost) spends the whole turn on getting there.
 */
export type MovementKind = 'fiveFootStep' | 'move' | 'doubleMove';

export interface MovementOption {
  readonly square: Position;
  readonly kind: MovementKind;
}

/** Each reachable square once, with the best kind of movement that reaches it. */
export function movementOptions(battle: Battle): MovementOption[] {
  const singleMove = battle.reachableSquares();
  const doubleMove = battle.doubleMoveReachableSquares();
  const options = new Map<string, MovementOption>();
  const offer = (square: Position, kind: MovementKind) => {
    const key = `${square.x},${square.y}`;
    if (!options.has(key)) {
      options.set(key, { square, kind });
    }
  };
  for (const square of doubleMove) {
    if (isFiveFootStepAway(battle, square)) {
      offer(square, 'fiveFootStep');
    }
  }
  for (const square of singleMove) {
    if (isFiveFootStepAway(battle, square)) {
      offer(square, 'fiveFootStep');
    }
  }
  // After a full attack the move is gone but the step is not: neither list above has it then.
  for (const square of adjacentSquares(battle)) {
    if (isFiveFootStepAway(battle, square)) {
      offer(square, 'fiveFootStep');
    }
  }
  for (const square of singleMove) {
    offer(square, 'move');
  }
  for (const square of doubleMove) {
    offer(square, 'doubleMove');
  }
  return [...options.values()];
}

/** The enemies the combatant on turn could charge right now. */
export function chargeableEnemies(battle: Battle): Character[] {
  const actor = battle.currentActor;
  return battle.combatants.filter((c) => c.isAlive && Character.areEnemies(actor, c) && battle.canCharge(c));
}

function adjacentSquares(battle: Battle): Position[] {
  return battle.threatenedSquaresOf(battle.currentActor).filter((square) => !battle.combatants.some((c) => c.isAlive && positionsEqual(c.position, square)));
}
