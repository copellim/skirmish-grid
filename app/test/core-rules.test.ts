// The rules everything else is built on: the grid and its 5/10/5 diagonals, the d20 check, saving
// throws, and the attack resolution's own arithmetic. `combat.test.ts` and `dice.test.ts` cover the
// happy paths; this covers the boundaries and the breakdown the UI reads out of an attack result.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom, SeededRandom } from '../src/engine/random';
import { CombatEngine } from '../src/engine/combat-engine';
import { Character } from '../src/engine/character';
import { Armor, Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import { rollD20Check } from '../src/engine/d20-check';
import { resolveSavingThrow } from '../src/engine/saving-throws';
import { Weapons } from '../src/engine/catalogs';
import { tripAction } from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

describe('the grid', () => {
  it('knows which squares it holds', () => {
    const grid = new Grid(10, 10);

    expect(grid.contains({ x: 0, y: 0 })).toBe(true);
    expect(grid.contains({ x: 9, y: 9 })).toBe(true);
    expect(grid.contains({ x: 10, y: 0 })).toBe(false);
    expect(grid.contains({ x: 0, y: -1 })).toBe(false);
  });

  it.each([[0], [-1]])('refuses a dimension of %i', (dimension) => {
    expect(() => new Grid(dimension, 10)).toThrow();
    expect(() => new Grid(10, dimension)).toThrow();
  });

  it.each([
    [0, 0, 0, 0, 0], // the same square
    [0, 0, 0, 3, 15], // three orthogonal steps
    [0, 0, 1, 1, 5], // one diagonal
    [0, 0, 2, 2, 15], // 5 + 10
    [0, 0, 3, 3, 20], // 5 + 10 + 5
    [0, 0, 4, 4, 30], // 5 + 10 + 5 + 10
    [0, 0, 3, 1, 15], // a diagonal plus two orthogonals
    [5, 5, 2, 2, 20], // the same count of diagonals, walked backwards
  ])('costs (%i,%i)→(%i,%i) %i feet', (fromX, fromY, toX, toY, expected) => {
    expect(Grid.movementCost({ x: fromX, y: fromY }, { x: toX, y: toY })).toBe(expected);
  });

  it.each([
    [0, 0, 1, 0, true], // orthogonal neighbour
    [0, 0, 1, 1, true], // diagonal neighbour
    [0, 0, 2, 0, false], // two squares away
    [0, 0, 0, 0, false], // a square is not adjacent to itself
  ])('says (%i,%i) and (%i,%i) adjacent: %s', (aX, aY, bX, bY, adjacent) => {
    expect(Grid.areAdjacent({ x: aX, y: aY }, { x: bX, y: bY })).toBe(adjacent);
  });
});

describe('the d20 check', () => {
  it('reports the natural face and the modified total', () => {
    const result = rollD20Check(new SequenceRandom(14), 3);

    expect(result.naturalRoll).toBe(14);
    expect(result.total).toBe(17);
  });

  it('subtracts a negative modifier', () => {
    expect(rollD20Check(new SequenceRandom(10), -2).total).toBe(8);
  });
});

describe('saving throws', () => {
  // DEX 16 (+3), CON 14 (+2), WIS 12 (+1): each save draws on a different ability, so the totals
  // below say which one was used.
  const saver = (fortitude = 0, reflex = 0, will = 0): Character =>
    combatant('Saver').dex(16).con(14).wis(12).hp(20).saves(fortitude, reflex, will).build();

  it('adds base and Constitution for Fortitude', () => {
    const result = resolveSavingThrow(new SequenceRandom(10), saver(4), 'Fortitude', 16);

    expect(result.total).toBe(16);
    expect(result.succeeded).toBe(true);
  });

  it('adds base and Dexterity for Reflex', () => {
    const result = resolveSavingThrow(new SequenceRandom(11), saver(0, 1), 'Reflex', 16);

    expect(result.total).toBe(15);
    expect(result.succeeded).toBe(false);
  });

  it('adds base and Wisdom for Will', () => {
    expect(resolveSavingThrow(new SequenceRandom(15), saver(0, 0, 2), 'Will', 18).succeeded).toBe(true);
  });

  it('fails on a natural 1 even when the total clears the DC', () => {
    const result = resolveSavingThrow(new SequenceRandom(1), saver(20), 'Fortitude', 5);

    expect(result.total).toBe(23);
    expect(result.succeeded).toBe(false);
  });

  it('succeeds on a natural 20 even when the total falls far short', () => {
    const result = resolveSavingThrow(new SequenceRandom(20), saver(), 'Will', 50);

    expect(result.total).toBe(21);
    expect(result.succeeded).toBe(true);
  });
});

describe('attack resolution', () => {
  // STR 16 (+3) and BAB 1 unless stated: an attack bonus of +4 with a longsword (19–20/×2).
  const attacker = (strength = 16, baseAttackBonus = 1, weapon = Weapons.longsword()): Character =>
    combatant('Attacker').str(strength).hp(12).bab(baseAttackBonus).wielding(weapon).build();
  /** Dexterity 10, so the defender's AC is 10 plus whatever armor we hang on them. */
  const defender = (armorClass: number): Character => {
    const builder = combatant('Defender').hp(100).wielding(new Weapon('Fist', DiceExpression.parse('1d3'), 20, 2)).at(1, 0).on('B');
    return (armorClass > 10 ? builder.wearing(new Armor('Test plating', armorClass - 10, 8, 'Light')) : builder).build();
  };
  const greatsword = () =>
    new Weapon('Greatsword', DiceExpression.parse('2d6'), 19, 2, 'Melee', 5, 0, null, 'TwoHanded');

  it('deals weapon dice plus the Strength modifier on a plain hit', () => {
    const target = defender(10);

    const result = new CombatEngine(new SequenceRandom(10, 5)).resolveAttack(attacker(), target);

    expect(result.hit).toBe(true);
    expect(result.wasCritical).toBe(false);
    expect(result.damage).toBe(8);
    expect(target.currentHitPoints).toBe(92);
  });

  it('misses when the total falls short, without rolling damage', () => {
    const target = defender(15);

    const result = new CombatEngine(new SequenceRandom(2)).resolveAttack(attacker(), target);

    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
    expect(target.currentHitPoints).toBe(100);
  });

  it('misses on a natural 1 against an AC it would otherwise beat', () => {
    expect(new CombatEngine(new SequenceRandom(1)).resolveAttack(attacker(), defender(10)).hit).toBe(false);
  });

  it('hits on a natural 20, but stays an ordinary hit if the confirmation fails', () => {
    const result = new CombatEngine(new SequenceRandom(20, 2, 4)).resolveAttack(attacker(), defender(30));

    expect(result.hit).toBe(true);
    expect(result.wasCritical).toBe(false);
    expect(result.confirmationRoll).toBe(2);
    expect(result.damage).toBe(7); // die 4 + STR 3, unmultiplied
  });

  it('multiplies dice and modifier alike on a confirmed threat', () => {
    const target = defender(10);

    const result = new CombatEngine(new SequenceRandom(19, 10, 8, 8)).resolveAttack(attacker(), target);

    expect(result.wasCritical).toBe(true);
    expect(result.damageDiceRoll).toBe(16);
    expect(result.damageModifier).toBe(6);
    expect(result.damage).toBe(22);
    expect(target.currentHitPoints).toBe(78);
  });

  it('never deals less than a point on a hit, however weak the attacker', () => {
    // STR 6 is −2: a die of 1 would otherwise be −1 damage.
    const result = new CombatEngine(new SequenceRandom(12, 1)).resolveAttack(attacker(6), defender(10));

    expect(result.damage).toBe(1);
  });

  it('reports the attack roll broken into its parts', () => {
    const result = new CombatEngine(new SequenceRandom(10, 5)).resolveAttack(attacker(), defender(10), {
      attackBonus: 2,
      sneakAttackApplies: false,
      powerAttackDamageBonus: 0,
    });

    expect(result.baseAttackBonus).toBe(1);
    expect(result.abilityAttackModifier).toBe(3);
    expect(result.situationalAttackBonus).toBe(2);
    expect(result.attackTotal).toBe(
      result.attackRoll + result.baseAttackBonus + result.abilityAttackModifier + result.situationalAttackBonus,
    );
  });

  it('reports the damage split between dice and modifier', () => {
    const result = new CombatEngine(new SequenceRandom(10, 5)).resolveAttack(attacker(), defender(10));

    expect(result.damageDiceRoll).toBe(5);
    expect(result.damageModifier).toBe(3);
    expect(result.damage).toBe(8);
  });

  it('adds one and a half times Strength for a two-handed weapon', () => {
    const result = new CombatEngine(new SequenceRandom(10, 4, 4)).resolveAttack(
      attacker(14, 2, greatsword()),
      defender(10),
    );

    expect(result.damageDiceRoll).toBe(8);
    expect(result.damageModifier).toBe(3); // floor(2 × 1.5)
    expect(result.damage).toBe(11);
  });

  // SRD Damage, Wielding a Weapon Two-Handed: "you add 1½ times your Strength bonus" — a penalty
  // is not a bonus, so it reaches the damage whole.
  it('leaves a Strength penalty unmultiplied', () => {
    const result = new CombatEngine(new SequenceRandom(15, 5, 5)).resolveAttack(
      attacker(6, 0, greatsword()),
      defender(10),
    );

    expect(result.damageModifier).toBe(-2);
    expect(result.damage).toBe(8);
  });

  it('adds nothing at Strength 10, two-handed or not', () => {
    const result = new CombatEngine(new SequenceRandom(10, 3, 3)).resolveAttack(
      attacker(10, 1, greatsword()),
      defender(10),
    );

    expect(result.damageModifier).toBe(0);
    expect(result.damage).toBe(6);
  });

  it('adds plain Strength for a one-handed weapon', () => {
    const result = new CombatEngine(new SequenceRandom(10, 5)).resolveAttack(attacker(14), defender(10));

    expect(result.damageModifier).toBe(2);
    expect(result.damage).toBe(7);
  });

  it('uses Dexterity to hit and no ability at all on ranged damage', () => {
    const archer = attacker(16, 1, Weapons.shortbow());

    const result = new CombatEngine(new SequenceRandom(15, 4)).resolveAttack(archer, defender(10));

    expect(result.abilityAttackModifier).toBe(0); // Dex 10, not the +3 Strength
    expect(result.damageModifier).toBe(0);
    expect(result.damageDiceRoll).toBe(4);
  });

  // SRD Damage, Strength Bonus: "When you hit with a melee or thrown weapon, including a sling,
  // add your Strength modifier to the damage result."
  it('adds Strength to sling damage', () => {
    const slinger = combatant('Slinger').str(16).dex(12).hp(20).bab(1).wielding(Weapons.sling()).build();
    const target = combatant('Target').hp(50).at(1, 0).on('B').build();

    const result = new CombatEngine(new SequenceRandom(15, 3)).resolveAttack(slinger, target);

    expect(result.damageModifier).toBe(3);
    expect(result.damage).toBe(6);
  });

  // SRD: "A Strength penalty, but not a bonus, applies on attacks made with a bow that is not a
  // composite bow."
  it('carries a Strength penalty onto a bow, but never a bonus', () => {
    const weakling = attacker(6, 1, Weapons.shortbow());

    const result = new CombatEngine(new SequenceRandom(15, 5)).resolveAttack(weakling, defender(10));

    expect(result.damageModifier).toBe(-2);
    expect(result.damage).toBe(3);
  });

  it('spares a crossbow the Strength penalty a bow would take', () => {
    const weakling = attacker(6, 1, Weapons.lightCrossbow());

    const result = new CombatEngine(new SequenceRandom(15, 5)).resolveAttack(weakling, defender(10));

    expect(result.damageModifier).toBe(0);
    expect(result.damage).toBe(5);
  });
});

describe('transient ability changes reach the resolution, not just the display', () => {
  it('carries the rage Strength bonus into the attack roll', () => {
    const barbarian = combatant('Barb').bab(0).barbarianAt(1).wielding(Weapons.longsword()).build();
    barbarian.enterRage(0); // +4 Strength → +2 on the modifier
    const target = combatant('Target').hp(30).build();
    target.applyArmorClassModifier(6); // AC 16, which only the rage bonus can reach

    const result = new CombatEngine(new SequenceRandom(14, 5)).resolveAttack(barbarian, target);

    expect(result.hit).toBe(true);
  });

  it('carries it into the damage too', () => {
    const barbarian = combatant('Barb').bab(0).barbarianAt(1).wielding(Weapons.longsword()).build();
    barbarian.enterRage(0);
    const target = combatant('Target').hp(30).build();

    new CombatEngine(new SequenceRandom(15, 5)).resolveAttack(barbarian, target);

    expect(target.currentHitPoints).toBe(23); // 5 + 2
  });

  it('carries the fatigue penalty into the damage', () => {
    const fighter = combatant('Fighter').str(14).bab(0).wielding(Weapons.longsword()).build();
    fighter.markFatigued(); // +2 Strength modifier down to +0
    const target = combatant('Target').hp(30).build();

    new CombatEngine(new SequenceRandom(15, 5)).resolveAttack(fighter, target);

    expect(target.currentHitPoints).toBe(25);
  });

  it('carries the rage bonus into an opposed manoeuvre', () => {
    const barbarian = combatant('Barb').barbarianAt(1).at(0, 0).on('A').build();
    barbarian.enterRage(0);
    const target = combatant('Target').at(1, 0).on('B').build();
    // The target goes first and passes; then its attack of opportunity misses (7 against the
    // rager's AC 8), the trip's touch attack lands, and the opposed check is 8 + 2 against 10 + 0
    // — the tie goes to the attacker only because the rage is in the modifier.
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(5, 10, 7, 9, 8, 10), [barbarian, target]);
    battle.endTurn();

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(true);
  });
});

describe('the character sheet', () => {
  it('combines the base attack bonus with the ability each attack kind uses', () => {
    const fighter = combatant('Fighter').str(16).dex(14).hp(12).bab(1).wielding(Weapons.longsword()).build();

    expect(fighter.meleeAttackBonus).toBe(1 + 3);
    expect(fighter.rangedAttackBonus).toBe(1 + 2);
  });

  it('reports each combatant’s initiative as rolled plus Dexterity', () => {
    const first = combatant('First').hp(12).bab(1).build();
    const second = combatant('Second').dex(14).hp(12).bab(1).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(5, 8), [first, second]);

    expect(battle.initiativeOf(first)).toBe(5);
    expect(battle.initiativeOf(second)).toBe(10);
  });
});

describe('the seeded generator', () => {
  it('repeats itself for the same seed', () => {
    const draw = (seed: number) => {
      const random = new SeededRandom(seed);
      return Array.from({ length: 20 }, () => random.next(1, 21));
    };

    expect(draw(2024)).toEqual(draw(2024));
  });

  it('diverges for different seeds', () => {
    const first = new SeededRandom(1);
    const second = new SeededRandom(2);
    const firstDraws = Array.from({ length: 20 }, () => first.next(1, 21));
    const secondDraws = Array.from({ length: 20 }, () => second.next(1, 21));

    expect(firstDraws).not.toEqual(secondDraws);
  });

  it('does not collapse to a constant on seed zero', () => {
    const random = new SeededRandom(0);
    const draws = Array.from({ length: 20 }, () => random.next(1, 21));

    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it('stays inside the requested range, and covers a whole die', () => {
    const random = new SeededRandom(7);
    const faces = Array.from({ length: 600 }, () => random.next(1, 7));

    expect(Math.min(...faces)).toBe(1);
    expect(Math.max(...faces)).toBe(6);
    expect(new Set(faces).size).toBe(6);
  });
});
