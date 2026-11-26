import type { Random } from './random';
import type { Character } from './character';
import type { Side } from './enums';
import { rollD20Check } from './d20-check';
import { rollPercentile } from './dice';

const MINIMUM_COMBATANTS = 2;
// SRD Condition Summary, Dying: "She has a 10% chance to become stable."
const STABILIZATION_PERCENTILE_MAX = 10;
const BLEED_OUT_DAMAGE = 1;

/**
 * Drives turn order: rolls SRD initiative (d20 + Dex, ties by higher Dex then original order),
 * cycles to the next living combatant, and tracks the actor's action economy (one move + one
 * standard per turn) plus dying-actor bleed-out. Port of `TurnManager`.
 */
export class TurnManager {
  private readonly random: Random;
  private readonly initiativeOrderList: Character[];
  private readonly initiativeTotals = new Map<Character, number>();
  private currentIndex = 0;

  private _turnNumber = 1;
  private _hasMovementAvailable = false;
  private _hasStandardActionAvailable = false;
  private _isMovementLimitedToFiveFootStep = false;
  private _hasTakenMoreThanAFiveFootStep = false;

  constructor(random: Random, combatants: readonly Character[]) {
    if (combatants.length < MINIMUM_COMBATANTS) {
      throw new Error(`A fight needs at least ${MINIMUM_COMBATANTS} combatants.`);
    }
    this.random = random;
    this.initiativeOrderList = this.rollInitiative(random, combatants);
    this.currentIndex = 0;
    for (const combatant of this.initiativeOrderList) {
      combatant.markFlatFooted();
    }
    this.grantTurnActions();
  }

  get turnNumber(): number {
    return this._turnNumber;
  }

  get initiativeOrder(): readonly Character[] {
    return this.initiativeOrderList;
  }

  get currentActor(): Character {
    return this.initiativeOrderList[this.currentIndex];
  }

  get hasMovementAvailable(): boolean {
    return this._hasMovementAvailable;
  }

  get hasStandardActionAvailable(): boolean {
    return this._hasStandardActionAvailable;
  }

  /**
   * SRD Full Attack: "The only movement you can take during a full attack is a 5-foot step." The
   * move action survives the full attack, but nothing except that step may spend it.
   */
  get isMovementLimitedToFiveFootStep(): boolean {
    return this._isMovementLimitedToFiveFootStep;
  }

  /** True once the actor has moved by anything other than a 5-foot step, which bars a full attack. */
  get hasTakenMoreThanAFiveFootStep(): boolean {
    return this._hasTakenMoreThanAFiveFootStep;
  }

  // SRD Injury and Death: combat ends when at most one Side has a Conscious member.
  get isCombatOver(): boolean {
    const sides = new Set<Side>();
    for (const c of this.initiativeOrderList) {
      if (c.vitalStatus === 'Conscious') {
        sides.add(c.side);
      }
    }
    return sides.size <= 1;
  }

  get winner(): Character | null {
    return this.isCombatOver
      ? this.initiativeOrderList.find((c) => c.vitalStatus === 'Conscious') ?? null
      : null;
  }

  /** The side that won — a victory belongs to a Side, not a single survivor. */
  get winningSide(): Side | null {
    if (!this.isCombatOver) {
      return null;
    }
    const survivor = this.initiativeOrderList.find((c) => c.vitalStatus === 'Conscious');
    return survivor ? survivor.side : null;
  }

  useMovement(): void {
    if (!this._hasMovementAvailable) {
      throw new Error('Movement has already been used this turn.');
    }
    this._hasMovementAvailable = false;
    this._hasTakenMoreThanAFiveFootStep = true;
  }

  /** SRD Full Attack: the 5-foot step is the one movement a full attack tolerates. */
  useFiveFootStep(): void {
    if (!this._hasMovementAvailable) {
      throw new Error('Movement has already been used this turn.');
    }
    this._hasMovementAvailable = false;
  }

  useStandardAction(): void {
    if (!this._hasStandardActionAvailable) {
      throw new Error('The standard action has already been used this turn.');
    }
    this._hasStandardActionAvailable = false;
  }

  /**
   * SRD Full Attack: a full-round action that still leaves room for a 5-foot step, before, after
   * or between the attacks. It spends the standard action and narrows what is left of the move.
   */
  useFullAttack(): void {
    if (!this._hasStandardActionAvailable) {
      throw new Error('A full attack needs the standard action available.');
    }
    if (this._hasTakenMoreThanAFiveFootStep) {
      throw new Error('A full attack allows no movement beyond a 5-ft step.');
    }
    this._hasStandardActionAvailable = false;
    this._isMovementLimitedToFiveFootStep = true;
  }

  useFullRoundAction(): void {
    if (!this._hasMovementAvailable || !this._hasStandardActionAvailable) {
      throw new Error('A full-round action needs both the move and the standard action available.');
    }
    this._hasMovementAvailable = false;
    this._hasStandardActionAvailable = false;
    this._hasTakenMoreThanAFiveFootStep = true;
  }

  advanceTurn(): boolean {
    const previousIndex = this.currentIndex;
    do {
      this.currentIndex = (this.currentIndex + 1) % this.initiativeOrderList.length;
    } while (this.currentActor.vitalStatus === 'Stable' || this.currentActor.vitalStatus === 'Dead');

    const newRoundStarted = this.currentIndex <= previousIndex;
    if (newRoundStarted) {
      this._turnNumber++;
      this.resolveBleedOutAtEndOfRound();
    }

    this.grantTurnActions();
    return newRoundStarted;
  }

  /**
   * SRD Condition Summary, Dying: "At the end of each round (starting with the round in which the
   * character dropped below 0 hit points), the character rolls d% to see whether she becomes
   * stable. She has a 10% chance to become stable. If she does not, she loses 1 hit point."
   *
   * The check comes first and Constitution has nothing to do with it; the hit point is lost only
   * when it fails. Resolved in initiative order so the draw sequence stays stable for a seed.
   */
  private resolveBleedOutAtEndOfRound(): void {
    for (const combatant of this.initiativeOrderList) {
      if (combatant.vitalStatus !== 'Dying') {
        continue;
      }
      if (rollPercentile(this.random) <= STABILIZATION_PERCENTILE_MAX) {
        combatant.stabilize();
        continue;
      }
      combatant.takeDamage(BLEED_OUT_DAMAGE);
    }
  }

  private grantTurnActions(): void {
    this._hasMovementAvailable = true;
    this._hasStandardActionAvailable = true;
    this._isMovementLimitedToFiveFootStep = false;
    this._hasTakenMoreThanAFiveFootStep = false;
    this.currentActor.resetAttacksOfOpportunity();
    this.currentActor.resetCleave();
    this.currentActor.tickEffects();
    this.currentActor.clearFlatFooted();
    // SRD Aid Another: both +2 last until the start of the *helper's* next turn, so it is the
    // helper coming round that expires them — on whoever received them, not on the actor on turn.
    for (const combatant of this.initiativeOrderList) {
      combatant.expireAidFrom(this.currentActor);
    }
    if (this.currentActor.isRaging) {
      this.currentActor.tickRage();
    }
  }

  initiativeOf(combatant: Character): number {
    return this.initiativeTotals.get(combatant)!;
  }

  private rollInitiative(random: Random, combatants: readonly Character[]): Character[] {
    const entries = combatants.map((combatant, index) => {
      const dexterityModifier = combatant.abilities.dexterity.modifier;
      // The d20 draw happens here, in combatant order, to keep the sequence stable for seeds.
      const total = rollD20Check(random, dexterityModifier).total;
      this.initiativeTotals.set(combatant, total);
      return { combatant, dexterityModifier, total, index };
    });

    return entries
      .sort((a, b) => b.total - a.total || b.dexterityModifier - a.dexterityModifier || a.index - b.index)
      .map((entry) => entry.combatant);
  }
}
