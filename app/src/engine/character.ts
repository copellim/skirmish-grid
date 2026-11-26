import { AbilitySet } from './ability';
import { Armor, Shield, Weapon, type Effect, type Item } from './item';
import { Weapons } from './catalogs';
import type {
  Side,
  WeaponKind,
  BonusType,
  BonusTarget,
  SavingThrowKind,
  VitalStatus,
  EffectDuration,
} from './enums';
import type { Position } from './position';
import { Feat } from './feat';
import type { Spell } from './spell';
import { SpellSlots } from './spell-slots';
import { grantSorcererSpellSlots } from './sorcerer-spell-slots';
import { ClassLevel, babAt, saveAt } from './character-class';
import type { Random } from './random';
import { rollDie } from './dice';

const ATTACKS_OF_OPPORTUNITY_PER_ROUND = 1;
const BASE_ARMOR_CLASS = 10; // SRD: AC starts at 10 before any bonuses.
const DEATH_THRESHOLD = -10;
const SPEED_REDUCTION_DIVISOR = 5;
// SRD Bonus Types: untyped modifiers always stack, and dodge bonuses stack with each other too.
const ALWAYS_STACKING_BONUS_TYPES: ReadonlySet<BonusType> = new Set(['Untyped', 'Dodge']);
// SRD Touch Attacks: the three bonus types a touch attack goes straight through.
const TOUCH_ATTACK_IGNORED_BONUS_TYPES: ReadonlySet<BonusType> = new Set(['Armor', 'Shield', 'Natural']);
// SRD Barbarian, Rage: 3 rounds plus the newly improved Constitution modifier; the rage's own
// +4 to the score is +2 on the modifier.
const RAGE_BASE_DURATION_IN_ROUNDS = 3;
const RAGE_ABILITY_MODIFIER_BONUS = 2;
const RAGE_ARMOR_CLASS_PENALTY = -2;
// SRD: one rage a day at 1st level, one more every four levels, six at most.
const LEVELS_PER_EXTRA_DAILY_RAGE = 4;
const MAXIMUM_DAILY_RAGES = 6;
const RAGE_HIT_POINTS_PER_LEVEL = 2;
// SRD Aid Another: a successful check gives "a +2 bonus on his next attack roll" or "a +2 bonus to
// AC against that opponent's next attack".
const AID_ANOTHER_ATTACK_BONUS = 2;
const AID_ANOTHER_ARMOR_CLASS_BONUS = 2;

type FeatConstructor<T extends Feat> = abstract new (...args: never[]) => T;

/**
 * A combatant on the battle grid. Mutable state (hit points, position, conditions) changes only
 * through the dedicated mutators. Port of `Character`.
 */
export class Character {
  readonly name: string;
  readonly abilities: AbilitySet;
  readonly maxHitPoints: number;
  currentHitPoints: number;
  readonly armor: Armor | null;
  readonly shield: Shield | null;
  readonly baseAttackBonus: number;
  readonly sneakAttackDice: number;
  readonly barbarianLevels: number;
  /** Sum of levels in arcane spellcasting classes. Zero for non-casters. */
  readonly casterLevel: number;
  readonly fortitudeBaseSave: number;
  readonly reflexBaseSave: number;
  readonly willBaseSave: number;
  readonly speed: number;
  readonly weapon: Weapon;
  position: Position;
  readonly side: Side;

  private availableAttacksOfOpportunity = ATTACKS_OF_OPPORTUNITY_PER_ROUND;
  private _hasCleavedThisRound = false;
  private readonly feats: Feat[] = [];
  private readonly effects: Effect[] = [];
  private readonly _spellSlots = new SpellSlots();
  private readonly _knownSpells: Spell[] = [];

  private _isStable = false;
  private _isFlatFooted = false;
  private _isProne = false;
  private _isDisarmed = false;
  private _isFatigued = false;
  private _avoidsOverruns = false;
  private _isRaging = false;
  private _rageRoundsLeft = 0;
  private _ragesRemaining = 0;
  private _rageHitPoints = 0;
  private readonly attackAidGranters: Character[] = [];
  private readonly armorClassAidGranters: Character[] = [];

  constructor(
    name: string,
    abilities: AbilitySet,
    maxHitPoints: number,
    baseAttackBonus: number,
    speed: number,
    weapon: Weapon,
    position: Position,
    side: Side,
    armor: Armor | null = null,
    shield: Shield | null = null,
    fortitudeBaseSave = 0,
    reflexBaseSave = 0,
    willBaseSave = 0,
    sneakAttackDice = 0,
    barbarianLevels = 0,
    casterLevel = 0,
  ) {
    if (!name || name.trim().length === 0) {
      throw new Error('Character name must not be empty.');
    }
    if (maxHitPoints < 1) {
      throw new RangeError('Max hit points must be at least 1.');
    }
    // SRD: a two-handed weapon occupies both hands and cannot be wielded with a shield.
    if (weapon.handedness === 'TwoHanded' && shield !== null) {
      throw new Error(
        `A two-handed weapon (${weapon.name}) cannot be used with a shield (${shield.name}).`,
      );
    }

    this.name = name;
    this.abilities = abilities;
    this.maxHitPoints = maxHitPoints;
    this.currentHitPoints = maxHitPoints;
    this.armor = armor;
    this.shield = shield;
    this.baseAttackBonus = baseAttackBonus;
    this.speed = speed;
    this.weapon = weapon;
    this.position = position;
    this.side = side;
    this.fortitudeBaseSave = fortitudeBaseSave;
    this.reflexBaseSave = reflexBaseSave;
    this.willBaseSave = willBaseSave;
    this.sneakAttackDice = sneakAttackDice;
    this.barbarianLevels = barbarianLevels;
    this.casterLevel = casterLevel;
    this._ragesRemaining = Character.dailyRages(barbarianLevels);
  }

  // ---- Feats ----

  get allFeats(): readonly Feat[] {
    return this.feats;
  }

  hasFeat<T extends Feat>(ctor: FeatConstructor<T>): boolean {
    return this.feats.some((f) => f instanceof ctor);
  }

  addFeat(feat: Feat): void {
    if (this.feats.some((f) => f.name === feat.name)) {
      throw new Error(`Feat '${feat.name}' already acquired.`);
    }
    const reason = feat.unmetPrerequisiteReason(this);
    if (reason !== null) {
      throw new Error(`Prerequisites not met for feat '${feat.name}': ${reason}.`);
    }
    this.feats.push(feat);
  }

  passiveFeatAttackBonus(attackKind: WeaponKind): number {
    return this.feats.reduce((sum, f) => sum + f.passiveAttackBonus(this, attackKind), 0);
  }

  // ---- Spells ----

  get spellSlots(): SpellSlots {
    return this._spellSlots;
  }

  get knownSpells(): readonly Spell[] {
    return this._knownSpells;
  }

  /** Adds a spell to the known list. Ignores duplicates (by name — names are unique). */
  learnSpell(spell: Spell): void {
    if (!this._knownSpells.some((s) => s.name === spell.name)) {
      this._knownSpells.push(spell);
    }
  }

  // ---- Effects ----

  get activeEffects(): readonly Effect[] {
    return this.effects;
  }

  addEffect(effect: Effect): void {
    this.effects.push(effect);
  }

  /** SRD: effects that last "until the start of your next turn" expire when that turn begins. */
  tickEffects(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].duration === ('UntilStartOfNextTurn' satisfies EffectDuration)) {
        this.effects.splice(i, 1);
      }
    }
  }

  private effectBonus(target: BonusTarget): number {
    return this.effects
      .filter((e) => e.target === target)
      .reduce((sum, e) => sum + e.value, 0);
  }

  /** Transient AC change (e.g. charging's -2) lasting until the start of this character's next turn. */
  get armorClassModifier(): number {
    return this.effectBonus('ArmorClass');
  }

  /** A transient untyped AC change (the charge's -2) expiring at the start of this character's next turn. */
  applyArmorClassModifier(delta: number): void {
    this.addEffect({
      type: 'Untyped',
      target: 'ArmorClass',
      value: delta,
      duration: 'UntilStartOfNextTurn',
    });
  }

  // ---- Conditions ----

  get isFlatFooted(): boolean {
    return this._isFlatFooted;
  }
  markFlatFooted(): void {
    this._isFlatFooted = true;
  }
  clearFlatFooted(): void {
    this._isFlatFooted = false;
  }

  get isProne(): boolean {
    return this._isProne;
  }
  markProne(): void {
    this._isProne = true;
  }
  clearProne(): void {
    this._isProne = false;
  }

  get isDisarmed(): boolean {
    return this._isDisarmed;
  }
  markDisarmed(): void {
    this._isDisarmed = true;
  }
  clearDisarmed(): void {
    this._isDisarmed = false;
  }

  /** SRD: a disarmed combatant falls back to an unarmed strike (1d3). */
  get activeWeapon(): Weapon {
    return this._isDisarmed ? Weapons.unarmedStrike() : this.weapon;
  }

  /**
   * SRD Overrun, Step 2: "The defender has the option to simply avoid you." The engine cannot ask a
   * combatant who is not on turn, so the choice is a stance: the defender declares it on its own
   * turn and keeps it until it changes it. Blocking is the default.
   */
  get avoidsOverruns(): boolean {
    return this._avoidsOverruns;
  }
  setAvoidsOverruns(avoids: boolean): void {
    this._avoidsOverruns = avoids;
  }

  get isFatigued(): boolean {
    return this._isFatigued;
  }
  markFatigued(): void {
    this._isFatigued = true;
  }
  clearFatigued(): void {
    this._isFatigued = false;
  }

  private get fatiguedStrengthPenalty(): number {
    return this._isFatigued ? -2 : 0;
  }
  private get fatiguedDexterityPenalty(): number {
    return this._isFatigued ? -2 : 0;
  }

  // ---- Rage (SRD Barbarian) ----

  get isRaging(): boolean {
    return this._isRaging;
  }
  get rageRoundsLeft(): number {
    return this._rageRoundsLeft;
  }
  get ragesRemaining(): number {
    return this._ragesRemaining;
  }
  /** SRD: not temporary hit points — they never absorb damage first, they just raise the total. */
  get rageHitPoints(): number {
    return this._rageHitPoints;
  }

  private get rageStrengthBonus(): number {
    return this._isRaging ? RAGE_ABILITY_MODIFIER_BONUS : 0;
  }
  private get rageConstitutionBonus(): number {
    return this._isRaging ? RAGE_ABILITY_MODIFIER_BONUS : 0;
  }
  private get rageArmorClassPenalty(): number {
    return this._isRaging ? RAGE_ARMOR_CLASS_PENALTY : 0;
  }
  private get rageWillSaveBonus(): number {
    return this._isRaging ? RAGE_ABILITY_MODIFIER_BONUS : 0;
  }

  /**
   * SRD Barbarian: "At 1st level he can use his rage ability once per day. At 4th level and every
   * four levels thereafter, he can use it one additional time per day (to a maximum of six times
   * per day at 20th level)."
   */
  private static dailyRages(barbarianLevels: number): number {
    if (barbarianLevels === 0) {
      return 0;
    }
    const earned = 1 + Math.floor(barbarianLevels / LEVELS_PER_EXTRA_DAILY_RAGE);
    return Math.min(earned, MAXIMUM_DAILY_RAGES);
  }

  /**
   * SRD Barbarian: "A fit of rage lasts for a number of rounds equal to 3 + the character's (newly
   * improved) Constitution modifier." The argument is the modifier before the rage; the +2 the
   * rage itself grants is added here.
   */
  enterRage(constitutionModifier: number): void {
    this._isRaging = true;
    this._rageRoundsLeft =
      RAGE_BASE_DURATION_IN_ROUNDS + constitutionModifier + RAGE_ABILITY_MODIFIER_BONUS;
    this._ragesRemaining--;
    this._rageHitPoints = RAGE_HIT_POINTS_PER_LEVEL * this.barbarianLevels;
    this.currentHitPoints += this._rageHitPoints;
  }

  tickRage(): void {
    if (!this._isRaging) {
      return;
    }
    this._rageRoundsLeft--;
    if (this._rageRoundsLeft <= 0) {
      this.endRage();
    }
  }

  /**
   * SRD Barbarian: the Constitution increase "increases the barbarian's hit points by 2 points per
   * level, but these hit points go away at the end of the rage" — the whole amount, whatever damage
   * landed meanwhile, which can drop the barbarian on the spot.
   */
  endRage(): void {
    this._isRaging = false;
    this._rageRoundsLeft = 0;
    this.currentHitPoints = Math.max(DEATH_THRESHOLD, this.currentHitPoints - this._rageHitPoints);
    this._rageHitPoints = 0;
    this.markFatigued();
  }

  // ---- Vitality ----

  get vitalStatus(): VitalStatus {
    if (this.currentHitPoints > 0) return 'Conscious';
    if (this.currentHitPoints === 0) return 'Staggered';
    // SRD Condition Summary, Dead: "The character's hit points are reduced to -10 or lower."
    // Death outranks stabilization — having stabilized earlier is no protection from the blow that
    // gets there.
    if (this.currentHitPoints <= DEATH_THRESHOLD) return 'Dead';
    return this._isStable ? 'Stable' : 'Dying';
  }

  get isDefeated(): boolean {
    const status = this.vitalStatus;
    return status === 'Dying' || status === 'Stable' || status === 'Dead';
  }

  get isAlive(): boolean {
    return this.currentHitPoints > DEATH_THRESHOLD;
  }

  get canAct(): boolean {
    const status = this.vitalStatus;
    return status === 'Conscious' || status === 'Staggered';
  }

  takeDamage(amount: number): void {
    if (amount < 0) {
      throw new RangeError('Damage must not be negative.');
    }
    // SRD Barbarian: the rage hit points "are not lost first the way temporary hit points are",
    // so damage always comes off the real total.
    this.currentHitPoints = Math.max(DEATH_THRESHOLD, this.currentHitPoints - amount);
  }

  stabilize(): void {
    this._isStable = true;
  }

  moveTo(destination: Position): void {
    this.position = destination;
  }

  // ---- Derived defense ----

  get effectiveSpeed(): number {
    // SRD: medium/heavy armor reduces base speed (30→20, 20→15). No exact .5 case arises for
    // standard speeds, so Math.round matches C# Math.Round here.
    const armoredSpeed = this.armor?.reducedSpeed
      ? Math.round((this.speed * 2) / 3 / SPEED_REDUCTION_DIVISOR) * SPEED_REDUCTION_DIVISOR
      : this.speed;
    // SRD Condition Summary, Disabled: at exactly 0 hit points "she moves at half speed", rounded
    // down to a whole 5-ft square.
    return this.vitalStatus === 'Staggered'
      ? Math.floor(armoredSpeed / 2 / SPEED_REDUCTION_DIVISOR) * SPEED_REDUCTION_DIVISOR
      : armoredSpeed;
  }

  // SRD: armor caps the wearer's Dex bonus to AC; a shield does not. Flat-footed suppresses a
  // positive Dex bonus but a Dex penalty still applies.
  private get cappedDexterityBonus(): number {
    const dexMod = this.abilities.dexterity.modifier;
    const cappedDex =
      this.armor === null ? dexMod : Math.min(dexMod, this.armor.maximumDexterityBonus);
    return this._isFlatFooted ? Math.min(0, cappedDex) : cappedDex;
  }

  private get equippedItems(): Item[] {
    const items: Item[] = [this.weapon];
    if (this.armor !== null) items.push(this.armor);
    if (this.shield !== null) items.push(this.shield);
    return items;
  }

  /** Everything that modifies armor class right now: the gear worn and the effects in play. */
  private get armorClassContributions(): { type: BonusType; value: number }[] {
    const fromEquipment = this.equippedItems
      .flatMap((item) => item.bonuses)
      .filter((bonus) => bonus.target === 'ArmorClass');
    const fromEffects = this.effects.filter((effect) => effect.target === 'ArmorClass');
    return [...fromEquipment, ...fromEffects];
  }

  /**
   * SRD Bonus Types, Stacking and Modifiers: "The same type of bonus doesn't stack with the same
   * type — only the best bonus applies", while bonuses without a type do stack, and "Penalties […]
   * do stack with one another". So Mage Armor's armor bonus never adds to worn armor. Dodge
   * bonuses are the SRD's own exception: they "stack with each other".
   */
  private static stackBonuses(contributions: readonly { type: BonusType; value: number }[]): number {
    const bestOfEachType = new Map<BonusType, number>();
    let total = 0;
    for (const contribution of contributions) {
      if (contribution.value < 0 || ALWAYS_STACKING_BONUS_TYPES.has(contribution.type)) {
        total += contribution.value;
        continue;
      }
      const best = bestOfEachType.get(contribution.type) ?? 0;
      bestOfEachType.set(contribution.type, Math.max(best, contribution.value));
    }
    for (const best of bestOfEachType.values()) {
      total += best;
    }
    return total;
  }

  /** SRD AC: 10 + capped Dex + the stacked typed bonuses + rage/fatigue penalties. */
  get effectiveArmorClass(): number {
    return (
      BASE_ARMOR_CLASS +
      this.cappedDexterityBonus +
      Character.stackBonuses(this.armorClassContributions) +
      this.aidAnotherArmorClassBonus +
      this.rageArmorClassPenalty +
      this.fatiguedDexterityPenalty
    );
  }

  /**
   * SRD Touch Attacks: "you ignore the target's armor bonus, shield bonus, and natural armor
   * bonus." The filter is on the bonus type, so Mage Armor is left out exactly like worn armor.
   * The Dexterity cap stays: the armor is still being worn.
   */
  get touchArmorClass(): number {
    const reaching = this.armorClassContributions.filter(
      (contribution) => !TOUCH_ATTACK_IGNORED_BONUS_TYPES.has(contribution.type),
    );
    return (
      BASE_ARMOR_CLASS +
      this.cappedDexterityBonus +
      Character.stackBonuses(reaching) +
      this.rageArmorClassPenalty +
      this.fatiguedDexterityPenalty
    );
  }

  // ---- Saving throws & offense ----

  savingThrowModifier(kind: SavingThrowKind): number {
    switch (kind) {
      case 'Fortitude':
        return (
          this.fortitudeBaseSave + this.abilities.constitution.modifier + this.rageConstitutionBonus
        );
      case 'Reflex':
        // The effective modifier, not the raw score: fatigue's -2 to Dexterity reaches Reflex too.
        return this.reflexBaseSave + this.effectiveDexterityModifier;
      case 'Will':
        return this.willBaseSave + this.abilities.wisdom.modifier + this.rageWillSaveBonus;
    }
  }

  get effectiveStrengthModifier(): number {
    return this.abilities.strength.modifier + this.rageStrengthBonus + this.fatiguedStrengthPenalty;
  }

  get effectiveDexterityModifier(): number {
    return this.abilities.dexterity.modifier + this.fatiguedDexterityPenalty;
  }

  get meleeAttackBonus(): number {
    return this.baseAttackBonus + this.effectiveStrengthModifier + this.passiveFeatAttackBonus('Melee');
  }

  get rangedAttackBonus(): number {
    return this.baseAttackBonus + this.effectiveDexterityModifier + this.passiveFeatAttackBonus('Ranged');
  }

  // ---- Attacks of opportunity & Aid Another ----

  /**
   * SRD Threatened Squares: "You threaten all squares into which you can make a melee attack"; and
   * "If you're unarmed, you don't normally threaten any squares and thus can't make attacks of
   * opportunity." A bow is not a melee attack, and a disarmed combatant falls back to an unarmed
   * strike — neither threatens anything.
   */
  get threatensAdjacentSquares(): boolean {
    return !this.isDefeated && !this.activeWeapon.isRanged && !this.activeWeapon.isUnarmed;
  }

  /**
   * SRD Condition Summary (Flat-Footed): "A flat-footed character loses his Dexterity bonus to AC
   * (if any) and cannot make attacks of opportunity." Being flat-footed suspends the attack, not
   * the threat: the squares stay threatened.
   */
  get canMakeAttackOfOpportunity(): boolean {
    return (
      this.threatensAdjacentSquares &&
      !this.isFlatFooted &&
      this.availableAttacksOfOpportunity > 0
    );
  }

  get availableAttacksOfOpportunityCount(): number {
    return this.availableAttacksOfOpportunity;
  }

  spendAttackOfOpportunity(): void {
    if (this.availableAttacksOfOpportunity <= 0) {
      throw new Error('No attack of opportunity available this round.');
    }
    this.availableAttacksOfOpportunity--;
  }

  resetAttacksOfOpportunity(): void {
    this.availableAttacksOfOpportunity = ATTACKS_OF_OPPORTUNITY_PER_ROUND;
  }

  /**
   * SRD Cleave: "You can use this ability once per round." A round's worth of chances is what a
   * character gets between one of its turns and the next — the same window as the attack of
   * opportunity above — so both are reset by `TurnManager.grantTurnActions`.
   */
  get hasCleavedThisRound(): boolean {
    return this._hasCleavedThisRound;
  }

  markCleaved(): void {
    this._hasCleavedThisRound = true;
  }

  resetCleave(): void {
    this._hasCleavedThisRound = false;
  }

  /**
   * SRD Aid Another: both benefits hold "as long as that attack comes before the beginning of your
   * next turn" — the *helper's* next turn. So each bonus remembers who granted it: only that
   * helper's turn coming round can expire it, and until then it survives the recipient's own turn.
   *
   * The two are kept apart because they live differently: the attack bonus is spent by the first
   * attack that uses it, the armor class bonus only ever expires.
   */
  get aidAnotherAttackBonus(): number {
    return this.attackAidGranters.length * AID_ANOTHER_ATTACK_BONUS;
  }
  grantAttackAid(helper: Character): void {
    this.attackAidGranters.push(helper);
  }

  get aidAnotherArmorClassBonus(): number {
    return this.armorClassAidGranters.length * AID_ANOTHER_ARMOR_CLASS_BONUS;
  }
  grantArmorClassAid(helper: Character): void {
    this.armorClassAidGranters.push(helper);
  }

  /** Drops both kinds of aid a given helper granted: their next turn has begun. */
  expireAidFrom(helper: Character): void {
    Character.dropGranter(this.attackAidGranters, helper);
    Character.dropGranter(this.armorClassAidGranters, helper);
  }

  private static dropGranter(granters: Character[], helper: Character): void {
    for (let i = granters.length - 1; i >= 0; i--) {
      if (granters[i] === helper) {
        granters.splice(i, 1);
      }
    }
  }

  /** Spends the attack bonus: the first attack that uses it consumes every stack of it. */
  resetAidAnotherBonus(): void {
    this.attackAidGranters.length = 0;
  }

  // ---- Relationships ----

  /** Two combatants are enemies when they belong to different sides. */
  static areEnemies(first: Character, second: Character): boolean {
    return first !== second && first.side !== second.side;
  }

  /** Two combatants are allies when they share a side but are not the same combatant. */
  static areAllies(first: Character, second: Character): boolean {
    return first !== second && first.side === second.side;
  }

  /**
   * Builds a character whose BAB, saving throws, and hit points derive from class/level entries
   * (SRD Multiclass: BAB and base saves sum). First overall level uses the max hit-die face; each
   * subsequent level rolls 1dDV via `random` in list order. Port of `Character.FromClassLevels`.
   */
  static fromClassLevels(
    name: string,
    abilities: AbilitySet,
    classes: readonly ClassLevel[],
    random: Random,
    speed: number,
    weapon: Weapon,
    position: Position,
    side: Side,
    armor: Armor | null = null,
    shield: Shield | null = null,
    feats: readonly Feat[] = [],
    knownSpells: readonly Spell[] = [],
  ): Character {
    const sum = (selector: (c: ClassLevel) => number) => classes.reduce((t, c) => t + selector(c), 0);

    const bab = sum((c) => babAt(c.characterClass.bab, c.level));
    const fortBase = sum((c) => saveAt(c.characterClass.fortitude, c.level));
    const refBase = sum((c) => saveAt(c.characterClass.reflex, c.level));
    const willBase = sum((c) => saveAt(c.characterClass.will, c.level));

    const rogueLevels = sum((c) => (c.characterClass.grantsSneakAttack ? c.level : 0));
    const sneakAttackDice = rogueLevels > 0 ? Math.floor((rogueLevels + 1) / 2) : 0;
    const barbarianLevels = sum((c) => (c.characterClass.grantsRage ? c.level : 0));
    const sorcererLevels = sum((c) => (c.characterClass.grantsArcaneSpellcasting ? c.level : 0));

    const hp = Character.computeHitPoints(abilities, classes, random);

    const character = new Character(
      name,
      abilities,
      hp,
      bab,
      speed,
      weapon,
      position,
      side,
      armor,
      shield,
      fortBase,
      refBase,
      willBase,
      sneakAttackDice,
      barbarianLevels,
      sorcererLevels,
    );

    if (sorcererLevels > 0) {
      grantSorcererSpellSlots(character.spellSlots, sorcererLevels, abilities.charisma.modifier);
    }

    for (const feat of feats) {
      character.addFeat(feat);
    }
    for (const spell of knownSpells) {
      character.learnSpell(spell);
    }

    return character;
  }

  private static computeHitPoints(
    abilities: AbilitySet,
    classes: readonly ClassLevel[],
    random: Random,
  ): number {
    const totalLevel = classes.reduce((t, c) => t + c.level, 0);
    let isFirstLevelConsumed = false;
    let rolledHp = 0;

    for (const classLevel of classes) {
      let levelsToRoll = classLevel.level;
      if (!isFirstLevelConsumed) {
        rolledHp += classLevel.characterClass.hitDieSides;
        levelsToRoll--;
        isFirstLevelConsumed = true;
      }
      for (let i = 0; i < levelsToRoll; i++) {
        rolledHp += rollDie(random, classLevel.characterClass.hitDieSides);
      }
    }

    const totalHp = rolledHp + abilities.constitution.modifier * totalLevel;
    return Math.max(1, totalHp); // SRD: minimum 1 hit point total.
  }
}
