// SRD Combat — attack resolution beyond the basic swing: flanking, attacks of opportunity, sneak
// attack, the iterative attacks of a full attack, and ranged fire with its range increments.
// https://www.d20srd.org/srd/combat/combatStatistics.htm

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { CombatEngine } from '../src/engine/combat-engine';
import { Character } from '../src/engine/character';
import { Armor, Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import {
  attackAction,
  fiveFootStepAction,
  fullAttackAction,
  moveAction,
} from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const ARENA = 10;
const longsword = () => new Weapon('Longsword', DiceExpression.parse('1d8'), 19, 2);
const fist = () => new Weapon('Fist', DiceExpression.parse('1d3'), 20, 2);
const shortbow = (rangeIncrementInFeet = 60) =>
  new Weapon('Shortbow', DiceExpression.parse('1d6'), 20, 3, 'Ranged', 5, rangeIncrementInFeet, 'Bow');
/** Plain armor with no Dex cap worth speaking of: a dial for the defender's AC. */
const plating = (armorBonus: number) => new Armor('Plating', armorBonus, 8, 'Light');

const battleOf = (rolls: number[], ...combatants: Character[]): Battle =>
  new Battle(new Grid(ARENA, ARENA), new SequenceRandom(...rolls), combatants);

describe('flanking', () => {
  // STR 16 (+3) fighters. Dex 10, so AC is 10 plus whatever armor we hang on them.
  const fighter = (name: string, x: number, y: number, side: 'A' | 'B', armorClass = 10): Character => {
    const builder = combatant(name).str(16).hp(30).bab(1).wielding(longsword()).at(x, y).on(side);
    return (armorClass > 10 ? builder.wearing(plating(armorClass - 10)) : builder).build();
  };

  // Initiative 3,2,1 puts the first combatant on turn.
  const trio = (a: Character, b: Character, c: Character, ...laterRolls: number[]) =>
    battleOf([3, 2, 1, ...laterRolls], a, b, c);

  it('recognises an ally directly opposite the target', () => {
    const attacker = fighter('Atk', 4, 5, 'A');
    const ally = fighter('Ally', 6, 5, 'A');
    const target = fighter('Foe', 5, 5, 'B');

    expect(trio(attacker, ally, target).isFlanking(attacker, target)).toBe(true);
  });

  it('recognises it on the diagonal too', () => {
    const attacker = fighter('Atk', 4, 4, 'A');
    const ally = fighter('Ally', 6, 6, 'A');
    const target = fighter('Foe', 5, 5, 'B');

    expect(trio(attacker, ally, target).isFlanking(attacker, target)).toBe(true);
  });

  it('refuses an ally that is adjacent but not opposite', () => {
    const attacker = fighter('Atk', 4, 5, 'A');
    const ally = fighter('Ally', 5, 4, 'A');
    const target = fighter('Foe', 5, 5, 'B');

    expect(trio(attacker, ally, target).isFlanking(attacker, target)).toBe(false);
  });

  it('refuses an ally on the right line but out of reach', () => {
    const attacker = fighter('Atk', 4, 5, 'A');
    const ally = fighter('Ally', 8, 5, 'A');
    const target = fighter('Foe', 5, 5, 'B');

    expect(trio(attacker, ally, target).isFlanking(attacker, target)).toBe(false);
  });

  // SRD: the bonus needs an opponent "threatened by a character or creature friendly to you on the
  // opponent's opposite border". A combatant at -3 hit points is unconscious and threatens nothing,
  // even though it is not dead.
  it('refuses an ally who is opposite but down and dying', () => {
    const attacker = fighter('Atk', 4, 5, 'A');
    const ally = fighter('Ally', 6, 5, 'A');
    const target = fighter('Foe', 5, 5, 'B');
    const battle = trio(attacker, ally, target);
    expect(battle.isFlanking(attacker, target)).toBe(true);

    ally.takeDamage(33); // 30 → −3: dying, still on the grid.

    expect(ally.vitalStatus).toBe('Dying');
    expect(battle.isFlanking(attacker, target)).toBe(false);
  });

  it('does not count an enemy standing opposite as a flanking partner', () => {
    const attacker = fighter('Atk', 4, 5, 'A');
    const enemyAcross = fighter('Foe2', 6, 5, 'B');
    const target = fighter('Foe', 5, 5, 'B');

    expect(trio(attacker, enemyAcross, target).isFlanking(attacker, target)).toBe(false);
  });

  it('turns a near miss into a hit with its +2', () => {
    // d20 10 + BAB 1 + STR 3 = 14, short of AC 16; flanking makes it 16. Damage 5 + STR 3.
    const attacker = fighter('Atk', 4, 5, 'A');
    const ally = fighter('Ally', 6, 5, 'A');
    const target = fighter('Foe', 5, 5, 'B', 16);
    const battle = trio(attacker, ally, target, 10, 5);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(true);
    expect(target.currentHitPoints).toBe(30 - 8);
  });

  // SRD Critical Hits: the confirmation roll is "another attack roll with all the same modifiers",
  // so the situational bonuses of the threatening attack ride along.
  // https://www.d20srd.org/srd/combat/combatStatistics.htm#criticalHits
  it('rides along on the critical confirmation roll', () => {
    // Longsword threatens on 19: 19 + BAB 1 + STR 3 + flanking 2 = 25 hits AC 20 and threatens.
    // The confirmation of 14 makes 20 only with the flanking +2. Crit damage 5 + 4 + STR 3 ×2.
    const attacker = fighter('Atk', 4, 5, 'A');
    const ally = fighter('Ally', 6, 5, 'A');
    const target = fighter('Foe', 5, 5, 'B', 20);
    const battle = trio(attacker, ally, target, 19, 14, 5, 4);

    const result = battle.execute(attackAction(target));

    expect(result?.wasCritical).toBe(true);
    expect(target.currentHitPoints).toBe(30 - 15);
  });

  it('is missing from the confirmation when nobody flanks, on the very same rolls', () => {
    // Same dice, no ally opposite: 19 + 4 = 23 still hits AC 20, but the confirmation of 14 makes
    // 18 and falls short — an ordinary hit for 5 + STR 3.
    const attacker = fighter('Atk', 4, 5, 'A');
    const bystander = fighter('Bystander', 0, 0, 'A');
    const target = fighter('Foe', 5, 5, 'B', 20);
    const battle = trio(attacker, bystander, target, 19, 14, 5, 4);

    const result = battle.execute(attackAction(target));

    expect(result?.wasCritical).toBe(false);
    expect(target.currentHitPoints).toBe(30 - 8);
  });
});

describe('attacks of opportunity', () => {
  const fighter = (name: string, x: number, y: number, side: 'A' | 'B', hitPoints = 30): Character =>
    combatant(name).str(16).hp(hitPoints).bab(1).wielding(longsword()).at(x, y).on(side).build();

  it('gives each combatant one per round, spent and reset explicitly', () => {
    const fighter1 = fighter('F', 0, 0, 'A');
    expect(fighter1.canMakeAttackOfOpportunity).toBe(true);

    fighter1.spendAttackOfOpportunity();

    expect(fighter1.availableAttacksOfOpportunityCount).toBe(0);
    expect(fighter1.canMakeAttackOfOpportunity).toBe(false);
    expect(() => fighter1.spendAttackOfOpportunity()).toThrow();

    fighter1.resetAttacksOfOpportunity();
    expect(fighter1.availableAttacksOfOpportunityCount).toBe(1);
  });

  it('fires when someone leaves a threatened square', () => {
    // AoO d20 10 (+1 BAB +3 STR) = 14 beats AC 10; damage 6 + 3.
    // Initiative 2/1 puts the enemy first, so it has acted and is no longer flat-footed.
    const mover = fighter('Mover', 1, 0, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = battleOf([1, 2, 10, 6], mover, enemy);
    battle.endTurn();

    battle.execute(moveAction({ x: 3, y: 0 }));

    expect(mover.currentHitPoints).toBe(30 - 9);
    expect(mover.position).toEqual({ x: 3, y: 0 });
    expect(enemy.availableAttacksOfOpportunityCount).toBe(0);
  });

  it('stays silent when the mover was never threatened', () => {
    // The enemy goes first, so distance — not the flat-footed clause — is what keeps it silent.
    const mover = fighter('Mover', 5, 5, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = battleOf([1, 2], mover, enemy);
    battle.endTurn();

    battle.execute(moveAction({ x: 5, y: 7 }));

    expect(mover.currentHitPoints).toBe(30);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(1);
  });

  it('never fires between allies', () => {
    // The ally goes first: friendship — not the flat-footed clause — is what keeps it silent.
    const mover = fighter('Mover', 1, 0, 'A');
    const ally = fighter('Ally', 0, 0, 'A');
    const battle = battleOf([1, 2], mover, ally);
    battle.endTurn();

    battle.execute(moveAction({ x: 3, y: 0 }));

    expect(mover.currentHitPoints).toBe(30);
    expect(ally.availableAttacksOfOpportunityCount).toBe(1);
  });

  // SRD Injury and Death: a dying character is unconscious and can take no actions — an attack of
  // opportunity included. https://www.d20srd.org/srd/combat/injuryandDeath.htm#dying1to9HitPoints
  it('never fires from a threatener who is down and dying', () => {
    // The enemy goes first, so it is not flat-footed: only the dying clause can silence it.
    const mover = fighter('Mover', 1, 0, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = battleOf([1, 2], mover, enemy);
    enemy.takeDamage(31); // 30 → −1: dying, still on the grid but past acting.
    battle.endTurn();

    battle.execute(moveAction({ x: 3, y: 0 }));

    expect(enemy.vitalStatus).toBe('Dying');
    expect(mover.currentHitPoints).toBe(30);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(1);
  });

  it('is spent by the first provocation, so the second one goes unpunished', () => {
    // Initiative 3/2/1 puts the enemy first, so it is no longer flat-footed; the two
    // movers follow in their own order.
    const first = fighter('First', 4, 5, 'A');
    const second = fighter('Second', 6, 5, 'A');
    const enemy = fighter('Enemy', 5, 5, 'B');
    const battle = battleOf([2, 1, 3, 10, 6], first, second, enemy);
    battle.endTurn();

    battle.execute(moveAction({ x: 4, y: 3 }));
    battle.endTurn();
    battle.execute(moveAction({ x: 6, y: 3 }));

    expect(first.currentHitPoints).toBe(30 - 9);
    expect(second.currentHitPoints).toBe(30);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(0);
  });

  it('comes back at the start of the threatener’s own turn', () => {
    const mover = fighter('Mover', 1, 0, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = battleOf([1, 2, 10, 6], mover, enemy);
    battle.endTurn(); // the enemy has acted, so its attack of opportunity is legitimate

    battle.execute(moveAction({ x: 3, y: 0 }));
    expect(enemy.availableAttacksOfOpportunityCount).toBe(0);

    battle.endTurn();

    expect(enemy.availableAttacksOfOpportunityCount).toBe(1);
  });
});

describe('sneak attack', () => {
  // Resolved straight through the engine: Battle decides *when* it applies, this is *what* it adds.
  const rogue = (sneakAttackDice: number): Character =>
    combatant('Rogue')
      .hp(10)
      .bab(1)
      .wielding(new Weapon('Dagger', DiceExpression.parse('1d4'), 19, 2))
      .at(0, 0)
      .on('A')
      .sneakDice(sneakAttackDice)
      .build();
  const defender = (): Character =>
    combatant('Defender').hp(100).wielding(longsword()).at(0, 1).on('B').build();

  it('adds its d6 dice to the damage of an eligible hit', () => {
    // d20 15 hits AC 10; weapon 1d4 = 3, sneak 1d6 = 4.
    const engine = new CombatEngine(new SequenceRandom(15, 3, 4));

    const result = engine.resolveAttack(rogue(1), defender(), {
      attackBonus: 0,
      sneakAttackApplies: true,
      powerAttackDamageBonus: 0,
    });

    expect(result.hit).toBe(true);
    expect(result.sneakAttackDamage).toBe(4);
    expect(result.damage).toBe(7);
  });

  it('adds nothing when the situation does not allow it', () => {
    const engine = new CombatEngine(new SequenceRandom(15, 3));

    const result = engine.resolveAttack(rogue(1), defender(), {
      attackBonus: 0,
      sneakAttackApplies: false,
      powerAttackDamageBonus: 0,
    });

    expect(result.sneakAttackDamage).toBe(0);
    expect(result.damage).toBe(3);
  });

  it('adds nothing when the attacker has no sneak dice to roll', () => {
    const engine = new CombatEngine(new SequenceRandom(15, 3));

    const result = engine.resolveAttack(rogue(0), defender(), {
      attackBonus: 0,
      sneakAttackApplies: true,
      powerAttackDamageBonus: 0,
    });

    expect(result.sneakAttackDamage).toBe(0);
    expect(result.damage).toBe(3);
  });

  it('is never multiplied by a critical', () => {
    // Dagger threatens on 19: d20 19 hits, confirm 20. Weapon 4+3 = 7 (×2), sneak 5+6 = 11 (×1).
    const engine = new CombatEngine(new SequenceRandom(19, 20, 4, 3, 5, 6));

    const result = engine.resolveAttack(rogue(2), defender(), {
      attackBonus: 0,
      sneakAttackApplies: true,
      powerAttackDamageBonus: 0,
    });

    expect(result.wasCritical).toBe(true);
    expect(result.sneakAttackDamage).toBe(11);
    expect(result.damage).toBe(18);
  });

  // SRD Rogue: "Ranged attacks can count as sneak attacks only if the target is within 30 feet."
  // https://www.d20srd.org/srd/classes/rogue.htm#sneakAttack — the gate lives in `Battle`, which is
  // why these two go through a whole fight instead of the resolver.
  describe('at range', () => {
    // The archer shoots first, so the target is still flat-footed: eligibility turns on distance alone.
    const shot = (targetX: number, ...rolls: number[]) => {
      const archer = combatant('Archer')
        .hp(30)
        .bab(1)
        .wielding(shortbow())
        .at(0, 0)
        .on('A')
        .sneakDice(1)
        .build();
      const target = combatant('Target').hp(100).wielding(longsword()).at(targetX, 0).on('B').build();
      const battle = battleOf([2, 1, ...rolls], archer, target);
      return { target, result: battle.execute(attackAction(target)) };
    };

    it('adds the sneak dice at exactly thirty feet', () => {
      // d20 15 + BAB 1 hits AC 10; arrow 1d6 = 4 and no Strength on ranged damage, sneak 1d6 = 5.
      const { target, result } = shot(6, 15, 4, 5);

      expect(result?.sneakAttackDamage).toBe(5);
      expect(target.currentHitPoints).toBe(100 - 9);
    });

    it('adds nothing one square further out', () => {
      const { target, result } = shot(7, 15, 4);

      expect(result?.hit).toBe(true);
      expect(result?.sneakAttackDamage).toBe(0);
      expect(target.currentHitPoints).toBe(100 - 4);
    });
  });
});

describe('full attack', () => {
  // STR 10 throughout, so the damage below is weapon dice only.
  const warrior = (baseAttackBonus: number): Character =>
    combatant('Warrior').hp(50).bab(baseAttackBonus).wielding(longsword()).at(0, 0).on('A').build();
  const dummy = (): Character =>
    combatant('Dummy').hp(100).wielding(fist()).at(1, 0).on('B').build();

  const duel = (baseAttackBonus: number, ...rolls: number[]) => {
    const attacker = warrior(baseAttackBonus);
    const target = dummy();
    return { attacker, target, battle: battleOf([2, 1, ...rolls], attacker, target) };
  };

  it('makes two attacks at BAB +6, at +6 and +1', () => {
    const { battle, target } = duel(6, 10, 4, 10, 3);

    battle.execute(fullAttackAction(target));

    expect(target.currentHitPoints).toBe(100 - 4 - 3);
    expect(battle.log.filter((entry) => entry.event === 'FullAttack')).toHaveLength(2);
  });

  it('makes three at BAB +11, at +11, +6 and +1', () => {
    const { battle, target } = duel(11, 10, 4, 10, 3, 10, 2);

    battle.execute(fullAttackAction(target));

    expect(target.currentHitPoints).toBe(100 - 9);
    expect(battle.log.filter((entry) => entry.event === 'FullAttack')).toHaveLength(3);
  });

  // SRD: the iterative attacks run down from the base attack bonus in steps of 5 until the bonus
  // would drop below +1 — four of them at BAB +16, at +16/+11/+6/+1. Each row raises the target's AC
  // by exactly one step, so the number of hits reads back the bonus of every single attack.
  it.each([
    [26, 1],
    [21, 2],
    [16, 3],
    [11, 4],
  ])('at BAB +16 hits an AC %i target %i times', (armorClass, expectedHits) => {
    // STR 20 (+5) with a longsword: every attack is d20 5 + 16/11/6/1 + 5, damage 8 + STR 5 = 13.
    const attacker = combatant('Warrior').str(20).hp(50).bab(16).wielding(longsword()).at(0, 0).on('A').build();
    const target = combatant('Dummy')
      .hp(200)
      .wielding(fist())
      .wearing(plating(armorClass - 10))
      .at(1, 0)
      .on('B')
      .build();
    const hitRolls = Array.from({ length: expectedHits }, () => [5, 8]).flat();
    const missRolls = Array.from({ length: 4 - expectedHits }, () => 5);
    const battle = battleOf([2, 1, ...hitRolls, ...missRolls], attacker, target);

    battle.execute(fullAttackAction(target));

    expect(battle.log.filter((entry) => entry.event === 'FullAttack')).toHaveLength(4);
    expect(target.currentHitPoints).toBe(200 - 13 * expectedHits);
  });

  it('refuses BAB +5, one short of the second attack', () => {
    const { battle, target } = duel(5);

    expect(() => battle.execute(fullAttackAction(target))).toThrow();
  });

  it('is offered at BAB +6 against an adjacent target', () => {
    const { battle, target } = duel(6);

    expect(battle.canFullAttack(target)).toBe(true);
  });

  it('is not offered at BAB +5', () => {
    const { battle, target } = duel(5);

    expect(battle.canFullAttack(target)).toBe(false);
  });

  // SRD Full Attack: "The only movement you can take during a full attack is a 5-foot step." The
  // standard action is gone, and the move survives only for that step.
  it('spends the standard action and leaves the move only for a 5-ft step', () => {
    const { battle, target } = duel(6, 10, 4, 10, 3);

    battle.execute(fullAttackAction(target));

    expect(battle.hasStandardActionAvailable).toBe(false);
    expect(battle.hasMovementAvailable).toBe(true);
    expect(battle.canMove).toBe(false);
  });

  // SRD: "You may take the step before, after, or between your attacks."
  it('still leaves room for the 5-ft step afterwards', () => {
    const { battle, attacker, target } = duel(6, 10, 4, 10, 3);

    battle.execute(fullAttackAction(target));
    battle.execute(fiveFootStepAction({ x: 0, y: 1 }));

    expect(attacker.position).toEqual({ x: 0, y: 1 });
  });

  it('is out of the question once the actor has taken a real move', () => {
    const { battle, target } = duel(6, 10, 4, 10, 3);

    battle.execute(moveAction({ x: 0, y: 1 })); // still adjacent to the dummy at (1,0)

    expect(battle.canFullAttack(target)).toBe(false);
    expect(() => battle.execute(fullAttackAction(target))).toThrow(/5-ft step/);
  });
});

describe('ranged attacks', () => {
  // STR 16 (+3) but DEX 14 (+2): the point of several of these is that the bow uses Dex, not Str.
  const archer = (x: number, y: number, weapon: Weapon): Character =>
    combatant('Archer').str(16).dex(14).hp(30).bab(1).wielding(weapon).at(x, y).on('A').build();
  const swordsman = (name: string, x: number, y: number, side: 'A' | 'B'): Character =>
    combatant(name).str(16).hp(30).bab(1).wielding(longsword()).at(x, y).on(side).build();
  const armored = (x: number, y: number, armorBonus: number): Character =>
    combatant('Tough').hp(30).wielding(fist()).at(x, y).on('B').wearing(plating(armorBonus)).build();

  it('refuses to exist without a range increment', () => {
    expect(() => new Weapon('Bad', DiceExpression.parse('1d6'), 20, 3, 'Ranged', 5, 0)).toThrow();
  });

  it('adds Dexterity to the attack roll, not Strength', () => {
    // BAB 1 + DEX 2 = 13 total, under AC 14. With Strength it would have been 14 and hit.
    const shooter = archer(0, 0, shortbow());
    const target = armored(3, 0, 4);
    const battle = battleOf([2, 1, 10], shooter, target);

    expect(battle.execute(attackAction(target))?.hit).toBe(false);
  });

  it('leaves Strength out of the damage as well', () => {
    const shooter = archer(0, 0, shortbow());
    const target = swordsman('Target', 3, 0, 'B');
    const battle = battleOf([2, 1, 10, 5], shooter, target);

    const result = battle.execute(attackAction(target));

    expect(result?.hit).toBe(true);
    expect(result?.damage).toBe(5);
  });

  it('takes −2 per range increment past the first', () => {
    // 20-ft increment, target 30 ft away → second increment → −2: 11 + 3 − 2 = 12 vs AC 13.
    const shooter = archer(0, 0, shortbow(20));
    const target = armored(6, 0, 3);
    const battle = battleOf([2, 1, 11], shooter, target);

    expect(battle.execute(attackAction(target))?.hit).toBe(false);
  });

  it('reaches ten increments and refuses the shot beyond them', () => {
    // 5-ft increment → 50 ft of range: 45 ft is a shot, 55 ft is not.
    const inRange = battleOf(
      [2, 1, 10, 5],
      archer(0, 0, shortbow(5)),
      swordsman('Target', 0, 9, 'B'),
    );
    const targetInRange = inRange.combatants.find((c) => c.name === 'Target')!;
    expect(() => inRange.execute(attackAction(targetInRange))).not.toThrow();

    const tooFar = battleOf([2, 1], archer(0, 0, shortbow(5)), swordsman('Target', 0, 11, 'B'));
    const targetTooFar = tooFar.combatants.find((c) => c.name === 'Target')!;
    expect(() => tooFar.execute(attackAction(targetTooFar))).toThrow();
  });

  it('provokes an attack of opportunity when fired in someone’s face', () => {
    // The adjacent foe's AoO (d20 10 +4, damage 6+3) lands before the archer's own shot.
    // Initiative 6 / 2+2 / 1 puts that foe first, so it has acted and is not flat-footed.
    const shooter = archer(1, 0, shortbow());
    const adjacentFoe = swordsman('Foe', 0, 0, 'B');
    const distantFoe = swordsman('Distant', 5, 0, 'B');
    const battle = battleOf([2, 6, 1, 10, 6, 10, 4], shooter, adjacentFoe, distantFoe);
    battle.endTurn();

    battle.execute(attackAction(distantFoe));

    expect(shooter.currentHitPoints).toBe(30 - 9);
  });
});

describe('attacks of opportunity: who cannot make them', () => {
  const fighter = (name: string, x: number, y: number, side: 'A' | 'B'): Character =>
    combatant(name).str(16).hp(30).bab(1).wielding(longsword()).at(x, y).on(side).build();

  // SRD Condition Summary: "A flat-footed character loses his Dexterity bonus to AC (if any) and
  // cannot make attacks of opportunity." Everyone is flat-footed until their first turn comes up,
  // so this is every AoO taken in round one before the threatener has acted.
  it('never fires from a threatener who has not acted yet, being flat-footed', () => {
    // Initiative 2/1: the mover goes first, so the enemy is still flat-footed when it would strike.
    const mover = fighter('Mover', 1, 0, 'A');
    const enemy = fighter('Enemy', 0, 0, 'B');
    const battle = battleOf([2, 1, 15, 6], mover, enemy);
    expect(enemy.isFlatFooted).toBe(true);

    battle.execute(moveAction({ x: 3, y: 0 }));

    expect(mover.currentHitPoints).toBe(30);
    expect(enemy.availableAttacksOfOpportunityCount).toBe(1);
  });

  // SRD Threatened Squares: "If you're unarmed, you don't normally threaten any squares and thus
  // can't make attacks of opportunity", and "An attack of opportunity is a single melee attack" —
  // a combatant holding only a bow threatens nothing.
  it('never fires from a combatant holding only a bow, which threatens nothing', () => {
    // Initiative is rolled in constructor order: the mover's 1 against the archer's 2 + DEX 3 puts
    // the archer first, so it has acted — and is no longer flat-footed — when the mover walks away.
    // Its AoO would otherwise land (d20 15 + BAB 1 + DEX 3 = 19 against AC 10, arrow 1d6 = 6).
    const mover = fighter('Mover', 1, 0, 'A');
    const archer = combatant('Archer').dex(16).hp(30).bab(1).wielding(shortbow()).at(0, 0).on('B').build();
    const battle = battleOf([1, 2, 15, 6], mover, archer);
    battle.endTurn(); // archer → mover
    expect(battle.currentActor).toBe(mover);
    expect(archer.isFlatFooted).toBe(false);

    battle.execute(moveAction({ x: 3, y: 0 }));

    expect(mover.currentHitPoints).toBe(30);
    expect(archer.availableAttacksOfOpportunityCount).toBe(1);
  });
});

describe('full attack after a five-foot step', () => {
  // SRD Full Attack: "The only movement you can take during a full attack is a 5-foot step. You may
  // take the step before, after, or between your attacks."
  it('still happens after a five-foot step', () => {
    const attacker = combatant('Warrior').hp(50).bab(6).wielding(longsword()).at(0, 0).on('A').build();
    const target = combatant('Dummy').hp(100).wielding(fist()).at(2, 0).on('B').build();
    const battle = battleOf([2, 1, 10, 4, 10, 3], attacker, target);

    battle.execute(fiveFootStepAction({ x: 1, y: 0 }));
    battle.execute(fullAttackAction(target));

    expect(battle.log.filter((entry) => entry.event === 'FullAttack')).toHaveLength(2);
    expect(target.currentHitPoints).toBe(100 - 7);
  });
});
