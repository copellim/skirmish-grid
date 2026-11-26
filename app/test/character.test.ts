import { describe, it, expect } from 'vitest';
import { Character } from '../src/engine/character';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { CharacterClasses, ClassLevel } from '../src/engine/character-class';
import { Weapons, Armors, Shields } from '../src/engine/catalogs';
import { PowerAttackFeat, WeaponFocusFeat } from '../src/engine/feat';
import { SequenceRandom } from '../src/engine/random';

const abilities = (str = 10, dex = 10, con = 10, int = 10, wis = 10, cha = 10) =>
  new AbilitySet(
    new AbilityScore(str),
    new AbilityScore(dex),
    new AbilityScore(con),
    new AbilityScore(int),
    new AbilityScore(wis),
    new AbilityScore(cha),
  );

describe('Character.fromClassLevels', () => {
  it('takes max hit-die at level 1, then rolls subsequent levels in order', () => {
    // Fighter 3 (d10): 10 (max) + roll(7) + roll(4) + CON(+0) = 21.
    const c = Character.fromClassLevels(
      'Hero',
      abilities(),
      [new ClassLevel(CharacterClasses.fighter(), 3)],
      new SequenceRandom(7, 4),
      30,
      Weapons.longsword(),
      { x: 0, y: 0 },
      'A',
    );
    expect(c.maxHitPoints).toBe(21);
    expect(c.baseAttackBonus).toBe(3); // full BAB
    expect(c.savingThrowModifier('Fortitude')).toBe(3); // good save base at L3
    expect(c.savingThrowModifier('Reflex')).toBe(1); // poor save base at L3
  });

  it('applies CON modifier per total level', () => {
    // Rogue 1 (d6): 6 + CON(+2)×1 = 8.
    const c = Character.fromClassLevels(
      'Sneak',
      abilities(10, 14, 14),
      [new ClassLevel(CharacterClasses.rogue(), 1)],
      new SequenceRandom(),
      30,
      Weapons.dagger(),
      { x: 0, y: 0 },
      'A',
    );
    expect(c.maxHitPoints).toBe(8);
    expect(c.sneakAttackDice).toBe(1);
  });

  it('grants sorcerer spell slots scaled by Charisma', () => {
    // Sorcerer 3, CHA 16 (+3): base 1st-level slots = 5, +bonus(3,1)=1 → 6.
    const c = Character.fromClassLevels(
      'Mage',
      abilities(8, 12, 12, 10, 10, 16),
      [new ClassLevel(CharacterClasses.sorcerer(), 3)],
      new SequenceRandom(2, 3),
      30,
      Weapons.dagger(),
      { x: 0, y: 0 },
      'A',
    );
    expect(c.casterLevel).toBe(3);
    expect(c.spellSlots.remaining(1)).toBe(6);
  });
});

describe('feats', () => {
  it('rejects Power Attack without Strength 13', () => {
    const c = new Character('Weak', abilities(10), 10, 1, 30, Weapons.club(), { x: 0, y: 0 }, 'A');
    expect(() => c.addFeat(new PowerAttackFeat())).toThrow();
  });

  it('Weapon Focus adds +1 to the matching attack kind only', () => {
    const c = new Character('Bow', abilities(12, 14), 10, 1, 30, Weapons.shortbow(), { x: 0, y: 0 }, 'A');
    c.addFeat(new WeaponFocusFeat('Ranged'));
    expect(c.passiveFeatAttackBonus('Ranged')).toBe(1);
    expect(c.passiveFeatAttackBonus('Melee')).toBe(0);
  });
});

describe('derived stats', () => {
  it('caps Dex bonus by armor and reduces speed for medium armor', () => {
    const c = new Character('Tank', abilities(14, 18), 12, 1, 30, Weapons.longsword(), { x: 0, y: 0 }, 'A', Armors.chainmail());
    // chainmail caps Dex at +2; AC = 10 + 2 + 5 = 17.
    expect(c.effectiveArmorClass).toBe(17);
    expect(c.effectiveSpeed).toBe(20);
  });

  it('rejects a two-handed weapon paired with a shield', () => {
    expect(
      () =>
        new Character('Bad', abilities(), 12, 1, 30, Weapons.greatsword(), { x: 0, y: 0 }, 'A', null, Shields.heavySteel()),
    ).toThrow();
  });

  // SRD: "You need at least two hands to use a bow, regardless of its size."
  it('rejects a bow paired with a shield, for the same reason', () => {
    expect(
      () =>
        new Character('Archer', abilities(), 12, 1, 30, Weapons.shortbow(), { x: 0, y: 0 }, 'A', null, Shields.buckler()),
    ).toThrow();
  });
});

describe('AbilitySet', () => {
  it('exposes all six SRD abilities with their modifiers', () => {
    const set = new AbilitySet(
      new AbilityScore(16),
      new AbilityScore(14),
      new AbilityScore(13),
      new AbilityScore(10),
      new AbilityScore(12),
      new AbilityScore(8),
    );

    expect([
      set.strength.modifier,
      set.dexterity.modifier,
      set.constitution.modifier,
      set.intelligence.modifier,
      set.wisdom.modifier,
      set.charisma.modifier,
    ]).toEqual([3, 2, 1, 0, 1, -1]);
  });
});

describe('Character basics', () => {
  const fighter = (maxHitPoints = 12) =>
    new Character('Fighter', abilities(16, 10), maxHitPoints, 1, 30, Weapons.longsword(), { x: 0, y: 0 }, 'A', Armors.chainShirt(), Shields.lightSteel());

  it('starts at full health with the stats it was given', () => {
    const c = fighter();

    expect(c.name).toBe('Fighter');
    expect(c.maxHitPoints).toBe(12);
    expect(c.currentHitPoints).toBe(12);
    expect(c.effectiveArmorClass).toBe(15); // 10 + chain shirt 4 + light shield 1
    expect(c.baseAttackBonus).toBe(1);
    expect(c.speed).toBe(30);
    expect(c.weapon.name).toBe('Longsword');
    expect(c.position).toEqual({ x: 0, y: 0 });
    expect(c.isAlive).toBe(true);
  });

  it('takes damage off the current total', () => {
    const c = fighter();

    c.takeDamage(5);

    expect(c.currentHitPoints).toBe(7);
    expect(c.isAlive).toBe(true);
  });

  it('stops at the death threshold', () => {
    const c = fighter();

    c.takeDamage(100);

    expect(c.currentHitPoints).toBe(-10);
    expect(c.isAlive).toBe(false);
  });

  it('refuses damage that heals', () => {
    expect(() => fighter().takeDamage(-1)).toThrow();
  });

  it('moves where it is told', () => {
    const c = fighter();

    c.moveTo({ x: 3, y: 4 });

    expect(c.position).toEqual({ x: 3, y: 4 });
  });

  it.each([[0], [-1]])('refuses %i maximum hit points', (maxHitPoints) => {
    expect(() => fighter(maxHitPoints)).toThrow();
  });
});
