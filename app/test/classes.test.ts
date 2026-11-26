// SRD classes and the progressions behind them: https://www.d20srd.org/srd/classes/
//
// `Character.fromClassLevels` derives BAB, base saves and hit points from class levels (multiclass
// sums them), plus the class features the engine implements: sneak attack dice, rage, and the
// sorcerer's spell slots. `character.test.ts` covers the constructor's own arithmetic; this covers
// the class tables it reads from.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { CharacterClasses, ClassLevel, babAt, saveAt } from '../src/engine/character-class';
import { maxCastableSpellLevel, spellsKnownLimit } from '../src/engine/sorcerer-spell-slots';
import { SpellCatalog } from '../src/engine/spell-catalog';
import { resolveSpell } from '../src/engine/spell-resolver';
import { Weapons } from '../src/engine/catalogs';
import type { Spell } from '../src/engine/spell';
import { castSpellAction } from '../src/engine/combat-action';
import { combatant } from './support/character-builder';

const abilities = (constitution = 10, charisma = 10) =>
  new AbilitySet(
    new AbilityScore(10),
    new AbilityScore(10),
    new AbilityScore(constitution),
    new AbilityScore(10),
    new AbilityScore(10),
    new AbilityScore(charisma),
  );

describe('progression tables', () => {
  it('gives a full-BAB class its level as its bonus', () => {
    expect([babAt('Full', 1), babAt('Full', 5), babAt('Full', 20)]).toEqual([1, 5, 20]);
  });

  it('gives a three-quarters class three levels in four', () => {
    expect([babAt('ThreeQuarters', 1), babAt('ThreeQuarters', 4), babAt('ThreeQuarters', 20)]).toEqual([0, 3, 15]);
  });

  it('gives a half-BAB class one level in two', () => {
    expect([babAt('Half', 1), babAt('Half', 2), babAt('Half', 20)]).toEqual([0, 1, 10]);
  });

  it('starts a good save at 2 and adds half the levels', () => {
    expect([saveAt('Good', 1), saveAt('Good', 2), saveAt('Good', 20)]).toEqual([2, 3, 12]);
  });

  it('gives a poor save a third of the levels', () => {
    expect([saveAt('Poor', 1), saveAt('Poor', 3), saveAt('Poor', 20)]).toEqual([0, 1, 6]);
  });
});

describe('the class catalog', () => {
  it('describes the Fighter as the SRD does', () => {
    const fighter = CharacterClasses.fighter();

    expect(fighter.name).toBe('Fighter');
    expect(fighter.hitDieSides).toBe(10);
    expect(fighter.bab).toBe('Full');
    expect([fighter.fortitude, fighter.reflex, fighter.will]).toEqual(['Good', 'Poor', 'Poor']);
  });

  it('describes the Rogue as the SRD does', () => {
    const rogue = CharacterClasses.rogue();

    expect(rogue.name).toBe('Rogue');
    expect(rogue.hitDieSides).toBe(6);
    expect(rogue.bab).toBe('ThreeQuarters');
    expect([rogue.fortitude, rogue.reflex, rogue.will]).toEqual(['Poor', 'Good', 'Poor']);
    expect(rogue.grantsSneakAttack).toBe(true);
  });

  it('describes the Barbarian as the SRD does', () => {
    const barbarian = CharacterClasses.barbarian();

    expect(barbarian.hitDieSides).toBe(12);
    expect([babAt(barbarian.bab, 1), babAt(barbarian.bab, 4), babAt(barbarian.bab, 20)]).toEqual([1, 4, 20]);
    expect([saveAt(barbarian.fortitude, 1), saveAt(barbarian.reflex, 1), saveAt(barbarian.will, 1)]).toEqual([2, 0, 0]);
    expect(barbarian.grantsRage).toBe(true);
  });

  it('describes the Sorcerer as the SRD does', () => {
    const sorcerer = CharacterClasses.sorcerer();

    expect(sorcerer.hitDieSides).toBe(4);
    expect(sorcerer.bab).toBe('ThreeQuarters');
    expect([sorcerer.fortitude, sorcerer.reflex, sorcerer.will]).toEqual(['Poor', 'Poor', 'Good']);
    expect(sorcerer.grantsArcaneSpellcasting).toBe(true);
  });

  it('refuses a class entry below level one', () => {
    expect(() => new ClassLevel(CharacterClasses.fighter(), 0)).toThrow();
  });

  it('accepts level one', () => {
    expect(new ClassLevel(CharacterClasses.fighter(), 1).level).toBe(1);
  });
});

describe('building a character from class levels', () => {
  const fighterWith = (classes: ClassLevel[], rolls: number[], constitution = 14): Character =>
    Character.fromClassLevels(
      'Test Fighter',
      abilities(constitution),
      classes,
      new SequenceRandom(...rolls),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );

  it('takes the maximum hit die at first level, with no roll at all', () => {
    const character = fighterWith([new ClassLevel(CharacterClasses.fighter(), 1)], []);

    expect(character.baseAttackBonus).toBe(1);
    expect(character.fortitudeBaseSave).toBe(2);
    expect(character.reflexBaseSave).toBe(0);
    expect(character.willBaseSave).toBe(0);
    expect(character.maxHitPoints).toBe(12); // 10 + CON 2
  });

  it('rolls every level after the first', () => {
    // 10 (max) + 6 + 8, plus CON +2 on each of the three levels.
    const character = fighterWith([new ClassLevel(CharacterClasses.fighter(), 3)], [6, 8]);

    expect(character.baseAttackBonus).toBe(3);
    expect(character.fortitudeBaseSave).toBe(3);
    expect(character.reflexBaseSave).toBe(1);
    expect(character.willBaseSave).toBe(1);
    expect(character.maxHitPoints).toBe(30);
  });

  it('sums BAB, saves and hit points across two class entries', () => {
    // Two separate Fighter-1 entries: each contributes its own good save, as the SRD multiclass rule has it.
    const character = fighterWith(
      [new ClassLevel(CharacterClasses.fighter(), 1), new ClassLevel(CharacterClasses.fighter(), 1)],
      [7],
    );

    expect(character.baseAttackBonus).toBe(2);
    expect(character.fortitudeBaseSave).toBe(4);
    expect(character.reflexBaseSave).toBe(0);
    expect(character.willBaseSave).toBe(0);
    expect(character.maxHitPoints).toBe(21);
  });

  it('gives a barbarian their hit points, BAB and daily rages', () => {
    const character = Character.fromClassLevels(
      'Test Barbarian',
      abilities(14),
      [new ClassLevel(CharacterClasses.barbarian(), 2)],
      new SequenceRandom(8),
      40,
      Weapons.greataxe(),
      { x: 0, y: 0 },
      'A',
    );

    expect(character.maxHitPoints).toBe(24); // 12 + 8, plus CON +2 twice
    expect(character.baseAttackBonus).toBe(2);
    expect(character.barbarianLevels).toBe(2);
    // SRD Barbarian: one rage a day at 1st level, a second only at 4th — Constitution buys none.
    expect(character.ragesRemaining).toBe(1);
  });

  it('stacks a barbarian level with a fighter one', () => {
    const character = Character.fromClassLevels(
      'Test Barbarian Fighter',
      abilities(10),
      [new ClassLevel(CharacterClasses.barbarian(), 1), new ClassLevel(CharacterClasses.fighter(), 1)],
      new SequenceRandom(1, 1),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );

    expect(character.baseAttackBonus).toBe(2);
    expect(character.barbarianLevels).toBe(1);
  });
});

describe('sneak attack dice by rogue level', () => {
  const rogueAt = (level: number, rolls: number[]): Character =>
    Character.fromClassLevels(
      'Test Rogue',
      abilities(),
      [new ClassLevel(CharacterClasses.rogue(), level)],
      new SequenceRandom(...rolls),
      30,
      Weapons.dagger(),
      { x: 0, y: 0 },
      'A',
    );

  it.each([
    [1, [], 1],
    [2, [1], 1],
    [3, [1, 1], 2],
    [5, [1, 1, 1, 1], 3],
  ])('gives a rogue of level %i, %i dice', (level, rolls, expected) => {
    expect(rogueAt(level, rolls as number[]).sneakAttackDice).toBe(expected);
  });

  it('gives a fighter none', () => {
    const fighter = Character.fromClassLevels(
      'Test Fighter',
      abilities(),
      [new ClassLevel(CharacterClasses.fighter(), 1)],
      new SequenceRandom(),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );

    expect(fighter.sneakAttackDice).toBe(0);
  });

  it('counts only the rogue half of a multiclass', () => {
    const character = Character.fromClassLevels(
      'Test Multiclass',
      abilities(),
      [new ClassLevel(CharacterClasses.fighter(), 1), new ClassLevel(CharacterClasses.rogue(), 1)],
      new SequenceRandom(1),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );

    expect(character.sneakAttackDice).toBe(1);
  });
});

describe('the sorcerer', () => {
  const sorcererAt = (level: number, charisma = 10, knownSpells: Spell[] = []): Character =>
    Character.fromClassLevels(
      'Sorcerer',
      abilities(10, charisma),
      [new ClassLevel(CharacterClasses.sorcerer(), level)],
      new SequenceRandom(...Array<number>(level - 1).fill(2)),
      30,
      Weapons.dagger(),
      { x: 0, y: 0 },
      'A',
      null,
      null,
      [],
      knownSpells,
    );

  it('opens with the three first-level slots of the SRD table, and nothing higher', () => {
    const sorcerer = sorcererAt(1);

    expect(sorcerer.spellSlots.remaining(1)).toBe(3);
    expect(sorcerer.spellSlots.remaining(2)).toBe(0);
    expect(sorcerer.spellSlots.remaining(3)).toBe(0);
  });

  it('unlocks second-level slots at level 4 and third-level ones at 6', () => {
    expect(sorcererAt(4).spellSlots.remaining(2)).toBe(3);
    expect(sorcererAt(6).spellSlots.remaining(3)).toBe(3);
    expect(sorcererAt(7).spellSlots.remaining(3)).toBe(4);
  });

  it('adds a bonus slot per level the Charisma modifier reaches', () => {
    // CHA 16 (+3): one bonus at first level, one at second.
    expect(sorcererAt(1, 16).spellSlots.remaining(1)).toBe(4);
    expect(sorcererAt(4, 16).spellSlots.remaining(1)).toBe(7);
    expect(sorcererAt(4, 16).spellSlots.remaining(2)).toBe(4);
  });

  // Both sorcerer tables, row by row, against the SRD. Charisma 10 so no bonus spell muddies the
  // base numbers. Table: Sorcerer Spells per Day, columns 1st-3rd (the 0-level cantrip column is
  // out of the combat perimeter and is not modelled).
  // https://www.d20srd.org/srd/classes/sorcererWizard.htm#sorcerer
  it.each([
    [1, [3, 0, 0]],
    [2, [4, 0, 0]],
    [3, [5, 0, 0]],
    [4, [6, 3, 0]],
    [5, [6, 4, 0]],
    [6, [6, 5, 3]],
    [7, [6, 6, 4]],
  ])('has the SRD slots per day at level %i', (level, expected) => {
    const sorcerer = sorcererAt(level);

    expect([1, 2, 3].map((spellLevel) => sorcerer.spellSlots.remaining(spellLevel))).toEqual(expected);
  });

  // Table: Sorcerer Spells Known, summed over spell levels 1-3: 2, 2, 3, 3+1, 4+2, 4+2+1, 5+3+2.
  it.each([
    [1, 2],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 6],
    [6, 7],
    [7, 10],
    [8, 10],
  ])('knows the SRD number of spells of levels one to three at level %i', (level, expected) => {
    expect(spellsKnownLimit(level)).toBe(expected);
  });

  // SRD bonus spells: one extra slot at every spell level the ability modifier reaches, and another
  // every four points past it — Charisma 20 (+5) is +2 at 1st level and +1 at 2nd and 3rd. Measured
  // as the gap against Charisma 10, so the formula is under test and not the base table.
  // https://www.d20srd.org/srd/theBasics.htm#abilitiesAndSpellcasters
  it.each([
    [1, 2],
    [2, 1],
    [3, 1],
  ])('adds the bonus slots Charisma 20 grants at spell level %i (+%i)', (spellLevel, expectedBonus) => {
    const plain = sorcererAt(6).spellSlots.remaining(spellLevel);

    expect(sorcererAt(6, 20).spellSlots.remaining(spellLevel) - plain).toBe(expectedBonus);
  });

  it('adds none at Charisma 10', () => {
    const sorcerer = sorcererAt(6);

    expect(sorcerer.spellSlots.remaining(1)).toBe(6);
    expect(sorcerer.spellSlots.remaining(2)).toBe(5);
    expect(sorcerer.spellSlots.remaining(3)).toBe(3);
  });

  it.each([
    [1, 1],
    [4, 2],
    [6, 3],
  ])('can cast up to level %i spells at character level %i', (level, expected) => {
    expect(maxCastableSpellLevel(level)).toBe(expected);
  });

  it('remembers the spells it was built with', () => {
    const sorcerer = sorcererAt(3, 10, [SpellCatalog.magicMissile(), SpellCatalog.scorchingRay()]);

    expect(sorcerer.knownSpells).toHaveLength(2);
    expect(sorcerer.knownSpells.map((spell) => spell.name)).toContain('Magic Missile');
  });

  it('learns a spell only once', () => {
    const sorcerer = sorcererAt(1);

    sorcerer.learnSpell(SpellCatalog.magicMissile());
    sorcerer.learnSpell(SpellCatalog.magicMissile());

    expect(sorcerer.knownSpells).toHaveLength(1);
  });

  it('refuses to cast what it never learned, slots or no slots', () => {
    const sorcerer = sorcererAt(1);
    const target = combatant('Target').at(1, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(20, 1), [sorcerer, target]);

    expect(() => battle.execute(castSpellAction(SpellCatalog.magicMissile(), target))).toThrow();
  });

  it('casts a self buff through Battle, spending a slot from the table', () => {
    const sorcerer = sorcererAt(1, 10, [SpellCatalog.mageArmor()]);
    const armorClassBefore = sorcerer.effectiveArmorClass;
    const enemy = combatant('Enemy').at(9, 9).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(20, 1), [sorcerer, enemy]);

    battle.execute(castSpellAction(SpellCatalog.mageArmor()));

    expect(sorcerer.effectiveArmorClass).toBe(armorClassBefore + 4);
    expect(sorcerer.spellSlots.remaining(1)).toBe(2);
    expect(battle.log.some((entry) => entry.event === 'CastSpell')).toBe(true);
  });

  it('casts an attack spell through Battle, spending a slot from the table', () => {
    const sorcerer = sorcererAt(1, 10, [SpellCatalog.magicMissile()]);
    const target = combatant('Target').hp(20).at(3, 0).on('B').build();
    const battle = new Battle(new Grid(10, 10), new SequenceRandom(20, 1, 3), [sorcerer, target]);

    battle.execute(castSpellAction(SpellCatalog.magicMissile(), target));

    expect(sorcerer.spellSlots.remaining(1)).toBe(2);
    expect(target.currentHitPoints).toBe(16);
  });

  it('raises the caster’s AC by four with Shield, as with Mage Armor', () => {
    const caster = combatant('Caster').build();
    const armorClassBefore = caster.effectiveArmorClass;

    resolveSpell(new SequenceRandom(), caster, [caster], SpellCatalog.shield());

    expect(caster.effectiveArmorClass).toBe(armorClassBefore + 4);
  });
});
