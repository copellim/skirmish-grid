// The mat's movement overlay: each square tagged with the cheapest way of reaching it, and the
// enemies a charge can reach. Pinned against the same battles the menu is pinned on.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { attackAction, fullAttackAction, moveAction } from '../src/engine/combat-action';
import { chargeableEnemies, movementOptions } from '../src/game/movement-overlay';
import { combatant } from './support/character-builder';

const FACES = [5, 5, 5, 5, 5, 5, 5, 5];

const kindAt = (battle: Battle, x: number, y: number) =>
  movementOptions(battle).find((o) => o.square.x === x && o.square.y === y)?.kind ?? null;

describe('movementOptions', () => {
  it('tags the adjacent squares as steps, the ones within speed as moves, the rest within double speed as double moves', () => {
    const actor = combatant('A1').at(0, 0).on('A').build();
    const battle = new Battle(new Grid(12, 12), new SequenceRandom(20, 1, ...FACES), [actor, combatant('B1').at(11, 11).on('B').build()]);

    expect(kindAt(battle, 1, 0)).toBe('fiveFootStep');
    expect(kindAt(battle, 1, 1)).toBe('fiveFootStep');
    expect(kindAt(battle, 6, 0)).toBe('move');
    expect(kindAt(battle, 9, 0)).toBe('doubleMove');
    expect(kindAt(battle, 10, 11)).toBeNull();
    expect(kindAt(battle, 0, 0)).toBeNull();
  });

  it('keeps only the step once a full attack has narrowed the movement', () => {
    const veteran = combatant('A1').bab(6).at(0, 0).on('A').build();
    const enemy = combatant('B1').at(1, 0).on('B').build();
    const battle = new Battle(new Grid(12, 12), new SequenceRandom(20, 1, ...FACES), [veteran, enemy]);
    battle.execute(fullAttackAction(enemy));

    const kinds = new Set(movementOptions(battle).map((o) => o.kind));
    expect(kinds).toEqual(new Set(['fiveFootStep']));
    expect(kindAt(battle, 0, 1)).toBe('fiveFootStep');
    expect(kindAt(battle, 1, 0)).toBeNull(); // the enemy stands there
  });

  it('offers nothing once the move is spent', () => {
    const actor = combatant('A1').at(0, 0).on('A').build();
    const battle = new Battle(new Grid(12, 12), new SequenceRandom(20, 1, ...FACES), [actor, combatant('B1').at(11, 11).on('B').build()]);
    battle.execute(moveAction({ x: 1, y: 0 }));

    expect(movementOptions(battle)).toEqual([]);
  });
});

describe('chargeableEnemies', () => {
  it('lists the enemies a charge reaches, and none once the standard action is spent', () => {
    // Open ground around the actor: the diagonal neighbour and the enemy two squares up both have
    // free squares 10 ft away next to them, which is not what makes a charge (SRD: closest space).
    const actor = combatant('A1').at(5, 5).on('A').build();
    const near = combatant('B1').at(9, 5).on('B').build();
    const far = combatant('B2').at(19, 19).on('B').build();
    const adjacent = combatant('B3').at(6, 6).on('B').build();
    const twoAway = combatant('B4').at(5, 7).on('B').build();
    const battle = new Battle(new Grid(20, 20), new SequenceRandom(20, 1, 1, 1, 1, ...FACES), [actor, near, far, adjacent, twoAway]);

    expect(chargeableEnemies(battle)).toEqual([near]);

    battle.execute(attackAction(adjacent));
    expect(chargeableEnemies(battle)).toEqual([]);
  });
});
