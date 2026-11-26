// `narrated` is how the arena learns what an action did: it reads the log lines the action wrote.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { attackAction, tripAction } from '../src/engine/combat-action';
import { narrated } from '../src/game/turn-narration';
import { combatant } from './support/character-builder';

const fighter = (name: string, x: number, side: 'A' | 'B') => combatant(name).bab(1).at(x, 0).on(side).build();

describe('narrated', () => {
  it('returns the log lines the action wrote, in the engine’s words', () => {
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(20, 1, 15, 4), [attacker, target]);

    const narration = narrated(battle, () => battle.execute(attackAction(target)));

    expect(narration.error).toBeNull();
    expect(narration.lines).toEqual(['A1 hits B1 for 4 (attack d20:15 +1 BAB = 16 vs AC 10; damage 1d8:4).']);
  });

  it('reports the engine’s refusal instead of throwing', () => {
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 3, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(20, 1), [attacker, target]);

    const narration = narrated(battle, () => battle.execute(attackAction(target)));

    expect(narration.lines).toEqual([]);
    expect(narration.error).toBe('B1 is not within melee reach.');
  });

  it('keeps the lines written before a late refusal, with the refusal', () => {
    // A trip resolves the target's attack of opportunity and its own touch attack before it finds
    // the standard action already spent: those log lines are real and stay in the narration.
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(1, 20, 2, 15, 4, 8, 9, 5, 5), [attacker, target]);
    battle.endTurn(); // B1's turn passes so B1 is no longer flat-footed
    battle.execute(attackAction(target));

    const narration = narrated(battle, () => battle.execute(tripAction(target)));

    expect(narration.lines).toHaveLength(2);
    expect(narration.lines[0]).toMatch(/^Attack of opportunity — B1/);
    expect(narration.lines[1]).toBe('A1 fails to reach B1 for a trip.');
    expect(narration.error).toBe('The standard action has already been used this turn.');
  });

  it('leaves round separators out', () => {
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(20, 1), [attacker, target]);
    battle.endTurn();

    const narration = narrated(battle, () => battle.endTurn());

    expect(battle.log.some((entry) => entry.event === 'RoundSeparator')).toBe(true);
    expect(narration.lines).toEqual([]);
    expect(narration.error).toBeNull();
  });
});

describe('the damage a narrated act dealt', () => {
  it('names who lost hit points and how many, for a hit', () => {
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(20, 1, 15, 4), [attacker, target]);

    const narration = narrated(battle, () => battle.execute(attackAction(target)));

    expect(narration.damage).toEqual([{ victim: target, amount: 4 }]);
  });

  it('is empty for a miss', () => {
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(20, 1, 2), [attacker, target]);

    expect(narrated(battle, () => battle.execute(attackAction(target))).damage).toEqual([]);
  });

  it('counts the attack of opportunity the act provoked against the actor', () => {
    // A trip draws the target's attack of opportunity first: the tripper is the one who bleeds.
    const attacker = fighter('A1', 0, 'A');
    const target = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(5, 5), new SequenceRandom(1, 20, 15, 6, 2), [attacker, target]);
    battle.endTurn(); // B1's turn passes so B1 is no longer flat-footed

    const narration = narrated(battle, () => battle.execute(tripAction(target)));

    expect(narration.damage).toEqual([{ victim: attacker, amount: 6 }]);
  });
});
