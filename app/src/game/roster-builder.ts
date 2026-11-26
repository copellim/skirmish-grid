import { Character } from '../engine/character';
import { ClassLevel, CharacterClasses } from '../engine/character-class';
import { Weapons, Armors } from '../engine/catalogs';
import type { Weapon, Armor, Shield } from '../engine/item';
import type { Side } from '../engine/enums';
import type { Position } from '../engine/position';
import { SeededRandom, type Random } from '../engine/random';
import type { Feat } from '../engine/feat';
import type { Spell } from '../engine/spell';
import { ARENA_GRID_SIZE, abilitiesFor, type LoadoutChoice, type PlayerLoadout } from './loadout';

const HUMAN_COLUMN_X = 1;

// Spread a side's members on consecutive squares of its column, centered on the grid's midline.
function columnY(gridSize: number, count: number, index: number): number {
  const top = Math.floor(gridSize / 2) - Math.floor(count / 2);
  return Math.max(0, Math.min(gridSize - 1, top + index));
}

function buildCharacter(
  name: string,
  position: Position,
  side: Side,
  classes: readonly ClassLevel[],
  weapon: Weapon,
  armor: Armor | null,
  shield: Shield | null,
  random: Random,
  feats: readonly Feat[] = [],
  knownSpells: readonly Spell[] = [],
): Character {
  return Character.fromClassLevels(
    name,
    abilitiesFor(classes),
    classes,
    random,
    30,
    weapon,
    position,
    side,
    armor,
    shield,
    feats,
    knownSpells,
  );
}

function buildMirroredFighter(name: string, position: Position, side: Side, level: number, random: Random): Character {
  return buildCharacter(
    name,
    position,
    side,
    [new ClassLevel(CharacterClasses.fighter(), level)],
    Weapons.longsword(),
    Armors.chainmail(),
    null,
    random,
  );
}

/**
 * Builds the NvM roster: the human's chosen character on Side.A plus auto-generated allies, against
 * auto-generated Side.B enemies. Auto combatants are Fighters mirrored on the human's total level
 * (longsword + chainmail) — the human only picks their own loadout. Pure. Port of `RosterBuilder`.
 */
export function buildRoster(
  humanLoadout: PlayerLoadout,
  partySize: number,
  enemyCount: number,
  gridSize: number,
  characterRandom: Random,
): Character[] {
  if (partySize < 1 || enemyCount < 1) {
    throw new Error('Each side needs at least one combatant.');
  }

  const enemyColumnX = gridSize - 2;
  const mirroredLevel = humanLoadout.classes.reduce((t, c) => t + c.level, 0);

  const roster: Character[] = [
    buildCharacter(
      'You',
      { x: HUMAN_COLUMN_X, y: columnY(gridSize, partySize, 0) },
      'A',
      humanLoadout.classes,
      humanLoadout.weapon,
      humanLoadout.armor,
      humanLoadout.shield,
      characterRandom,
      humanLoadout.feats,
      humanLoadout.knownSpells,
    ),
  ];

  for (let i = 1; i < partySize; i++) {
    roster.push(
      buildMirroredFighter('Ally ' + (i + 1), { x: HUMAN_COLUMN_X, y: columnY(gridSize, partySize, i) }, 'A', mirroredLevel, characterRandom),
    );
  }

  for (let i = 0; i < enemyCount; i++) {
    roster.push(
      buildMirroredFighter('Enemy ' + (i + 1), { x: enemyColumnX, y: columnY(gridSize, enemyCount, i) }, 'B', mirroredLevel, characterRandom),
    );
  }

  return roster;
}

/**
 * The human's combatant exactly as the fight will build it — same loadout, same seed, so the hit
 * points the loadout screen previews are the ones the first round starts with.
 */
export function previewPlayerCombatant(choice: LoadoutChoice): Character {
  return buildRoster(choice.loadout, choice.partySize, choice.enemyCount, ARENA_GRID_SIZE, new SeededRandom(choice.seed))[0];
}
