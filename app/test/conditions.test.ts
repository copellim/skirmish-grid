// SRD Condition Summary: https://www.d20srd.org/srd/conditionSummary.htm
//
// Prone, flat-footed, fatigued, raging, and the vitality track (conscious → staggered → dying →
// stable → dead) with the side-based win condition. Plus the transient `Effect` model the temporary
// modifiers ride on.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { TurnManager } from '../src/engine/turn-manager';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { Weapons } from '../src/engine/catalogs';
import { Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import { CharacterClasses, ClassLevel } from '../src/engine/character-class';
import {
  attackAction,
  chargeAction,
  endRageAction,
  moveAction,
  rageAction,
  standUpAction,
  withdrawAction,
} from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const ARENA = 10;

const battleOf = (rolls: number[], ...combatants: Character[]): Battle =>
  new Battle(new Grid(ARENA, ARENA), new SequenceRandom(...rolls), combatants);

describe('prone', () => {
  // Daggers all round (1d4 melee), so the numbers below are only about the ±4 prone modifiers.
  const knifeFighter = (name: string, x: number, y: number, side: 'A' | 'B'): Character =>
    combatant(name).hp(30).bab(1).wielding(Weapons.dagger()).at(x, y).on(side).build();

  it('gives a melee attacker +4 against a prone target', () => {
    // d20 8 (+1 BAB) would miss AC 10; the prone bonus turns it into a hit.
    const attacker = knifeFighter('Attacker', 0, 0, 'A');
    const target = knifeFighter('Target', 0, 1, 'B');
    target.markProne();
    const battle = battleOf([5, 1, 8, 3], attacker, target);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(true);
  });

  it('costs a ranged attacker −4 against a prone target', () => {
    // d20 12 (+1) would hit AC 10; at −4 it misses. Target 25 ft away, so no AoO on the shot.
    const archer = combatant('Archer').hp(30).bab(1).wielding(Weapons.shortbow()).at(0, 0).on('A').build();
    const target = knifeFighter('Target', 0, 5, 'B');
    target.markProne();
    const battle = battleOf([5, 1, 12], archer, target);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(false);
  });

  // SRD Condition Summary, Prone: an attacker who is prone "cannot use a ranged weapon (except for
  // a crossbow)".
  it('refuses a bow to a prone attacker', () => {
    const archer = combatant('Archer').hp(30).bab(1).wielding(Weapons.shortbow()).at(0, 0).on('A').build();
    const target = knifeFighter('Target', 0, 5, 'B');
    archer.markProne();
    const battle = battleOf([5, 1], archer, target);

    expect(() => battle.execute(attackAction(target))).toThrow(/prone/);
  });

  it('lets the same prone attacker fire a crossbow', () => {
    // d20 12 (+1 BAB) against AC 10: a hit, and no −4 — the SRD penalty is on melee attack rolls.
    const shooter = combatant('Shooter').hp(30).bab(1).wielding(Weapons.lightCrossbow()).at(0, 0).on('A').build();
    const target = knifeFighter('Target', 0, 5, 'B');
    shooter.markProne();
    const battle = battleOf([5, 1, 12, 4], shooter, target);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(true);
  });

  it('costs a prone attacker −4 on its own attacks', () => {
    const attacker = knifeFighter('Attacker', 0, 0, 'A');
    const target = knifeFighter('Target', 0, 1, 'B');
    attacker.markProne();
    const battle = battleOf([5, 1, 12], attacker, target);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(false);
  });

  it('stands up for a move action', () => {
    const actor = knifeFighter('Actor', 0, 0, 'A');
    const enemy = knifeFighter('Enemy', 9, 9, 'B');
    actor.markProne();
    const battle = battleOf([5, 1], actor, enemy);

    battle.execute(standUpAction());

    expect(actor.isProne).toBe(false);
    expect(battle.hasMovementAvailable).toBe(false);
  });

  it('refuses to stand up someone who is already on their feet', () => {
    const actor = knifeFighter('Actor', 0, 0, 'A');
    const enemy = knifeFighter('Enemy', 9, 9, 'B');
    const battle = battleOf([5, 1], actor, enemy);

    expect(() => battle.execute(standUpAction())).toThrow();
  });

  it('provokes an attack of opportunity from an adjacent enemy while standing up', () => {
    // The AoO still enjoys the +4 against the (still) prone actor: d20 15 +1 +4 = 20 vs AC 10.
    // Initiative 5 to the enemy: it has acted, so it is no longer flat-footed and may take its AoO.
    const actor = knifeFighter('Actor', 1, 0, 'A');
    const enemy = knifeFighter('Enemy', 0, 0, 'B');
    actor.markProne();
    const battle = battleOf([1, 5, 15, 3], actor, enemy);
    battle.endTurn();

    battle.execute(standUpAction());

    expect(actor.currentHitPoints).toBe(30 - 3);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(0);
    expect(actor.isProne).toBe(false);
  });
});

describe('flat-footed', () => {
  const withDexterity = (score: number, side: 'A' | 'B' = 'A'): Character =>
    combatant('Test').dex(score).hp(10).wielding(Weapons.dagger()).on(side).build();

  it('suppresses a positive Dex bonus to AC', () => {
    const character = withDexterity(14);
    expect(character.effectiveArmorClass).toBe(12);

    character.markFlatFooted();

    expect(character.effectiveArmorClass).toBe(10);
  });

  it('keeps a Dex penalty, which is not a bonus to lose', () => {
    const character = withDexterity(6);

    character.markFlatFooted();

    expect(character.effectiveArmorClass).toBe(8);
  });

  it('restores the AC once cleared', () => {
    const character = withDexterity(14);
    character.markFlatFooted();

    character.clearFlatFooted();

    expect(character.effectiveArmorClass).toBe(12);
  });

  it('clears it for whoever acts first, and only for them', () => {
    const first = withDexterity(14, 'A');
    const second = withDexterity(14, 'B');
    const turns = new TurnManager(new SequenceRandom(10, 5), [first, second]);

    expect(turns.currentActor).toBe(first);
    expect(first.isFlatFooted).toBe(false);
    expect(second.isFlatFooted).toBe(true);
  });

  it('clears it for the next combatant when their turn comes round', () => {
    const first = withDexterity(14, 'A');
    const second = withDexterity(14, 'B');
    const turns = new TurnManager(new SequenceRandom(10, 5), [first, second]);

    turns.advanceTurn();

    expect(turns.currentActor).toBe(second);
    expect(second.isFlatFooted).toBe(false);
  });
});

describe('fatigued', () => {
  const fighter = (x = 0, y = 0, side: 'A' | 'B' = 'A'): Character =>
    combatant('Fighter').bab(1).at(x, y).on(side).build();

  it('costs 2 on melee attacks', () => {
    const character = fighter();
    const baseline = character.meleeAttackBonus;

    character.markFatigued();

    expect(character.meleeAttackBonus).toBe(baseline - 2);
  });

  it('costs 2 on ranged attacks', () => {
    const character = fighter();
    const baseline = character.rangedAttackBonus;

    character.markFatigued();

    expect(character.rangedAttackBonus).toBe(baseline - 2);
  });

  it('costs 2 AC', () => {
    const character = fighter();
    const baseline = character.effectiveArmorClass;

    character.markFatigued();

    expect(character.effectiveArmorClass).toBe(baseline - 2);
  });

  // The -2 is to Dexterity itself, so it reaches every roll the ability governs — Reflex included.
  it('costs 2 on Reflex saves, through the Dexterity penalty', () => {
    const character = fighter();
    const baseline = character.savingThrowModifier('Reflex');

    character.markFatigued();

    expect(character.savingThrowModifier('Reflex')).toBe(baseline - 2);
  });

  it('leaves Fortitude and Will alone, which Dexterity does not govern', () => {
    const character = fighter();
    const [fortitude, will] = [
      character.savingThrowModifier('Fortitude'),
      character.savingThrowModifier('Will'),
    ];

    character.markFatigued();

    expect(character.savingThrowModifier('Fortitude')).toBe(fortitude);
    expect(character.savingThrowModifier('Will')).toBe(will);
  });

  it('gives all of it back when cleared', () => {
    const character = fighter();
    const [melee, ranged, armorClass, reflex] = [
      character.meleeAttackBonus,
      character.rangedAttackBonus,
      character.effectiveArmorClass,
      character.savingThrowModifier('Reflex'),
    ];

    character.markFatigued();
    character.clearFatigued();

    expect(character.meleeAttackBonus).toBe(melee);
    expect(character.rangedAttackBonus).toBe(ranged);
    expect(character.effectiveArmorClass).toBe(armorClass);
    expect(character.savingThrowModifier('Reflex')).toBe(reflex);
  });

  it('forbids charging', () => {
    const attacker = fighter(0, 0, 'A');
    const target = fighter(0, 3, 'B');
    attacker.markFatigued();
    const battle = battleOf([5, 1], attacker, target);

    expect(() => battle.execute(chargeAction(target))).toThrow();
  });
});

describe('rage', () => {
  const barbarian = (): Character =>
    Character.fromClassLevels(
      'Barbarian',
      new AbilitySet(
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
      ),
      [new ClassLevel(CharacterClasses.barbarian(), 1)],
      new SequenceRandom(),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );

  const ragingPair = (rolls: number[] = [5, 1], enemyX = 5, enemyY = 5) => {
    const rager = barbarian();
    const enemy = combatant('Fighter').bab(1).at(enemyX, enemyY).on('B').build();
    return { rager, enemy, battle: battleOf(rolls, rager, enemy) };
  };

  it('turns on', () => {
    const { battle, rager } = ragingPair();

    battle.execute(rageAction());

    expect(rager.isRaging).toBe(true);
  });

  it('adds 2 to melee attacks', () => {
    const { battle, rager } = ragingPair();
    const baseline = rager.meleeAttackBonus;

    battle.execute(rageAction());

    expect(rager.meleeAttackBonus).toBe(baseline + 2);
  });

  it('costs 2 AC', () => {
    const { battle, rager } = ragingPair();
    const baseline = rager.effectiveArmorClass;

    battle.execute(rageAction());

    expect(rager.effectiveArmorClass).toBe(baseline - 2);
  });

  it('adds 2 on Will saves', () => {
    const { battle, rager } = ragingPair();
    const baseline = rager.savingThrowModifier('Will');

    battle.execute(rageAction());

    expect(rager.savingThrowModifier('Will')).toBe(baseline + 2);
  });

  it('adds 2 on Fortitude saves, through the +4 Constitution', () => {
    const { battle, rager } = ragingPair();
    const baseline = rager.savingThrowModifier('Fortitude');

    battle.execute(rageAction());

    expect(rager.savingThrowModifier('Fortitude')).toBe(baseline + 2);
  });

  it('refuses anyone without barbarian levels', () => {
    const fighter = combatant('Fighter').bab(1).at(0, 0).on('A').build();
    const enemy = combatant('Enemy').bab(1).at(5, 5).on('B').build();
    const battle = battleOf([5, 1], fighter, enemy);

    expect(() => battle.execute(rageAction())).toThrow();
  });

  it('refuses a second rage once the day’s are spent', () => {
    const { battle } = ragingPair();
    battle.execute(rageAction());
    battle.execute(endRageAction());

    expect(() => battle.execute(rageAction())).toThrow();
  });

  it('refuses to start while already fatigued', () => {
    const { battle, rager } = ragingPair();
    rager.markFatigued();

    expect(() => battle.execute(rageAction())).toThrow();
  });

  it('leaves the barbarian fatigued when it ends', () => {
    const { battle, rager } = ragingPair();

    battle.execute(rageAction());
    battle.execute(endRageAction());

    expect(rager.isRaging).toBe(false);
    expect(rager.isFatigued).toBe(true);
  });

  it('takes the rage hit points back when it ends', () => {
    const { battle, rager } = ragingPair();
    const beforeRage = rager.currentHitPoints;

    battle.execute(rageAction());
    battle.execute(endRageAction());

    expect(rager.currentHitPoints).toBe(beforeRage);
  });

  // SRD: "A fit of rage lasts for a number of rounds equal to 3 + the character's (newly improved)
  // Constitution modifier" — the rage's own +4 Constitution makes that 5 rounds here.
  it('runs out on its own once the rounds are used up', () => {
    const rager = barbarian();

    rager.enterRage(0);
    for (let round = 0; round < 4; round++) {
      rager.tickRage();
    }
    expect(rager.isRaging).toBe(true);
    rager.tickRage();

    expect(rager.isRaging).toBe(false);
    expect(rager.isFatigued).toBe(true);
  });

  it('still allows a charge, unlike fatigue', () => {
    const { battle, enemy } = ragingPair([5, 1, 15, 5], 0, 3);

    battle.execute(rageAction());

    expect(() => battle.execute(chargeAction(enemy))).not.toThrow();
  });
});

describe('the vitality track', () => {
  const sword = new Weapon('Sword', DiceExpression.parse('1d6'), 20, 2);
  const wounded = (maxHitPoints: number, damage: number): Character => {
    const character = combatant('Fighter').hp(maxHitPoints).bab(1).wielding(sword).build();
    character.takeDamage(damage);
    return character;
  };

  it('is conscious at full hit points', () => {
    expect(wounded(10, 0).vitalStatus).toBe('Conscious');
  });

  it('is staggered at exactly zero', () => {
    expect(wounded(1, 1).vitalStatus).toBe('Staggered');
  });

  it('is dying below zero', () => {
    expect(wounded(1, 2).vitalStatus).toBe('Dying');
  });

  it('is dead at −10', () => {
    expect(wounded(1, 11).vitalStatus).toBe('Dead');
  });

  it('never drops past −10, however hard the blow', () => {
    expect(wounded(1, 100).currentHitPoints).toBe(-10);
  });

  // SRD Condition Summary, Dead: "The character's hit points are reduced to -10 or lower." Having
  // stabilized earlier is no protection from the blow that gets there.
  it('is dead at −10 even for someone who had stabilized', () => {
    const character = wounded(10, 12); // −2: dying
    character.stabilize();
    expect(character.vitalStatus).toBe('Stable');

    character.takeDamage(8); // −10

    expect(character.vitalStatus).toBe('Dead');
  });

  it('counts a dying combatant as defeated', () => {
    expect(wounded(1, 2).isDefeated).toBe(true);
  });

  it('does not count a staggered one as defeated', () => {
    expect(wounded(1, 1).isDefeated).toBe(false);
  });
});

// SRD Condition Summary, Dying: "At the end of each round (starting with the round in which the
// character dropped below 0 hit points), the character rolls d% to see whether she becomes stable.
// She has a 10% chance to become stable. If she does not, she loses 1 hit point."
describe('bleeding out', () => {
  // A1 fights on so the fight does not end; B2 is the one bleeding, last in initiative.
  const bleedingBattle = (rollsAfterInitiative: number[], constitution = 10) => {
    const ally = combatant('A1').hp(10).on('A').at(0, 0).build();
    const foe = combatant('B1').hp(10).on('B').at(9, 9).build();
    const downed = combatant('B2').con(constitution).hp(10).on('B').at(8, 8).build();
    downed.takeDamage(12); // −2 → dying
    const battle = battleOf([15, 10, 5, ...rollsAfterInitiative], ally, foe, downed);
    return { ally, foe, downed, battle };
  };

  /** Round one, from A1 all the way back to A1: the wrap is where the round ends. */
  const playARound = (battle: Battle) => {
    battle.endTurn();
    battle.endTurn();
    battle.endTurn();
  };

  it('stabilises on a percentile roll of ten or under, losing nothing', () => {
    const { battle, downed } = bleedingBattle([10]);

    playARound(battle);

    expect(downed.vitalStatus).toBe('Stable');
    expect(downed.currentHitPoints).toBe(-2);
  });

  it('loses the hit point only after the check has failed', () => {
    const { battle, downed } = bleedingBattle([11]);

    playARound(battle);

    expect(downed.vitalStatus).toBe('Dying');
    expect(downed.currentHitPoints).toBe(-3);
  });

  // The old rule was a DC 10 Constitution check, so a +4 modifier all but guaranteed the save.
  it('takes no account of Constitution', () => {
    const { battle, downed } = bleedingBattle([11], 18);

    playARound(battle);

    expect(downed.vitalStatus).toBe('Dying');
    expect(downed.currentHitPoints).toBe(-3);
  });

  // The check belongs to the end of the round, not to the dying combatant's own turn.
  it('waits for the end of the round, not for the dying combatant’s turn', () => {
    const { battle, downed } = bleedingBattle([11]);

    battle.endTurn(); // A1 → B1
    battle.endTurn(); // B1 → B2, whose own turn comes round with nothing spent

    expect(downed.currentHitPoints).toBe(-2);
  });
});

describe('the win condition', () => {
  const swordsman = (name: string, x: number, y: number, side: 'A' | 'B', hp: number): Character =>
    combatant(name)
      .hp(hp)
      .bab(1)
      .wielding(new Weapon('Sword', DiceExpression.parse('1d6'), 20, 2))
      .at(x, y)
      .on(side)
      .build();

  it('ends the fight when the last enemy drops below zero', () => {
    const hero = swordsman('Hero', 0, 0, 'A', 10);
    const rival = swordsman('Rival', 1, 0, 'B', 5);
    const battle = battleOf([2, 1, 15, 6], hero, rival);

    battle.execute(attackAction(rival));

    expect(rival.vitalStatus).toBe('Dying');
    expect(battle.isOver).toBe(true);
    expect(battle.winner).toBe(hero);
  });

  it('ends it when the last enemy is merely staggered — a side with nobody conscious has lost', () => {
    const hero = swordsman('Hero', 0, 0, 'A', 10);
    const rival = swordsman('Rival', 1, 0, 'B', 3);
    const battle = battleOf([2, 1, 15, 3], hero, rival);

    battle.execute(attackAction(rival));

    expect(rival.vitalStatus).toBe('Staggered');
    expect(battle.isOver).toBe(true);
    expect(battle.winner).toBe(hero);
  });

  it('lets a staggered combatant take one action per turn, not two', () => {
    const hero = swordsman('Hero', 0, 0, 'A', 10);
    const rival = swordsman('Rival', 1, 0, 'B', 1);
    // init 2,1; attack 15; damage 1; then the AoO the hero's move provokes rolls a natural 1.
    const battle = battleOf([2, 1, 15, 1, 1], hero, rival);

    battle.execute(attackAction(rival)); // rival to 0 HP → staggered
    battle.execute(moveAction({ x: 0, y: 2 }));
    battle.endTurn();
    expect(rival.vitalStatus).toBe('Staggered');

    battle.execute(moveAction({ x: 2, y: 0 }));

    expect(battle.hasMovementAvailable).toBe(false);
    expect(battle.hasStandardActionAvailable).toBe(false);
  });
});

describe('transient effects', () => {
  it('expires an until-next-turn modifier on the tick', () => {
    const character = combatant('C').build();
    character.applyArmorClassModifier(-2);
    expect(character.activeEffects).toHaveLength(1);
    expect(character.armorClassModifier).toBe(-2);

    character.tickEffects();

    expect(character.activeEffects).toHaveLength(0);
    expect(character.armorClassModifier).toBe(0);
  });

  it('keeps a permanent one across the tick', () => {
    const character = combatant('C').build();
    character.addEffect({ type: 'Untyped', target: 'ArmorClass', value: 1, duration: 'Permanent' });

    character.tickEffects();

    expect(character.armorClassModifier).toBe(1);
  });

  it('stacks untyped AC modifiers', () => {
    const character = combatant('C').build();
    character.applyArmorClassModifier(-2);
    character.applyArmorClassModifier(2);

    expect(character.armorClassModifier).toBe(0);
  });
});

describe('rage, in the numbers the SRD gives it', () => {
  const barbarian = (constitution: number, levels = 1): Character =>
    combatant('Barbarian').con(constitution).hp(30).bab(1).barbarianAt(levels).build();

  // SRD Barbarian: "A fit of rage lasts for a number of rounds equal to 3 + the character's (newly
  // improved) Constitution modifier." The rage's own +4 Constitution raises that modifier by 2, so
  // Constitution 14 (+2) rages for 3 + 4 = 7 rounds.
  it('lasts three rounds plus the Constitution the rage itself improved', () => {
    const character = barbarian(14);

    character.enterRage(2);

    expect(character.rageRoundsLeft).toBe(7);
  });

  // SRD: "At 1st level he can use his rage ability once per day. At 4th level and every four levels
  // thereafter, he can use it one additional time per day."
  it('counts its daily uses from barbarian levels, not Constitution', () => {
    // Constitution 18 (+4) must not buy extra rages, and a 4th-level barbarian gets the second one.
    expect(barbarian(18, 1).ragesRemaining).toBe(1);
    expect(barbarian(10, 4).ragesRemaining).toBe(2);
    expect(barbarian(10, 8).ragesRemaining).toBe(3);
  });

  // SRD: "The increase in Constitution increases the barbarian's hit points by 2 points per level,
  // but these hit points go away at the end of the rage […] (These extra hit points are not lost
  // first the way temporary hit points are.)" Damage comes off normally, and the whole 2/level is
  // taken back at the end — which can drop the barbarian on the spot.
  it('does not absorb damage first: the extra hit points come off at the end', () => {
    const character = barbarian(10, 5); // 30 HP, +10 while raging
    character.enterRage(0);
    expect(character.currentHitPoints).toBe(40);

    character.takeDamage(35); // 40 − 35 = 5 while the rage holds
    expect(character.currentHitPoints).toBe(5);
    character.endRage();

    expect(character.currentHitPoints).toBe(-5);
    expect(character.vitalStatus).toBe('Dying');
  });
});

describe('disabled at zero hit points', () => {
  // SRD Condition Summary, Disabled: "performing any standard action (or any other action the game
  // master deems strenuous […]) deals 1 point of damage after the completion of the act. Unless the
  // action increased the disabled character's hit points, she is now in negative hit points and
  // dying." The engine already grants the single action; the self-inflicted point is missing.
  it('costs one hit point for a standard action, which starts the dying', () => {
    const attacker = combatant('Attacker').bab(1).hp(20).at(0, 0).on('A').build();
    const target = combatant('Target').hp(40).at(1, 0).on('B').build();
    const battle = battleOf([2, 1, 15, 4], attacker, target);
    attacker.takeDamage(20); // exactly 0: disabled, still on its feet
    expect(attacker.vitalStatus).toBe('Staggered');

    battle.execute(attackAction(target));

    expect(attacker.currentHitPoints).toBe(-1);
    expect(attacker.vitalStatus).toBe('Dying');
  });

  // SRD: "She moves at half speed."
  it('moves at half speed', () => {
    const character = combatant('Walker').movingAt(30).hp(20).build();

    character.takeDamage(20);

    expect(character.effectiveSpeed).toBe(15);
  });

  // The half speed reaches every rule that reads it, the withdraw included: the withdraw measures its
  // route against `effectiveSpeed * 2`, so a disabled combatant withdraws half as far.
  it('withdraws half as far', () => {
    const walker = combatant('Walker').movingAt(30).hp(20).at(0, 0).on('A').build();
    const enemy = combatant('Enemy').hp(30).at(9, 9).on('B').build();
    const battle = battleOf([5, 1], walker, enemy);
    walker.takeDamage(20);

    expect(() => battle.execute(withdrawAction({ x: 0, y: 8 }))).toThrow(/costs 40 ft/);
    battle.execute(withdrawAction({ x: 0, y: 6 }));

    expect(walker.position).toEqual({ x: 0, y: 6 });
  });
});
