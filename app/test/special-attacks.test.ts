// SRD Special Attacks: https://www.d20srd.org/srd/combat/specialAttacks.htm
//
// Trip, bull rush, overrun, disarm (and retrieving the dropped weapon), coup de grâce, aid another.
// Every one of these is a `Battle.execute` path that no other test reaches: the DumbAi that drives
// the golden transcripts only attacks, charges, steps and moves.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import {
  aidAnotherAction,
  attackAction,
  bullRushAction,
  coupDeGraceAction,
  disarmAction,
  fullAttackAction,
  moveAction,
  overrunAction,
  retrieveWeaponAction,
  setOverrunStanceAction,
  tripAction,
} from '../src/engine/combat-action';
import { Armors, Weapons } from '../src/engine/catalogs';
import { combatant } from './support/character-builder';

const ARENA = 10;

/** Everyone here is a plain BAB +1 fighter with a longsword: the manoeuvre is what varies. */
const brawler = (name: string, x: number, y: number, side: 'A' | 'B', strength = 10): Character =>
  combatant(name).str(strength).bab(1).at(x, y).on(side).build();

const battleOf = (rolls: number[], ...combatants: Character[]): Battle =>
  new Battle(new Grid(ARENA, ARENA), new SequenceRandom(...rolls), combatants);

describe('trip', () => {
  // SRD Trip: the manoeuvre is an unarmed touch attack, so it draws the target's attack of
  // opportunity first, then the touch attack, then the opposed check (and the counter-trip).
  // Both fighters have STR 10 (+0), so the opposed checks are decided by the d20 alone.
  const TARGET_ATTACK_OF_OPPORTUNITY_MISSES = 8; // BAB +1 against AC 10
  const ATTACKER_TOUCH_ATTACK_HITS = 9; // BAB +1 against touch AC 10

  /**
   * The target rolls initiative first and passes, so the trip lands on someone who has already
   * taken a turn — the shape the SRD wants for an attack of opportunity.
   */
  const tripBattle = (...manoeuvreRolls: number[]) => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 0, 1, 'B');
    const battle = battleOf([1, 5, ...manoeuvreRolls], attacker, target);
    battle.endTurn(); // the target's own turn, spent doing nothing
    return { attacker, target, battle };
  };

  it('knocks the target prone when the attacker wins the opposed check', () => {
    const { battle, target } = tripBattle(
      TARGET_ATTACK_OF_OPPORTUNITY_MISSES,
      ATTACKER_TOUCH_ATTACK_HITS,
      15,
      10,
    );

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(true);
  });

  // SRD: "If you lose, the defender may immediately react and make a Strength check opposed by your
  // Dexterity or Strength check to try to trip you." Any loss — the margin of ten the engine used to
  // want is a Pathfinder rule, not a 3.5 one.
  it('trips the attacker back on a check lost by six', () => {
    const { battle, attacker, target } = tripBattle(
      TARGET_ATTACK_OF_OPPORTUNITY_MISSES,
      ATTACKER_TOUCH_ATTACK_HITS,
      8,
      14, // the trip is lost by six
      16,
      5, // and the counter-trip lands
    );

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(false);
    expect(attacker.isProne).toBe(true);
  });

  it('trips the attacker back on a check lost by eleven, no differently', () => {
    const { battle, attacker, target } = tripBattle(
      TARGET_ATTACK_OF_OPPORTUNITY_MISSES,
      ATTACKER_TOUCH_ATTACK_HITS,
      3,
      14,
      16,
      5,
    );

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(false);
    expect(attacker.isProne).toBe(true);
  });

  // SRD: "Make an unarmed melee touch attack against your target." No touch, no contest.
  it('ends on the spot when the unarmed touch attack misses', () => {
    const { battle, attacker, target } = tripBattle(
      TARGET_ATTACK_OF_OPPORTUNITY_MISSES,
      2, // BAB +1 against touch AC 10: nowhere near
    );

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(false);
    expect(attacker.isProne).toBe(false);
  });

  // SRD: "make a Strength check opposed by the defender's Dexterity or Strength check (whichever
  // ability score has the higher modifier)."
  it('lets a nimble defender resist with Dexterity instead of Strength', () => {
    const attacker = combatant('Attacker').str(14).bab(1).at(0, 0).on('A').build();
    const target = combatant('Target').dex(18).bab(1).at(0, 1).on('B').build();
    // Attacker 15 + STR 2 = 17; the defender's 14 + DEX 4 = 18 wins, where 14 + STR 0 would lose.
    const battle = battleOf([1, 5, 8, 12, 15, 14, 5, 10], attacker, target);
    battle.endTurn();

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(false);
  });

  it('trips the same defender on the same dice once the Dexterity is ordinary', () => {
    const attacker = combatant('Attacker').str(14).bab(1).at(0, 0).on('A').build();
    const target = combatant('Target').bab(1).at(0, 1).on('B').build(); // DEX 10 this time
    const battle = battleOf([1, 5, 8, 12, 15, 14], attacker, target);
    battle.endTurn();

    battle.execute(tripAction(target));

    expect(target.isProne).toBe(true);
  });

  // SRD: "Make an unarmed melee touch attack against your target. This provokes an attack of
  // opportunity from your target as normal for unarmed attacks."
  it('provokes an attack of opportunity from the target', () => {
    // The target's AoO lands (d20 15, then 1d8 = 4); the manoeuvre then draws its own dice.
    const { attacker, target, battle } = tripBattle(15, 4, ATTACKER_TOUCH_ATTACK_HITS, 3, 3);

    battle.execute(tripAction(target));

    expect(attacker.currentHitPoints).toBeLessThan(20);
    expect(target.availableAttacksOfOpportunityCount).toBe(0);
  });

  it('refuses a target that is not adjacent', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 5, 5, 'B');
    const battle = battleOf([5, 1], attacker, target);

    expect(() => battle.execute(tripAction(target))).toThrow();
  });

  it('refuses a target that is already down', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 0, 1, 'B');
    target.takeDamage(21); // 20 HP − 21 = −1 → Dying
    const battle = battleOf([5, 1], attacker, target);

    expect(() => battle.execute(tripAction(target))).toThrow();
  });
});

describe('bull rush', () => {
  it('pushes the target five feet back along the line of the shove', () => {
    // Attacker (0,0) shoves the target at (1,0): direction (+1,0), so the target lands on (2,0).
    // 15 against 12 is a margin of three, under the five that would buy a second square.
    // The target is still flat-footed, so no attack of opportunity precedes the contest.
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const battle = battleOf([5, 1, 15, 12], attacker, target);

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 2, y: 0 });
  });

  // SRD: "If you wish to move with the defender, you can push him back an additional 5 feet for
  // each 5 points by which your check result is greater than the defender's check result."
  it('follows the target through the extra distance the margin buys', () => {
    // STR 20 (+5) against STR 3 (−4) on the same d20: a margin of nine, so one extra square.
    const attacker = brawler('Attacker', 0, 0, 'A', 20);
    const target = brawler('Target', 1, 0, 'B', 3);
    const battle = battleOf([5, 1, 3, 3], attacker, target);

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 3, y: 0 });
    expect(attacker.position).toEqual({ x: 1, y: 0 });
  });

  // SRD: "You can't, however, exceed your normal movement limit."
  it('stops the extra distance at the attacker’s own movement limit', () => {
    // 5 + 5 against 1 − 4: a margin of thirteen, worth two extra squares. A speed of 5 ft pays for
    // one of them, so the target lands on (3,0) and not on (4,0).
    const slowAttacker = combatant('Slow').str(20).bab(1).movingAt(5).at(0, 0).on('A').build();
    const target = brawler('Target', 1, 0, 'B', 3);
    const battle = battleOf([5, 1, 5, 1], slowAttacker, target);

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 3, y: 0 });
    expect(slowAttacker.position).toEqual({ x: 1, y: 0 });
  });

  // SRD: "If you fail to beat the defender's Strength check result, you move 5 feet straight back
  // to where you were before you moved into his space."
  it('sends the attacker five feet straight back when the defender wins', () => {
    const attacker = brawler('Attacker', 1, 0, 'A');
    const target = brawler('Target', 2, 0, 'B');
    const battle = battleOf([5, 1, 5, 15], attacker, target);

    battle.execute(bullRushAction(target));

    expect(attacker.position).toEqual({ x: 0, y: 0 });
    expect(attacker.isProne).toBe(false);
    expect(target.position).toEqual({ x: 2, y: 0 });
  });

  // SRD: "If that space is occupied, you fall prone in that space."
  it('leaves the attacker prone when the square it would fall back into is taken', () => {
    const attacker = brawler('Attacker', 1, 0, 'A');
    const target = brawler('Target', 2, 0, 'B');
    const ally = brawler('Ally', 0, 0, 'A');
    const battle = battleOf([5, 4, 1, 5, 15], attacker, target, ally);

    battle.execute(bullRushAction(target));

    expect(attacker.position).toEqual({ x: 1, y: 0 });
    expect(attacker.isProne).toBe(true);
  });

  it('leaves the target in place when the square behind it is occupied', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const wall = brawler('Wall', 2, 0, 'B');
    const battle = battleOf([5, 4, 1, 15, 8], attacker, target, wall);

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 1, y: 0 });
  });

  it('leaves the target in place when the push would leave the grid', () => {
    const attacker = brawler('Attacker', 8, 0, 'A');
    const target = brawler('Target', 9, 0, 'B');
    const battle = battleOf([5, 1, 15, 8], attacker, target);

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 9, y: 0 });
  });

  // The attacker is in the corner, so the 5-ft retreat a lost check calls for has nowhere to go and
  // leaves it prone where it stands — see the two tests below for the retreat itself.
  it('moves nobody when the defender wins the opposed check', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const battle = battleOf([5, 1, 5, 15], attacker, target);

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 1, y: 0 });
    expect(attacker.position).toEqual({ x: 0, y: 0 });
  });

  it('provokes an attack of opportunity that can stop the shove before the contest', () => {
    // The shove provokes from every threatening enemy except its own target. Guardian's AoO
    // (d20 15, 1d8 = 8) drops an attacker already down to 7 HP, so no contest is ever rolled.
    // The guardian rolls initiative first and passes, so its AoO comes from someone who has
    // already acted rather than from a flat-footed combatant.
    const attacker = brawler('Attacker', 0, 0, 'A');
    attacker.takeDamage(13);
    const target = brawler('Target', 1, 0, 'B');
    const guardian = brawler('Guardian', 0, 1, 'B');
    const battle = battleOf([2, 1, 5, 15, 8], attacker, target, guardian);
    battle.endTurn();

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 1, y: 0 });
    expect(attacker.isDefeated).toBe(true);
  });
});

describe('overrun', () => {
  // SRD Step 2: "The defender has the option to simply avoid you." It is the defender's choice, not
  // a consequence of which side they are on: an enemy that does not declare it is contested, rather
  // than stepping aside automatically while only allies get the contest.
  it('contests an enemy that does not choose to avoid', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const battle = battleOf([5, 1, 15, 8], attacker, target);

    battle.execute(overrunAction(target, { x: 2, y: 0 }));

    expect(attacker.position).toEqual({ x: 2, y: 0 });
    expect(target.isProne).toBe(true);
  });

  // SRD Step 3: "If you lose, the defender may immediately react and make a Strength check […] to
  // try to knock you prone." A Strength check, not a free attack. Step 4: "you have to move 5 feet
  // back the way you came, ending your movement there."
  it('sends the attacker five feet back on a lost check, with no free attack', () => {
    // Contest 5 vs 15, then the defender's counter-check (15 against 5) knocks the attacker down.
    const attacker = brawler('Attacker', 1, 0, 'A');
    const defender = brawler('Defender', 2, 0, 'B');
    const battle = battleOf([5, 1, 5, 15, 15, 5], attacker, defender);

    battle.execute(overrunAction(defender, { x: 3, y: 0 }));

    expect(attacker.position).toEqual({ x: 0, y: 0 });
    expect(attacker.isProne).toBe(true);
    expect(attacker.currentHitPoints).toBe(20);
  });

  // SRD Step 2: "The defender has the option to simply avoid you. If he avoids you, he doesn't
  // suffer any ill effect and you may keep moving." The engine cannot ask a defender who is not on
  // turn, so the choice is a stance the defender declares on its own turn and keeps until it
  // changes it.
  it('lets a defender who has declared the stance simply step aside', () => {
    // The defender goes first, declares the stance, and still gets its Step 1 attack of opportunity
    // (d20 3, a miss). Nothing else is queued, so a contest would run the sequence dry and say so.
    const attacker = brawler('Attacker', 0, 0, 'A');
    const defender = brawler('Defender', 1, 0, 'B');
    const battle = battleOf([1, 5, 3], attacker, defender);
    battle.execute(setOverrunStanceAction(true));
    battle.endTurn();

    battle.execute(overrunAction(defender, { x: 2, y: 0 }));

    expect(attacker.position).toEqual({ x: 2, y: 0 });
    expect(defender.isProne).toBe(false);
    expect(attacker.isProne).toBe(false);
  });

  it('costs the defender nothing to declare it', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const defender = brawler('Defender', 1, 0, 'B');
    const battle = battleOf([1, 5], attacker, defender);

    battle.execute(setOverrunStanceAction(true));

    expect(defender.avoidsOverruns).toBe(true);
    expect(battle.hasMovementAvailable).toBe(true);
    expect(battle.hasStandardActionAvailable).toBe(true);
  });

  it('goes back to blocking when the defender drops the stance', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const defender = brawler('Defender', 1, 0, 'B');
    // The attack of opportunity misses (d20 3), then the contest: 15 against 8.
    const battle = battleOf([1, 5, 3, 15, 8], attacker, defender);
    battle.execute(setOverrunStanceAction(true));
    battle.execute(setOverrunStanceAction(false));
    battle.endTurn();

    battle.execute(overrunAction(defender, { x: 2, y: 0 }));

    expect(defender.isProne).toBe(true);
  });

  // SRD Step 4: "If you fail but are not knocked prone, you have to move 5 feet back the way you
  // came, ending your movement there."
  it('sends the attacker back on its feet when the counter-check misses', () => {
    // Contest 5 against 15, then the defender's counter-check (5 against 15) fails.
    const attacker = brawler('Attacker', 1, 0, 'A');
    const defender = brawler('Defender', 2, 0, 'B');
    const battle = battleOf([5, 1, 5, 15, 5, 15], attacker, defender);

    battle.execute(overrunAction(defender, { x: 3, y: 0 }));

    expect(attacker.position).toEqual({ x: 0, y: 0 });
    expect(attacker.isProne).toBe(false);
    expect(defender.isProne).toBe(false);
  });

  it('refuses a destination that is occupied', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const blocker = brawler('Blocker', 2, 0, 'B');
    const battle = battleOf([5, 3, 1], attacker, target, blocker);

    expect(() => battle.execute(overrunAction(target, { x: 2, y: 0 }))).toThrow();
  });

  it('refuses a target that is not adjacent', () => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 5, 5, 'B');
    const battle = battleOf([5, 1], attacker, target);

    expect(() => battle.execute(overrunAction(target, { x: 6, y: 5 }))).toThrow();
  });
});

describe('disarm', () => {
  // SRD Disarm draws the target's attack of opportunity first, then a single opposed attack roll,
  // then the counter-disarm. Both brawlers have BAB +1 and STR 10 unless the test says otherwise.
  const TARGET_ATTACK_OF_OPPORTUNITY_MISSES = 8; // BAB +1 against AC 10

  /** The target rolls initiative first and passes, so it has already acted when the disarm lands. */
  const duel = (...manoeuvreRolls: number[]) => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 0, 1, 'B');
    const battle = battleOf([1, 5, ...manoeuvreRolls], attacker, target);
    battle.endTurn();
    return { attacker, target, battle };
  };

  // SRD Step 1: "You provoke an attack of opportunity from the target you are trying to disarm."
  it('provokes an attack of opportunity from the target', () => {
    // The target's AoO lands: d20 15 (+1 BAB) beats AC 10, longsword 1d8 = 4.
    const { attacker, target, battle } = duel(15, 4);

    battle.execute(disarmAction(target));

    expect(attacker.currentHitPoints).toBeLessThan(20);
    expect(target.availableAttacksOfOpportunityCount).toBe(0);
  });

  // SRD Step 1: "If the defender's attack of opportunity deals any damage, your disarm attempt fails."
  it('is stopped outright when that attack of opportunity draws blood', () => {
    const { target, battle } = duel(15, 4);

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(false);
  });

  // SRD Step 2 is the whole resolution: "You and the defender make opposed attack rolls with your
  // respective weapons." There is no separate roll against the defender's AC, and a natural 1 is
  // nothing special in an opposed check.
  it('resolves as one opposed attack roll, with no separate roll against AC', () => {
    // A natural 1 against the defender's 3: with BAB +10 on the attacker the opposed total is 11
    // against 4, so the weapon comes free. A roll against AC would have thrown it away.
    const attacker = combatant('Attacker').bab(10).at(0, 0).on('A').build();
    const target = combatant('Target').bab(1).at(0, 1).on('B').build();
    // The target's attack of opportunity is a natural 1, so it draws no blood.
    const battle = battleOf([1, 5, 1, 1, 3], attacker, target);
    battle.endTurn();

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(true);
  });

  it('disarms the target when the attacker wins the opposed check', () => {
    const { battle, attacker, target } = duel(TARGET_ATTACK_OF_OPPORTUNITY_MISSES, 15, 10);

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(true);
    expect(attacker.isDisarmed).toBe(false);
  });

  // SRD Step 3: "If you fail on the disarm attempt, the defender may immediately react and attempt
  // to disarm you with the same sort of opposed melee attack roll." Any failure.
  it('lets the defender counter-disarm on a check lost by four', () => {
    // 14 − 10 = 4, well under the ten the engine used to insist on before turning the manoeuvre
    // around — a margin that is a Pathfinder rule, not a 3.5 one.
    const { battle, attacker, target } = duel(TARGET_ATTACK_OF_OPPORTUNITY_MISSES, 10, 14, 15, 5);

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(false);
    expect(attacker.isDisarmed).toBe(true);
  });

  // SRD Step 2: "the wielder of a light weapon takes a -4 penalty. (An unarmed strike is considered
  // a light weapon, so you always take a penalty when trying to disarm an opponent by using an
  // unarmed strike.)"
  it('costs an unarmed attacker four on the opposed roll', () => {
    // Same d20 (3) for both sides and the same BAB and Strength, so only the −4 for the unarmed
    // strike separates them: 9 against 13, and the attempt has to fail. Without that −4 both make
    // 13 and the attacker takes the tie. The full plate is there only so the target's attack of
    // opportunity misses (7 + 10 against AC 18) and nothing but the penalty decides the outcome.
    const attacker = combatant('Attacker').bab(10).wearing(Armors.fullPlate()).at(0, 0).on('A').build();
    const target = combatant('Target').bab(10).at(1, 0).on('B').build();
    attacker.markDisarmed(); // an unarmed strike is a light weapon
    const battle = battleOf([1, 5, 7, 3, 3, 3, 3], attacker, target);
    battle.endTurn();

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(false);
  });

  it('gives the wielder of a two-handed weapon four on the same roll', () => {
    // Same dice as above, mirrored: the attacker's greatsword makes 3 + 10 + 4 = 17 against 13.
    const attacker = combatant('Attacker').bab(10).wielding(Weapons.greatsword()).at(0, 0).on('A').build();
    const target = combatant('Target').bab(10).at(1, 0).on('B').build();
    const battle = battleOf([1, 5, 1, 3, 3], attacker, target);
    battle.endTurn();

    battle.execute(disarmAction(target));

    expect(target.isDisarmed).toBe(true);
  });

  // SRD: "As a melee attack, you may attempt to disarm your opponent." A bow makes no melee attack.
  it('refuses a disarm attempted with a ranged weapon', () => {
    const archer = combatant('Archer').bab(10).wielding(Weapons.shortbow()).at(0, 0).on('A').build();
    const target = combatant('Target').bab(10).at(1, 0).on('B').build();
    const battle = battleOf([1, 5], archer, target);
    battle.endTurn();

    expect(() => battle.execute(disarmAction(target))).toThrow(/melee/);
  });

  // SRD: "If the targeted item isn't a melee weapon, the defender takes a -4 penalty on the roll."
  // The bow needs two hands, but that is not the two-handed melee category the +4 belongs to.
  it('costs the target four when what it holds is a bow, instead of paying it four', () => {
    const attacker = combatant('Attacker').bab(10).wearing(Armors.fullPlate()).at(0, 0).on('A').build();
    const archer = combatant('Archer').bab(10).wielding(Weapons.shortbow()).at(1, 0).on('B').build();
    // A bow threatens nothing, so there is no attack of opportunity to roll: the dice
    // are the opposed check alone, 3 + 10 = 13 against 3 + 10 − 4 = 9.
    const battle = battleOf([1, 5, 3, 3], attacker, archer);
    battle.endTurn();

    battle.execute(disarmAction(archer));

    expect(archer.isDisarmed).toBe(true);
  });

  // SRD: the defender holding something that is not a melee weapon "can't attempt to disarm you in
  // return if your attempt fails".
  it('denies that target the counter-disarm when the attempt fails', () => {
    const attacker = combatant('Attacker').bab(10).wearing(Armors.fullPlate()).at(0, 0).on('A').build();
    const archer = combatant('Archer').bab(10).wielding(Weapons.shortbow()).at(1, 0).on('B').build();
    // A bow threatens nothing, so no attack of opportunity is rolled.
    // 1 + 10 = 11 against 20 + 10 − 4 = 26: the attacker loses, and nothing comes back.
    const battle = battleOf([1, 5, 1, 20], attacker, archer);
    battle.endTurn();

    battle.execute(disarmAction(archer));

    expect(archer.isDisarmed).toBe(false);
    expect(attacker.isDisarmed).toBe(false);
  });

  it('leaves a disarmed combatant fighting with an unarmed strike', () => {
    const fighter = brawler('Fighter', 0, 0, 'A');

    fighter.markDisarmed();

    expect(fighter.activeWeapon.name).toBe('Unarmed Strike');
  });

  it('picks the weapon back up, unopposed when nobody threatens', () => {
    // The enemy acts first, so distance — not the flat-footed clause — is what keeps it silent.
    const actor = brawler('Actor', 0, 0, 'A');
    const enemy = brawler('Enemy', 9, 9, 'B');
    actor.markDisarmed();
    const battle = battleOf([1, 5], actor, enemy);
    battle.endTurn();

    battle.execute(retrieveWeaponAction());

    expect(actor.isDisarmed).toBe(false);
  });

  // SRD: picking a dropped weapon up is a move action, so a full attack has already spent the
  // round on everything but a 5-ft step.
  it('cannot be picked back up after a full attack', () => {
    const actor = combatant('Actor').bab(6).at(0, 0).on('A').build();
    const enemy = brawler('Enemy', 1, 0, 'B');
    const battle = battleOf([5, 1, 10, 4, 10, 3], actor, enemy);
    battle.execute(fullAttackAction(enemy));
    actor.markDisarmed();

    expect(() => battle.execute(retrieveWeaponAction())).toThrow(/move action/);
  });

  it('provokes an attack of opportunity while picking the weapon back up', () => {
    // Enemy AoO: d20 15 (+1 BAB) beats AC 10, longsword 1d8 = 6.
    // The enemy rolls initiative first and passes: it has acted, so it is no longer flat-footed and its AoO is legitimate.
    const actor = brawler('Actor', 0, 0, 'A');
    const enemy = brawler('Enemy', 0, 1, 'B');
    actor.markDisarmed();
    const battle = battleOf([1, 5, 15, 6], actor, enemy);
    battle.endTurn();

    battle.execute(retrieveWeaponAction());

    expect(actor.isDisarmed).toBe(false);
    expect(actor.currentHitPoints).toBe(14);
  });
});

describe('coup de grâce', () => {
  // Longsword: 1d8, crit ×2 — a coup de grâce is an automatic critical, so it rolls two dice.
  const helplessDuel = (rolls: number[]) => {
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    return { attacker, target, battle: battleOf([2, 1, ...rolls], attacker, target) };
  };

  it('kills the target outright when the Fortitude save fails', () => {
    // Damage 5+5 = 10 → DC 20; a natural 1 always fails.
    const { battle, target } = helplessDuel([5, 5, 1]);
    target.takeDamage(21); // −1 → Dying

    battle.execute(coupDeGraceAction(target));

    expect(target.vitalStatus).toBe('Dead');
  });

  it('leaves the target dying, not dead, when the save succeeds', () => {
    // Damage 3+3 = 6 → DC 16; a natural 20 always succeeds. −1 − 6 = −7.
    const { battle, target } = helplessDuel([3, 3, 20]);
    target.takeDamage(21);

    battle.execute(coupDeGraceAction(target));

    expect(target.vitalStatus).toBe('Dying');
    expect(target.currentHitPoints).toBe(-7);
  });

  // The coup de grâce is the one place that tells 'Stable' from 'Dead' apart, so it is where the
  // −10 rule shows: someone who stabilized and was then beaten down to −10 is a corpse, not a
  // helpless target.
  it('refuses a target who stabilized but is already at −10', () => {
    const { battle, target } = helplessDuel([]);
    target.takeDamage(21); // −1: dying
    target.stabilize();
    target.takeDamage(9); // −10

    expect(() => battle.execute(coupDeGraceAction(target))).toThrow(/Dying or Stable/);
  });

  it('rolls the weapon damage twice, as the automatic critical demands', () => {
    // Two dice (4 and 3) land: −1 − 7 = −8. A single die would have left the target at −5.
    const { battle, target } = helplessDuel([4, 3, 20]);
    target.takeDamage(21);

    battle.execute(coupDeGraceAction(target));

    expect(target.currentHitPoints).toBe(-8);
  });

  // SRD: "Delivering a coup de grace provokes attacks of opportunity from threatening opponents."
  it('provokes an attack of opportunity from a second enemy standing over the attacker', () => {
    // Initiative 3/2/1 puts the guard on turn first, so it is no longer flat-footed when it strikes.
    // AoO d20 15 (+BAB 1) beats AC 10 for 1d8 = 6. Then the coup de grâce rolls 4+3 = 7 (auto crit,
    // two dice) against a target at −1, and a natural 20 always saves.
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const guard = brawler('Guard', 0, 1, 'B');
    const battle = battleOf([2, 1, 3, 15, 6, 4, 3, 20], attacker, target, guard);
    target.takeDamage(21);
    battle.endTurn(); // guard → attacker

    battle.execute(coupDeGraceAction(target));

    expect(attacker.currentHitPoints).toBe(20 - 6);
    expect(guard.availableAttacksOfOpportunityCount).toBe(0);
    expect(target.currentHitPoints).toBe(-8);
  });

  it('refuses a target that is still conscious', () => {
    const { battle, target } = helplessDuel([]);

    expect(() => battle.execute(coupDeGraceAction(target))).toThrow();
  });

  it('refuses a target that is already dead', () => {
    const { battle, target } = helplessDuel([]);
    target.takeDamage(30); // clamped to −10 → Dead

    expect(() => battle.execute(coupDeGraceAction(target))).toThrow();
  });
});

describe('aid another', () => {
  // Helper (0,0) and ally (1,0) on side A, enemy (1,1) adjacent to the ally. Initiative 15/10/5
  // puts the helper on turn first.
  const aidBattle = (rollsAfterInitiative: number[]) => {
    const helper = brawler('Helper', 0, 0, 'A');
    const ally = brawler('Ally', 1, 0, 'A');
    const enemy = brawler('Enemy', 1, 1, 'B');
    const battle = battleOf([15, 10, 5, ...rollsAfterInitiative], helper, ally, enemy);
    return { helper, ally, enemy, battle };
  };

  it('grants the ally +2 on its next attack when the aid roll beats DC 10', () => {
    const { battle, ally } = aidBattle([12]);

    battle.execute(aidAnotherAction(ally, 'AttackRoll'));

    expect(ally.aidAnotherAttackBonus).toBe(2);
  });

  it('grants the ally +2 AC instead when that benefit is chosen', () => {
    const { battle, ally } = aidBattle([14]);
    const armorClassBefore = ally.effectiveArmorClass;

    battle.execute(aidAnotherAction(ally, 'ArmorClass'));

    expect(ally.effectiveArmorClass).toBe(armorClassBefore + 2);
  });

  it('grants nothing when the aid roll falls short of DC 10', () => {
    const { battle, ally } = aidBattle([7]);
    const armorClassBefore = ally.effectiveArmorClass;

    battle.execute(aidAnotherAction(ally, 'AttackRoll'));

    expect(ally.aidAnotherAttackBonus).toBe(0);
    expect(ally.effectiveArmorClass).toBe(armorClassBefore);
  });

  it('spends the attack bonus on the first attack that uses it', () => {
    // Granted directly here: the point under test is that attacking consumes it, not how it arrives.
    const { battle, helper, ally, enemy } = aidBattle([10, 4]);
    battle.endTurn(); // helper → ally
    ally.grantAttackAid(helper);
    expect(ally.aidAnotherAttackBonus).toBe(2);

    battle.execute({ kind: 'attack', target: enemy, powerAttackPenalty: 0 });

    expect(ally.aidAnotherAttackBonus).toBe(0);
  });

  // SRD: the bonus holds "as long as that attack comes before the beginning of your next turn" —
  // the helper's next turn. It survives the ally's whole turn and dies when the helper comes round.
  it('wipes the bonus when the helper’s own next turn comes round', () => {
    const { battle, helper, ally } = aidBattle([12]);
    battle.execute(aidAnotherAction(ally, 'AttackRoll'));
    expect(ally.aidAnotherAttackBonus).toBe(2);

    battle.endTurn(); // helper → ally
    battle.endTurn(); // ally → enemy
    battle.endTurn(); // enemy → helper, a round later

    expect(battle.currentActor).toBe(helper);
    expect(ally.aidAnotherAttackBonus).toBe(0);
  });

  // SRD: the +2 to AC runs on the same clock as the +2 to attack — "as long as that attack comes
  // before the beginning of your next turn", the helper's. It has to survive the ally's own turn.
  it('keeps the +2 AC into the aided ally’s own turn', () => {
    const { battle, ally } = aidBattle([12]);
    const armorClassBefore = ally.effectiveArmorClass;
    battle.execute(aidAnotherAction(ally, 'ArmorClass'));

    battle.endTurn(); // helper → ally

    expect(battle.currentActor).toBe(ally);
    expect(ally.effectiveArmorClass).toBe(armorClassBefore + 2);
  });

  it('wipes the +2 AC when the helper’s own next turn comes round', () => {
    const { battle, helper, ally } = aidBattle([12]);
    const armorClassBefore = ally.effectiveArmorClass;
    battle.execute(aidAnotherAction(ally, 'ArmorClass'));

    battle.endTurn(); // helper → ally
    battle.endTurn(); // ally → enemy
    battle.endTurn(); // enemy → helper, a round later

    expect(battle.currentActor).toBe(helper);
    expect(ally.effectiveArmorClass).toBe(armorClassBefore);
  });

  // SRD: "If you're in a position to make a melee attack on an opponent that is engaging a friend
  // in melee" — the helper has to threaten that opponent too, not merely stand next to the friend.
  it('refuses to aid against an enemy the helper cannot reach', () => {
    const helper = brawler('Helper', 0, 0, 'A');
    const ally = brawler('Ally', 1, 0, 'A');
    const distantEnemy = brawler('Enemy', 2, 0, 'B');
    const battle = battleOf([15, 10, 5], helper, ally, distantEnemy);

    expect(() => battle.execute(aidAnotherAction(ally, 'AttackRoll'))).toThrow(/reach/);
  });
});

describe('bull rush: provoking and extra push', () => {
  // SRD: "Doing this provokes an attack of opportunity from each opponent that threatens you,
  // including the defender."
  it('provokes an attack of opportunity from the defender too', () => {
    // The target rolls initiative first and passes, so it is not flat-footed when the shove
    // provokes it.
    const attacker = brawler('Attacker', 0, 0, 'A');
    const target = brawler('Target', 1, 0, 'B');
    const battle = battleOf([1, 2, 15, 4, 3, 3, 3, 3], attacker, target);
    battle.endTurn();

    battle.execute(bullRushAction(target));

    expect(attacker.currentHitPoints).toBeLessThan(20);
    expect(target.availableAttacksOfOpportunityCount).toBe(0);
  });

  // SRD: "you can push him back an additional 5 feet for each 5 points by which your check result
  // is greater than the defender's check result."
  it('pushes five feet further for every five points of margin', () => {
    // Same d20 for both, STR 20 (+5) against STR 3 (−4): a margin of nine, so 5 ft plus one more
    // 5-ft increment — two squares in all.
    const attacker = brawler('Attacker', 0, 0, 'A', 20);
    const target = brawler('Target', 1, 0, 'B', 3);
    const battle = battleOf([1, 2, 3, 3, 3, 3], attacker, target);
    battle.endTurn(); // the target has acted, so it can answer the shove

    battle.execute(bullRushAction(target));

    expect(target.position).toEqual({ x: 3, y: 0 });
  });
});

describe('aid another, the full path', () => {
  const trio = (rolls: number[]) => {
    const helper = combatant('Helper').bab(5).at(0, 0).on('A').build();
    const ally = combatant('Ally').bab(1).at(1, 0).on('A').build();
    const enemy = combatant('Enemy').bab(1).at(1, 1).on('B').build();
    return { helper, ally, enemy, battle: battleOf([15, 10, 5, ...rolls], helper, ally, enemy) };
  };

  // SRD: "You make an attack roll against AC 10" — d20 plus the attack bonus, not a bare d20.
  it('rolls an attack against AC 10, not a bare d20', () => {
    // A natural 5 is short of 10 on its own; with BAB +5 it reaches exactly 10 and succeeds.
    const { battle, ally } = trio([5]);

    battle.execute(aidAnotherAction(ally, 'AttackRoll'));

    expect(ally.aidAnotherAttackBonus).toBe(2);
  });

  // SRD: the bonus holds "as long as that attack comes before the beginning of *your* next turn" —
  // the helper's next turn, so the ally can still spend it when its own turn comes round.
  it('survives into the aided ally’s own turn', () => {
    const { battle, ally, enemy } = trio([15, 15, 4]);
    battle.execute(aidAnotherAction(ally, 'AttackRoll'));

    battle.endTurn(); // helper → ally

    expect(battle.currentActor).toBe(ally);
    expect(ally.aidAnotherAttackBonus).toBe(2);
    battle.execute(attackAction(enemy));
    expect(ally.aidAnotherAttackBonus).toBe(0);
  });
});

describe('the read-only predicates the arena menu asks before offering a manoeuvre', () => {
  // The contract under test is not "the predicate says yes" but "the predicate agrees with
  // `execute`": every row builds two identical battles, asks one and executes the other. A row
  // where the two disagree is a menu entry that would fail after being offered, which is exactly
  // what the predicates exist to prevent. The queued faces are plenty for any manoeuvre: what is
  // left unused does not matter, and a 5 fits every die a manoeuvre rolls (d20, d8, d6).
  const PLENTY_OF_FACES = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

  interface Scenario {
    readonly name: string;
    readonly expected: boolean;
    readonly build: () => { battle: Battle; target: Character };
    readonly ask: (battle: Battle, target: Character) => boolean;
    readonly act: (battle: Battle, target: Character) => unknown;
  }

  /** Attacker first in initiative (20 against 1), target where the row wants it. */
  const duel = (targetX: number, targetY: number, attackerWeapon = Weapons.longsword()) => {
    const attacker = combatant('Attacker').bab(1).wielding(attackerWeapon).at(0, 0).on('A').build();
    const target = brawler('Target', targetX, targetY, 'B');
    const battle = battleOf([20, 1, ...PLENTY_OF_FACES], attacker, target);
    return { battle, target, attacker };
  };

  const spendTheStandardAction = (battle: Battle, target: Character): void => {
    battle.execute(attackAction(target));
  };

  const manoeuvreRows = (
    kind: string,
    ask: Scenario['ask'],
    act: Scenario['act'],
  ): Scenario[] => [
    { name: `${kind}: adjacent enemy on a fresh turn`, expected: true, build: () => duel(1, 0), ask, act },
    { name: `${kind}: enemy two squares away`, expected: false, build: () => duel(2, 0), ask, act },
    {
      name: `${kind}: the standard action is already spent`,
      expected: false,
      build: () => {
        const scenario = duel(1, 0);
        spendTheStandardAction(scenario.battle, scenario.target);
        return scenario;
      },
      ask,
      act,
    },
    {
      name: `${kind}: the target is already down`,
      expected: false,
      build: () => {
        const scenario = duel(1, 0);
        scenario.target.takeDamage(21);
        return scenario;
      },
      ask,
      act,
    },
    {
      name: `${kind}: the target is the attacker itself`,
      expected: false,
      build: () => {
        const scenario = duel(1, 0);
        return { battle: scenario.battle, target: scenario.attacker };
      },
      ask,
      act,
    },
  ];

  const rows: Scenario[] = [
    ...manoeuvreRows('trip', (b, t) => b.canTrip(t), (b, t) => b.execute(tripAction(t))),
    ...manoeuvreRows('bull rush', (b, t) => b.canBullRush(t), (b, t) => b.execute(bullRushAction(t))),
    ...manoeuvreRows('disarm', (b, t) => b.canDisarm(t), (b, t) => b.execute(disarmAction(t))),
    {
      name: 'disarm: a ranged weapon cannot disarm',
      expected: false,
      build: () => duel(1, 0, Weapons.shortbow()),
      ask: (b, t) => b.canDisarm(t),
      act: (b, t) => b.execute(disarmAction(t)),
    },
    {
      name: 'coup de grâce: dying target within reach',
      expected: true,
      build: () => {
        const scenario = duel(1, 0);
        scenario.target.takeDamage(21);
        return scenario;
      },
      ask: (b, t) => b.canCoupDeGrace(t),
      act: (b, t) => b.execute(coupDeGraceAction(t)),
    },
    {
      name: 'coup de grâce: the target is still fighting',
      expected: false,
      build: () => duel(1, 0),
      ask: (b, t) => b.canCoupDeGrace(t),
      act: (b, t) => b.execute(coupDeGraceAction(t)),
    },
    {
      name: 'coup de grâce: the target is already dead',
      expected: false,
      build: () => {
        const scenario = duel(1, 0);
        scenario.target.takeDamage(30);
        return scenario;
      },
      ask: (b, t) => b.canCoupDeGrace(t),
      act: (b, t) => b.execute(coupDeGraceAction(t)),
    },
    {
      name: 'coup de grâce: dying target two squares away',
      expected: false,
      build: () => {
        const scenario = duel(2, 0);
        scenario.target.takeDamage(21);
        return scenario;
      },
      ask: (b, t) => b.canCoupDeGrace(t),
      act: (b, t) => b.execute(coupDeGraceAction(t)),
    },
    {
      name: 'coup de grâce: a full-round action needs the move action too',
      expected: false,
      build: () => {
        const scenario = duel(2, 0);
        scenario.target.takeDamage(21);
        scenario.battle.execute(moveAction({ x: 1, y: 0 }));
        return scenario;
      },
      ask: (b, t) => b.canCoupDeGrace(t),
      act: (b, t) => b.execute(coupDeGraceAction(t)),
    },
  ];

  it.each(rows)('$name', ({ expected, build, ask, act }) => {
    const asked = build();
    expect(ask(asked.battle, asked.target)).toBe(expected);

    const executed = build();
    const attempt = () => act(executed.battle, executed.target);
    if (expected) {
      expect(attempt).not.toThrow();
    } else {
      expect(attempt).toThrow();
    }
  });

  describe('aid another', () => {
    // Helper (0,0), ally (1,0), enemy where the row puts it. Initiative 15/10/5: helper first.
    const party = (enemyX: number, enemyY: number) => {
      const helper = brawler('Helper', 0, 0, 'A');
      const ally = brawler('Ally', 1, 0, 'A');
      const enemy = brawler('Enemy', enemyX, enemyY, 'B');
      const battle = battleOf([15, 10, 5, ...PLENTY_OF_FACES], helper, ally, enemy);
      return { helper, ally, enemy, battle };
    };

    const aidRows: { name: string; expected: boolean; build: () => { battle: Battle; ally: Character } }[] = [
      { name: 'an enemy engages the ally within the helper’s reach', expected: true, build: () => party(1, 1) },
      { name: 'the enemy engages the ally out of the helper’s reach', expected: false, build: () => party(2, 1) },
      { name: 'no enemy engages the ally at all', expected: false, build: () => party(5, 5) },
      {
        name: 'the ally is already down',
        expected: false,
        build: () => {
          const scenario = party(1, 1);
          scenario.ally.takeDamage(21);
          return scenario;
        },
      },
      {
        name: 'the "ally" is the enemy',
        expected: false,
        build: () => {
          const scenario = party(1, 1);
          return { battle: scenario.battle, ally: scenario.enemy };
        },
      },
      {
        name: 'the "ally" is the helper itself',
        expected: false,
        build: () => {
          const scenario = party(1, 1);
          return { battle: scenario.battle, ally: scenario.helper };
        },
      },
      {
        name: 'the standard action is already spent',
        expected: false,
        build: () => {
          const scenario = party(1, 1);
          scenario.battle.execute(attackAction(scenario.enemy));
          return scenario;
        },
      },
    ];

    it.each(aidRows)('$name', ({ expected, build }) => {
      const asked = build();
      expect(asked.battle.canAidAnother(asked.ally)).toBe(expected);

      const executed = build();
      const attempt = () => executed.battle.execute(aidAnotherAction(executed.ally, 'AttackRoll'));
      if (expected) {
        expect(attempt).not.toThrow();
      } else {
        expect(attempt).toThrow();
      }
    });
  });
});
