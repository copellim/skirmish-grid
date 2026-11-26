// SRD Feats: https://www.d20srd.org/srd/feats.htm
//
// The feat infrastructure (prerequisites, duplicates, construction from class levels) and the four
// combat feats the engine implements: Power Attack, Cleave, Great Cleave, Weapon Focus.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { Armors, Weapons } from '../src/engine/catalogs';
import { Weapon } from '../src/engine/item';
import { CleaveFeat, GreatCleaveFeat, PowerAttackFeat, WeaponFocusFeat } from '../src/engine/feat';
import { CharacterClasses, ClassLevel } from '../src/engine/character-class';
import { attackAction, chargeAction, fullAttackAction, moveAction } from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const battleOf = (rolls: number[], ...combatants: Character[]): Battle =>
  new Battle(new Grid(5, 5), new SequenceRandom(...rolls), combatants);

const dummy = (): Character =>
  combatant('Dummy').hp(100).wielding(Weapons.dagger()).at(1, 0).on('B').build();

describe('feat prerequisites', () => {
  const strong = (): Character => combatant('Strong Fighter').str(14).hp(10).bab(1).build();

  it('refuses Power Attack below Strength 13', () => {
    const weak = combatant('Weak Fighter').str(12).hp(10).bab(1).build();

    expect(() => weak.addFeat(new PowerAttackFeat())).toThrow();
  });

  it('refuses Cleave without Power Attack', () => {
    expect(() => strong().addFeat(new CleaveFeat())).toThrow();
  });

  it('refuses Great Cleave without Cleave', () => {
    const character = strong();
    character.addFeat(new PowerAttackFeat());

    expect(() => character.addFeat(new GreatCleaveFeat())).toThrow();
  });

  it('refuses Weapon Focus at BAB +0', () => {
    const squire = combatant('Level 0').str(14).hp(10).bab(0).build();

    expect(() => squire.addFeat(new WeaponFocusFeat('Melee'))).toThrow();
  });

  it('refuses the same feat twice', () => {
    const character = strong();
    character.addFeat(new PowerAttackFeat());

    expect(() => character.addFeat(new PowerAttackFeat())).toThrow();
  });

  it('reports a feat it has, and one it has not', () => {
    const character = strong();
    expect(character.hasFeat(PowerAttackFeat)).toBe(false);

    character.addFeat(new PowerAttackFeat());

    expect(character.hasFeat(PowerAttackFeat)).toBe(true);
  });

  it('carries feats through construction from class levels', () => {
    const character = Character.fromClassLevels(
      'Fighter',
      new AbilitySet(
        new AbilityScore(14),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
      ),
      [new ClassLevel(CharacterClasses.fighter(), 1)],
      new SequenceRandom(),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
      null,
      null,
      [new PowerAttackFeat()],
    );

    expect(character.hasFeat(PowerAttackFeat)).toBe(true);
  });

  it('grants no passive attack bonus without feats', () => {
    expect(strong().passiveFeatAttackBonus('Melee')).toBe(0);
  });
});

describe('Weapon Focus', () => {
  // STR 14 (+2), DEX 12 (+1), BAB 2.
  const fighter = (weapon: Weapon): Character =>
    combatant('Fighter').str(14).dex(12).hp(10).bab(2).wielding(weapon).build();

  it('adds +1 to melee attacks for the melee choice', () => {
    const character = fighter(Weapons.longsword());
    const baseline = character.meleeAttackBonus;

    character.addFeat(new WeaponFocusFeat('Melee'));

    expect(character.meleeAttackBonus).toBe(baseline + 1);
  });

  it('leaves ranged attacks alone for the melee choice', () => {
    const character = fighter(Weapons.longsword());
    const baseline = character.rangedAttackBonus;

    character.addFeat(new WeaponFocusFeat('Melee'));

    expect(character.rangedAttackBonus).toBe(baseline);
  });

  it('adds +1 to ranged attacks for the ranged choice', () => {
    const character = fighter(Weapons.shortbow());
    const baseline = character.rangedAttackBonus;

    character.addFeat(new WeaponFocusFeat('Ranged'));

    expect(character.rangedAttackBonus).toBe(baseline + 1);
  });

  it('refuses the same weapon kind twice', () => {
    const character = fighter(Weapons.longsword());
    character.addFeat(new WeaponFocusFeat('Melee'));

    expect(() => character.addFeat(new WeaponFocusFeat('Melee'))).toThrow();
  });
});

describe('Power Attack', () => {
  const powerAttacker = (strength: number, weapon: Weapon, baseAttackBonus = 4): Character => {
    const character = combatant('Fighter').str(strength).hp(30).bab(baseAttackBonus).wielding(weapon).build();
    character.addFeat(new PowerAttackFeat());
    return character;
  };

  it('refuses a penalty from someone without the feat', () => {
    const squire = combatant('Squire').str(14).hp(10).bab(4).wielding(Weapons.longsword()).build();
    const target = dummy();
    const battle = battleOf([10, 10, 15, 5], squire, target);

    expect(() => battle.execute(attackAction(target, 2))).toThrow(/feat/);
  });

  it('refuses a penalty larger than the base attack bonus', () => {
    const fighter = powerAttacker(16, Weapons.longsword(), 3);
    const target = dummy();
    const battle = battleOf([10, 10, 15, 5], fighter, target);

    expect(() => battle.execute(attackAction(target, 4))).toThrow(/penalty must be between/);
  });

  it('trades attack for damage one for one with one hand', () => {
    // d20 8 + BAB 4 + STR 3 − 2 = 13 hits AC 10; damage 3 + STR 3 + 2.
    const fighter = powerAttacker(16, Weapons.longsword());
    const target = dummy();
    const battle = battleOf([10, 5, 8, 3], fighter, target);

    const result = battle.execute(attackAction(target, 2));

    expect(result?.hit).toBe(true);
    expect(result?.situationalAttackBonus).toBe(-2);
    expect(result?.damage).toBe(8);
  });

  // SRD: "If you attack with a two-handed weapon […] instead add twice the number subtracted from
  // your attack rolls." Twice the penalty, not one and a half rounded down like the Strength bonus.
  it('pays twice the penalty on a two-handed weapon', () => {
    // Greataxe: damage 1d12 = 5, plus STR ×1.5 = 4, plus the Power Attack bonus 2 × 2 = 4.
    const fighter = powerAttacker(16, Weapons.greataxe());
    const target = dummy();
    const battle = battleOf([12, 5, 8, 5], fighter, target);

    const result = battle.execute(attackAction(target, 2));

    expect(result?.hit).toBe(true);
    expect(result?.damage).toBe(13);
  });

  it('has its damage bonus multiplied by a critical', () => {
    // Natural 20 hits and threatens, confirm 15. Dice 3+3, STR +1 ×2, Power Attack 2 ×2.
    const fighter = powerAttacker(13, Weapons.longsword());
    const target = dummy();
    const battle = battleOf([10, 5, 20, 15, 3, 3], fighter, target);

    const result = battle.execute(attackAction(target, 2));

    expect(result?.wasCritical).toBe(true);
    expect(result?.damage).toBe(12);
  });

  it('changes nothing at penalty zero', () => {
    const fighter = powerAttacker(16, Weapons.longsword());
    const target = dummy();
    const battle = battleOf([10, 5, 8, 4], fighter, target);

    const result = battle.execute(attackAction(target, 0));

    expect(result?.hit).toBe(true);
    expect(result?.situationalAttackBonus).toBe(0);
    expect(result?.damage).toBe(7);
  });

  // SRD: "You can't add the bonus from Power Attack to the damage dealt with a light weapon
  // (except with unarmed strikes or natural weapon attacks), even though the penalty on attack
  // rolls still applies."
  it('pays the penalty but earns no damage with a light weapon', () => {
    // d20 8 + BAB 4 + STR 3 - 2 = 13 hits AC 10; damage 3 + STR 3, and nothing from Power Attack.
    const fighter = powerAttacker(16, Weapons.dagger());
    const target = dummy();
    const battle = battleOf([10, 5, 8, 3], fighter, target);

    const result = battle.execute(attackAction(target, 2));

    expect(result?.situationalAttackBonus).toBe(-2);
    expect(result?.damage).toBe(6);
  });

  it('still earns the damage with an unarmed strike, the SRD exception', () => {
    // A disarmed combatant falls back to the unarmed strike, which is Light but exempt:
    // damage 1d3 = 2, plus STR 3, plus the Power Attack bonus 2.
    const fighter = powerAttacker(16, Weapons.longsword());
    fighter.markDisarmed();
    const target = dummy();
    const battle = battleOf([10, 5, 8, 2], fighter, target);

    const result = battle.execute(attackAction(target, 2));

    expect(result?.damage).toBe(7);
  });

  it('needs no feat at all for a penalty of zero', () => {
    const squire = combatant('Squire').hp(10).bab(1).wielding(Weapons.dagger()).build();
    const target = dummy();
    const battle = battleOf([10, 5, 12, 2], squire, target);

    expect(() => battle.execute(attackAction(target, 0))).not.toThrow();
  });
});

/** A goblin at a square, reachable from the pending Cleave tests at the end of the file. */
const goblinAt = (name: string, x: number, y: number, hitPoints: number): Character =>
  combatant(name).str(8).hp(hitPoints).wielding(Weapons.dagger()).at(x, y).on('B').build();

describe('Cleave', () => {
  // STR 16 (+3), BAB 4, longsword.
  const cleaver = (x: number, y: number, greatCleave = false): Character => {
    const character = combatant('Cleaver').str(16).hp(40).bab(4).wielding(Weapons.longsword()).at(x, y).build();
    character.addFeat(new PowerAttackFeat());
    character.addFeat(new CleaveFeat());
    if (greatCleave) {
      character.addFeat(new GreatCleaveFeat());
    }
    return character;
  };
  const goblin = (name: string, x: number, y: number, hitPoints = 5): Character =>
    combatant(name).str(8).hp(hitPoints).wielding(Weapons.dagger()).at(x, y).on('B').build();

  it('takes a free swing at another adjacent enemy after a kill', () => {
    // Kill Goblin1 (d20 10, damage 8+3 = 11 against 1 HP), then cleave Goblin2 (d20 12, 3+3).
    const attacker = cleaver(1, 1);
    const first = goblin('Goblin1', 1, 0, 1);
    const second = goblin('Goblin2', 1, 2, 20);
    const battle = battleOf([15, 8, 5, 10, 8, 12, 3], attacker, first, second);

    battle.execute(attackAction(first));

    expect(first.vitalStatus).toBe('Dead');
    expect(second.currentHitPoints).toBe(14);
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(true);
  });

  // SRD Cleave: "If you deal a creature enough damage to make it drop (typically by dropping it to
  // below 0 hit points or killing it) […]" — dropping is below zero, not the -10 of death.
  it('takes the swing on a foe merely dropped below zero, without killing it', () => {
    // Goblin1 has 8 HP and takes 8 + STR 3: -3, dying but far from dead. Then cleave (d20 12, 3+3).
    const attacker = cleaver(1, 1);
    const first = goblin('Goblin1', 1, 0, 8);
    const second = goblin('Goblin2', 1, 2, 20);
    const battle = battleOf([15, 8, 5, 10, 8, 12, 3], attacker, first, second);

    battle.execute(attackAction(first));

    expect(first.vitalStatus).toBe('Dying');
    expect(second.currentHitPoints).toBe(14);
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(true);
  });

  it('does not trigger on a foe left standing at exactly zero, who has not dropped', () => {
    // Goblin1 has 11 HP and takes exactly 11: disabled at 0, still on its feet.
    const attacker = cleaver(1, 1);
    const first = goblin('Goblin1', 1, 0, 11);
    const second = goblin('Goblin2', 1, 2, 20);
    const battle = battleOf([15, 8, 5, 10, 8], attacker, first, second);

    battle.execute(attackAction(first));

    expect(first.vitalStatus).toBe('Staggered');
    expect(second.currentHitPoints).toBe(20);
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(false);
  });

  it('has nothing to cleave into when the kill stands alone', () => {
    const attacker = cleaver(0, 0);
    const victim = goblin('Goblin', 1, 0, 1);
    const battle = battleOf([15, 5, 10, 8], attacker, victim);

    battle.execute(attackAction(victim));

    expect(victim.vitalStatus).toBe('Dead');
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(false);
  });

  it('does not trigger on a miss', () => {
    const attacker = cleaver(1, 1);
    const first = goblin('Goblin1', 1, 0, 20);
    const second = goblin('Goblin2', 1, 2, 20);
    const battle = battleOf([15, 8, 5, 1], attacker, first, second);

    battle.execute(attackAction(first));

    expect(first.currentHitPoints).toBe(20);
    expect(second.currentHitPoints).toBe(20);
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(false);
  });

  it('does not trigger for a fighter who lacks the feat', () => {
    const fighter = combatant('Fighter').str(16).hp(40).bab(4).wielding(Weapons.longsword()).at(1, 1).build();
    const first = goblin('Goblin1', 1, 0, 1);
    const second = goblin('Goblin2', 1, 2, 20);
    const battle = battleOf([15, 8, 5, 10, 8], fighter, first, second);

    battle.execute(attackAction(first));

    expect(first.vitalStatus).toBe('Dead');
    expect(second.currentHitPoints).toBe(20);
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(false);
  });

  it('stops after one extra attack without Great Cleave', () => {
    const attacker = cleaver(1, 1);
    const first = goblin('Goblin1', 1, 0, 1);
    const second = goblin('Goblin2', 0, 1, 1);
    const third = goblin('Goblin3', 1, 2, 20);
    const battle = battleOf([15, 8, 7, 5, 10, 8, 12, 8], attacker, first, second, third);

    battle.execute(attackAction(first));

    expect(first.vitalStatus).toBe('Dead');
    expect(third.currentHitPoints).toBe(20);
    expect(battle.log.filter((entry) => entry.event === 'Cleave')).toHaveLength(1);
  });

  // SRD Cleave: the extra attack comes "at the same bonus as the attack that dropped the previous
  // creature". The charge's +2 rides along; the engine used to recompute the bonus from scratch and
  // lose it. Situational modifiers stay the ones the dropping attack was made with — that is what
  // "the same bonus" says, target or no target.
  it('carries the charge bonus into the extra attack', () => {
    // BAB 4 + STR 3 = 7 against the armoured goblin's AC 18: a d20 9 makes 16 and misses. With the
    // charge's +2 it is exactly 18 and lands, for 1d8 4 + STR 3.
    const attacker = cleaver(0, 0);
    const charged = goblin('Goblin1', 3, 0, 1);
    const armoured = combatant('Goblin2')
      .str(8)
      .hp(20)
      .wielding(Weapons.dagger())
      .wearing(Armors.fullPlate())
      .at(2, 1)
      .on('B')
      .build();
    const battle = battleOf([15, 8, 5, 10, 5, 9, 4], attacker, charged, armoured);

    battle.execute(chargeAction(charged));

    expect(charged.vitalStatus).toBe('Dying');
    expect(armoured.currentHitPoints).toBe(20 - 7);
  });

  it('carries the iterative penalty into the extra attack', () => {
    // The second iterative is at −5, and so is the cleave: 8 + BAB 6 + STR 3 − 5 = 12 against the
    // breastplate's AC 15, a miss. At the full bonus it would have made 17 and hit.
    const attacker = combatant('Cleaver').str(16).hp(40).bab(6).wielding(Weapons.longsword()).at(1, 1).build();
    attacker.addFeat(new PowerAttackFeat());
    attacker.addFeat(new CleaveFeat());
    const first = goblin('Goblin1', 1, 0, 8);
    const armoured = combatant('Goblin2')
      .str(8)
      .hp(20)
      .wielding(Weapons.dagger())
      .wearing(Armors.breastplate())
      .at(1, 2)
      .on('B')
      .build();
    // Initiative, the first iterative's natural 1, the second iterative (15, 1d8 = 8), the cleave.
    const battle = battleOf([15, 8, 5, 1, 15, 8, 8, 4], attacker, first, armoured);

    battle.execute(fullAttackAction(first));

    expect(first.vitalStatus).toBe('Dying');
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(true);
    expect(armoured.currentHitPoints).toBe(20);
  });

  it('keeps going as long as the kills keep coming, with Great Cleave', () => {
    const attacker = cleaver(1, 1, true);
    const first = goblin('Goblin1', 1, 0, 1);
    const second = goblin('Goblin2', 0, 1, 1);
    const third = goblin('Goblin3', 1, 2, 20);
    const battle = battleOf([15, 8, 7, 5, 10, 8, 12, 8, 10, 3], attacker, first, second, third);

    battle.execute(attackAction(first));

    expect(first.vitalStatus).toBe('Dead');
    expect(second.vitalStatus).toBe('Dead');
    expect(third.currentHitPoints).toBeLessThan(20);
    expect(battle.log.filter((entry) => entry.event === 'Cleave').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Cleave from a full attack', () => {
  // SRD Cleave fires on any attack that drops a foe, an iterative attack of a full attack included.
  it('fires from an iterative attack that drops a foe', () => {
    const attacker = combatant('Cleaver').str(16).hp(40).bab(6).wielding(Weapons.longsword()).at(1, 1).build();
    attacker.addFeat(new PowerAttackFeat());
    attacker.addFeat(new CleaveFeat());
    const first = combatant('Goblin1').hp(8).wielding(Weapons.dagger()).at(1, 0).on('B').build();
    const second = combatant('Goblin2').hp(20).wielding(Weapons.dagger()).at(1, 2).on('B').build();
    // Initiative 15/8/5, then the first iterative (d20 15, 1d8 = 8 plus STR 3 → −3), then the cleave.
    const battle = battleOf([15, 8, 5, 15, 8, 12, 3], attacker, first, second);

    battle.execute(fullAttackAction(first));

    expect(first.vitalStatus).toBe('Dying');
    expect(battle.log.some((entry) => entry.event === 'Cleave')).toBe(true);
  });
});

describe('Cleave from an attack of opportunity', () => {
  // SRD Cleave does not name the attack that has to land the blow: an attack of opportunity is a
  // melee attack like any other. A flat-footed combatant makes no attacks of opportunity, so only
  // someone who has already acted threatens: the cleaver goes first in initiative and the scene
  // opens with an endTurn().
  //
  // STR 16 (+3), BAB 4, longsword — the same cleaver as the describe above.
  const cleaver = (x: number, y: number, greatCleave = false): Character => {
    const character = combatant('Cleaver').str(16).hp(40).bab(4).wielding(Weapons.longsword()).at(x, y).build();
    character.addFeat(new PowerAttackFeat());
    character.addFeat(new CleaveFeat());
    if (greatCleave) {
      character.addFeat(new GreatCleaveFeat());
    }
    return character;
  };
  const goblin = (name: string, x: number, y: number, hitPoints: number): Character =>
    combatant(name).str(8).hp(hitPoints).wielding(Weapons.dagger()).at(x, y).on('B').build();

  const cleaveCount = (battle: Battle): number =>
    battle.log.filter((entry) => entry.event === 'Cleave').length;

  it('fires when the opportunity attack drops the one who provoked it', () => {
    const attacker = cleaver(2, 2);
    const runner = goblin('Goblin1', 1, 2, 5);
    const bystander = goblin('Goblin2', 3, 2, 20);
    // Initiative 15/10/5, then the AoO (d20 10, 1d8 = 8 plus STR 3 → −6), then the cleave (12, 3+3).
    const battle = battleOf([15, 10, 5, 10, 8, 12, 3], attacker, runner, bystander);
    battle.endTurn();

    battle.execute(moveAction({ x: 0, y: 2 }));

    expect(runner.vitalStatus).toBe('Dying');
    expect(bystander.currentHitPoints).toBe(14);
    expect(cleaveCount(battle)).toBe(1);
  });

  // SRD Cleave: "You can use this ability once per round." With the trigger above a round can offer
  // two dropping attacks — one on your turn, one on someone else's — so the limit needs a counter.
  it('stays spent for the round once the cleaver has already cleaved on its own turn', () => {
    const attacker = cleaver(2, 2);
    const victim = goblin('Goblin1', 2, 1, 1);
    const runner = goblin('Goblin2', 1, 2, 5);
    const bystander = goblin('Goblin3', 3, 2, 20);
    // Initiative 15/8/10/5 → Cleaver, Goblin2, Goblin1, Goblin3. The attack kills Goblin1
    // (d20 10, 8+3 against 1 HP), the cleave leaves Goblin2 at 1 HP (10, 1+3), and on Goblin2's
    // own turn the AoO (10, 8+3) drops it — inside the same round.
    const battle = battleOf([15, 8, 10, 5, 10, 8, 10, 1, 10, 8], attacker, victim, runner, bystander);

    battle.execute(attackAction(victim));
    battle.endTurn();
    battle.execute(moveAction({ x: 0, y: 2 }));

    expect(victim.vitalStatus).toBe('Dead');
    expect(runner.isDefeated).toBe(true);
    expect(bystander.currentHitPoints).toBe(20);
    expect(cleaveCount(battle)).toBe(1);
  });

  it('cleaves a second time in the round with Great Cleave, which lifts the limit', () => {
    const attacker = cleaver(2, 2, true);
    const victim = goblin('Goblin1', 2, 1, 1);
    const runner = goblin('Goblin2', 1, 2, 5);
    const bystander = goblin('Goblin3', 3, 2, 20);
    // The same scene and the same dice, plus the second cleave (d20 12, 1d8 = 3 plus STR 3).
    const battle = battleOf(
      [15, 8, 10, 5, 10, 8, 10, 1, 10, 8, 12, 3],
      attacker,
      victim,
      runner,
      bystander,
    );

    battle.execute(attackAction(victim));
    battle.endTurn();
    battle.execute(moveAction({ x: 0, y: 2 }));

    expect(bystander.currentHitPoints).toBe(14);
    expect(cleaveCount(battle)).toBe(2);
  });
});
