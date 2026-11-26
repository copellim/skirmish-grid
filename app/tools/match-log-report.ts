// Human-readable views over a match log: the summary of a fight, its moves, and the outcome of
// replaying it. Pure — every function takes an already-parsed log and returns lines — so the CLI next
// to it stays a thin shell around argument parsing and I/O, and these can be tested without a file.

import type { Battle } from '../src/engine/battle';
import type { SerializedAction, SerializedChoice } from '../src/game/replay';
import {
  replayMatchLog,
  type CombatantSnapshot,
  type MatchEventRecord,
  type ParsedMatchLog,
} from '../src/game/match-log';
import { ARENA_GRID_SIZE } from '../src/game/loadout';

const NONE = '—';

function nameOf(combatants: readonly CombatantSnapshot[], index: number): string {
  const combatant = combatants[index];
  return combatant === undefined ? `<unknown combatant ${index}>` : `[${index}] ${combatant.name}`;
}

function joinOrNone(values: readonly string[]): string {
  return values.length === 0 ? NONE : values.join(', ');
}

function square(position: { readonly x: number; readonly y: number }): string {
  return `(${position.x},${position.y})`;
}

// ---- Actions in words ----

/** One line of plain English for a recorded action, with target names rather than bare indices. */
export function describeAction(action: SerializedAction, combatants: readonly CombatantSnapshot[]): string {
  const target = (index: number): string => nameOf(combatants, index);
  switch (action.kind) {
    case 'move':
      return `moves to ${square(action.destination)}`;
    case 'doubleMove':
      return `double moves to ${square(action.destination)}`;
    case 'fiveFootStep':
      return `takes a 5-ft step to ${square(action.destination)}`;
    case 'withdraw':
      return `withdraws to ${square(action.destination)}`;
    case 'attack':
    case 'fullAttack': {
      const what = action.kind === 'attack' ? 'attacks' : 'full attacks';
      const powerAttack = action.powerAttackPenalty === 0 ? '' : ` (Power Attack ${-action.powerAttackPenalty})`;
      return `${what} ${target(action.targetIndex)}${powerAttack}`;
    }
    case 'charge':
      return `charges ${target(action.targetIndex)}`;
    case 'trip':
      return `trips ${target(action.targetIndex)}`;
    case 'bullRush':
      return `bull rushes ${target(action.targetIndex)}`;
    case 'disarm':
      return `disarms ${target(action.targetIndex)}`;
    case 'coupDeGrace':
      return `delivers a coup de grâce to ${target(action.targetIndex)}`;
    case 'overrun':
      return `overruns ${target(action.targetIndex)} towards ${square(action.destination)}`;
    case 'aidAnother':
      return `aids ${target(action.allyIndex)} (${action.benefit})`;
    case 'castSpell': {
      const at =
        action.targetIndex !== null
          ? ` at ${target(action.targetIndex)}`
          : action.areaCenter !== null
            ? ` centred on ${square(action.areaCenter)}`
            : '';
      return `casts ${action.spellName}${at}${action.defensive ? ', defensively' : ''}`;
    }
    case 'standUp':
      return 'stands up';
    case 'retrieveWeapon':
      return 'retrieves its weapon';
    case 'setOverrunStance':
      return action.avoids ? 'will step aside from an overrun' : 'will block an overrun';
    case 'rage':
      return 'flies into a rage';
    case 'endRage':
      return 'ends its rage';
  }
}

function describeEvent(record: MatchEventRecord, combatants: readonly CombatantSnapshot[]): string {
  return record.kind === 'endTurn' ? 'ends the turn' : describeAction(record.action, combatants);
}

// ---- Summary ----

function describeLoadout(choice: SerializedChoice): string[] {
  const classes = choice.classes.map((c) => `${c.name} ${c.level}`).join(' / ');
  const gear = [choice.weapon, choice.armor ?? 'no armor', choice.shield ?? 'no shield'].join(', ');
  return [
    `  character   ${classes}`,
    `  gear        ${gear}`,
    `  feats       ${joinOrNone(choice.featNames)}`,
    `  spells      ${joinOrNone(choice.spellNames)}`,
  ];
}

function roundsPlayed(events: readonly MatchEventRecord[]): number {
  return events.reduce((highest, event) => Math.max(highest, event.turn), 0);
}

function warningsFor(parsed: ParsedMatchLog): string[] {
  const warnings: string[] = [];
  if (parsed.droppedTruncatedLastLine) {
    warnings.push('  WARNING     the last line was cut off mid-write and has been discarded');
  }
  if (parsed.end === null) {
    warnings.push('  WARNING     no matchEnd record: the match was still running, or it crashed');
  }
  return warnings;
}

/** Setup, teams, seed and outcome of one fight — the answer to "what was this match?". */
export function summaryLines(parsed: ParsedMatchLog): string[] {
  const { start, events, end } = parsed;
  const actions = events.filter((event) => event.kind === 'action').length;
  const lines = [
    `match       ${start.matchId}`,
    `  started     ${start.startedAt}`,
    `  schema      ${start.schemaVersion}`,
    `  seed        ${start.choice.seed}`,
    `  arena       ${ARENA_GRID_SIZE}x${ARENA_GRID_SIZE}`,
    ...describeLoadout(start.choice),
    `  sides       A ${start.choice.partySize} vs B ${start.choice.enemyCount}`,
    ...start.combatants.map(
      (combatant) => `    ${nameOf(start.combatants, combatant.index)} — side ${combatant.side}, ${combatant.controller}`,
    ),
    `  rounds      ${roundsPlayed(events)}`,
    `  events      ${events.length} (${actions} actions, ${events.length - actions} turn ends)`,
    ...warningsFor(parsed),
  ];

  if (end === null) {
    return [...lines, '  result      unknown'];
  }
  return [
    ...lines,
    `  result      ${end.winningSide === null ? 'no winner' : `side ${end.winningSide} wins`}`,
    ...end.combatants.map(
      (combatant) => `    ${nameOf(start.combatants, combatant.index)} — ${combatant.hitPoints} hp, ${combatant.vitalStatus}`,
    ),
  ];
}

// ---- Moves ----

export interface MoveFilter {
  /** Only the moves of this round. */
  readonly round?: number;
  /** Only the moves of this combatant: its index, or a case-insensitive part of its name. */
  readonly actor?: string;
}

function matchesActor(record: MatchEventRecord, combatants: readonly CombatantSnapshot[], actor: string): boolean {
  if (String(record.actorIndex) === actor) {
    return true;
  }
  const name = combatants[record.actorIndex]?.name ?? '';
  return name.toLowerCase().includes(actor.toLowerCase());
}

export function filterMoves(
  events: readonly MatchEventRecord[],
  combatants: readonly CombatantSnapshot[],
  filter: MoveFilter,
): MatchEventRecord[] {
  return events.filter(
    (record) =>
      (filter.round === undefined || record.turn === filter.round) &&
      (filter.actor === undefined || matchesActor(record, combatants, filter.actor)),
  );
}

/** The move list in play order: round, actor, who controls it, and what it did. */
export function moveLines(parsed: ParsedMatchLog, filter: MoveFilter = {}): string[] {
  const combatants = parsed.start.combatants;
  const selected = filterMoves(parsed.events, combatants, filter);
  if (selected.length === 0) {
    return ['no move matches the filter'];
  }
  const widest = Math.max(...selected.map((record) => nameOf(combatants, record.actorIndex).length));
  return selected.map((record) => {
    const actor = nameOf(combatants, record.actorIndex).padEnd(widest);
    return `r${String(record.turn).padStart(2)}  ${actor}  ${record.controller.padEnd(7)}  ${describeEvent(record, combatants)}`;
  });
}

// ---- Replay ----

function outcomeMatches(parsed: ParsedMatchLog, battle: Battle): boolean {
  const end = parsed.end;
  if (end === null) {
    return false;
  }
  return (
    end.winningSide === battle.winningSide &&
    end.combatants.every((recorded) => {
      const rebuilt = battle.combatants[recorded.index];
      return rebuilt.currentHitPoints === recorded.hitPoints && rebuilt.vitalStatus === recorded.vitalStatus;
    })
  );
}

/**
 * Replays the log and reports the state it reaches. `replayMatchLog` already fails loud if the recorded
 * actor is not the combatant on turn; on top of that, when the log carries a matchEnd, the rebuilt state
 * is compared against the recorded one. A mismatch there means the engine no longer plays this match the
 * way it did when the log was written — which is exactly the bug such a log is kept to reproduce.
 */
export function replayLines(parsed: ParsedMatchLog): string[] {
  const battle = replayMatchLog(parsed);
  const lines = [
    `replayed    ${parsed.events.length} events, ${roundsPlayed(parsed.events)} rounds`,
    `  actors      every recorded actor was the combatant on turn`,
    ...warningsFor(parsed),
    `  winner      ${battle.winningSide === null ? 'none yet' : `side ${battle.winningSide}`}`,
    ...battle.combatants.map(
      (combatant, index) =>
        `    ${nameOf(parsed.start.combatants, index)} — ${combatant.currentHitPoints} hp, ${combatant.vitalStatus}, at ${square(combatant.position)}`,
    ),
  ];

  if (parsed.end === null) {
    return [...lines, '  outcome     nothing recorded to compare against'];
  }
  return [
    ...lines,
    outcomeMatches(parsed, battle)
      ? '  outcome     matches the recorded matchEnd (winner, hit points, vital status)'
      : '  outcome     DIFFERS from the recorded matchEnd — this build no longer reproduces the match',
  ];
}

// ---- Listing a directory of logs ----

export interface StoredLog {
  readonly name: string;
  readonly jsonl: string;
}

/** One line per stored log. A log that cannot be read is reported in place, never aborts the listing. */
export function listingLines(logs: readonly StoredLog[], parse: (jsonl: string) => ParsedMatchLog): string[] {
  if (logs.length === 0) {
    return ['no match log found'];
  }
  return logs.map((log) => {
    try {
      const parsed = parse(log.jsonl);
      const outcome =
        parsed.end === null
          ? 'unfinished'
          : parsed.end.winningSide === null
            ? 'no winner'
            : `side ${parsed.end.winningSide}`;
      return `${log.name}  seed ${parsed.start.choice.seed}  ${roundsPlayed(parsed.events)} rounds  ${parsed.events.length} events  ${outcome}`;
    } catch (cause) {
      return `${log.name}  UNREADABLE: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  });
}
