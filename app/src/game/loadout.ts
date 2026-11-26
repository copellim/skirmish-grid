import { AbilitySet, AbilityScore } from '../engine/ability';
import { ClassLevel, type CharacterClass } from '../engine/character-class';
import type { Weapon, Armor, Shield } from '../engine/item';
import type { Feat } from '../engine/feat';
import type { Spell } from '../engine/spell';

/** The human's chosen character: classes/level, equipment, feats, known spells. Port of `PlayerLoadout`. */
export interface PlayerLoadout {
  readonly classes: readonly ClassLevel[];
  readonly weapon: Weapon;
  readonly armor: Armor | null;
  readonly shield: Shield | null;
  readonly feats: readonly Feat[];
  readonly knownSpells: readonly Spell[];
}

/** Fixed arena dimension (squares per side). Not user-chosen, so it lives with the match config. */
export const ARENA_GRID_SIZE = 12;

/** A full match setup: the human's loadout plus side sizes and the seed that fixes all randomness. */
export interface LoadoutChoice {
  readonly loadout: PlayerLoadout;
  readonly partySize: number;
  readonly enemyCount: number;
  readonly seed: number;
}

// Default ability arrays (mirror the C# LoadoutScreen): a martial spread and an arcane-caster spread.
const martialAbilities = new AbilitySet(
  new AbilityScore(16),
  new AbilityScore(13),
  new AbilityScore(14),
  new AbilityScore(10),
  new AbilityScore(12),
  new AbilityScore(8),
);

const casterAbilities = new AbilitySet(
  new AbilityScore(10),
  new AbilityScore(14),
  new AbilityScore(14),
  new AbilityScore(12),
  new AbilityScore(10),
  new AbilityScore(16),
);

/** The ability set appropriate for the chosen class (martial vs arcane caster). */
export function abilitiesFor(classes: readonly ClassLevel[]): AbilitySet {
  return classes.some((c) => c.characterClass.grantsArcaneSpellcasting) ? casterAbilities : martialAbilities;
}

export function singleClassLoadout(
  characterClass: CharacterClass,
  level: number,
  weapon: Weapon,
  armor: Armor | null,
  shield: Shield | null,
  feats: readonly Feat[] = [],
  knownSpells: readonly Spell[] = [],
): PlayerLoadout {
  return { classes: [new ClassLevel(characterClass, level)], weapon, armor, shield, feats, knownSpells };
}
