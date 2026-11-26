import { describe, it, expect } from 'vitest';
import { buildRoster, previewPlayerCombatant } from '../src/game/roster-builder';
import { newBattleFromChoice } from '../src/game/replay';
import { singleClassLoadout } from '../src/game/loadout';
import { CharacterClasses } from '../src/engine/character-class';
import { Weapons, Armors } from '../src/engine/catalogs';
import { SequenceRandom } from '../src/engine/random';

const GRID = 20;
const humanFighter = (level: number) =>
  singleClassLoadout(CharacterClasses.fighter(), level, Weapons.longsword(), Armors.chainmail(), null);

const build = (partySize: number, enemyCount: number) =>
  buildRoster(humanFighter(3), partySize, enemyCount, GRID, new SequenceRandom(...Array(50).fill(4)));

describe('buildRoster', () => {
  it('produces the requested count per side', () => {
    const roster = build(3, 2);
    expect(roster.filter((c) => c.side === 'A')).toHaveLength(3);
    expect(roster.filter((c) => c.side === 'B')).toHaveLength(2);
  });

  it('gives every combatant a distinct square', () => {
    const roster = build(4, 4);
    const distinct = new Set(roster.map((c) => `${c.position.x},${c.position.y}`));
    expect(distinct.size).toBe(roster.length);
  });

  it('names are unique', () => {
    const roster = build(4, 4);
    expect(new Set(roster.map((c) => c.name)).size).toBe(roster.length);
  });

  it('sides occupy opposite columns', () => {
    const roster = build(2, 2);
    expect(new Set(roster.filter((c) => c.side === 'A').map((c) => c.position.x))).toEqual(new Set([1]));
    expect(new Set(roster.filter((c) => c.side === 'B').map((c) => c.position.x))).toEqual(new Set([GRID - 2]));
  });

  it('auto combatants mirror the human total level (same BAB)', () => {
    const roster = buildRoster(humanFighter(5), 2, 1, GRID, new SequenceRandom(...Array(50).fill(4)));
    const humanBab = roster.find((c) => c.name === 'You')!.baseAttackBonus;
    for (const c of roster.filter((c) => c.name !== 'You')) {
      expect(c.baseAttackBonus).toBe(humanBab);
    }
  });

  it('rejects an empty side', () => {
    expect(() => build(0, 2)).toThrow();
  });
});

describe('previewPlayerCombatant', () => {
  it('is the combatant the fight starts with: same hit points as the first of the seeded roster', () => {
    const choice = {
      loadout: singleClassLoadout(CharacterClasses.fighter(), 3, Weapons.longsword(), Armors.chainmail(), null),
      partySize: 2,
      enemyCount: 2,
      seed: 42,
    };

    const preview = previewPlayerCombatant(choice);
    const started = newBattleFromChoice(choice).combatants.find((c) => c.name === 'You');

    expect(preview.name).toBe('You');
    expect(preview.maxHitPoints).toBe(started?.maxHitPoints);
    expect(preview.effectiveArmorClass).toBe(started?.effectiveArmorClass);
    expect(preview.baseAttackBonus).toBe(3);
  });
});
