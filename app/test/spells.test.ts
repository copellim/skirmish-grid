import { describe, it, expect } from 'vitest';
import { resolveSpell } from '../src/engine/spell-resolver';
import { SpellCatalog } from '../src/engine/spell-catalog';
import { defensiveConcentrationDc, damageConcentrationDc, resolveConcentration } from '../src/engine/concentration';
import { Character } from '../src/engine/character';
import { AbilitySet, AbilityScore } from '../src/engine/ability';
import { Weapons } from '../src/engine/catalogs';
import { SequenceRandom } from '../src/engine/random';

const abil = (cha = 10, dex = 10, con = 10) =>
  new AbilitySet(
    new AbilityScore(10),
    new AbilityScore(dex),
    new AbilityScore(con),
    new AbilityScore(10),
    new AbilityScore(10),
    new AbilityScore(cha),
  );

const target = () => new Character('T', abil(), 30, 1, 30, Weapons.club(), { x: 5, y: 0 }, 'B');
const caster = (cha = 16, dex = 12) =>
  new Character('C', abil(cha, dex), 12, 1, 30, Weapons.dagger(), { x: 0, y: 0 }, 'A', null, null, 0, 0, 0, 0, 0, 3);

describe('SpellResolver', () => {
  it('Magic Missile auto-hits for 1d4+1', () => {
    const t = target();
    const res = resolveSpell(new SequenceRandom(3), caster(), [t], SpellCatalog.magicMissile());
    expect(res.targetResults[0].hit).toBe(true);
    expect(res.targetResults[0].damageDealt).toBe(3 + 1);
    expect(t.currentHitPoints).toBe(30 - 4);
  });

  it('Scorching Ray misses on a low ranged touch roll', () => {
    // touch attack = d20 + BAB(1) + DEX(+1). Roll 2 → total 4; target touch AC 10 → miss.
    const res = resolveSpell(new SequenceRandom(2), caster(), [target()], SpellCatalog.scorchingRay());
    expect(res.targetResults[0].hit).toBe(false);
    expect(res.targetResults[0].damageDealt).toBe(0);
  });

  it('Fireball shares one roll; a failed save takes full, a success takes half', () => {
    const a = target();
    const b = target();
    // shared 5d6 roll = 6×5 = 30. Then per-target Reflex saves: a fails (roll 2), b succeeds (roll 20).
    const rng = new SequenceRandom(6, 6, 6, 6, 6, /*a save*/ 2, /*b save*/ 20);
    const res = resolveSpell(rng, caster(), [a, b], SpellCatalog.fireball());
    expect(res.targetResults[0].damageDealt).toBe(30); // failed save → full
    expect(res.targetResults[1].damageDealt).toBe(15); // success → half
  });

  it('Mage Armor applies a +4 armor AC effect to the caster', () => {
    const c = caster();
    const before = c.effectiveArmorClass;
    resolveSpell(new SequenceRandom(), c, [c], SpellCatalog.mageArmor());
    expect(c.effectiveArmorClass).toBe(before + 4);
  });
});

describe('Concentration', () => {
  it('computes defensive and damage DCs', () => {
    expect(defensiveConcentrationDc(SpellCatalog.fireball())).toBe(18); // 15 + 3
    expect(damageConcentrationDc(7, SpellCatalog.magicMissile())).toBe(18); // 10 + 7 + 1
  });

  it('resolves a check against a DC', () => {
    // modifier = casterLevel(3) + 3 + CON(0) = 6. Roll 10 → total 16 ≥ 15.
    const res = resolveConcentration(new SequenceRandom(10), caster(), 15);
    expect(res.total).toBe(16);
    expect(res.succeeded).toBe(true);
  });
});
