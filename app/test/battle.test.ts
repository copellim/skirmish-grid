// `Battle` as the single authority over what a combatant may do — action economy, occupancy, reach,
// the turn order underneath it, and the side-based end of the fight — plus the gaps a code review
// found once the rules started interacting (rage buffer, coup de grâce with sneak dice, a disarmed
// archer, the two-handed disarm bonus, Power Attack inside a full attack).

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom, SeededRandom } from '../src/engine/random';
import { TurnManager } from '../src/engine/turn-manager';
import { CombatEngine } from '../src/engine/combat-engine';
import { Character } from '../src/engine/character';
import { Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import { Weapons } from '../src/engine/catalogs';
import { PowerAttackFeat } from '../src/engine/feat';
import { chooseAction } from '../src/engine/dumb-ai';
import {
  attackAction,
  disarmAction,
  doubleMoveAction,
  fullAttackAction,
  moveAction,
} from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const longsword = () => new Weapon('Longsword', DiceExpression.parse('1d8'), 19, 2);
const fist = () => new Weapon('Fist', DiceExpression.parse('1d3'), 20, 2);

/** STR 16 (+3), 12 HP, BAB 1, speed 30 — small hit points keep the arithmetic short. */
const hero = (name: string, x: number, y: number, side: 'A' | 'B' = 'A'): Character =>
  combatant(name).str(16).hp(12).bab(1).wielding(longsword()).at(x, y).on(side).build();

// Initiative 2 then 1: the first listed combatant acts first.
const duel = (first: Character, second: Character, laterRolls: number[] = [], size = 10): Battle =>
  new Battle(new Grid(size, size), new SequenceRandom(2, 1, ...laterRolls), [first, second]);

describe('Battle validates the actions it is handed', () => {
  it('moves the actor and spends the move', () => {
    const actor = hero('Hero', 0, 0);
    const battle = duel(actor, hero('Rival', 9, 9));

    battle.execute(moveAction({ x: 3, y: 0 }));

    expect(actor.position).toEqual({ x: 3, y: 0 });
    expect(battle.hasMovementAvailable).toBe(false);
    expect(battle.log.length).toBeGreaterThan(0);
  });

  it('refuses a move beyond the speed', () => {
    const battle = duel(hero('Hero', 0, 0), hero('Rival', 9, 9));

    expect(() => battle.execute(moveAction({ x: 7, y: 0 }))).toThrow(); // 35 ft on a 30-ft speed
  });

  it('refuses an occupied square', () => {
    const battle = duel(hero('Hero', 0, 0), hero('Rival', 1, 0));

    expect(() => battle.execute(moveAction({ x: 1, y: 0 }))).toThrow();
  });

  it('refuses a square off the grid', () => {
    const battle = duel(hero('Hero', 0, 0), hero('Rival', 9, 9));

    expect(() => battle.execute(moveAction({ x: -1, y: 0 }))).toThrow();
  });

  it('resolves an attack on an adjacent target and spends the standard action', () => {
    const attacker = hero('Hero', 0, 0);
    const target = hero('Rival', 1, 0);
    const battle = duel(attacker, target, [10, 5]);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(true);
    expect(target.currentHitPoints).toBe(4);
    expect(battle.hasStandardActionAvailable).toBe(false);
  });

  it('refuses an attack out of reach', () => {
    const target = hero('Rival', 5, 0);
    const battle = duel(hero('Hero', 0, 0), target);

    expect(() => battle.execute(attackAction(target))).toThrow();
  });

  it('refuses a second attack in the same turn', () => {
    const target = hero('Rival', 1, 0);
    const battle = duel(hero('Hero', 0, 0), target, [10, 5]);
    battle.execute(attackAction(target));

    expect(() => battle.execute(attackAction(target))).toThrow();
  });

  it('hands the turn on', () => {
    const battle = duel(hero('Hero', 0, 0), hero('Rival', 9, 9));

    expect(battle.currentActor.name).toBe('Hero');
    battle.endTurn();
    expect(battle.currentActor.name).toBe('Rival');
  });

  it('reports the winner once one side is out', () => {
    const survivor = hero('Hero', 0, 0);
    const rival = hero('Rival', 1, 0, 'B');
    const battle = duel(survivor, rival);

    rival.takeDamage(100);

    expect(battle.isOver).toBe(true);
    expect(battle.winner).toBe(survivor);
  });
});

describe('double move', () => {
  it('covers twice the speed and costs the whole round', () => {
    const runner = hero('Hero', 0, 0);
    const battle = duel(runner, hero('Rival', 19, 19), [], 20);

    battle.execute(doubleMoveAction({ x: 12, y: 0 })); // 60 ft

    expect(runner.position).toEqual({ x: 12, y: 0 });
    expect(battle.hasMovementAvailable).toBe(false);
    expect(battle.hasStandardActionAvailable).toBe(false);
  });

  it('refuses one square further', () => {
    const battle = duel(hero('Hero', 0, 0), hero('Rival', 19, 19), [], 20);

    expect(() => battle.execute(doubleMoveAction({ x: 13, y: 0 }))).toThrow(); // 65 ft
  });

  it('refuses once the standard action is gone', () => {
    const target = hero('Rival', 1, 0);
    const battle = duel(hero('Hero', 0, 0), target, [10, 5]);
    battle.execute(attackAction(target));

    expect(() => battle.execute(doubleMoveAction({ x: 0, y: 6 }))).toThrow();
  });

  it('provokes on the way out, like any other move', () => {
    // The rival acts first, so it is no longer flat-footed when the runner leaves.
    const runner = hero('Hero', 0, 0);
    const battle = duel(hero('Rival', 1, 0, 'B'), runner, [10, 5]);
    battle.endTurn();

    battle.execute(doubleMoveAction({ x: 0, y: 9 }));

    expect(runner.currentHitPoints).toBe(4); // 12 − (5 + STR 3)
  });
});

describe('turn order', () => {
  const roller = (name: string, dexterity = 10, side: 'A' | 'B' = 'A'): Character =>
    combatant(name).dex(dexterity).hp(12).wielding(fist()).on(side).build();

  const turnsOf = (rolls: number[], ...combatants: Character[]) =>
    new TurnManager(new SequenceRandom(...rolls), combatants);

  it('sorts by roll plus Dexterity, highest first', () => {
    const fast = roller('Fast', 14);
    const slow = roller('Slow', 10);
    const turns = turnsOf([5, 18], fast, slow); // 7 against 18

    expect(turns.initiativeOrder.map((c) => c.name)).toEqual(['Slow', 'Fast']);
    expect(turns.currentActor.name).toBe('Slow');
  });

  it('breaks a tie on Dexterity', () => {
    const nimble = roller('Nimble', 14);
    const clumsy = roller('Clumsy', 10);

    expect(turnsOf([10, 12], nimble, clumsy).currentActor.name).toBe('Nimble');
  });

  it('cycles round the table', () => {
    const turns = turnsOf([3, 2], roller('A'), roller('B'));

    expect(turns.currentActor.name).toBe('A');
    turns.advanceTurn();
    expect(turns.currentActor.name).toBe('B');
    turns.advanceTurn();
    expect(turns.currentActor.name).toBe('A');
  });

  it('skips whoever is down', () => {
    const first = roller('A');
    const second = roller('B');
    const third = roller('C');
    const turns = turnsOf([3, 2, 1], first, second, third);
    second.takeDamage(100);

    turns.advanceTurn();

    expect(turns.currentActor.name).toBe('C');
  });

  it('knows when the fight is decided', () => {
    const survivor = roller('A', 10, 'A');
    const loser = roller('B', 10, 'B');
    const turns = turnsOf([3, 2], survivor, loser);
    expect(turns.isCombatOver).toBe(false);
    expect(turns.winner).toBeNull();

    loser.takeDamage(100);

    expect(turns.isCombatOver).toBe(true);
    expect(turns.winner).toBe(survivor);
  });

  it('grants a move and a standard action each turn', () => {
    const turns = turnsOf([3, 2], roller('A'), roller('B'));

    expect(turns.hasMovementAvailable).toBe(true);
    expect(turns.hasStandardActionAvailable).toBe(true);
  });

  it('gives them back only on the next turn', () => {
    const turns = turnsOf([3, 2], roller('A'), roller('B'));

    turns.useMovement();
    turns.useStandardAction();
    expect(turns.hasMovementAvailable).toBe(false);
    expect(turns.hasStandardActionAvailable).toBe(false);

    turns.advanceTurn();

    expect(turns.hasMovementAvailable).toBe(true);
    expect(turns.hasStandardActionAvailable).toBe(true);
  });

  it('refuses to spend a move twice', () => {
    const turns = turnsOf([3, 2], roller('A'), roller('B'));
    turns.useMovement();

    expect(() => turns.useMovement()).toThrow();
  });

  it('refuses a fight with fewer than two combatants', () => {
    expect(() => new TurnManager(new SequenceRandom(1), [roller('Lonely')])).toThrow();
  });
});

describe('sides', () => {
  const plain = (name: string, side: 'A' | 'B'): Character =>
    combatant(name).hp(12).wielding(fist()).on(side).build();

  it('are remembered by the combatant', () => {
    expect(plain('Hero', 'A').side).toBe('A');
  });

  it('make enemies only across the line, and never of oneself', () => {
    const first = plain('Hero', 'A');
    const ally = plain('Ally', 'A');
    const foe = plain('Foe', 'B');

    expect(Character.areEnemies(first, foe)).toBe(true);
    expect(Character.areEnemies(first, ally)).toBe(false);
    expect(Character.areEnemies(first, first)).toBe(false);
  });

  it('make allies of two combatants on the same side, but not of one with itself', () => {
    const first = plain('Hero', 'A');
    const ally = plain('Ally', 'A');
    const foe = plain('Foe', 'B');

    expect(Character.areAllies(first, ally)).toBe(true);
    expect(Character.areAllies(first, foe)).toBe(false);
    expect(Character.areAllies(first, first)).toBe(false);
  });
});

describe('two against two', () => {
  const squad = () => {
    const allyOne = combatant('A1').at(0, 0).on('A').build();
    const allyTwo = combatant('A2').at(0, 1).on('A').build();
    const foeOne = combatant('B1').at(9, 9).on('B').build();
    const foeTwo = combatant('B2').at(9, 8).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(18, 14, 10, 6), [
      allyOne,
      allyTwo,
      foeOne,
      foeTwo,
    ]);
    return { allyOne, allyTwo, foeOne, foeTwo, battle };
  };

  it('keeps going while both sides have someone standing', () => {
    expect(squad().battle.isOver).toBe(false);
  });

  it('ends when a whole side is down', () => {
    const { battle, foeOne, foeTwo } = squad();

    foeOne.takeDamage(1000);
    foeTwo.takeDamage(1000);

    expect(battle.isOver).toBe(true);
    expect(battle.winningSide).toBe('A');
  });

  it('does not end while one of the two is still conscious', () => {
    const { battle, foeOne } = squad();

    foeOne.takeDamage(1000);

    expect(battle.isOver).toBe(false);
  });

  it('bleeds a dying member each round while their ally fights on', () => {
    const ally = combatant('A1').hp(10).on('A').at(0, 0).build();
    const foe = combatant('B1').hp(10).on('B').at(9, 9).build();
    const downed = combatant('B2').hp(10).on('B').at(8, 8).build();
    downed.takeDamage(12); // −2 → Dying
    // Initiative 15/10/5, then the bleeding combatant's failed percentile roll (55).
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(15, 10, 5, 55), [ally, foe, downed]);
    expect(battle.isOver).toBe(false);

    battle.endTurn(); // → B1
    battle.endTurn(); // → B2, who keeps their slot in the order
    battle.endTurn(); // → A1: the round is over, and the dying member loses a hit point

    expect(downed.vitalStatus).toBe('Dying');
    expect(downed.currentHitPoints).toBe(-3);
    expect(battle.isOver).toBe(false);
  });

  it('ends a one-on-one at zero hit points, with no bleeding at all', () => {
    const player = combatant('P').hp(10).on('A').at(0, 0).build();
    const cpu = combatant('C').hp(10).on('B').at(1, 0).build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(15, 10), [player, cpu]);

    cpu.takeDamage(10); // exactly 0 → staggered, and alone on its side

    expect(battle.isOver).toBe(true);
    expect(battle.winningSide).toBe('A');
  });

  it('flanks with two allies either side of a foe', () => {
    const allyOne = combatant('A1').at(0, 1).on('A').build();
    const allyTwo = combatant('A2').at(2, 1).on('A').build();
    const foe = combatant('B1').at(1, 1).on('B').build();
    const bystander = combatant('B2').at(9, 9).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(18, 14, 10, 6), [
      allyOne,
      allyTwo,
      foe,
      bystander,
    ]);

    expect(battle.isFlanking(allyOne, foe)).toBe(true);
  });
});

describe('rules that only bite where they meet', () => {
  // SRD Barbarian: "(These extra hit points are not lost first the way temporary hit points are.)"
  // Damage comes off normally and the whole 2-per-level goes back at the end.
  it('takes damage off the real total, not off the rage bonus first', () => {
    const barbarian = combatant('Barb').hp(20).barbarianAt(2).build();

    barbarian.enterRage(0); // +4 while raging → 24
    barbarian.takeDamage(10); // 24 − 10 = 14
    barbarian.endRage(); // and the +4 goes away: 10

    expect(barbarian.currentHitPoints).toBe(10);
  });

  it('takes the whole bonus back at the end, however little damage landed', () => {
    const barbarian = combatant('Barb').hp(20).barbarianAt(2).build();

    barbarian.enterRage(0);
    barbarian.takeDamage(2); // 24 − 2 = 22
    barbarian.endRage(); // 22 − 4 = 18

    expect(barbarian.currentHitPoints).toBe(18);
  });

  it('adds a rogue’s sneak dice to a coup de grâce', () => {
    // Auto-crit dagger ×2: 4+4 = 8, plus 3d6 sneak = 3 → 11. Fortitude save on a natural 20 holds.
    const rogue = combatant('Rogue').sneakDice(3).wielding(Weapons.dagger()).build();
    const target = combatant('Victim').hp(50).on('B').build();

    const result = new CombatEngine(new SequenceRandom(4, 4, 1, 1, 1, 20)).resolveCoupDeGrace(rogue, target);

    expect(result.damage).toBe(11);
    expect(result.saveResult.succeeded).toBe(true);
    expect(target.currentHitPoints).toBe(39);
  });

  it('leaves the sneak component out for someone with no sneak dice', () => {
    const fighter = combatant('Fighter').wielding(Weapons.dagger()).build();
    const target = combatant('Victim').hp(50).on('B').build();

    const result = new CombatEngine(new SequenceRandom(4, 4, 20)).resolveCoupDeGrace(fighter, target);

    expect(result.damage).toBe(8);
  });

  it('grounds a disarmed archer: an unarmed strike does not reach across the field', () => {
    const archer = combatant('Archer').wielding(Weapons.shortbow()).at(0, 0).on('A').build();
    archer.markDisarmed();
    const enemy = combatant('Enemy').at(5, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(10, 5), [archer, enemy]);

    expect(() => battle.execute(attackAction(enemy))).toThrow();
  });

  it('lets that same archer punch whoever is next to them', () => {
    const archer = combatant('Archer').wielding(Weapons.shortbow()).at(0, 0).on('A').build();
    archer.markDisarmed();
    const enemy = combatant('Enemy').hp(20).at(1, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(10, 5, 15, 2), [archer, enemy]);

    const result = battle.execute(attackAction(enemy));

    expect(result?.hit).toBe(true);
    expect(enemy.currentHitPoints).toBe(18);
  });

  // The target goes first and passes, then its attack of opportunity misses (8 + 1 against AC 10),
  // so the opposed roll of 10 against 13 is all that is left: 10 + 1 + 4 = 15 beats 13 + 1 = 14.
  const DISARM_CONTEST_ROLLS = [5, 10, 8, 10, 13, 1, 20];

  it('gives a two-handed weapon +4 to disarm, which decides the contest', () => {
    const attacker = combatant('Attacker').bab(1).wielding(Weapons.greatsword()).at(0, 0).on('A').build();
    const target = combatant('Target').bab(1).at(1, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(...DISARM_CONTEST_ROLLS), [attacker, target]);
    battle.endTurn();

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(true);
  });

  it('loses the same contest one-handed, on the very same rolls', () => {
    const attacker = combatant('Attacker').bab(1).wielding(Weapons.longsword()).at(0, 0).on('A').build();
    const target = combatant('Target').bab(1).at(1, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(...DISARM_CONTEST_ROLLS), [attacker, target]);
    battle.endTurn();

    battle.execute(disarmAction(target));

    // 11 against 14: the counter-disarm the loss opens (1 + 1 against 20 + 1) fails in its turn.
    expect(target.isDisarmed).toBe(false);
    expect(attacker.isDisarmed).toBe(false);
  });

  it('applies the Power Attack bonus to every hit of a full attack', () => {
    // Penalty 1 one-handed → +1 damage each: two hits of 1d8(5) + STR(2) + 1.
    const attacker = combatant('Attacker').str(14).bab(6).wielding(Weapons.longsword()).at(0, 0).on('A').build();
    attacker.addFeat(new PowerAttackFeat());
    const target = combatant('Target').hp(50).at(1, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(10, 5, 15, 5, 10, 5), [attacker, target]);

    battle.execute(fullAttackAction(target, 1));

    expect(target.currentHitPoints).toBe(34);
  });
});

describe('a whole fight, played by the AI', () => {
  const SAFETY_TURN_LIMIT = 1000;

  const runDuel = (seed: number): Battle => {
    const battle = new Battle(new Grid(10, 10), new SeededRandom(seed), [
      combatant('A').str(16).dex(13).con(14).wis(12).cha(8).hp(12).bab(1).wielding(longsword()).at(1, 5).on('A').build(),
      combatant('B').str(16).dex(13).con(14).wis(12).cha(8).hp(12).bab(1).wielding(longsword()).at(8, 5).on('B').build(),
    ]);
    let turns = 0;
    while (!battle.isOver && turns++ < SAFETY_TURN_LIMIT) {
      for (let action = chooseAction(battle); action !== null; action = chooseAction(battle)) {
        battle.execute(action);
      }
      battle.endTurn();
    }
    return battle;
  };

  it('terminates with a winner', () => {
    const battle = runDuel(12345);

    expect(battle.isOver).toBe(true);
    expect(battle.winner).not.toBeNull();
    expect(battle.log.length).toBeGreaterThan(0);
  });

  it('plays out identically for the same seed', () => {
    const first = runDuel(999);
    const second = runDuel(999);

    expect(first.winner!.name).toBe(second.winner!.name);
    expect(first.log).toEqual(second.log);
  });
});
