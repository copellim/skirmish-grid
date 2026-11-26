// Fluent builder for test combatants, ported from the C# `CharacterBuilder`. Sensible defaults (all
// abilities 10, 20 HP, BAB 0, speed 30, longsword, (0,0), Side A); a test overrides only what it
// actually cares about, so the six-argument AbilitySet stops drowning the rule under test.

import { Character } from '../../src/engine/character';
import { AbilitySet, AbilityScore } from '../../src/engine/ability';
import { Weapons } from '../../src/engine/catalogs';
import { Armor, Shield, Weapon } from '../../src/engine/item';
import type { Side } from '../../src/engine/enums';
import type { Position } from '../../src/engine/position';
import type { Feat } from '../../src/engine/feat';

const DEFAULT_ABILITY_SCORE = 10;

export class CharacterBuilder {
  private strength = DEFAULT_ABILITY_SCORE;
  private dexterity = DEFAULT_ABILITY_SCORE;
  private constitution = DEFAULT_ABILITY_SCORE;
  private intelligence = DEFAULT_ABILITY_SCORE;
  private wisdom = DEFAULT_ABILITY_SCORE;
  private charisma = DEFAULT_ABILITY_SCORE;
  private maxHitPoints = 20;
  private baseAttackBonus = 0;
  private speed = 30;
  private weapon: Weapon = Weapons.longsword();
  private position: Position = { x: 0, y: 0 };
  private side: Side = 'A';
  private armor: Armor | null = null;
  private shield: Shield | null = null;
  private fortitudeBaseSave = 0;
  private reflexBaseSave = 0;
  private willBaseSave = 0;
  private sneakAttackDice = 0;
  private barbarianLevels = 0;
  private casterLevel = 0;
  private readonly feats: Feat[] = [];

  private constructor(private readonly name: string) {}

  static named(name: string): CharacterBuilder {
    return new CharacterBuilder(name);
  }

  str(score: number): this {
    this.strength = score;
    return this;
  }

  dex(score: number): this {
    this.dexterity = score;
    return this;
  }

  con(score: number): this {
    this.constitution = score;
    return this;
  }

  int(score: number): this {
    this.intelligence = score;
    return this;
  }

  wis(score: number): this {
    this.wisdom = score;
    return this;
  }

  cha(score: number): this {
    this.charisma = score;
    return this;
  }

  hp(maxHitPoints: number): this {
    this.maxHitPoints = maxHitPoints;
    return this;
  }

  bab(baseAttackBonus: number): this {
    this.baseAttackBonus = baseAttackBonus;
    return this;
  }

  movingAt(speed: number): this {
    this.speed = speed;
    return this;
  }

  wielding(weapon: Weapon): this {
    this.weapon = weapon;
    return this;
  }

  at(x: number, y: number): this {
    this.position = { x, y };
    return this;
  }

  on(side: Side): this {
    this.side = side;
    return this;
  }

  wearing(armor: Armor): this {
    this.armor = armor;
    return this;
  }

  carrying(shield: Shield): this {
    this.shield = shield;
    return this;
  }

  saves(fortitude: number, reflex: number, will: number): this {
    this.fortitudeBaseSave = fortitude;
    this.reflexBaseSave = reflex;
    this.willBaseSave = will;
    return this;
  }

  sneakDice(dice: number): this {
    this.sneakAttackDice = dice;
    return this;
  }

  barbarianAt(levels: number): this {
    this.barbarianLevels = levels;
    return this;
  }

  castingAt(casterLevel: number): this {
    this.casterLevel = casterLevel;
    return this;
  }

  withFeat(feat: Feat): this {
    this.feats.push(feat);
    return this;
  }

  build(): Character {
    const character = new Character(
      this.name,
      new AbilitySet(
        new AbilityScore(this.strength),
        new AbilityScore(this.dexterity),
        new AbilityScore(this.constitution),
        new AbilityScore(this.intelligence),
        new AbilityScore(this.wisdom),
        new AbilityScore(this.charisma),
      ),
      this.maxHitPoints,
      this.baseAttackBonus,
      this.speed,
      this.weapon,
      this.position,
      this.side,
      this.armor,
      this.shield,
      this.fortitudeBaseSave,
      this.reflexBaseSave,
      this.willBaseSave,
      this.sneakAttackDice,
      this.barbarianLevels,
      this.casterLevel,
    );
    for (const feat of this.feats) {
      character.addFeat(feat);
    }
    return character;
  }
}

/** `CharacterBuilder.named(name)`, shortened — these tests build a lot of combatants. */
export const combatant = (name: string): CharacterBuilder => CharacterBuilder.named(name);
