import type { Battle } from './battle';
import { Character } from './character';
import { Grid } from './grid';
import type { Position } from './position';
import { positionsEqual } from './position';
import {
  type CombatAction,
  attackAction,
  chargeAction,
  fullAttackAction,
  fiveFootStepAction,
  moveAction,
} from './combat-action';

const FIVE_FOOT_STEP_COST_IN_FEET = 5;

/**
 * CPU opponent: a ranged fighter shoots enemies in range and kites away from melee; a melee fighter
 * charges at charge range and otherwise closes in and attacks. Pure decision logic — no side effects,
 * no randomness; returns one action per call, caller pumps until null. Port of `DumbAi`.
 */
export function chooseAction(battle: Battle): CombatAction | null {
  const actor = battle.currentActor;
  if (!actor.canAct) {
    return null;
  }
  const enemy = nearestEnemy(battle, actor);
  if (enemy === null) {
    return null;
  }
  return actor.activeWeapon.isRanged
    ? chooseRangedAction(battle, actor, enemy)
    : chooseMeleeAction(battle, actor, enemy);
}

function chooseRangedAction(battle: Battle, actor: Character, enemy: Character): CombatAction | null {
  if (battle.hasMovementAvailable && isThreatened(battle, actor)) {
    const retreat = stepAwayBreakingThreat(battle, actor);
    if (retreat !== null) {
      return fiveFootStepAction(retreat);
    }
  }
  if (battle.hasStandardActionAvailable && isWithinRange(actor, enemy)) {
    return attackAction(enemy);
  }
  if (battle.canMove && !isWithinRange(actor, enemy)) {
    const step = stepToward(battle, actor, enemy);
    if (step !== null) {
      return moveAction(step);
    }
  }
  return null;
}

function chooseMeleeAction(battle: Battle, actor: Character, enemy: Character): CombatAction | null {
  const isAdjacent = Grid.areAdjacent(actor.position, enemy.position);
  if (isAdjacent && battle.canFullAttack(enemy)) {
    return fullAttackAction(enemy);
  }
  if (battle.hasStandardActionAvailable && isAdjacent) {
    return attackAction(enemy);
  }
  if (!isAdjacent && battle.canCharge(enemy)) {
    return chargeAction(enemy);
  }
  if (battle.canMove && !isAdjacent) {
    const step = stepToward(battle, actor, enemy);
    if (step !== null) {
      return moveAction(step);
    }
  }
  return null;
}

function isWithinRange(actor: Character, enemy: Character): boolean {
  return Grid.movementCost(actor.position, enemy.position) <= actor.activeWeapon.maximumRangeInFeet;
}

function isThreatened(battle: Battle, actor: Character): boolean {
  return battle.combatants.some(
    (enemy) =>
      enemy.isAlive && Character.areEnemies(actor, enemy) && Grid.areAdjacent(enemy.position, actor.position),
  );
}

function stepAwayBreakingThreat(battle: Battle, actor: Character): Position | null {
  let best: Position | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const square = { x: actor.position.x + dx, y: actor.position.y + dy };
      if (
        !battle.grid.contains(square) ||
        isOccupied(battle, square) ||
        Grid.movementCost(actor.position, square) !== FIVE_FOOT_STEP_COST_IN_FEET ||
        threatensAnyEnemy(battle, actor, square)
      ) {
        continue;
      }
      const distance = nearestEnemyDistanceFrom(battle, actor, square);
      if (distance > bestDistance) {
        best = square;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function threatensAnyEnemy(battle: Battle, actor: Character, square: Position): boolean {
  return battle.combatants.some(
    (enemy) => enemy.isAlive && Character.areEnemies(actor, enemy) && Grid.areAdjacent(enemy.position, square),
  );
}

function nearestEnemyDistanceFrom(battle: Battle, actor: Character, square: Position): number {
  return Math.min(
    ...battle.combatants
      .filter((enemy) => enemy.isAlive && Character.areEnemies(actor, enemy))
      .map((enemy) => chebyshevDistance(square, enemy.position)),
  );
}

function nearestEnemy(battle: Battle, actor: Character): Character | null {
  const enemies = battle.combatants
    .filter((candidate) => candidate.isAlive && Character.areEnemies(actor, candidate))
    .sort(
      (a, b) =>
        chebyshevDistance(actor.position, a.position) - chebyshevDistance(actor.position, b.position) ||
        a.position.x - b.position.x ||
        a.position.y - b.position.y,
    );
  return enemies.length > 0 ? enemies[0] : null;
}

function stepToward(battle: Battle, actor: Character, enemy: Character): Position | null {
  const currentDistance = chebyshevDistance(actor.position, enemy.position);

  let best: Position | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let x = 0; x < battle.grid.width; x++) {
    for (let y = 0; y < battle.grid.height; y++) {
      const square = { x, y };
      if (positionsEqual(square, actor.position) || isOccupied(battle, square)) {
        continue;
      }
      const cost = Grid.movementCost(actor.position, square);
      if (cost > actor.effectiveSpeed) {
        continue;
      }
      const distance = chebyshevDistance(square, enemy.position);
      if (distance >= currentDistance) {
        continue;
      }
      if (distance < bestDistance || (distance === bestDistance && cost < bestCost)) {
        best = square;
        bestDistance = distance;
        bestCost = cost;
      }
    }
  }
  return best;
}

function isOccupied(battle: Battle, square: Position): boolean {
  return battle.combatants.some((combatant) => combatant.isAlive && positionsEqual(combatant.position, square));
}

function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
