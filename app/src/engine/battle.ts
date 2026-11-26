import { Grid } from './grid';
import type { Random } from './random';
import { TurnManager } from './turn-manager';
import { CombatEngine } from './combat-engine';
import { Character } from './character';
import type { Side } from './enums';
import type { Position } from './position';
import { positionsEqual } from './position';
import { type AttackModifiers, type AttackResult } from './attack';
import type { CombatAction, AidAnotherBenefit } from './combat-action';
import type { CombatLogEntry, CombatLogEvent } from './combat-log';
import type { Weapon } from './item';
import type { Spell } from './spell';
import { PowerAttackFeat, CleaveFeat, GreatCleaveFeat } from './feat';
import { isLineOfSightClear, squaresBetween } from './line-of-sight';
import { rollD20Check, resolveTouchAttack } from './d20-check';
import { resolveOpposedCheck, attackerWins } from './opposed-check';
import { resolveSpell, type SpellResolution, type SpellTargetResult } from './spell-resolver';
import { defensiveConcentrationDc, damageConcentrationDc, resolveConcentration } from './concentration';

/**
 * One step in a battle's history, in execution order, with the combatant it belongs to and the round
 * it happened in (`turn`, the same counter the combat log stamps its entries with). Live domain
 * objects (no serialization) so the engine stays pure; `game/replay.ts` turns these into a portable
 * JSON replay and `game/match-log.ts` into a diagnostic log. Seed + this list = exact reproduction
 * of any match, human or AI.
 */
export type BattleEvent =
  | { readonly kind: 'action'; readonly turn: number; readonly actor: Character; readonly action: CombatAction }
  | { readonly kind: 'endTurn'; readonly turn: number; readonly actor: Character };

const FLANKING_BONUS = 2;
const CHARGE_ATTACK_BONUS = 2;
const CHARGE_ARMOR_CLASS_PENALTY = -2;
const MINIMUM_CHARGE_DISTANCE_IN_FEET = 10;
const FIVE_FOOT_STEP_COST_IN_FEET = 5;
const RANGE_INCREMENT_PENALTY = -2;
const MINIMUM_BAB_FOR_FULL_ATTACK = 6;
const PRONE_MELEE_BONUS = 4;
const PRONE_RANGED_PENALTY = -4;
const PRONE_ATTACKER_PENALTY = -4;
const SNEAK_ATTACK_MAX_RANGE_IN_FEET = 30;
// SRD Aid Another: "You make an attack roll against AC 10."
const AID_ANOTHER_DC = 10;
const TWO_HANDED_POWER_ATTACK_MULTIPLIER = 2;
const TWO_HANDED_DISARM_BONUS = 4;
const LIGHT_WEAPON_DISARM_PENALTY = -4;
const NON_MELEE_DISARM_PENALTY = -4;
// SRD Bull Rush: "an additional 5 feet for each 5 points" of margin on the opposed Strength check.
const BULL_RUSH_MARGIN_PER_EXTRA_SQUARE = 5;
const SQUARE_SIZE_IN_FEET = 5;
// SRD Disabled: a standard action taken at exactly 0 hit points costs one more hit point.
const DISABLED_STRAIN_DAMAGE = 1;

// SRD Cleave: the trigger is making a creature "drop (typically by dropping it to below 0 hit
// points or killing it)" — Dying, Stable or Dead, not only the -10 of Dead.
// Fresh-scope read of the status getter: combat mutates HP, but TS would keep `vitalStatus`
// narrowed to its pre-attack value at the call site. This helper recomputes without narrowing.
function hasDropped(character: Character): boolean {
  return character.isDefeated;
}

/**
 * Orchestrates a fight on a grid: owns the combatants, turn order, and attack resolution, and is
 * the single place that validates and applies combat actions. The UI chooses actions; the rules
 * live here. Port of the `Battle` partial class (core + special attacks + conditions + spellcasting).
 */
/**
 * How far `square` strays from the straight line `start` → `target`, as the absolute cross product
 * (an integer, so ties stay exact). Breaks ties between charge destinations of equal movement cost.
 */
const driftFromLine = (start: Position, target: Position, square: Position): number =>
  Math.abs((target.x - start.x) * (square.y - start.y) - (target.y - start.y) * (square.x - start.x));

export class Battle {
  private readonly _grid: Grid;
  private readonly random: Random;
  private readonly turns: TurnManager;
  private readonly combat: CombatEngine;
  // Constructor order (not initiative order): some tie-breaks (cleave target, occupancy) depend on it.
  private readonly combatantsList: Character[];
  private readonly logEntries: CombatLogEntry[] = [];
  private readonly events: BattleEvent[] = [];

  constructor(grid: Grid, random: Random, combatants: readonly Character[]) {
    this._grid = grid;
    this.random = random;
    this.combatantsList = [...combatants];
    this.turns = new TurnManager(random, combatants);
    this.combat = new CombatEngine(random);
  }

  private addLog(event: CombatLogEvent, message: string): void {
    this.logEntries.push({ turn: this.turns.turnNumber, event, message });
  }

  get grid(): Grid {
    return this._grid;
  }

  get combatants(): readonly Character[] {
    return this.turns.initiativeOrder;
  }

  get currentActor(): Character {
    return this.turns.currentActor;
  }

  get hasMovementAvailable(): boolean {
    return this.turns.hasMovementAvailable;
  }

  get hasStandardActionAvailable(): boolean {
    return this.turns.hasStandardActionAvailable;
  }

  /**
   * Whether a move action is still on the table. Distinct from `hasMovementAvailable`: SRD Full
   * Attack leaves the move unspent but narrows it to a 5-foot step, so the step reads the raw
   * availability and everything else reads this.
   */
  get canMove(): boolean {
    return this.turns.hasMovementAvailable && !this.turns.isMovementLimitedToFiveFootStep;
  }

  /** The round in progress, the same number the log entries and the battle events carry. */
  get turn(): number {
    return this.turns.turnNumber;
  }

  get isOver(): boolean {
    return this.turns.isCombatOver;
  }

  get winner(): Character | null {
    return this.turns.winner;
  }

  get winningSide(): Side | null {
    return this.turns.winningSide;
  }

  get log(): readonly CombatLogEntry[] {
    return this.logEntries;
  }

  /** Ordered history of applied actions and turn ends; feed to `game/replay.ts` for an exact replay. */
  get executedEvents(): readonly BattleEvent[] {
    return this.events;
  }

  initiativeOf(combatant: Character): number {
    return this.turns.initiativeOf(combatant);
  }

  /** Applies an action; returns the attack result for an attack, null otherwise. */
  execute(action: CombatAction): AttackResult | null {
    // Captured up front: the action belongs to whoever is on turn when it is issued, and the
    // disabled combatant's strain has to know what the turn looked like before the act.
    const actor = this.currentActor;
    const wasDisabled = actor.vitalStatus === 'Staggered';
    const hadStandardActionAvailable = this.turns.hasStandardActionAvailable;
    let result: AttackResult | null;
    switch (action.kind) {
      case 'move':
        result = this.executeMove(action.destination);
        break;
      case 'attack':
        result = this.executeAttack(action.target, action.powerAttackPenalty);
        break;
      case 'fiveFootStep':
        result = this.executeFiveFootStep(action.destination);
        break;
      case 'charge':
        result = this.executeCharge(action.target);
        break;
      case 'withdraw':
        result = this.executeWithdraw(action.destination);
        break;
      case 'fullAttack':
        result = this.executeFullAttack(action.target, action.powerAttackPenalty);
        break;
      case 'doubleMove':
        result = this.executeDoubleMove(action.destination);
        break;
      case 'standUp':
        result = this.executeStandUp();
        break;
      case 'trip':
        result = this.executeTrip(action.target);
        break;
      case 'overrun':
        result = this.executeOverrun(action.target, action.destination);
        break;
      case 'bullRush':
        result = this.executeBullRush(action.target);
        break;
      case 'disarm':
        result = this.executeDisarm(action.target);
        break;
      case 'retrieveWeapon':
        result = this.executeRetrieveWeapon();
        break;
      case 'aidAnother':
        result = this.executeAidAnother(action.ally, action.benefit);
        break;
      case 'coupDeGrace':
        result = this.executeCoupDeGrace(action.target);
        break;
      case 'rage':
        result = this.executeRage();
        break;
      case 'endRage':
        result = this.executeEndRage();
        break;
      case 'castSpell':
        result = this.executeCastSpell(action.spell, action.target, action.areaCenter, action.defensive);
        break;
      case 'setOverrunStance':
        result = this.executeSetOverrunStance(action.avoids);
        break;
    }

    // Recorded only after a successful apply: invalid actions throw above and are never logged.
    this.events.push({ kind: 'action', turn: this.turns.turnNumber, actor, action });
    this.applyDisabledStrain(actor, wasDisabled, hadStandardActionAvailable);
    // Declaring a stance is a free action: it must not cost a staggered combatant its single one.
    if (action.kind !== 'setOverrunStance') {
      this.consumeRemainingActionsIfStaggered();
    }
    return result;
  }

  /**
   * SRD Condition Summary, Disabled: at exactly 0 hit points, "performing any standard action […]
   * deals 1 point of damage after the completion of the act. Unless the action increased the
   * disabled character's hit points, she is now in negative hit points and dying."
   *
   * Reading the status again after the act is what covers the "unless": a heal has left the actor
   * conscious, and anything that hurt them further has already started the dying.
   */
  private applyDisabledStrain(
    actor: Character,
    wasDisabled: boolean,
    hadStandardActionAvailable: boolean,
  ): void {
    const spentTheStandardAction =
      hadStandardActionAvailable && !this.turns.hasStandardActionAvailable;
    if (!wasDisabled || !spentTheStandardAction || actor.vitalStatus !== 'Staggered') {
      return;
    }
    actor.takeDamage(DISABLED_STRAIN_DAMAGE);
    this.addLog('Disabled', `${actor.name} is disabled: the effort costs a hit point.`);
  }

  // SRD: a staggered character may take only a single action per turn.
  private consumeRemainingActionsIfStaggered(): void {
    if (this.currentActor.vitalStatus !== 'Staggered') {
      return;
    }
    if (this.turns.hasMovementAvailable) {
      this.turns.useMovement();
    }
    if (this.turns.hasStandardActionAvailable) {
      this.turns.useStandardAction();
    }
  }

  endTurn(): void {
    // Recorded before advancing: the event belongs to the combatant whose turn is ending, in the
    // round it is ending in — `advanceTurn` below may roll both the actor and the round over.
    this.events.push({ kind: 'endTurn', turn: this.turns.turnNumber, actor: this.currentActor });
    const newRoundStarted = this.turns.advanceTurn();
    if (newRoundStarted) {
      this.logEntries.push({ turn: this.turns.turnNumber, event: 'RoundSeparator', message: '' });
    }
  }

  // ---- Movement queries ----

  reachableSquares(): Position[] {
    if (!this.canMove) {
      return [];
    }
    return this.squaresWithinCost(this.currentActor.effectiveSpeed);
  }

  isReachable(square: Position): boolean {
    return this.reachableSquares().some((s) => positionsEqual(s, square));
  }

  doubleMoveReachableSquares(): Position[] {
    if (!this.turns.hasMovementAvailable || !this.turns.hasStandardActionAvailable) {
      return [];
    }
    return this.squaresWithinCost(this.currentActor.effectiveSpeed * 2);
  }

  private squaresWithinCost(maxDistance: number): Position[] {
    const actor = this.currentActor;
    const reachable: Position[] = [];
    for (let x = 0; x < this._grid.width; x++) {
      for (let y = 0; y < this._grid.height; y++) {
        const square = { x, y };
        if (positionsEqual(square, actor.position) || this.isOccupied(square)) {
          continue;
        }
        if (Grid.movementCost(actor.position, square) <= maxDistance) {
          reachable.push(square);
        }
      }
    }
    return reachable;
  }

  threatenedSquaresOf(character: Character): Position[] {
    const threatened: Position[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const square = { x: character.position.x + dx, y: character.position.y + dy };
        if (this._grid.contains(square)) {
          threatened.push(square);
        }
      }
    }
    return threatened;
  }

  // ---- Movement actions ----

  private executeMove(destination: Position): null {
    if (!this.canMove) {
      throw new Error('The current actor has no move action left this turn.');
    }
    const actor = this.currentActor;
    this.moveActorTo(actor, destination, actor.effectiveSpeed);
    this.turns.useMovement();
    return null;
  }

  private executeDoubleMove(destination: Position): null {
    if (!this.turns.hasMovementAvailable || !this.turns.hasStandardActionAvailable) {
      throw new Error('A double move requires both the move and the standard action to be available.');
    }
    const actor = this.currentActor;
    this.moveActorTo(actor, destination, actor.effectiveSpeed * 2);
    this.turns.useMovement();
    this.turns.useStandardAction();
    return null;
  }

  private moveActorTo(actor: Character, destination: Position, maxDistanceInFeet: number): void {
    if (!this._grid.contains(destination)) {
      throw new Error(`Destination (${destination.x},${destination.y}) is outside the grid.`);
    }
    if (this.isOccupied(destination)) {
      throw new Error(`Destination (${destination.x},${destination.y}) is occupied.`);
    }
    const cost = Grid.movementCost(actor.position, destination);
    if (cost > maxDistanceInFeet) {
      throw new Error(
        `Destination (${destination.x},${destination.y}) costs ${cost} ft, more than ${actor.name}'s allowed range of ${maxDistanceInFeet} ft.`,
      );
    }

    // SRD Attacks of Opportunity: "Moving out of a threatened square usually provokes an attack of
    // opportunity" — every square left along the way, not only the one the move started from. The
    // route is the straight line to the destination, the same approximation `executeWithdraw`
    // walks; both should follow a real path once the terrain has obstacles to route around.
    const start = actor.position;
    for (const square of [start, ...squaresBetween(start, destination)]) {
      this.resolveAttacksOfOpportunity(actor, square);
      if (actor.isDefeated) {
        return;
      }
    }
    actor.moveTo(destination);
    this.addLog('Move', `${actor.name} moves to (${destination.x},${destination.y}).`);
  }

  private resolveAttacksOfOpportunity(mover: Character, provokedSquare: Position): void {
    this.resolveAttacksOfOpportunityExcluding(mover, provokedSquare, null);
  }

  private resolveAttacksOfOpportunityExcluding(
    mover: Character,
    provokedSquare: Position,
    excluded: Character | null,
  ): void {
    const threateners = this.combatantsList.filter(
      (enemy) =>
        !enemy.isDefeated &&
        Character.areEnemies(mover, enemy) &&
        enemy.canMakeAttackOfOpportunity &&
        Grid.areAdjacent(enemy.position, provokedSquare) &&
        enemy !== excluded,
    );

    for (const enemy of threateners) {
      if (mover.isDefeated) {
        break;
      }
      this.resolveOneAttackOfOpportunity(enemy, mover);
    }
  }

  private resolveOneAttackOfOpportunity(threatener: Character, victim: Character): void {
    const modifiers: AttackModifiers = {
      attackBonus:
        (this.isFlanking(threatener, victim) ? FLANKING_BONUS : 0) + this.proneModifier(threatener, victim),
      sneakAttackApplies: this.isSneakAttackEligible(threatener, victim),
      powerAttackDamageBonus: 0,
    };
    const result = this.combat.resolveAttack(threatener, victim, modifiers);
    threatener.spendAttackOfOpportunity();
    this.addLog('AttackOfOpportunity', 'Attack of opportunity — ' + Battle.describe(threatener, victim, result));
    if (result.hit && hasDropped(victim)) {
      // SRD Cleave triggers on any melee attack that drops a foe, and an attack of opportunity is
      // one. The bonus rides along whole, as everywhere else — which here means without the feats'
      // passive bonus, since `modifiers` above never adds it. That is a known deviation from the
      // SRD, left in place on purpose: feat bonuses reach neither attacks of opportunity nor the
      // disarm's opposed roll yet.
      this.tryCleaveProcOn(threatener, 0, modifiers.attackBonus);
    }
  }

  // ---- Power Attack helpers ----

  private static validatePowerAttack(attacker: Character, penalty: number): void {
    if (penalty === 0) {
      return;
    }
    if (!attacker.hasFeat(PowerAttackFeat)) {
      throw new Error('Power Attack feat required.');
    }
    if (penalty < 1 || penalty > attacker.baseAttackBonus) {
      throw new Error(`Power Attack penalty must be between 1 and ${attacker.baseAttackBonus}.`);
    }
  }

  /**
   * SRD (Power Attack): "If you attack with a two-handed weapon, or with a one-handed weapon
   * wielded in two hands, instead add twice the number subtracted from your attack rolls. You
   * can't add the bonus from Power Attack to the damage dealt with a light weapon (except with
   * unarmed strikes or natural weapon attacks), even though the penalty on attack rolls still
   * applies."
   */
  private static computePowerAttackDamageBonus(attacker: Character, penalty: number): number {
    if (penalty === 0) {
      return 0;
    }
    const weapon = attacker.activeWeapon;
    if (weapon.handedness === 'TwoHanded') {
      return penalty * TWO_HANDED_POWER_ATTACK_MULTIPLIER;
    }
    if (weapon.handedness === 'Light' && !weapon.isUnarmed) {
      return 0;
    }
    return penalty;
  }

  // ---- Attacks ----

  private executeAttack(target: Character, powerAttackPenalty: number): AttackResult | null {
    if (!this.turns.hasStandardActionAvailable) {
      throw new Error('The current actor has already taken a standard action this turn.');
    }
    const attacker = this.currentActor;
    if (target === attacker) {
      throw new Error('A combatant cannot attack itself.');
    }
    if (target.vitalStatus === 'Dead') {
      throw new Error(`${target.name} is already down.`);
    }

    Battle.validatePowerAttack(attacker, powerAttackPenalty);

    const base = attacker.activeWeapon.isRanged
      ? this.prepareRangedAttack(attacker, target)
      : this.prepareMeleeAttack(attacker, target);

    const modifiers: AttackModifiers = {
      attackBonus: base.attackBonus - powerAttackPenalty,
      sneakAttackApplies: base.sneakAttackApplies,
      powerAttackDamageBonus: Battle.computePowerAttackDamageBonus(attacker, powerAttackPenalty),
    };

    if (attacker.isDefeated) {
      this.turns.useStandardAction();
      return null;
    }

    const result = this.combat.resolveAttack(attacker, target, modifiers);
    this.turns.useStandardAction();
    this.addLog('Attack', Battle.describe(attacker, target, result));
    if (result.hit && hasDropped(target)) {
      this.tryCleaveProcOn(attacker, powerAttackPenalty, modifiers.attackBonus);
    }
    return result;
  }

  private prepareMeleeAttack(attacker: Character, target: Character): AttackModifiers {
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${target.name} is not within melee reach.`);
    }
    const modifiers: AttackModifiers = {
      attackBonus:
        (this.isFlanking(attacker, target) ? FLANKING_BONUS : 0) +
        this.proneModifier(attacker, target) +
        attacker.aidAnotherAttackBonus +
        attacker.passiveFeatAttackBonus('Melee'),
      sneakAttackApplies: this.isSneakAttackEligible(attacker, target),
      powerAttackDamageBonus: 0,
    };
    attacker.resetAidAnotherBonus();
    return modifiers;
  }

  private prepareRangedAttack(attacker: Character, target: Character): AttackModifiers {
    // SRD Condition Summary, Prone: an attacker who is prone "cannot use a ranged weapon (except
    // for a crossbow)".
    if (attacker.isProne && attacker.activeWeapon.rangedFamily !== 'Crossbow') {
      throw new Error(`${attacker.name} is prone and cannot use a ${attacker.activeWeapon.name}.`);
    }
    const distance = Grid.movementCost(attacker.position, target.position);
    if (distance > attacker.activeWeapon.maximumRangeInFeet) {
      throw new Error(`${target.name} is beyond the weapon's range.`);
    }
    this.resolveAttacksOfOpportunity(attacker, attacker.position);
    const modifiers: AttackModifiers = {
      attackBonus:
        Battle.rangePenalty(attacker.activeWeapon, distance) +
        this.proneModifier(attacker, target) +
        attacker.aidAnotherAttackBonus +
        attacker.passiveFeatAttackBonus('Ranged'),
      sneakAttackApplies: this.isSneakAttackEligible(attacker, target),
      powerAttackDamageBonus: 0,
    };
    attacker.resetAidAnotherBonus();
    return modifiers;
  }

  /** The current actor's ranged range penalty against the target (0 for melee). For UI range bands. */
  rangePenaltyAgainst(target: Character): number {
    if (!this.currentActor.weapon.isRanged) {
      return 0;
    }
    const distance = Grid.movementCost(this.currentActor.position, target.position);
    return Battle.rangePenalty(this.currentActor.weapon, distance);
  }

  // SRD ranged penalty: -2 per full range increment beyond the first.
  private static rangePenalty(weapon: Weapon, distanceInFeet: number): number {
    const increments = Math.floor(
      (distanceInFeet + weapon.rangeIncrementInFeet - 1) / weapon.rangeIncrementInFeet,
    );
    return RANGE_INCREMENT_PENALTY * Math.max(0, increments - 1);
  }

  private executeFiveFootStep(destination: Position): null {
    if (!this.turns.hasMovementAvailable) {
      throw new Error('A 5-ft step needs the move action, and no other movement this turn.');
    }
    const actor = this.currentActor;
    if (!this._grid.contains(destination) || this.isOccupied(destination)) {
      throw new Error(`Destination (${destination.x},${destination.y}) is not a free square.`);
    }
    if (
      !Grid.areAdjacent(actor.position, destination) ||
      Grid.movementCost(actor.position, destination) !== FIVE_FOOT_STEP_COST_IN_FEET
    ) {
      throw new Error('A 5-ft step must move exactly one square.');
    }
    actor.moveTo(destination);
    this.turns.useFiveFootStep();
    this.addLog('FiveFootStep', `${actor.name} takes a 5-ft step to (${destination.x},${destination.y}).`);
    return null;
  }

  /**
   * SRD Withdraw: "The square you start out in is not considered threatened by any opponent you
   * can see […] If, during the process of withdrawing, you move out of a threatened square (other
   * than the one you started in), enemies get attacks of opportunity as normal."
   *
   * The engine has no path model (no pathfinding around obstacles yet), so the route is the straight line to the destination:
   * every square on it but the starting one is a threatened square the withdrawer leaves.
   */
  private executeWithdraw(destination: Position): null {
    const actor = this.currentActor;
    if (!this._grid.contains(destination) || this.isOccupied(destination)) {
      throw new Error(`Destination (${destination.x},${destination.y}) is not a free square.`);
    }
    const cost = Grid.movementCost(actor.position, destination);
    if (cost > actor.effectiveSpeed * 2) {
      throw new Error(`Withdraw to (${destination.x},${destination.y}) costs ${cost} ft, more than double ${actor.name}'s speed.`);
    }
    this.turns.useFullRoundAction();
    for (const square of squaresBetween(actor.position, destination)) {
      this.resolveAttacksOfOpportunity(actor, square);
      if (actor.isDefeated) {
        return null;
      }
    }
    actor.moveTo(destination);
    this.addLog('Withdraw', `${actor.name} withdraws to (${destination.x},${destination.y}).`);
    return null;
  }

  private executeCharge(target: Character): AttackResult | null {
    const attacker = this.currentActor;
    if (target === attacker || target.vitalStatus === 'Dead') {
      throw new Error('Invalid charge target.');
    }
    if (!this.turns.hasMovementAvailable || !this.turns.hasStandardActionAvailable) {
      throw new Error('A charge is a full-round action and needs both actions available.');
    }
    if (attacker.isFatigued) {
      throw new Error('A fatigued character cannot charge.');
    }

    const destination = this.tryFindChargeDestination(attacker.position, target);
    if (destination === null) {
      throw new Error('Cannot charge: no reachable space next to the target.');
    }

    this.resolveAttacksOfOpportunity(attacker, attacker.position);
    this.turns.useFullRoundAction();
    if (attacker.isDefeated) {
      return null;
    }

    attacker.moveTo(destination);
    attacker.applyArmorClassModifier(CHARGE_ARMOR_CLASS_PENALTY);

    const attackBonus =
      CHARGE_ATTACK_BONUS +
      (this.isFlanking(attacker, target) ? FLANKING_BONUS : 0) +
      this.proneModifier(attacker, target) +
      attacker.passiveFeatAttackBonus('Melee');
    const result = this.combat.resolveAttack(attacker, target, {
      attackBonus,
      sneakAttackApplies: this.isSneakAttackEligible(attacker, target),
      powerAttackDamageBonus: 0,
    });
    this.addLog('Charge', `${attacker.name} charges! ` + Battle.describe(attacker, target, result));
    if (result.hit && hasDropped(target)) {
      this.tryCleaveProcOn(attacker, 0, attackBonus);
    }
    return result;
  }

  /**
   * SRD Full Attack: "The only movement you can take during a full attack is a 5-foot step. You may
   * take the step before, after, or between your attacks." It is a full-round action, but the step
   * is not what makes it impossible — so it spends the standard action and narrows the move rather
   * than swallowing both.
   */
  private executeFullAttack(target: Character, powerAttackPenalty: number): AttackResult | null {
    const attacker = this.currentActor;
    if (target === attacker || target.vitalStatus === 'Dead') {
      throw new Error('Invalid full-attack target.');
    }
    if (!this.turns.hasStandardActionAvailable) {
      throw new Error('A full attack needs the standard action available.');
    }
    if (attacker.baseAttackBonus < MINIMUM_BAB_FOR_FULL_ATTACK) {
      throw new Error(`${attacker.name} needs BAB >= ${MINIMUM_BAB_FOR_FULL_ATTACK} for a full attack.`);
    }
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${target.name} is not within melee reach.`);
    }

    Battle.validatePowerAttack(attacker, powerAttackPenalty);
    const powerAttackDamageBonus = Battle.computePowerAttackDamageBonus(attacker, powerAttackPenalty);

    this.turns.useFullAttack();

    let lastResult: AttackResult | null = null;
    for (
      let iterativePenalty = 0;
      attacker.baseAttackBonus - iterativePenalty >= 1;
      iterativePenalty += 5
    ) {
      const flankBonus = this.isFlanking(attacker, target) ? FLANKING_BONUS : 0;
      const modifiers: AttackModifiers = {
        attackBonus:
          -iterativePenalty -
          powerAttackPenalty +
          flankBonus +
          this.proneModifier(attacker, target) +
          attacker.passiveFeatAttackBonus('Melee'),
        sneakAttackApplies: this.isSneakAttackEligible(attacker, target),
        powerAttackDamageBonus,
      };
      const result = this.combat.resolveAttack(attacker, target, modifiers);
      this.addLog(
        'FullAttack',
        `Full attack [${Battle.signedNumber(attacker.baseAttackBonus - iterativePenalty)}] — ` +
          Battle.describe(attacker, target, result),
      );
      lastResult = result;

      // The iterative attacks stop as soon as the target drops, which is also what triggers Cleave:
      // SRD Full Attack lets you "see how the earlier attacks turn out before assigning the later
      // ones", and no one keeps spending them on a foe already on the ground.
      if (hasDropped(target)) {
        this.tryCleaveProcOn(attacker, powerAttackPenalty, modifiers.attackBonus);
        break;
      }
    }
    return lastResult;
  }

  canFullAttack(target: Character): boolean {
    return (
      this.turns.hasStandardActionAvailable &&
      !this.turns.hasTakenMoreThanAFiveFootStep &&
      this.currentActor.baseAttackBonus >= MINIMUM_BAB_FOR_FULL_ATTACK &&
      target !== this.currentActor &&
      target.vitalStatus !== 'Dead' &&
      Grid.areAdjacent(this.currentActor.position, target.position)
    );
  }

  canCharge(target: Character): boolean {
    return (
      this.turns.hasMovementAvailable &&
      this.turns.hasStandardActionAvailable &&
      target.vitalStatus !== 'Dead' &&
      target !== this.currentActor &&
      this.tryFindChargeDestination(this.currentActor.position, target) !== null
    );
  }

  // ---- Read-only predicates for the arena menu ----
  //
  // Each one answers "would `execute` accept this right now?" without touching anything, mirroring
  // the checks of the matching executor. The executors of the three manoeuvres resolve the target's
  // attack of opportunity before they spend the standard action, so asking here is the only way to
  // find out in advance that the action is not there to spend.

  canTrip(target: Character): boolean {
    return this.canAttemptMeleeManoeuvreOn(target);
  }

  canBullRush(target: Character): boolean {
    return this.canAttemptMeleeManoeuvreOn(target);
  }

  canDisarm(target: Character): boolean {
    return this.canAttemptMeleeManoeuvreOn(target) && !this.currentActor.activeWeapon.isRanged;
  }

  canCoupDeGrace(target: Character): boolean {
    return (
      this.turns.hasMovementAvailable &&
      this.turns.hasStandardActionAvailable &&
      target.isDefeated &&
      target.vitalStatus !== 'Dead' &&
      Grid.areAdjacent(this.currentActor.position, target.position)
    );
  }

  canAidAnother(ally: Character): boolean {
    const actor = this.currentActor;
    return (
      this.turns.hasStandardActionAvailable &&
      ally !== actor &&
      ally.side === actor.side &&
      !ally.isDefeated &&
      this.combatantsList.some((enemy) => this.isEngaging(enemy, ally) && Grid.areAdjacent(actor.position, enemy.position))
    );
  }

  private canAttemptMeleeManoeuvreOn(target: Character): boolean {
    return (
      this.turns.hasStandardActionAvailable &&
      target !== this.currentActor &&
      !target.isDefeated &&
      Grid.areAdjacent(this.currentActor.position, target.position)
    );
  }

  private isEngaging(enemy: Character, ally: Character): boolean {
    return !enemy.isDefeated && Character.areEnemies(ally, enemy) && Grid.areAdjacent(ally.position, enemy.position);
  }

  /**
   * SRD Charge, "Movement During a Charge": "you must move to the closest space from which you can
   * attack the opponent. (If this space is occupied or otherwise blocked, you can't charge.)" The
   * closest space is decided before anything else — over every square next to the target, the
   * charger's own and the occupied ones included — and the charge exists only if it lies between
   * 10 ft and double speed away. So a charger already adjacent (closest space: 0 ft) or two squares
   * off (5 ft) cannot charge, however many free squares 10 ft away flank the target.
   * Among the squares tied for closest, "directly toward the designated opponent" picks the one
   * nearest the straight line from the charger to the target, then x and y to stay deterministic.
   */
  private tryFindChargeDestination(start: Position, target: Character): Position | null {
    const maxDistance = this.currentActor.effectiveSpeed * 2;
    const candidates = this.threatenedSquaresOf(target).map((square) => ({ square, cost: Grid.movementCost(start, square) }));
    const closestCost = Math.min(...candidates.map((c) => c.cost));
    if (closestCost < MINIMUM_CHARGE_DISTANCE_IN_FEET || closestCost > maxDistance) {
      return null;
    }
    const closest = candidates
      .filter((c) => c.cost === closestCost)
      .map((c) => c.square)
      .sort((a, b) => driftFromLine(start, target.position, a) - driftFromLine(start, target.position, b) || a.x - b.x || a.y - b.y);
    return closest.find((square) => !this.isOccupied(square) && this.isPathClear(start, square)) ?? null;
  }

  private isPathClear(start: Position, end: Position): boolean {
    return isLineOfSightClear(start, end, (p) => this.isOccupied(p));
  }

  // ---- Sneak attack & flanking ----

  private isWithinSneakAttackRange(attacker: Character, target: Character): boolean {
    return (
      !attacker.activeWeapon.isRanged ||
      Grid.movementCost(attacker.position, target.position) <= SNEAK_ATTACK_MAX_RANGE_IN_FEET
    );
  }

  private isSneakAttackEligible(attacker: Character, target: Character): boolean {
    return (
      attacker.sneakAttackDice > 0 &&
      (this.isFlanking(attacker, target) || target.isFlatFooted) &&
      this.isWithinSneakAttackRange(attacker, target)
    );
  }

  isFlanking(attacker: Character, target: Character): boolean {
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      return false;
    }
    return this.combatantsList.some(
      // SRD Flanking: the partner must *threaten* the target. `isAlive` is still true at -9 hit
      // points, and a dying combatant threatens nothing.
      (ally) =>
        !ally.isDefeated &&
        Character.areAllies(attacker, ally) &&
        Grid.areAdjacent(ally.position, target.position) &&
        attacker.position.x + ally.position.x === 2 * target.position.x &&
        attacker.position.y + ally.position.y === 2 * target.position.y,
    );
  }

  // ---- Cleave ----

  private findAdjacentStandingEnemy(attacker: Character): Character | undefined {
    return this.combatantsList.find(
      (c) =>
        Character.areEnemies(attacker, c) &&
        !c.isDefeated &&
        Grid.areAdjacent(attacker.position, c.position),
    );
  }

  /**
   * SRD Cleave: "you get an immediate, extra melee attack against another creature within reach.
   * […] The extra attack is with the same weapon and at the same bonus as the attack that dropped
   * the previous creature. You can use this ability once per round." Great Cleave lifts the limit:
   * "you can use it as often as it comes up."
   *
   * "The same bonus" is taken literally: the situational total of the dropping attack rides along
   * whole — the charge's +2, a full attack's iterative penalty — instead of being recomputed
   * against the new target. Once per round does need a counter: an attack of opportunity can drop a
   * foe on someone else's turn, so a character who has already cleaved on its own turn gets a
   * second chance inside the same round. The loop below stops after one swing without Great Cleave;
   * the flag is what stops the *next* dropping attack of the round.
   */
  private tryCleaveProcOn(
    attacker: Character,
    powerAttackPenalty: number,
    droppingAttackBonus: number,
  ): void {
    if (!attacker.hasFeat(CleaveFeat)) {
      return;
    }
    const isGreatCleave = attacker.hasFeat(GreatCleaveFeat);
    if (attacker.hasCleavedThisRound && !isGreatCleave) {
      return;
    }
    attacker.markCleaved();
    for (;;) {
      const nextTarget = this.findAdjacentStandingEnemy(attacker);
      if (nextTarget === undefined) {
        break;
      }
      const modifiers: AttackModifiers = {
        attackBonus: droppingAttackBonus,
        sneakAttackApplies: this.isSneakAttackEligible(attacker, nextTarget),
        powerAttackDamageBonus: Battle.computePowerAttackDamageBonus(attacker, powerAttackPenalty),
      };
      const result = this.combat.resolveAttack(attacker, nextTarget, modifiers);
      this.addLog('Cleave', `Cleave → ${Battle.describe(attacker, nextTarget, result)}`);
      if (!isGreatCleave) {
        break;
      }
      if (!result.hit || !hasDropped(nextTarget)) {
        break;
      }
    }
  }

  // SRD Condition Summary — Prone modifiers.
  private proneModifier(attacker: Character, target: Character): number {
    const targetBonus = target.isProne
      ? attacker.activeWeapon.kind === 'Ranged'
        ? PRONE_RANGED_PENALTY
        : PRONE_MELEE_BONUS
      : 0;
    // SRD: a prone attacker takes "a -4 penalty on melee attack rolls" — the crossbow it is still
    // allowed to fire is not one of them.
    const attackerPenalty =
      attacker.isProne && !attacker.activeWeapon.isRanged ? PRONE_ATTACKER_PENALTY : 0;
    return targetBonus + attackerPenalty;
  }

  private isOccupied(square: Position): boolean {
    return this.combatantsList.some((c) => c.isAlive && positionsEqual(c.position, square));
  }

  // ---- Conditions (rage / aid another) ----

  private executeRage(): null {
    const actor = this.currentActor;
    if (actor.barbarianLevels === 0 || actor.ragesRemaining <= 0) {
      throw new Error('Character cannot rage.');
    }
    if (actor.isRaging) {
      throw new Error('Character is already raging.');
    }
    if (actor.isFatigued) {
      throw new Error('A fatigued character cannot rage.');
    }
    actor.enterRage(actor.abilities.constitution.modifier);
    this.addLog('Rage', `${actor.name} enters a rage!`);
    return null;
  }

  private executeEndRage(): null {
    const actor = this.currentActor;
    if (!actor.isRaging) {
      throw new Error('Character is not raging.');
    }
    actor.endRage();
    this.addLog('EndRage', `${actor.name} ends their rage and becomes fatigued.`);
    return null;
  }

  private executeAidAnother(ally: Character, benefit: AidAnotherBenefit): null {
    const actor = this.currentActor;
    if (ally.isDefeated) {
      throw new Error(`${ally.name} is already defeated.`);
    }
    if (actor === ally || actor.side !== ally.side) {
      throw new Error(`${ally.name} is not an ally.`);
    }
    // SRD Aid Another: "If you're in a position to make a melee attack on an opponent that is
    // engaging a friend in melee" — the helper has to threaten that opponent too.
    const engagedEnemy = this.combatantsList.some(
      (c) =>
        !c.isDefeated &&
        Character.areEnemies(ally, c) &&
        Grid.areAdjacent(ally.position, c.position) &&
        Grid.areAdjacent(actor.position, c.position),
    );
    if (!engagedEnemy) {
      throw new Error(`No enemy engaging ${ally.name} is within ${actor.name}'s reach.`);
    }

    // SRD: "You make an attack roll against AC 10" — not a bare d20 against a DC.
    const rollResult = rollD20Check(this.random, actor.meleeAttackBonus);
    if (rollResult.total >= AID_ANOTHER_DC) {
      if (benefit === 'AttackRoll') {
        ally.grantAttackAid(actor);
        this.addLog('AidAnother', `${actor.name} aids ${ally.name} (+2 to next attack).`);
      } else {
        ally.grantArmorClassAid(actor);
        this.addLog('AidAnother', `${actor.name} aids ${ally.name} (+2 AC for 1 round).`);
      }
    } else {
      this.addLog('AidAnother', `${actor.name} tries to aid ${ally.name} but fails.`);
    }
    this.turns.useStandardAction();
    return null;
  }

  // ---- Special attacks ----

  /**
   * SRD Overrun, Step 2: "The defender has the option to simply avoid you." A defender who is not
   * on turn cannot be asked, so the choice is a standing stance the combatant declares on its own
   * turn. Free: it spends nothing and can be changed as often as the combatant likes.
   */
  private executeSetOverrunStance(avoids: boolean): null {
    const actor = this.currentActor;
    actor.setAvoidsOverruns(avoids);
    this.addLog(
      'OverrunStance',
      avoids
        ? `${actor.name} will step aside rather than block an overrun.`
        : `${actor.name} will block an overrun.`,
    );
    return null;
  }

  private executeStandUp(): null {
    const actor = this.currentActor;
    if (!actor.isProne) {
      throw new Error(`${actor.name} is not prone.`);
    }
    // SRD: standing up is a move action, so a full attack has already ruled it out.
    if (!this.canMove) {
      throw new Error(`${actor.name} has no move action left this turn.`);
    }
    this.resolveAttacksOfOpportunity(actor, actor.position);
    actor.clearProne();
    this.turns.useMovement();
    this.addLog('StandUp', `${actor.name} stands up.`);
    return null;
  }

  /**
   * SRD Trip: "Make an unarmed melee touch attack against your target. This provokes an attack of
   * opportunity from your target as normal for unarmed attacks. If your attack succeeds, make a
   * Strength check opposed by the defender's Dexterity or Strength check (whichever ability score
   * has the higher modifier). […] If you lose, the defender may immediately react and make a
   * Strength check opposed by your Dexterity or Strength check to try to trip you."
   *
   * The counter-trip is the defender's option in the SRD; with no way to ask them, the engine
   * always takes it.
   */
  private executeTrip(target: Character): null {
    const attacker = this.currentActor;
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${attacker.name} is not adjacent to ${target.name}.`);
    }
    if (target.isDefeated) {
      throw new Error(`${target.name} is already defeated.`);
    }

    if (target.canMakeAttackOfOpportunity) {
      this.resolveOneAttackOfOpportunity(target, attacker);
    }
    if (attacker.isDefeated) {
      this.turns.useStandardAction();
      return null;
    }

    const touch = resolveTouchAttack(
      this.random,
      attacker.baseAttackBonus + attacker.effectiveStrengthModifier,
      target.touchArmorClass,
    );
    if (!touch.hit) {
      this.addLog('Trip', `${attacker.name} fails to reach ${target.name} for a trip.`);
      this.turns.useStandardAction();
      return null;
    }

    const check = resolveOpposedCheck(
      this.random,
      attacker.effectiveStrengthModifier,
      Battle.tripDefenseModifier(target),
    );
    if (attackerWins(check)) {
      target.markProne();
      this.addLog('Trip', `${attacker.name} trips ${target.name} (prone).`);
      this.turns.useStandardAction();
      return null;
    }

    const counter = resolveOpposedCheck(
      this.random,
      target.effectiveStrengthModifier,
      Battle.tripDefenseModifier(attacker),
    );
    if (attackerWins(counter)) {
      attacker.markProne();
      this.addLog('Trip', `${attacker.name}'s trip on ${target.name} backfires — ${attacker.name} falls prone.`);
    } else {
      this.addLog('Trip', `${attacker.name} fails to trip ${target.name}.`);
    }
    this.turns.useStandardAction();
    return null;
  }

  /** SRD Trip: the defender resists with "Dexterity or Strength […] whichever has the higher modifier". */
  private static tripDefenseModifier(defender: Character): number {
    return Math.max(defender.effectiveDexterityModifier, defender.effectiveStrengthModifier);
  }

  /**
   * SRD Bull Rush. Initiation: "First, you move into the defender's space. Doing this provokes an
   * attack of opportunity from each opponent that threatens you, including the defender." Results:
   * "If you beat the defender's Strength check result, you push him back 5 feet. If you wish to
   * move with the defender, you can push him back an additional 5 feet for each 5 points by which
   * your check result is greater than the defender's check result. You can't, however, exceed your
   * normal movement limit." And on a loss: "you move 5 feet straight back to where you were before
   * you moved into his space. If that space is occupied, you fall prone in that space."
   *
   * Moving with the defender is the attacker's option in the SRD; with no way to ask them, the
   * engine always takes it — the same convention as the counter-trip and the counter-disarm.
   */
  private executeBullRush(target: Character): null {
    const attacker = this.currentActor;
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${attacker.name} is not adjacent to ${target.name}.`);
    }
    if (target.isDefeated) {
      throw new Error(`${target.name} is already defeated.`);
    }
    this.resolveAttacksOfOpportunity(attacker, attacker.position);
    if (attacker.isDefeated) {
      this.turns.useStandardAction();
      return null;
    }
    const check = resolveOpposedCheck(this.random, attacker.effectiveStrengthModifier, target.effectiveStrengthModifier);
    if (attackerWins(check)) {
      this.pushBack(attacker, target, check.attackerTotal - check.defenderTotal);
    } else {
      this.addLog('BullRush', `${attacker.name} fails to bull rush ${target.name}.`);
      this.retreatFiveFeetFrom(attacker, target.position, 'BullRush');
    }
    this.turns.useStandardAction();
    return null;
  }

  /**
   * Walks the defender back one square at a time along the line of the shove, stopping at the grid
   * edge or the first square somebody else holds. The attacker follows for every square past the
   * first: that following move is what the SRD charges for the extra distance, and the engine
   * caps it at the attacker's speed.
   */
  private pushBack(attacker: Character, target: Character, margin: number): void {
    const step = {
      x: Math.sign(target.position.x - attacker.position.x),
      y: Math.sign(target.position.y - attacker.position.y),
    };
    const affordableExtraSquares = Math.floor(attacker.effectiveSpeed / SQUARE_SIZE_IN_FEET);
    const extraSquares = Math.min(
      Math.floor(margin / BULL_RUSH_MARGIN_PER_EXTRA_SQUARE),
      affordableExtraSquares,
    );

    let pushedSquares = 0;
    for (let square = 0; square <= extraSquares; square++) {
      const destination = { x: target.position.x + step.x, y: target.position.y + step.y };
      if (!this._grid.contains(destination) || this.isOccupied(destination)) {
        break;
      }
      target.moveTo(destination);
      pushedSquares++;
      if (square > 0) {
        attacker.moveTo({ x: attacker.position.x + step.x, y: attacker.position.y + step.y });
      }
    }

    if (pushedSquares === 0) {
      this.addLog('BullRush', `${attacker.name} tries to push ${target.name} but the target is blocked.`);
      return;
    }
    const { x, y } = target.position;
    this.addLog('BullRush', `${attacker.name} pushes ${target.name} to (${x},${y}).`);
  }

  /**
   * SRD Bull Rush and Overrun Step 4: the loser of the manoeuvre "moves 5 feet straight back to
   * where you were before you moved into his space. If that space is occupied, you fall prone in
   * that space." The engine keeps one combatant per square, so a blocked retreat leaves the loser
   * prone where they stand rather than sharing the square.
   */
  private retreatFiveFeetFrom(
    mover: Character,
    opponentPosition: Position,
    manoeuvre: CombatLogEvent,
  ): void {
    const destination = {
      x: mover.position.x - Math.sign(opponentPosition.x - mover.position.x),
      y: mover.position.y - Math.sign(opponentPosition.y - mover.position.y),
    };
    if (!this._grid.contains(destination) || this.isOccupied(destination)) {
      mover.markProne();
      this.addLog(manoeuvre, `${mover.name} is driven back into an occupied square and falls prone.`);
      return;
    }
    mover.moveTo(destination);
    this.addLog(manoeuvre, `${mover.name} is driven back to (${destination.x},${destination.y}).`);
  }

  /**
   * SRD Overrun, in its four steps. Step 1: "Since you begin the overrun by moving into the
   * defender's space, you provoke an attack of opportunity from the defender." Step 2: "The
   * defender has the option to simply avoid you" — a defender who is not on turn cannot be asked,
   * so the choice is a stance it declares on its own turn (`setOverrunStance`); blocking is the
   * default. The stance is read after Step 1, because the attack of opportunity comes first. Step 3:
   * "make a Strength check opposed by the defender's Dexterity or Strength check (whichever
   * ability score has the higher modifier). […] If you lose, the defender may immediately react
   * and make a Strength check opposed by your Dexterity or Strength check […] to try to knock you
   * prone." Step 4: "If you fail […] you have to move 5 feet back the way you came, ending your
   * movement there."
   *
   * There is no free attack anywhere in it: the defender's only answer to a lost check is the
   * counter-check.
   */
  private executeOverrun(target: Character, destination: Position): null {
    if (!this.canMove) {
      throw new Error('The current actor has no move action left this turn.');
    }
    const attacker = this.currentActor;
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${attacker.name} is not adjacent to ${target.name}.`);
    }
    const isBlocked = this.combatantsList.some(
      (c) => positionsEqual(c.position, destination) && !c.isDefeated && c !== attacker,
    );
    if (!this._grid.contains(destination) || isBlocked) {
      throw new Error(`Destination (${destination.x},${destination.y}) is not valid.`);
    }

    if (target.canMakeAttackOfOpportunity) {
      this.resolveOneAttackOfOpportunity(target, attacker);
    }
    if (attacker.isDefeated) {
      this.turns.useMovement();
      return null;
    }

    if (target.avoidsOverruns) {
      attacker.moveTo(destination);
      this.addLog('Overrun', `${target.name} steps aside. ${attacker.name} moves through.`);
      this.turns.useMovement();
      return null;
    }

    const check = resolveOpposedCheck(
      this.random,
      attacker.effectiveStrengthModifier,
      Battle.tripDefenseModifier(target),
    );
    if (attackerWins(check)) {
      attacker.moveTo(destination);
      target.markProne();
      this.addLog('Overrun', `${attacker.name} overruns ${target.name} (prone).`);
      this.turns.useMovement();
      return null;
    }

    this.addLog('Overrun', `${attacker.name} is blocked by ${target.name}.`);
    const counter = resolveOpposedCheck(
      this.random,
      target.effectiveStrengthModifier,
      Battle.tripDefenseModifier(attacker),
    );
    if (attackerWins(counter)) {
      attacker.markProne();
      this.addLog('Overrun', `${target.name} knocks ${attacker.name} prone.`);
    }
    this.retreatFiveFeetFrom(attacker, target.position, 'Overrun');
    this.turns.useMovement();
    return null;
  }

  /**
   * SRD Disarm, in its three steps. Step 1: "You provoke an attack of opportunity from the target
   * you are trying to disarm. […] If the defender's attack of opportunity deals any damage, your
   * disarm attempt fails." Step 2: "You and the defender make opposed attack rolls with your
   * respective weapons." Step 3: "If you fail on the disarm attempt, the defender may immediately
   * react and attempt to disarm you with the same sort of opposed melee attack roll."
   *
   * There is no roll against the defender's armor class anywhere in it. As for the trip, the
   * counter-disarm is the defender's option and the engine always takes it for them.
   */
  private executeDisarm(target: Character): null {
    const attacker = this.currentActor;
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${attacker.name} is not adjacent to ${target.name}.`);
    }
    if (target.isDefeated) {
      throw new Error(`${target.name} is already defeated.`);
    }
    // SRD: "As a melee attack, you may attempt to disarm your opponent."
    if (attacker.activeWeapon.isRanged) {
      throw new Error(`A disarm is a melee attack; ${attacker.name} is holding a ranged weapon.`);
    }

    const hitPointsBeforeAttackOfOpportunity = attacker.currentHitPoints;
    if (target.canMakeAttackOfOpportunity) {
      this.resolveOneAttackOfOpportunity(target, attacker);
    }
    if (attacker.isDefeated) {
      this.turns.useStandardAction();
      return null;
    }
    if (attacker.currentHitPoints < hitPointsBeforeAttackOfOpportunity) {
      this.addLog('Disarm', `${target.name}'s attack of opportunity stops ${attacker.name}'s disarm.`);
      this.turns.useStandardAction();
      return null;
    }

    const check = resolveOpposedCheck(
      this.random,
      Battle.disarmAttackModifier(attacker),
      Battle.disarmAttackModifier(target),
    );
    if (attackerWins(check)) {
      target.markDisarmed();
      this.addLog('Disarm', `${attacker.name} disarms ${target.name}.`);
      this.turns.useStandardAction();
      return null;
    }

    // SRD: holding something that is not a melee weapon, the defender "can't attempt to disarm you
    // in return if your attempt fails".
    if (target.activeWeapon.isRanged) {
      this.addLog('Disarm', `${attacker.name} fails to disarm ${target.name}.`);
      this.turns.useStandardAction();
      return null;
    }

    const counter = resolveOpposedCheck(
      this.random,
      Battle.disarmAttackModifier(target),
      Battle.disarmAttackModifier(attacker),
    );
    if (attackerWins(counter)) {
      attacker.markDisarmed();
      this.addLog('Disarm', `${target.name} turns the tables: ${attacker.name} is disarmed.`);
    } else {
      this.addLog('Disarm', `${attacker.name} fails to disarm ${target.name}.`);
    }
    this.turns.useStandardAction();
    return null;
  }

  /**
   * SRD Disarm: "The wielder of a two-handed weapon on a disarm attempt gets a +4 bonus on this
   * roll, and the wielder of a light weapon takes a -4 penalty. (An unarmed strike is considered a
   * light weapon, so you always take a penalty when trying to disarm an opponent by using an
   * unarmed strike.) […] If the targeted item isn't a melee weapon, the defender takes a -4
   * penalty on the roll."
   *
   * Light / one-handed / two-handed is the SRD's melee category, so it is read only for a melee
   * weapon: a bow needs two hands to fire but earns nobody the +4.
   */
  private static disarmAttackModifier(combatant: Character): number {
    const base = combatant.baseAttackBonus + combatant.effectiveStrengthModifier;
    if (combatant.activeWeapon.isRanged) {
      return base + NON_MELEE_DISARM_PENALTY;
    }
    switch (combatant.activeWeapon.handedness) {
      case 'TwoHanded':
        return base + TWO_HANDED_DISARM_BONUS;
      case 'Light':
        return base + LIGHT_WEAPON_DISARM_PENALTY;
      default:
        return base;
    }
  }

  private executeRetrieveWeapon(): null {
    const actor = this.currentActor;
    if (!actor.isDisarmed) {
      throw new Error(`${actor.name} is not disarmed.`);
    }
    // SRD: picking a dropped weapon up is a move action, so a full attack has already ruled it out.
    if (!this.canMove) {
      throw new Error(`${actor.name} has no move action left this turn.`);
    }
    this.resolveAttacksOfOpportunity(actor, actor.position);
    actor.clearDisarmed();
    this.turns.useMovement();
    this.addLog('RetrieveWeapon', `${actor.name} retrieves their weapon.`);
    return null;
  }

  private executeCoupDeGrace(target: Character): null {
    const attacker = this.currentActor;
    if (!target.isDefeated || target.vitalStatus === 'Dead') {
      throw new Error(`${target.name} must be Dying or Stable for a coup de grâce.`);
    }
    if (!Grid.areAdjacent(attacker.position, target.position)) {
      throw new Error(`${attacker.name} is not adjacent to ${target.name}.`);
    }
    // SRD: "Delivering a coup de grace provokes attacks of opportunity from threatening opponents."
    this.resolveAttacksOfOpportunity(attacker, attacker.position);
    this.turns.useFullRoundAction();
    if (attacker.isDefeated) {
      this.addLog('CoupDeGrace', `${attacker.name} is cut down before the coup de grâce lands.`);
      return null;
    }

    const result = this.combat.resolveCoupDeGrace(attacker, target);
    const saveDesc = result.saveResult.succeeded ? 'save made' : 'save failed — dead';
    this.addLog('CoupDeGrace', `${attacker.name} lands a coup de grâce on ${target.name} for ${result.damage} — ${saveDesc}.`);
    return null;
  }

  // ---- Spellcasting ----

  private executeCastSpell(
    spell: Spell,
    target: Character | null,
    areaCenter: Position | null,
    defensive: boolean,
  ): null {
    const caster = this.currentActor;

    if (!this.turns.hasStandardActionAvailable) {
      throw new Error(`${caster.name} has no standard action available to cast ${spell.name}.`);
    }
    if (!caster.knownSpells.some((s) => s.name === spell.name)) {
      throw new Error(`${caster.name} does not know the spell '${spell.name}'.`);
    }
    if (caster.spellSlots.remaining(spell.spellLevel) <= 0) {
      throw new Error(`${caster.name} has no remaining ${spell.spellLevel}-level spell slots.`);
    }

    let targets: Character[];
    if (spell.targeting === 'Area') {
      if (areaCenter === null) {
        throw new Error(`Area spell '${spell.name}' requires an AreaCenter.`);
      }
      this.validateSpellRange(caster, areaCenter, spell);
      targets = this.collectAreaTargets(areaCenter, spell.areaRadiusInFeet);
    } else if (spell.targeting === 'SelfBuff') {
      targets = [caster];
    } else {
      if (target === null) {
        throw new Error(`Spell '${spell.name}' requires a Target.`);
      }
      this.validateSingleSpellTarget(caster, target, spell);
      targets = [target];
    }

    caster.spellSlots.trySpend(spell.spellLevel);

    if (spell.targeting !== 'SelfBuff') {
      if (defensive) {
        const dc = defensiveConcentrationDc(spell);
        const check = resolveConcentration(this.random, caster, dc);
        if (!check.succeeded) {
          this.turns.useStandardAction();
          this.addLog('SpellDisrupted', `${caster.name} loses ${spell.name} (defensive cast failed: d20:${check.naturalRoll} total:${check.total} vs DC ${dc}).`);
          return null;
        }
      } else if (this.isCasterThreatened(caster)) {
        const hpBefore = caster.currentHitPoints;
        this.resolveAttacksOfOpportunity(caster, caster.position);
        const damageTaken = hpBefore - caster.currentHitPoints;

        if (caster.isDefeated) {
          this.turns.useStandardAction();
          this.addLog('SpellDisrupted', `${caster.name} loses ${spell.name} (incapacitated by AoO).`);
          return null;
        }
        if (damageTaken > 0) {
          const dc = damageConcentrationDc(damageTaken, spell);
          const check = resolveConcentration(this.random, caster, dc);
          if (!check.succeeded) {
            this.turns.useStandardAction();
            this.addLog('SpellDisrupted', `${caster.name} loses ${spell.name} (Concentration failed: d20:${check.naturalRoll} total:${check.total} vs DC ${dc}).`);
            return null;
          }
        }
      }
    }

    const resolution = resolveSpell(this.random, caster, targets, spell);
    this.turns.useStandardAction();
    this.addLog('CastSpell', Battle.describeSpellResolution(caster, spell, resolution));
    return null;
  }

  private isCasterThreatened(caster: Character): boolean {
    return this.combatantsList.some(
      (enemy) =>
        !enemy.isDefeated &&
        Character.areEnemies(caster, enemy) &&
        enemy.canMakeAttackOfOpportunity &&
        Grid.areAdjacent(enemy.position, caster.position),
    );
  }

  private validateSpellRange(caster: Character, targetPosition: Position, spell: Spell): void {
    const distanceInFeet = Grid.movementCost(caster.position, targetPosition);
    if (distanceInFeet > spell.rangeInFeet) {
      throw new Error(`${spell.name} is out of range: target is ${distanceInFeet} ft away (max ${spell.rangeInFeet} ft).`);
    }
  }

  private validateSingleSpellTarget(caster: Character, target: Character, spell: Spell): void {
    if (target.isDefeated) {
      throw new Error(`Cannot target a defeated combatant with ${spell.name}.`);
    }
    this.validateSpellRange(caster, target.position, spell);
  }

  private collectAreaTargets(center: Position, radiusInFeet: number): Character[] {
    return this.combatantsList.filter((c) => c.isAlive && Grid.movementCost(center, c.position) <= radiusInFeet);
  }

  // ---- Log formatting ----

  private static describeSpellResolution(caster: Character, spell: Spell, resolution: SpellResolution): string {
    const targetDescriptions = resolution.targetResults.map((r) => Battle.describeSpellTargetResult(spell, r));
    return `${caster.name} casts ${spell.name}: ${targetDescriptions.join(', ')}`;
  }

  private static describeSpellTargetResult(spell: Spell, result: SpellTargetResult): string {
    if (!result.hit) {
      const touchInfo = result.attackRoll > 0 ? ` (touch d20:${result.attackRoll})` : '';
      return `misses ${result.target.name}${touchInfo}`;
    }
    const saveInfo = spell.savingThrow !== null ? (result.saveSucceeded ? ' (save: pass)' : ' (save: fail)') : '';
    return `hits ${result.target.name} for ${result.damageDealt}${saveInfo}`;
  }

  private static describe(attacker: Character, target: Character, result: AttackResult): string {
    const attackBreakdown =
      `attack d20:${result.attackRoll}${Battle.describeAttackBonuses(attacker, result)} ` +
      `= ${result.attackTotal} vs AC ${target.effectiveArmorClass}`;

    if (!result.hit) {
      return `${attacker.name} misses ${target.name} (${attackBreakdown}).`;
    }
    const critical = result.wasCritical ? ' critically' : '';
    return `${attacker.name}${critical} hits ${target.name} for ${result.damage} (${attackBreakdown}; ${Battle.describeDamage(attacker, result)}).`;
  }

  private static describeAttackBonuses(attacker: Character, result: AttackResult): string {
    const abilityLabel = attacker.weapon.isRanged ? 'DEX' : 'STR';
    return (
      Battle.signedTerm(result.baseAttackBonus, 'BAB') +
      Battle.signedTerm(result.abilityAttackModifier, abilityLabel) +
      Battle.signedTerm(result.situationalAttackBonus, 'situational')
    );
  }

  private static describeDamage(attacker: Character, result: AttackResult): string {
    const abilityLabel = attacker.weapon.isRanged ? 'DEX' : 'STR';
    const dice = result.wasCritical
      ? `${attacker.weapon.criticalMultiplier}×${attacker.weapon.damageDice}=${result.damageDiceRoll}`
      : `${attacker.weapon.damageDice}:${result.damageDiceRoll}`;
    const sneakTerm = result.sneakAttackDamage > 0 ? ` +${result.sneakAttackDamage} sneak` : '';
    return `damage ${dice}` + Battle.signedTerm(result.damageModifier, abilityLabel) + sneakTerm;
  }

  private static signedTerm(value: number, label: string): string {
    if (value === 0) {
      return '';
    }
    return ` ${Battle.signedNumber(value)} ${label}`;
  }

  private static signedNumber(value: number): string {
    return value >= 0 ? `+${value}` : `-${Math.abs(value)}`;
  }
}
