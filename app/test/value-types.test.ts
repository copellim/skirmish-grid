import { describe, it, expect } from 'vitest';
import { AbilityScore } from '../src/engine/ability';
import { Armors, Weapons, Shields } from '../src/engine/catalogs';
import { Weapon } from '../src/engine/item';

describe('AbilityScore.modifier — floor((score-10)/2)', () => {
  it('rounds odd low scores down (not toward zero)', () => {
    expect(new AbilityScore(7).modifier).toBe(-2);
    expect(new AbilityScore(9).modifier).toBe(-1);
  });

  it('matches the SRD table', () => {
    expect(new AbilityScore(10).modifier).toBe(0);
    expect(new AbilityScore(16).modifier).toBe(3);
    expect(new AbilityScore(1).modifier).toBe(-5);
  });

  it('rejects scores below 1', () => {
    expect(() => new AbilityScore(0)).toThrow(RangeError);
  });
});

describe('catalogs', () => {
  it('returns fresh instances', () => {
    expect(Armors.chainmail()).not.toBe(Armors.chainmail());
  });

  it('chainmail carries its SRD profile and reduces speed', () => {
    const c = Armors.chainmail();
    expect([c.armorBonus, c.maximumDexterityBonus, c.armorCheckPenalty, c.reducedSpeed]).toEqual([
      5, 2, -5, true,
    ]);
  });

  it('ranged weapon reaches ten increments; melee uses reach', () => {
    expect(Weapons.shortbow().maximumRangeInFeet).toBe(600);
    expect(Weapons.longsword().maximumRangeInFeet).toBe(5);
    expect(Weapons.shortbow().isRanged).toBe(true);
  });

  it('two-handed weapon is flagged', () => {
    expect(Weapons.greatsword().handedness).toBe('TwoHanded');
  });

  it('a ranged weapon needs a positive range increment', () => {
    expect(() => new Weapon('bad', Weapons.dagger().damageDice, 20, 2, 'Ranged')).toThrow();
  });

  it('shields grant their AC bonus', () => {
    expect(Shields.tower().shieldBonus).toBe(4);
  });
});
