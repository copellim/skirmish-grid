/**
 * A single SRD 3.5 ability score and its derived modifier. Modifier = floor((score - 10) / 2);
 * Math.floor (not integer truncation) is required so odd scores below 10 round down correctly
 * (7 → -2, not -1). Port of `AbilityScore`.
 */
export class AbilityScore {
  static readonly MINIMUM_SCORE = 1;

  readonly score: number;

  constructor(score: number) {
    if (score < AbilityScore.MINIMUM_SCORE) {
      throw new RangeError(`Ability score must be at least ${AbilityScore.MINIMUM_SCORE}.`);
    }
    this.score = score;
  }

  get modifier(): number {
    return Math.floor((this.score - 10) / 2);
  }
}

/** The six SRD 3.5 ability scores that define a character. Port of `AbilitySet`. */
export class AbilitySet {
  constructor(
    readonly strength: AbilityScore,
    readonly dexterity: AbilityScore,
    readonly constitution: AbilityScore,
    readonly intelligence: AbilityScore,
    readonly wisdom: AbilityScore,
    readonly charisma: AbilityScore,
  ) {}
}
