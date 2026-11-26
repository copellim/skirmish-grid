// SRD class definitions and the BAB / saving-throw progressions that drive them.

/**
 * SRD Base Attack Bonus progressions. Full = class level; ThreeQuarters = floor(level × 3/4);
 * Half = floor(level / 2).
 */
export type BabProgression = 'Full' | 'ThreeQuarters' | 'Half';

export function babAt(progression: BabProgression, classLevel: number): number {
  switch (progression) {
    case 'Full':
      return classLevel;
    case 'ThreeQuarters':
      return Math.floor((classLevel * 3) / 4);
    case 'Half':
      return Math.floor(classLevel / 2);
  }
}

/** SRD saving-throw progressions. Good = 2 + floor(level/2); Poor = floor(level/3). */
export type SaveProgression = 'Good' | 'Poor';

const GOOD_SAVE_BASE = 2;

export function saveAt(progression: SaveProgression, classLevel: number): number {
  switch (progression) {
    case 'Good':
      return GOOD_SAVE_BASE + Math.floor(classLevel / 2);
    case 'Poor':
      return Math.floor(classLevel / 3);
  }
}

/** An SRD character class definition: hit die, BAB and saving-throw progressions, granted features. */
export interface CharacterClass {
  readonly name: string;
  readonly hitDieSides: number;
  readonly bab: BabProgression;
  readonly fortitude: SaveProgression;
  readonly reflex: SaveProgression;
  readonly will: SaveProgression;
  readonly grantsSneakAttack: boolean;
  readonly grantsRage: boolean;
  readonly grantsArcaneSpellcasting: boolean;
}

/** Pairs a character class with the number of levels taken in that class. Port of `ClassLevel`. */
export class ClassLevel {
  readonly characterClass: CharacterClass;
  readonly level: number;

  constructor(characterClass: CharacterClass, level: number) {
    if (level < 1) {
      throw new RangeError('Level must be at least 1.');
    }
    this.characterClass = characterClass;
    this.level = level;
  }
}

function makeClass(
  name: string,
  hitDieSides: number,
  bab: BabProgression,
  fortitude: SaveProgression,
  reflex: SaveProgression,
  will: SaveProgression,
  flags: Partial<Pick<CharacterClass, 'grantsSneakAttack' | 'grantsRage' | 'grantsArcaneSpellcasting'>> = {},
): CharacterClass {
  return {
    name,
    hitDieSides,
    bab,
    fortitude,
    reflex,
    will,
    grantsSneakAttack: flags.grantsSneakAttack ?? false,
    grantsRage: flags.grantsRage ?? false,
    grantsArcaneSpellcasting: flags.grantsArcaneSpellcasting ?? false,
  };
}

// Standard SRD 3.5 class presets. SRD: https://www.d20srd.org/srd/classes/
export const CharacterClasses = {
  // d10, full BAB, good Fortitude, poor Reflex/Will.
  fighter: (): CharacterClass => makeClass('Fighter', 10, 'Full', 'Good', 'Poor', 'Poor'),
  // d6, ¾ BAB, good Reflex, poor Fortitude/Will, sneak attack.
  rogue: (): CharacterClass =>
    makeClass('Rogue', 6, 'ThreeQuarters', 'Poor', 'Good', 'Poor', { grantsSneakAttack: true }),
  // d12, full BAB, good Fortitude, poor Reflex/Will, rage.
  barbarian: (): CharacterClass =>
    makeClass('Barbarian', 12, 'Full', 'Good', 'Poor', 'Poor', { grantsRage: true }),
  // d4, ¾ BAB, good Will, poor Fortitude/Reflex, CHA-based arcane spontaneous caster.
  sorcerer: (): CharacterClass =>
    makeClass('Sorcerer', 4, 'ThreeQuarters', 'Poor', 'Poor', 'Good', {
      grantsArcaneSpellcasting: true,
    }),
};
