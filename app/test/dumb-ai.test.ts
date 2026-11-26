// `DumbAi` is a pure decision function: given a battle, it returns the action it would take, or null
// to end the turn. It never resolves a rule itself — everything it picks must be something `Battle`
// accepts. Only its melee-and-move branches show up in the golden transcripts; these pin the rest.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { Armor, Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import { Armors } from '../src/engine/catalogs';
import { chooseAction } from '../src/engine/dumb-ai';
import { actionsEqual, attackAction, chargeAction, moveAction } from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const longsword = () => new Weapon('Longsword', DiceExpression.parse('1d8'), 19, 2);
const shortbow = () => new Weapon('Shortbow', DiceExpression.parse('1d6'), 20, 3, 'Ranged', 5, 60, 'Bow');

interface FighterOptions {
  weapon?: Weapon;
  speed?: number;
  armor?: Armor;
}

const fighter = (
  name: string,
  x: number,
  y: number,
  side: 'A' | 'B' = 'A',
  { weapon = longsword(), speed = 30, armor }: FighterOptions = {},
): Character => {
  const builder = combatant(name).str(16).hp(12).bab(1).movingAt(speed).wielding(weapon).at(x, y).on(side);
  return (armor === undefined ? builder : builder.wearing(armor)).build();
};

const battleOf = (rolls: number[], ...combatants: Character[]): Battle =>
  new Battle(new Grid(10, 10), new SequenceRandom(...rolls), combatants);

describe('DumbAi', () => {
  it('attacks an adjacent enemy', () => {
    const hero = fighter('Hero', 0, 0);
    const rival = fighter('Rival', 1, 0, 'B');
    const battle = battleOf([2, 1], hero, rival);

    expect(actionsEqual(chooseAction(battle), attackAction(rival))).toBe(true);
  });

  it('picks the nearest living enemy of several', () => {
    const hero = fighter('Hero', 0, 0);
    const near = fighter('Near', 1, 0, 'B');
    const far = fighter('Far', 7, 0, 'B');
    const battle = battleOf([3, 2, 1], hero, near, far);

    expect(actionsEqual(chooseAction(battle), attackAction(near))).toBe(true);
  });

  it('steps over a fallen enemy and acts on the one still standing', () => {
    const hero = fighter('Hero', 0, 0);
    const fallen = fighter('Fallen', 1, 0, 'B');
    const standing = fighter('Standing', 9, 9, 'B');
    fallen.takeDamage(1000);
    const battle = battleOf([3, 2, 1], hero, fallen, standing);

    const action = chooseAction(battle);

    expect(action).not.toBeNull();
    expect(actionsEqual(action, attackAction(fallen))).toBe(false);
  });

  it('never attacks the ally standing next to it', () => {
    // The ally also blocks every charge lane, so the only thing left is to advance.
    const hero = fighter('Hero', 0, 0);
    const ally = fighter('Ally', 1, 0, 'A');
    const enemy = fighter('Enemy', 5, 0, 'B');
    const battle = battleOf([3, 2, 1], hero, ally, enemy);

    expect(chooseAction(battle)?.kind).toBe('move');
  });

  it('charges an enemy standing at charge range with a clear lane', () => {
    const hero = fighter('Hero', 0, 0);
    const rival = fighter('Rival', 5, 0, 'B');
    const battle = battleOf([2, 1], hero, rival);

    expect(actionsEqual(chooseAction(battle), chargeAction(rival))).toBe(true);
  });

  // SRD Charge: two squares away the closest space is 5 ft off, under the 10-ft minimum.
  it('closes in on an enemy two squares away instead of charging it', () => {
    const hero = fighter('Hero', 0, 0);
    const rival = fighter('Rival', 0, 2, 'B');
    const battle = battleOf([2, 1], hero, rival);

    expect(actionsEqual(chooseAction(battle), moveAction({ x: 0, y: 1 }))).toBe(true);
  });

  it('closes the distance when the enemy is too far to charge', () => {
    // Speed 10 → a charge reaches 20 ft; the rival stands 40 ft away.
    const hero = fighter('Hero', 0, 0, 'A', { speed: 10 });
    const rival = fighter('Rival', 8, 0, 'B', { speed: 10 });
    const battle = battleOf([2, 1], hero, rival);

    expect(actionsEqual(chooseAction(battle), moveAction({ x: 2, y: 0 }))).toBe(true);
  });

  it('keeps its move inside the speed its armor leaves it', () => {
    // Chainmail cuts 30 ft to 20: a destination chosen on the raw speed would be refused by Battle.
    const hero = fighter('Hero', 0, 0, 'A', { armor: Armors.chainmail() });
    const rival = fighter('Rival', 9, 9, 'B');
    const battle = battleOf([2, 1], hero, rival);

    const action = chooseAction(battle);

    expect(action?.kind).toBe('move');
    const destination = (action as { kind: 'move'; destination: { x: number; y: number } }).destination;
    expect(Grid.movementCost(hero.position, destination)).toBeLessThanOrEqual(20);
    expect(() => battle.execute(action!)).not.toThrow();
  });

  it('shoots when it has a bow and nobody in its face', () => {
    const archer = fighter('Archer', 0, 0, 'A', { weapon: shortbow() });
    const rival = fighter('Rival', 5, 0, 'B');
    const battle = battleOf([2, 1], archer, rival);

    expect(actionsEqual(chooseAction(battle), attackAction(rival))).toBe(true);
  });

  it('kites away with a five-foot step when a melee foe closes in', () => {
    const archer = fighter('Archer', 5, 5, 'A', { weapon: shortbow() });
    const foe = fighter('Foe', 6, 5, 'B');
    const battle = battleOf([2, 1], archer, foe);

    const action = chooseAction(battle);

    expect(action?.kind).toBe('fiveFootStep');
    const destination = (action as { kind: 'fiveFootStep'; destination: { x: number; y: number } }).destination;
    expect(Grid.areAdjacent(destination, foe.position)).toBe(false);
  });

  it('ends the turn once the standard action is gone', () => {
    const hero = fighter('Hero', 0, 0);
    const rival = fighter('Rival', 1, 0, 'B');
    const battle = battleOf([2, 1, 10, 5], hero, rival);
    battle.execute(attackAction(rival));

    expect(chooseAction(battle)).toBeNull();
  });

  it('ends the turn when nothing is in reach and the move is spent', () => {
    const hero = fighter('Hero', 0, 0);
    const rival = fighter('Rival', 9, 9, 'B');
    const battle = battleOf([2, 1], hero, rival);

    battle.execute(moveAction({ x: 3, y: 3 }));

    expect(chooseAction(battle)).toBeNull();
  });
});
