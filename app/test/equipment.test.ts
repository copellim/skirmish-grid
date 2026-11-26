// SRD Equipment — armor, shields and weapons: https://www.d20srd.org/srd/equipment/
//
// What the gear contributes: armor class from typed bonuses (armor and shield stack, the Dex cap
// bites, transient modifiers land on top), the speed heavy and medium armor costs, and the weapon
// profile the attack resolution reads (threat range, multiplier, range increment).

import { describe, it, expect } from 'vitest';
import { Character } from '../src/engine/character';
import { Armor, Shield, Weapon } from '../src/engine/item';
import { DiceExpression } from '../src/engine/dice-expression';
import { Armors, Shields, Weapons } from '../src/engine/catalogs';
import { combatant } from './support/character-builder';

describe('armor class', () => {
  const fighter = (dexterity: number, armor?: Armor, shield?: Shield): Character => {
    let builder = combatant('Fighter').dex(dexterity).hp(12).bab(1).wielding(Weapons.longsword());
    builder = armor === undefined ? builder : builder.wearing(armor);
    return (shield === undefined ? builder : builder.carrying(shield)).build();
  };

  it('is ten plus the whole Dexterity bonus with no armor at all', () => {
    expect(fighter(16).effectiveArmorClass).toBe(13);
  });

  it('adds the armor bonus and caps the Dexterity one', () => {
    // Dex 18 is +4, and a chain shirt allows exactly +4: 10 + 4 + 4.
    expect(fighter(18, Armors.chainShirt()).effectiveArmorClass).toBe(18);
  });

  it('lets the cap bite when the Dexterity bonus exceeds it', () => {
    // Dex 20 is +5, but full plate allows +1: 10 + 1 + 8.
    expect(fighter(20, Armors.fullPlate()).effectiveArmorClass).toBe(19);
  });

  it('stacks armor with a shield, since the bonus types differ', () => {
    expect(fighter(13, Armors.chainShirt(), Shields.lightSteel()).effectiveArmorClass).toBe(16);
  });

  it('does not let a shield cap the Dexterity bonus', () => {
    expect(fighter(20, undefined, Shields.heavySteel()).effectiveArmorClass).toBe(17);
  });

  // SRD Bonus Types: "Bonuses without a type always stack" — with each other and with the typed
  // ones, unlike two bonuses that share a type.
  it('stacks untyped modifiers with each other and with the gear', () => {
    const character = fighter(13, Armors.chainShirt());

    character.applyArmorClassModifier(2); // an ally aiding
    character.applyArmorClassModifier(2); // and another

    expect(character.effectiveArmorClass).toBe(10 + 1 + 4 + 2 + 2);
  });

  it('keeps only the larger of two armor bonuses', () => {
    const character = fighter(13, Armors.chainShirt()); // an armor bonus of +4
    character.addEffect({ type: 'Armor', target: 'ArmorClass', value: 2, duration: 'Permanent' });

    expect(character.effectiveArmorClass).toBe(10 + 1 + 4);
  });

  // SRD Bonus Types: "Dodge bonuses […] stack with each other, unlike most other types of bonuses."
  it('stacks dodge bonuses with each other', () => {
    const character = fighter(13, Armors.chainShirt());
    character.addEffect({ type: 'Dodge', target: 'ArmorClass', value: 1, duration: 'Permanent' });
    character.addEffect({ type: 'Dodge', target: 'ArmorClass', value: 1, duration: 'Permanent' });

    expect(character.effectiveArmorClass).toBe(10 + 1 + 4 + 1 + 1);
  });

  it('keeps only the larger of two deflection bonuses, as for any other type', () => {
    const character = fighter(13, Armors.chainShirt());
    character.addEffect({ type: 'Deflection', target: 'ArmorClass', value: 1, duration: 'Permanent' });
    character.addEffect({ type: 'Deflection', target: 'ArmorClass', value: 3, duration: 'Permanent' });

    expect(character.effectiveArmorClass).toBe(10 + 1 + 4 + 3);
  });

  it('applies a transient modifier on top of all of it', () => {
    const character = fighter(13, Armors.chainShirt());

    character.applyArmorClassModifier(-2); // a charge, say

    expect(character.effectiveArmorClass).toBe(10 + 1 + 4 - 2);
  });
});

describe('speed under armor', () => {
  const withArmor = (armor: Armor | undefined, baseSpeed = 30): Character => {
    const builder = combatant('Fighter').hp(10).bab(1).movingAt(baseSpeed).wielding(Weapons.shortsword());
    return (armor === undefined ? builder : builder.wearing(armor)).build();
  };

  it('cuts thirty feet to twenty in heavy armor', () => {
    expect(withArmor(Armors.fullPlate()).effectiveSpeed).toBe(20);
  });

  it('cuts twenty feet to fifteen, for the shorter legs', () => {
    expect(withArmor(Armors.fullPlate(), 20).effectiveSpeed).toBe(15);
  });

  it('costs the same twenty in medium armor', () => {
    expect(withArmor(Armors.breastplate()).effectiveSpeed).toBe(20);
  });

  it('costs nothing in light armor', () => {
    expect(withArmor(Armors.chainShirt()).effectiveSpeed).toBe(30);
  });

  it('leaves an unarmored combatant at their base speed', () => {
    expect(withArmor(undefined).effectiveSpeed).toBe(30);
  });
});

describe('armor and shields as items', () => {
  it('carries the SRD profile and grants an armor-typed AC bonus', () => {
    const chainShirt = Armors.chainShirt();

    expect(chainShirt.name).toBe('Chain shirt');
    expect(chainShirt.armorBonus).toBe(4);
    expect(chainShirt.maximumDexterityBonus).toBe(4);
    expect(chainShirt.category).toBe('Light');
    expect(chainShirt.bonuses).toContainEqual({ type: 'Armor', target: 'ArmorClass', value: 4 });
  });

  it('refuses negative armor numbers', () => {
    expect(() => new Armor('Bad', -1, 4, 'Light')).toThrow();
    expect(() => new Armor('Bad', 4, -1, 'Light')).toThrow();
  });

  it('grants a shield-typed AC bonus, which is why it stacks with armor', () => {
    const heavySteel = Shields.heavySteel();

    expect(heavySteel.name).toBe('Heavy steel shield');
    expect(heavySteel.shieldBonus).toBe(2);
    expect(heavySteel.bonuses).toContainEqual({ type: 'Shield', target: 'ArmorClass', value: 2 });
  });

  it('refuses a negative shield bonus', () => {
    expect(() => new Shield('Bad', -1)).toThrow();
  });
});

describe('weapons', () => {
  const longsword = () => new Weapon('Longsword', DiceExpression.parse('1d8'), 19, 2);

  it('exposes the stats the attack resolution reads', () => {
    const weapon = longsword();

    expect(weapon.name).toBe('Longsword');
    expect(weapon.damageDice.toString()).toBe('1d8');
    expect(weapon.threatRangeMin).toBe(19);
    expect(weapon.criticalMultiplier).toBe(2);
  });

  it.each([
    [20, true],
    [19, true],
    [18, false],
    [1, false],
  ])('threatens on a natural %i: %s', (naturalRoll, threatens) => {
    expect(longsword().threatensCriticalOn(naturalRoll)).toBe(threatens);
  });

  it('threatens on twenty alone when that is its whole range', () => {
    const greataxe = new Weapon('Greataxe', DiceExpression.parse('1d12'), 20, 3);

    expect(greataxe.threatensCriticalOn(20)).toBe(true);
    expect(greataxe.threatensCriticalOn(19)).toBe(false);
  });

  it('refuses a blank name', () => {
    expect(() => new Weapon('  ', DiceExpression.parse('1d8'), 20, 2)).toThrow();
  });

  it.each([[1], [21]])('refuses a threat range of %i, outside 2–20', (threatRangeMin) => {
    expect(() => new Weapon('Bad', DiceExpression.parse('1d8'), threatRangeMin, 2)).toThrow();
  });

  it('refuses a critical multiplier below two', () => {
    expect(() => new Weapon('Bad', DiceExpression.parse('1d8'), 20, 1)).toThrow();
  });

  it('gives a melee weapon its SRD profile and no bonuses of its own', () => {
    const greatsword = Weapons.greatsword();

    expect(greatsword.name).toBe('Greatsword');
    expect(greatsword.damageDice.toString()).toBe('2d6');
    expect(greatsword.threatRangeMin).toBe(19);
    expect(greatsword.criticalMultiplier).toBe(2);
    expect(greatsword.isRanged).toBe(false);
    expect(greatsword.bonuses).toHaveLength(0);
  });

  it('gives a ranged one its range increment', () => {
    const longbow = Weapons.longbow();

    expect(longbow.isRanged).toBe(true);
    expect(longbow.rangeIncrementInFeet).toBe(100);
    expect(longbow.criticalMultiplier).toBe(3);
  });
});

// The catalogs are data, and data drifts silently: one wrong column and a whole class of fights is
// resolved against a rule nobody wrote. These three walk the SRD tables entry by entry.
// Armor and shields: https://www.d20srd.org/srd/equipment/armor.htm#tableArmorandShields
// Weapons: https://www.d20srd.org/srd/equipment/weapons.htm#tableWeapons (Medium damage column)
describe('the catalogs against the SRD tables', () => {
  it.each([
    ['Padded', Armors.padded, 1, 8, 0, false],
    ['Leather', Armors.leather, 2, 6, 0, false],
    ['Studded leather', Armors.studdedLeather, 3, 5, -1, false],
    ['Chain shirt', Armors.chainShirt, 4, 4, -2, false],
    ['Hide', Armors.hide, 3, 4, -3, true],
    ['Scale mail', Armors.scaleMail, 4, 3, -4, true],
    ['Chainmail', Armors.chainmail, 5, 2, -5, true],
    ['Breastplate', Armors.breastplate, 5, 3, -4, true],
    ['Splint mail', Armors.splintMail, 6, 0, -7, true],
    ['Banded mail', Armors.bandedMail, 6, 1, -6, true],
    ['Half-plate', Armors.halfPlate, 7, 0, -7, true],
    ['Full plate', Armors.fullPlate, 8, 1, -6, true],
  ])('%s carries its row of the armor table', (name, make, bonus, maximumDex, checkPenalty, slower) => {
    const armor = make();

    expect(armor.name).toBe(name);
    expect(armor.armorBonus).toBe(bonus);
    expect(armor.maximumDexterityBonus).toBe(maximumDex);
    expect(armor.armorCheckPenalty).toBe(checkPenalty);
    expect(armor.reducedSpeed).toBe(slower);
  });

  it.each([
    ['Buckler', Shields.buckler, 1],
    ['Light wooden shield', Shields.lightWooden, 1],
    ['Light steel shield', Shields.lightSteel, 1],
    ['Heavy wooden shield', Shields.heavyWooden, 2],
    ['Heavy steel shield', Shields.heavySteel, 2],
    ['Tower shield', Shields.tower, 4],
  ])('%s carries its row of the shield table', (name, make, bonus) => {
    const shield = make();

    expect(shield.name).toBe(name);
    expect(shield.shieldBonus).toBe(bonus);
  });

  it.each([
    ['Dagger', Weapons.dagger, '1d4', 19, 2, 'Melee', 0, 'Light'],
    ['Club', Weapons.club, '1d6', 20, 2, 'Melee', 0, 'OneHanded'],
    ['Light mace', Weapons.lightMace, '1d6', 20, 2, 'Melee', 0, 'Light'],
    ['Heavy mace', Weapons.heavyMace, '1d8', 20, 2, 'Melee', 0, 'OneHanded'],
    ['Shortsword', Weapons.shortsword, '1d6', 19, 2, 'Melee', 0, 'Light'],
    ['Longsword', Weapons.longsword, '1d8', 19, 2, 'Melee', 0, 'OneHanded'],
    ['Rapier', Weapons.rapier, '1d6', 18, 2, 'Melee', 0, 'OneHanded'],
    ['Battleaxe', Weapons.battleaxe, '1d8', 20, 3, 'Melee', 0, 'OneHanded'],
    ['Warhammer', Weapons.warhammer, '1d8', 20, 3, 'Melee', 0, 'OneHanded'],
    ['Handaxe', Weapons.handaxe, '1d6', 20, 3, 'Melee', 0, 'Light'],
    ['Greatsword', Weapons.greatsword, '2d6', 19, 2, 'Melee', 0, 'TwoHanded'],
    ['Greataxe', Weapons.greataxe, '1d12', 20, 3, 'Melee', 0, 'TwoHanded'],
    ['Unarmed Strike', Weapons.unarmedStrike, '1d3', 20, 2, 'Melee', 0, 'Light'],
    ['Shortbow', Weapons.shortbow, '1d6', 20, 3, 'Ranged', 60, 'TwoHanded'],
    ['Longbow', Weapons.longbow, '1d8', 20, 3, 'Ranged', 100, 'TwoHanded'],
    ['Light crossbow', Weapons.lightCrossbow, '1d8', 19, 2, 'Ranged', 80, 'TwoHanded'],
    ['Heavy crossbow', Weapons.heavyCrossbow, '1d10', 19, 2, 'Ranged', 120, 'TwoHanded'],
    ['Sling', Weapons.sling, '1d4', 20, 2, 'Ranged', 50, 'OneHanded'],
  ])(
    '%s carries its row of the weapon table',
    (name, make, damage, threatRangeMin, multiplier, kind, rangeIncrement, handedness) => {
      const weapon = make();

      expect(weapon.name).toBe(name);
      expect(weapon.damageDice.toString()).toBe(damage);
      expect(weapon.threatRangeMin).toBe(threatRangeMin);
      expect(weapon.criticalMultiplier).toBe(multiplier);
      expect(weapon.kind).toBe(kind);
      expect(weapon.rangeIncrementInFeet).toBe(rangeIncrement);
      expect(weapon.handedness).toBe(handedness);
    },
  );
});
