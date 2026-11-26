import { describe, it, expect } from 'vitest';
import { Grid } from '../src/engine/grid';
import { isLineOfSightClear } from '../src/engine/line-of-sight';
import { CombatEngine } from '../src/engine/combat-engine';
import { resolveSavingThrow } from '../src/engine/saving-throws';
import { resolveOpposedCheck, attackerWins } from '../src/engine/opposed-check';
import { Character } from '../src/engine/character';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { Weapons } from '../src/engine/catalogs';
import { SequenceRandom } from '../src/engine/random';
import { Battle } from '../src/engine/battle';
import { moveAction } from '../src/engine/combat-action';

const abil = (str = 10, dex = 10, con = 10) =>
  new AbilitySet(
    new AbilityScore(str),
    new AbilityScore(dex),
    new AbilityScore(con),
    new AbilityScore(10),
    new AbilityScore(10),
    new AbilityScore(10),
  );

const fighter = (str: number, weapon = Weapons.longsword(), hp = 20) =>
  new Character('F', abil(str), hp, 1, 30, weapon, { x: 0, y: 0 }, 'A');

describe('Grid', () => {
  it('uses SRD 5/10/5 alternating diagonal cost', () => {
    expect(Grid.movementCost({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(5); // 1 diagonal
    expect(Grid.movementCost({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(15); // 5 + 10
    expect(Grid.movementCost({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(20); // 5 + 10 + 5
    expect(Grid.movementCost({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(15); // straight
  });

  it('adjacency excludes the same square', () => {
    expect(Grid.areAdjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(Grid.areAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(Grid.areAdjacent({ x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });
});

describe('line of sight', () => {
  it('is clear with no blockers and blocked by an interior square', () => {
    expect(isLineOfSightClear({ x: 0, y: 0 }, { x: 4, y: 0 }, () => false)).toBe(true);
    const blocker = { x: 2, y: 0 };
    expect(
      isLineOfSightClear({ x: 0, y: 0 }, { x: 4, y: 0 }, (p) => p.x === blocker.x && p.y === blocker.y),
    ).toBe(false);
  });
});

describe('saving throws', () => {
  it('natural 1 always fails, natural 20 always succeeds', () => {
    const c = fighter(10);
    expect(resolveSavingThrow(new SequenceRandom(1), c, 'Fortitude', 2).succeeded).toBe(false);
    expect(resolveSavingThrow(new SequenceRandom(20), c, 'Fortitude', 99).succeeded).toBe(true);
  });
});

describe('opposed check', () => {
  it('gives ties to the attacker', () => {
    const tie = resolveOpposedCheck(new SequenceRandom(10, 10), 0, 0);

    expect(attackerWins(tie)).toBe(true);
    expect(attackerWins(resolveOpposedCheck(new SequenceRandom(2, 20), 0, 0))).toBe(false);
  });
});

describe('CombatEngine.resolveAttack', () => {
  it('natural 1 misses, no damage', () => {
    const engine = new CombatEngine(new SequenceRandom(1));
    const result = engine.resolveAttack(fighter(16), fighter(10));
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
  });

  it('a hit deals weapon dice + STR modifier', () => {
    // STR16 (+3), BAB1, longsword 1d8 (threat 19). Roll 10 → total 14 ≥ AC; not a threat.
    const engine = new CombatEngine(new SequenceRandom(10, 5));
    const target = fighter(10);
    const result = engine.resolveAttack(fighter(16), target);
    expect(result.hit).toBe(true);
    expect(result.wasCritical).toBe(false);
    expect(result.damage).toBe(5 + 3);
  });

  it('a confirmed critical multiplies dice and modifier', () => {
    // Roll 19 (threat) → hit; confirm 15 → crit (×2). Dice 5 + 4, modifier 3×2.
    const engine = new CombatEngine(new SequenceRandom(19, 15, 5, 4));
    const result = engine.resolveAttack(fighter(16), fighter(10));
    expect(result.wasCritical).toBe(true);
    expect(result.damage).toBe(5 + 4 + 3 * 2);
  });

  it('two-handed melee adds 1.5× STR to damage', () => {
    // Greatsword 2d6, STR16 → floor(3×1.5)=4. Roll 10 → hit; dice 3+2; +4.
    const engine = new CombatEngine(new SequenceRandom(10, 3, 2));
    const attacker = new Character('GS', abil(16), 20, 1, 30, Weapons.greatsword(), { x: 0, y: 0 }, 'A');
    const result = engine.resolveAttack(attacker, fighter(10));
    expect(result.damage).toBe(3 + 2 + 4);
  });
});

describe('Battle.executedEvents', () => {
  it('attributes every action and turn end to the combatant on turn, in its round', () => {
    const first = new Character('First', abil(10, 18), 20, 1, 30, Weapons.longsword(), { x: 0, y: 0 }, 'A');
    const second = new Character('Second', abil(10, 1), 20, 1, 30, Weapons.longsword(), { x: 5, y: 5 }, 'B');
    // Initiative is rolled in the constructor: DEX 18 (+4) vs DEX 1 (−5) on a fixed d20 fixes the order.
    const battle = new Battle(new Grid(12, 12), new SequenceRandom(10, 10), [first, second]);

    battle.execute(moveAction({ x: 1, y: 0 }));
    battle.endTurn();
    battle.execute(moveAction({ x: 4, y: 5 }));
    battle.endTurn(); // wraps to the top of the order → round 2
    battle.execute(moveAction({ x: 2, y: 0 }));

    expect(battle.executedEvents.map((e) => `${e.kind}:${e.actor.name}:${e.turn}`)).toEqual([
      'action:First:1',
      'endTurn:First:1',
      'action:Second:1',
      'endTurn:Second:1',
      'action:First:2',
    ]);
  });

  it('stamps events with the same round the combat log stamps its entries with', () => {
    const first = new Character('First', abil(10, 18), 20, 1, 30, Weapons.longsword(), { x: 0, y: 0 }, 'A');
    const second = new Character('Second', abil(10, 1), 20, 1, 30, Weapons.longsword(), { x: 5, y: 5 }, 'B');
    const battle = new Battle(new Grid(12, 12), new SequenceRandom(10, 10), [first, second]);

    battle.endTurn();
    battle.endTurn();
    battle.execute(moveAction({ x: 1, y: 0 }));

    const lastEvent = battle.executedEvents[battle.executedEvents.length - 1];
    const lastLogEntry = battle.log[battle.log.length - 1];
    expect(lastEvent.turn).toBe(lastLogEntry.turn);
  });
});
