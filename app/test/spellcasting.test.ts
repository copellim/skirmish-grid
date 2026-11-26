// SRD Magic Overview: https://www.d20srd.org/srd/magicOverview/
//
// The spellcasting machinery around the resolver that `spells.test.ts` already covers: spell slots,
// touch AC, save DCs, and — the part no other test reaches — casting through `Battle`, with its slot
// validation, range check, area targeting, the attack of opportunity a spell provokes and the
// Concentration check that decides whether the spell survives it.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { SpellSlots } from '../src/engine/spell-slots';
import { SpellCatalog } from '../src/engine/spell-catalog';
import { resolveSpell } from '../src/engine/spell-resolver';
import { DiceExpression } from '../src/engine/dice-expression';
import type { Spell } from '../src/engine/spell';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { CharacterClasses, ClassLevel } from '../src/engine/character-class';
import { Armors, Shields, Weapons } from '../src/engine/catalogs';
import { attackAction, castSpellAction } from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const caster = (name = 'Caster'): Character => combatant(name).at(0, 0).on('A').build();
const victim = (name = 'Target', x = 1, y = 0, hitPoints = 30): Character =>
  combatant(name).hp(hitPoints).at(x, y).on('B').build();

/** Initiative 20 vs 1: the caster always acts first. */
const battleOf = (rolls: number[], ...combatants: Character[]): Battle =>
  new Battle(new Grid(10, 10), new SequenceRandom(...rolls), combatants);

describe('spell slots', () => {
  it('starts empty', () => {
    expect(new SpellSlots().remaining(1)).toBe(0);
  });

  it('counts what was granted', () => {
    const slots = new SpellSlots();
    slots.grant(1, 3);

    expect(slots.remaining(1)).toBe(3);
  });

  it('spends one at a time', () => {
    const slots = new SpellSlots();
    slots.grant(1, 2);

    expect(slots.trySpend(1)).toBe(true);
    expect(slots.remaining(1)).toBe(1);
  });

  it('refuses to spend what it does not have', () => {
    expect(new SpellSlots().trySpend(1)).toBe(false);
  });
});

describe('touch armor class', () => {
  it('leaves armor and shield bonuses out', () => {
    const armored = combatant('Armored').wearing(Armors.chainShirt()).build();
    const naked = combatant('Naked').build();

    expect(armored.effectiveArmorClass).toBe(naked.effectiveArmorClass + 4);
    expect(armored.touchArmorClass).toBe(naked.touchArmorClass);
  });

  // SRD Touch Attacks: "you ignore the target's armor bonus, shield bonus, and natural armor
  // bonus" — the filter is on the bonus type, so a spell that grants one is ignored just the same.
  it('leaves Mage Armor out, since it grants an armor bonus', () => {
    const caster = combatant('Caster').castingAt(3).build();
    const touchBefore = caster.touchArmorClass;

    resolveSpell(new SequenceRandom(), caster, [caster], SpellCatalog.mageArmor());

    expect(caster.effectiveArmorClass).toBe(touchBefore + 4);
    expect(caster.touchArmorClass).toBe(touchBefore);
  });

  // SRD: a deflection bonus is not among the three the touch attack ignores.
  it('keeps a deflection bonus, which the touch attack does not ignore', () => {
    const character = combatant('Warded').build();
    character.addEffect({ type: 'Deflection', target: 'ArmorClass', value: 2, duration: 'Permanent' });

    expect(character.touchArmorClass).toBe(12);
  });

  it('leaves a natural armor bonus out, like the worn kind', () => {
    const character = combatant('Scaled').build();
    character.addEffect({ type: 'Natural', target: 'ArmorClass', value: 3, duration: 'Permanent' });

    expect(character.effectiveArmorClass).toBe(13);
    expect(character.touchArmorClass).toBe(10);
  });

  it('keeps the rage penalty, which is not armor', () => {
    const barbarian = Character.fromClassLevels(
      'Barbarian',
      new AbilitySet(
        new AbilityScore(16),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
        new AbilityScore(10),
      ),
      [new ClassLevel(CharacterClasses.barbarian(), 2)],
      new SequenceRandom(8), // the level-2 hit die
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );
    const baseline = barbarian.touchArmorClass;

    barbarian.enterRage(0);

    expect(barbarian.touchArmorClass).toBe(baseline - 2);
  });
});

describe('save DC', () => {
  it('is ten plus the spell level plus the caster’s Charisma modifier', () => {
    const spellcaster = combatant('Caster').cha(16).build();
    const fireball = SpellCatalog.fireball();

    expect(10 + fireball.spellLevel + spellcaster.abilities.charisma.modifier).toBe(16);
  });
});

describe('damage floors', () => {
  it('never deals less than one point on a hit', () => {
    // 1d4−3 rolling a 1 would be −2 damage.
    const feebleSpell: Spell = {
      name: 'TestSpell',
      spellLevel: 1,
      school: 'Evocation',
      targeting: 'AutoHit',
      rangeInFeet: 100,
      areaRadiusInFeet: 0,
      savingThrow: null,
      saveEffect: 'None',
      damage: new DiceExpression(1, 4, -3),
      appliedEffect: null,
      srdReference: '',
    };
    const target = victim('Target', 1, 0, 20);

    resolveSpell(new SequenceRandom(1), caster(), [target], feebleSpell);

    expect(target.currentHitPoints).toBe(19);
  });

  it('never halves a save down to nothing', () => {
    // A 1d6 blast rolling a 1: half of 1 is 0, which the resolver lifts back to 1.
    const tinyFireball: Spell = {
      name: 'TinyFireball',
      spellLevel: 3,
      school: 'Evocation',
      targeting: 'Area',
      rangeInFeet: 400,
      areaRadiusInFeet: 20,
      savingThrow: 'Reflex',
      saveEffect: 'Half',
      damage: new DiceExpression(1, 6, 0),
      appliedEffect: null,
      srdReference: '',
    };
    const target = combatant('Target').hp(30).saves(0, 20, 0).at(1, 0).on('B').build();

    const result = resolveSpell(new SequenceRandom(1, 10), caster(), [target], tinyFireball);

    expect(result.targetResults[0].damageDealt).toBe(1);
  });
});

describe('ranged touch attacks', () => {
  it('hits when the touch roll reaches the touch AC', () => {
    // BAB 5, Dex +0 → +5; d20 5 makes 10 against touch AC 10. Then 4d6 = 12.
    const shooter = combatant('Caster').bab(5).build();
    const target = victim();

    const result = resolveSpell(
      new SequenceRandom(5, 3, 3, 3, 3),
      shooter,
      [target],
      SpellCatalog.scorchingRay(),
    );

    expect(result.targetResults[0].hit).toBe(true);
    expect(result.targetResults[0].attackRoll).toBe(5);
    expect(result.targetResults[0].damageDealt).toBe(12);
  });

  it('ignores the armor bonus that would have stopped a normal attack', () => {
    // Chain shirt: AC 14 but touch AC 10. BAB 3 + d20 7 = 10 — a hit on touch, a miss on AC.
    const shooter = combatant('Caster').bab(3).build();
    const target = combatant('Target').hp(30).wearing(Armors.chainShirt()).at(1, 0).on('B').build();

    const result = resolveSpell(
      new SequenceRandom(7, 2, 2, 2, 2),
      shooter,
      [target],
      SpellCatalog.scorchingRay(),
    );

    expect(result.targetResults[0].hit).toBe(true);
  });

  it('misses on a natural 1 whatever the bonus', () => {
    const shooter = combatant('Caster').bab(10).build();
    const target = victim();

    const result = resolveSpell(new SequenceRandom(1), shooter, [target], SpellCatalog.scorchingRay());

    expect(result.targetResults[0].hit).toBe(false);
    expect(result.targetResults[0].damageDealt).toBe(0);
    expect(target.currentHitPoints).toBe(target.maxHitPoints);
  });

  it('hits on a natural 20 whatever the touch AC', () => {
    // Dex 40 puts touch AC at 25, out of reach of any total this caster can roll.
    const untouchable = combatant('HighDex').hp(30).dex(40).at(1, 0).on('B').build();

    const result = resolveSpell(
      new SequenceRandom(20, 3, 3, 3, 3),
      caster(),
      [untouchable],
      SpellCatalog.scorchingRay(),
    );

    expect(result.targetResults[0].hit).toBe(true);
  });
});

describe('casting through Battle', () => {
  it('spends a slot, logs the cast and applies the damage', () => {
    const spellcaster = caster();
    spellcaster.spellSlots.grant(1, 2);
    spellcaster.learnSpell(SpellCatalog.magicMissile());
    // 15 ft away: inside Magic Missile's range and out of melee, so nothing provokes.
    const target = victim('Target', 3, 0, 20);
    const battle = battleOf([20, 1, 3], spellcaster, target);

    battle.execute(castSpellAction(SpellCatalog.magicMissile(), target));

    expect(spellcaster.spellSlots.remaining(1)).toBe(1);
    expect(battle.log.some((entry) => entry.event === 'CastSpell')).toBe(true);
    expect(target.currentHitPoints).toBe(16);
  });

  it('refuses a spell with no slot left', () => {
    const spellcaster = caster();
    const target = victim();
    const battle = battleOf([20, 1], spellcaster, target);

    expect(() => battle.execute(castSpellAction(SpellCatalog.magicMissile(), target))).toThrow();
  });

  it('refuses a target beyond the spell’s range', () => {
    // Scorching Ray reaches 25 ft; this target stands at 30.
    const spellcaster = caster();
    spellcaster.spellSlots.grant(2, 1);
    const target = victim('Target', 6, 0);
    const battle = battleOf([20, 1], spellcaster, target);

    expect(() => battle.execute(castSpellAction(SpellCatalog.scorchingRay(), target))).toThrow();
  });

  it('refuses to cast once the standard action is spent', () => {
    const spellcaster = caster();
    spellcaster.spellSlots.grant(1, 5);
    const target = victim();
    const battle = battleOf([20, 1, 10, 3, 3], spellcaster, target);
    battle.execute(attackAction(target));

    expect(() => battle.execute(castSpellAction(SpellCatalog.magicMissile(), target))).toThrow();
  });

  it('catches everyone inside the blast radius, and nobody outside it', () => {
    // Centre (5,0): both targets are within 20 ft of it, the caster at (0,0) is not.
    const spellcaster = combatant('Caster').cha(10).at(0, 0).on('A').build();
    spellcaster.spellSlots.grant(3, 1);
    spellcaster.learnSpell(SpellCatalog.fireball());
    const first = victim('T1', 4, 0);
    const second = victim('T2', 3, 0);
    const battle = battleOf([20, 19, 1, 3, 3, 3, 3, 3, 5, 5], spellcaster, first, second);

    battle.execute(castSpellAction(SpellCatalog.fireball(), null, { x: 5, y: 0 }));

    expect(spellcaster.spellSlots.remaining(3)).toBe(0);
    expect(first.currentHitPoints).toBeLessThan(30);
    expect(second.currentHitPoints).toBeLessThan(30);
    expect(spellcaster.currentHitPoints).toBe(spellcaster.maxHitPoints);
    expect(battle.log.some((entry) => entry.event === 'CastSpell')).toBe(true);
  });
});

describe('casting in melee', () => {
  const besiegedCaster = () => {
    const spellcaster = combatant('Caster').con(10).at(0, 0).on('A').build();
    spellcaster.spellSlots.grant(1, 1);
    spellcaster.learnSpell(SpellCatalog.magicMissile());
    return spellcaster;
  };

  it('provokes, and the spell survives an attack that misses', () => {
    // The AoO rolls a natural 1: no damage, so no Concentration check is called for.
    const spellcaster = besiegedCaster();
    const enemy = victim('Enemy', 1, 0);
    const battle = battleOf([1, 20, 1, 3], spellcaster, enemy);
    battle.endTurn(); // the enemy has acted: it is no longer flat-footed and can strike

    battle.execute(castSpellAction(SpellCatalog.magicMissile(), enemy));

    expect(battle.log.some((entry) => entry.event === 'CastSpell')).toBe(true);
    expect(enemy.currentHitPoints).toBe(26);
  });

  it('loses the spell — and the slot — when the damage breaks concentration', () => {
    // AoO hits for 5 → DC 10 + 5 + 1 = 16; the caster's +3 on a natural 1 cannot reach it.
    const spellcaster = besiegedCaster();
    const enemy = victim('Enemy', 1, 0);
    const battle = battleOf([1, 20, 15, 5, 1], spellcaster, enemy);
    battle.endTurn(); // the enemy has acted: it is no longer flat-footed and can strike

    battle.execute(castSpellAction(SpellCatalog.magicMissile(), enemy));

    expect(battle.log.some((entry) => entry.event === 'SpellDisrupted')).toBe(true);
    expect(spellcaster.spellSlots.remaining(1)).toBe(0);
  });

  it('provokes nothing when cast defensively, and passes the check', () => {
    // Defensive DC 15 + 1 = 16; the caster's +3 on a d20 15 makes 18.
    const spellcaster = besiegedCaster();
    const enemy = victim('Enemy', 1, 0);
    const battle = battleOf([1, 20, 15, 3], spellcaster, enemy);
    battle.endTurn(); // the enemy could strike, so silence proves the defensive cast

    battle.execute(castSpellAction(SpellCatalog.magicMissile(), enemy, null, true));

    expect(battle.log.some((entry) => entry.event === 'CastSpell')).toBe(true);
    expect(enemy.currentHitPoints).toBe(26);
    expect(battle.log.every((entry) => entry.event !== 'AttackOfOpportunity')).toBe(true);
  });

  it('still loses the spell if the defensive check fails, but takes no attack either', () => {
    const spellcaster = besiegedCaster();
    const enemy = victim('Enemy', 1, 0);
    const battle = battleOf([1, 20, 1], spellcaster, enemy);
    battle.endTurn(); // the enemy could strike, so silence proves the defensive cast

    battle.execute(castSpellAction(SpellCatalog.magicMissile(), enemy, null, true));

    expect(battle.log.some((entry) => entry.event === 'SpellDisrupted')).toBe(true);
    expect(spellcaster.spellSlots.remaining(1)).toBe(0);
    expect(battle.log.every((entry) => entry.event !== 'AttackOfOpportunity')).toBe(true);
  });
});

describe('typed bonuses to armor class', () => {
  // SRD Bonus Types: two bonuses of the same type do not stack, the larger applies. Mage Armor
  // grants an *armor* bonus (spell-catalog.ts declares `type: 'Armor'`), so it adds nothing to
  // someone already wearing chainmail's +5.
  it('does not stack Mage Armor with worn armor', () => {
    const armored = combatant('Armored').wearing(Armors.chainmail()).build();
    const armorClassBefore = armored.effectiveArmorClass;

    resolveSpell(new SequenceRandom(), armored, [armored], SpellCatalog.mageArmor());

    expect(armored.effectiveArmorClass).toBe(armorClassBefore);
  });

  // The Shield spell grants a *shield* bonus of +4: against a heavy steel shield's +2 the larger
  // wins, so the gain is 2, not 4.
  it('does not stack the Shield spell with a carried shield', () => {
    const shielded = combatant('Shielded').carrying(Shields.heavySteel()).build();
    const armorClassBefore = shielded.effectiveArmorClass;

    resolveSpell(new SequenceRandom(), shielded, [shielded], SpellCatalog.shield());

    expect(shielded.effectiveArmorClass).toBe(armorClassBefore + 2);
  });
});
