// SRD Movement, Position, and Distance plus the move-related actions:
// https://www.d20srd.org/srd/combat/movementPositionAndDistance.htm
//
// Five-foot step, charge (with its line of approach and AC penalty), withdraw, and the reachable
// squares the UI offers.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import {
  attackAction,
  chargeAction,
  doubleMoveAction,
  fiveFootStepAction,
  moveAction,
  withdrawAction,
} from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const longsword = () => new Weapon('Longsword', DiceExpression.parse('1d8'), 19, 2);

/** STR 16 (+3), BAB 1, speed 30 — the same fighter throughout, so distances are the variable. */
const fighter = (name: string, x: number, y: number, side: 'A' | 'B' = 'A'): Character =>
  combatant(name).str(16).hp(30).bab(1).wielding(longsword()).at(x, y).on(side).build();

// Initiative 2 then 1: the first combatant listed acts first.
const duel = (first: Character, second: Character, laterRolls: number[] = [], size = 10): Battle =>
  new Battle(new Grid(size, size), new SequenceRandom(2, 1, ...laterRolls), [first, second]);

describe('five-foot step', () => {
  it('slips out of a threatened square without provoking, and spends the move', () => {
    const mover = fighter('Mover', 1, 0, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = duel(mover, enemy);

    battle.execute(fiveFootStepAction({ x: 1, y: 1 }));

    expect(mover.position).toEqual({ x: 1, y: 1 });
    expect(mover.currentHitPoints).toBe(30);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(1);
    expect(battle.hasMovementAvailable).toBe(false);
  });

  it('refuses to cover two squares', () => {
    const battle = duel(fighter('Mover', 1, 0, 'A'), fighter('Enemy', 9, 9, 'B'));

    expect(() => battle.execute(fiveFootStepAction({ x: 1, y: 2 }))).toThrow();
  });

  it('refuses to follow a regular move in the same turn', () => {
    const battle = duel(fighter('Mover', 0, 0, 'A'), fighter('Enemy', 9, 9, 'B'));
    battle.execute(moveAction({ x: 2, y: 0 }));

    expect(() => battle.execute(fiveFootStepAction({ x: 3, y: 0 }))).toThrow();
  });
});

describe('charge', () => {
  it('closes to the target, attacks at +2 and drops the charger’s AC by 2', () => {
    // d20 8 + BAB 1 + STR 3 + charge 2 = 14 beats AC 10; damage 5 + STR 3.
    const charger = fighter('Charger', 0, 0, 'A');
    const target = fighter('Target', 5, 0, 'B');
    const battle = duel(charger, target, [8, 5]);

    const result = battle.execute(chargeAction(target));

    expect(charger.position).toEqual({ x: 4, y: 0 });
    expect(result?.hit).toBe(true);
    expect(target.currentHitPoints).toBe(30 - 8);
    expect(charger.armorClassModifier).toBe(-2);
    expect(battle.hasMovementAvailable).toBe(false);
    expect(battle.hasStandardActionAvailable).toBe(false);
  });

  it('gives the AC back at the start of the charger’s next turn', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const target = fighter('Target', 5, 0, 'B');
    const battle = duel(charger, target, [8, 5]);

    battle.execute(chargeAction(target));
    battle.endTurn(); // target
    battle.endTurn(); // back to the charger

    expect(charger.armorClassModifier).toBe(0);
  });

  it.each([
    [6, 10, 12, 9],
    [6, 11, 12, 9],
  ])('reaches an adjacent square on an oblique approach from (%i,%i)', (fromX, fromY, toX, toY) => {
    // Neither offset lies on a clean grid line; the charge still has to land next to the target.
    const charger = fighter('Charger', fromX, fromY, 'A');
    const target = fighter('Target', toX, toY, 'B');
    const battle = duel(charger, target, [8, 5], 20);

    const result = battle.execute(chargeAction(target));

    expect(Grid.areAdjacent(charger.position, target.position)).toBe(true);
    expect(result?.hit).toBe(true);
  });

  it('refuses a lane blocked by a creature', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const blocker = fighter('Blocker', 3, 0, 'B');
    const target = fighter('Target', 6, 0, 'B');
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(3, 2, 1), [charger, blocker, target]);

    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  // SRD Charge: "if any line from your starting space to the ending space passes through a square
  // that […] contains a creature (even an ally), you can't charge."
  it('refuses a lane blocked by one of the charger’s own allies', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const ally = fighter('Ally', 3, 0, 'A');
    const target = fighter('Target', 6, 0, 'B');
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(3, 2, 1), [charger, ally, target]);

    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  // SRD Charge, "Movement During a Charge": "you must move to the closest space from which you can
  // attack the opponent" and "You must move at least 10 feet (2 squares)". The closest space is
  // decided first; when it is nearer than 10 ft there is no charge at all — the engine must not
  // skip it for a farther square beside the target.
  it('refuses a target already adjacent in open ground, where squares 10 ft away flank it', () => {
    const charger = fighter('Charger', 5, 5, 'A');
    const target = fighter('Target', 6, 6, 'B');
    const battle = duel(charger, target);

    expect(battle.canCharge(target)).toBe(false);
    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  it('refuses a target two squares away: the closest space is only 5 ft off', () => {
    const charger = fighter('Charger', 4, 3, 'A');
    const target = fighter('Target', 4, 5, 'B');
    const battle = duel(charger, target);

    expect(battle.canCharge(target)).toBe(false);
    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  // "directly toward the designated opponent": of the three squares 10 ft away next to the target,
  // the charge ends on the one in the charger's own row, not on a corner.
  it('lands on the square in front of the target, not beside it', () => {
    const charger = fighter('Charger', 2, 5, 'A');
    const target = fighter('Target', 5, 5, 'B');
    const battle = duel(charger, target, [8, 5]);

    battle.execute(chargeAction(target));

    expect(charger.position).toEqual({ x: 4, y: 5 });
  });

  // "(If this space is occupied or otherwise blocked, you can't charge.)" — a farther free square
  // next to the target is no substitute.
  it('refuses when the closest space is taken by a third combatant', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const bystander = fighter('Bystander', 3, 3, 'B');
    const target = fighter('Target', 4, 4, 'B');
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(3, 2, 1), [charger, bystander, target]);

    expect(battle.canCharge(target)).toBe(false);
    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  it('refuses a target already adjacent — a charge needs at least ten feet', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const target = fighter('Target', 1, 0, 'B');
    const battle = duel(charger, target);

    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  it('refuses once the standard action is spent', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const adjacent = fighter('Foe', 1, 0, 'B');
    const target = fighter('Target', 0, 5, 'B');
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(3, 2, 1, 10, 5), [charger, adjacent, target]);
    battle.execute(attackAction(adjacent));

    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  it('covers exactly double speed', () => {
    // Speed 30 → 60 ft of charge; the landing square (12,0) is 60 ft out.
    const charger = fighter('Charger', 0, 0, 'A');
    const target = fighter('Target', 13, 0, 'B');
    const battle = duel(charger, target, [8, 5], 20);

    battle.execute(chargeAction(target));

    expect(charger.position).toEqual({ x: 12, y: 0 });
  });

  it('refuses one square more than that', () => {
    const battle = duel(fighter('Charger', 0, 0, 'A'), fighter('Target', 14, 0, 'B'), [], 20);
    const target = battle.combatants.find((c) => c.name === 'Target')!;

    expect(() => battle.execute(chargeAction(target))).toThrow();
  });

  it('is not offered against an adjacent target', () => {
    const charger = fighter('Charger', 0, 0, 'A');
    const target = fighter('Target', 1, 0, 'B');

    expect(duel(charger, target).canCharge(target)).toBe(false);
  });

  it('is offered at exactly the ten-foot minimum', () => {
    // Target at (3,0): the landing square (2,0) sits ten feet from the charger.
    const charger = fighter('Charger', 0, 0, 'A');
    const target = fighter('Target', 3, 0, 'B');

    expect(duel(charger, target).canCharge(target)).toBe(true);
  });
});

describe('withdraw', () => {
  // SRD: "The square you start out in is not considered threatened by any opponent you can see."
  // Only that square — the rest of the route is the describe at the end of the file.
  it('leaves the square it starts in unpunished', () => {
    // The enemy acts first, so the exemption of the starting square — not the flat-footed clause —
    // is what keeps it silent, and nothing on the route to (4,0) is within its reach.
    const mover = fighter('Mover', 1, 0, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = duel(enemy, mover);
    battle.endTurn();

    battle.execute(withdrawAction({ x: 4, y: 0 }));

    expect(mover.position).toEqual({ x: 4, y: 0 });
    expect(mover.currentHitPoints).toBe(30);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(1);
    expect(battle.hasMovementAvailable).toBe(false);
    expect(battle.hasStandardActionAvailable).toBe(false);
  });

  it('covers up to double speed', () => {
    // 45 ft: past a single move, inside the 60 ft a withdrawal allows.
    const mover = fighter('Mover', 0, 0, 'A');
    const battle = duel(mover, fighter('Enemy', 9, 9, 'B'));

    battle.execute(withdrawAction({ x: 0, y: 9 }));

    expect(mover.position).toEqual({ x: 0, y: 9 });
  });

  it('refuses to go further', () => {
    const battle = duel(fighter('Mover', 1, 0, 'A'), fighter('Enemy', 0, 0, 'B'));

    expect(() => battle.execute(withdrawAction({ x: 9, y: 9 }))).toThrow();
  });
});

describe('reachable squares', () => {
  const pair = (heroAt: { x: number; y: number }, rivalAt: { x: number; y: number }) => {
    const hero = fighter('Hero', heroAt.x, heroAt.y, 'A');
    const rival = fighter('Rival', rivalAt.x, rivalAt.y, 'A');
    return { hero, rival, battle: duel(hero, rival) };
  };

  it('leaves out the mover’s own square, an occupied one, and anything out of range', () => {
    const { battle } = pair({ x: 0, y: 0 }, { x: 1, y: 0 });

    const reachable = battle.reachableSquares();

    expect(reachable).not.toContainEqual({ x: 0, y: 0 });
    expect(reachable).not.toContainEqual({ x: 1, y: 0 });
    expect(reachable).toContainEqual({ x: 3, y: 0 }); // 15 ft
    expect(reachable).not.toContainEqual({ x: 7, y: 0 }); // 35 ft
  });

  it('prices diagonals 5/10/5, so four of them are exactly a move', () => {
    const { battle } = pair({ x: 0, y: 0 }, { x: 9, y: 9 });

    const reachable = battle.reachableSquares();

    expect(reachable).toContainEqual({ x: 4, y: 4 }); // 30 ft
    expect(reachable).not.toContainEqual({ x: 5, y: 5 }); // 45 ft
  });

  it('is empty once the move is spent', () => {
    const { battle } = pair({ x: 0, y: 0 }, { x: 9, y: 9 });

    battle.execute(moveAction({ x: 1, y: 0 }));

    expect(battle.reachableSquares()).toHaveLength(0);
  });

  it('agrees with the single-square query', () => {
    const { battle } = pair({ x: 0, y: 0 }, { x: 9, y: 9 });

    expect(battle.isReachable({ x: 3, y: 0 })).toBe(true);
    expect(battle.isReachable({ x: 7, y: 0 })).toBe(false);
    expect(battle.isReachable({ x: 0, y: 0 })).toBe(false);
  });

  it('threatens only the neighbours that exist on the grid', () => {
    const { battle, hero } = pair({ x: 0, y: 0 }, { x: 9, y: 9 });

    // A corner square threatens three neighbours, not eight.
    expect(battle.threatenedSquaresOf(hero)).toEqual(
      expect.arrayContaining([
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    );
    expect(battle.threatenedSquaresOf(hero)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------
describe('withdraw along a threatened route', () => {
  // SRD Withdraw: "The square you start out in is not considered threatened […] If, during the
  // process of withdrawing, you move out of a threatened square (other than the one you started
  // in), enemies get attacks of opportunity as normal."
  it('provokes from a threatened square that is not the one it started in', () => {
    // The withdrawer starts clear of Chaser but has to cross the square Chaser threatens on its way
    // to (4,0). Chaser's AoO: d20 15 (+BAB 1 +STR 3) against AC 10, for 1d8 = 6 plus STR 3.
    // The chaser is listed first, so it acts first and is not flat-footed when the withdrawer
    // crosses the square it threatens.
    const withdrawer = fighter('Withdrawer', 0, 0, 'A');
    const chaser = fighter('Chaser', 2, 1, 'B');
    const battle = duel(chaser, withdrawer, [15, 6]);
    battle.endTurn();

    battle.execute(withdrawAction({ x: 4, y: 0 }));

    expect(withdrawer.position).toEqual({ x: 4, y: 0 });
    expect(withdrawer.currentHitPoints).toBe(30 - 9);
    expect(chaser.availableAttacksOfOpportunityCount).toBe(0);
  });
});

describe('move along a threatened route', () => {
  // SRD Attacks of Opportunity: "Moving out of a threatened square usually provokes an attack of
  // opportunity." An ordinary move exempts no square at all — unlike the withdrawal above, which
  // is spared only the one it starts in — so crossing a threatened square costs the same.
  it('provokes from a threatened square crossed on the way', () => {
    // The same scene as the withdrawal above, walked with a plain move: Runner starts clear of
    // Chaser and crosses the square it threatens. AoO d20 15 (+BAB 1 +STR 3), 1d8 = 6 plus STR 3.
    const runner = fighter('Runner', 0, 0, 'A');
    const chaser = fighter('Chaser', 2, 1, 'B');
    const battle = duel(chaser, runner, [15, 6]);
    battle.endTurn();

    battle.execute(moveAction({ x: 4, y: 0 }));

    expect(runner.position).toEqual({ x: 4, y: 0 });
    expect(runner.currentHitPoints).toBe(30 - 9);
    expect(chaser.availableAttacksOfOpportunityCount).toBe(0);
  });

  it('gets the same treatment on the second leg of a double move', () => {
    // 45 ft in a straight line, so the far half of the route is the one that crosses the threat.
    const runner = fighter('Runner', 0, 0, 'A');
    const chaser = fighter('Chaser', 7, 1, 'B');
    const battle = duel(chaser, runner, [15, 6]);
    battle.endTurn();

    battle.execute(doubleMoveAction({ x: 9, y: 0 }));

    expect(runner.position).toEqual({ x: 9, y: 0 });
    expect(runner.currentHitPoints).toBe(30 - 9);
    expect(chaser.availableAttacksOfOpportunityCount).toBe(0);
  });

  // The square the mover stops in is not left, so it never provokes — only the ones it walks out of.
  it('does not provoke from the square it stops in', () => {
    const runner = fighter('Runner', 0, 0, 'A');
    const chaser = fighter('Chaser', 5, 0, 'B');
    const battle = duel(chaser, runner);
    battle.endTurn();

    battle.execute(moveAction({ x: 4, y: 0 }));

    expect(runner.currentHitPoints).toBe(30);
    expect(chaser.availableAttacksOfOpportunityCount).toBe(1);
  });
});
