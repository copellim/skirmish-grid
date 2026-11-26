// Diagnostic match log: one JSONL file per fight, appended as it is played. The first line carries the
// whole setup (loadout, side sizes, seed) plus a snapshot of the combatants; every following line
// carries one applied action or turn end, attributed to its actor and to whoever controls it. This is
// not the combat log — that one is a domain object the UI renders. This one exists to reproduce a fight
// out of process, so it is built on the same seed-plus-actions guarantee `replay.ts` already provides.
//
// Pure and I/O-free, like the rest of `game/`: writing the lines out is `match-log-sink.ts`.

import type { Battle } from '../engine/battle';
import type { Character } from '../engine/character';
import type { Side } from '../engine/enums';
import type { VitalStatus } from '../engine/enums';
import type { LoadoutChoice } from './loadout';
import {
  serializeAction,
  deserializeAction,
  deserializeChoice,
  serializeChoice,
  newBattleFromChoice,
  type SerializedAction,
  type SerializedChoice,
  type SerializedEvent,
  type BattleReplay,
} from './replay';

/** Who issued a move. `player2` is reserved for a future human-vs-human arena. */
export type MatchController = 'human' | 'cpu' | 'player2';

export interface CombatantSnapshot {
  readonly index: number;
  readonly name: string;
  readonly side: Side;
  readonly controller: MatchController;
}

export interface CombatantOutcome {
  readonly index: number;
  readonly name: string;
  readonly hitPoints: number;
  readonly vitalStatus: VitalStatus;
}

/**
 * Bumped whenever a record changes shape in a way an older reader would misread. A log carries it on
 * its first line so a reader can say "this file is version N, I speak M" instead of failing later,
 * deep inside the rules, on a field that moved.
 */
export const MATCH_LOG_SCHEMA_VERSION = 2;

export interface MatchStartRecord {
  readonly kind: 'matchStart';
  readonly schemaVersion: number;
  readonly matchId: string;
  readonly startedAt: string;
  readonly choice: SerializedChoice;
  readonly combatants: readonly CombatantSnapshot[];
}

export interface ActionRecord {
  readonly kind: 'action';
  readonly turn: number;
  readonly actorIndex: number;
  readonly controller: MatchController;
  readonly action: SerializedAction;
}

export interface EndTurnRecord {
  readonly kind: 'endTurn';
  readonly turn: number;
  readonly actorIndex: number;
  readonly controller: MatchController;
}

export type MatchEventRecord = ActionRecord | EndTurnRecord;

export interface MatchEndRecord {
  readonly kind: 'matchEnd';
  readonly winningSide: Side | null;
  readonly combatants: readonly CombatantOutcome[];
}

export type MatchLogRecord = MatchStartRecord | MatchEventRecord | MatchEndRecord;

/** The sink contract, declared here so both the native and the web implementation are checked against it. */
export interface MatchLogSink {
  appendMatchLogLines(matchId: string, lines: readonly string[]): Promise<void>;
  listMatchLogs(): Promise<readonly string[]>;
  readMatchLog(matchId: string): Promise<string>;
}

// Side A is the human party and side B the CPU one, as the arena builds them today; a second human
// player arrives with PvP, which is why the controller is a record field rather than a copy of the side.
function controllerOf(combatant: Character): MatchController {
  return combatant.side === 'A' ? 'human' : 'cpu';
}

// ---- Building the records from a live battle ----

export function matchStartRecord(
  matchId: string,
  startedAt: string,
  choice: LoadoutChoice,
  battle: Battle,
): MatchStartRecord {
  return {
    kind: 'matchStart',
    schemaVersion: MATCH_LOG_SCHEMA_VERSION,
    matchId,
    startedAt,
    choice: serializeChoice(choice),
    combatants: battle.combatants.map((combatant, index) => ({
      index,
      name: combatant.name,
      side: combatant.side,
      controller: controllerOf(combatant),
    })),
  };
}

/** One record per applied action and turn end, in execution order. */
export function eventRecords(battle: Battle): MatchEventRecord[] {
  const combatants = battle.combatants;
  return battle.executedEvents.map<MatchEventRecord>((event) => {
    const common = {
      turn: event.turn,
      actorIndex: combatants.indexOf(event.actor),
      controller: controllerOf(event.actor),
    };
    return event.kind === 'endTurn'
      ? { kind: 'endTurn', ...common }
      : { kind: 'action', ...common, action: serializeAction(event.action, combatants) };
  });
}

export function matchEndRecord(battle: Battle): MatchEndRecord {
  return {
    kind: 'matchEnd',
    winningSide: battle.winningSide,
    combatants: battle.combatants.map((combatant, index) => ({
      index,
      name: combatant.name,
      hitPoints: combatant.currentHitPoints,
      vitalStatus: combatant.vitalStatus,
    })),
  };
}

/** JSONL lines, newline included, ready to be appended one at a time. */
export function toJsonLines(records: readonly MatchLogRecord[]): string[] {
  return records.map((record) => `${JSON.stringify(record)}\n`);
}

// ---- Reading a log back ----

export interface ParsedMatchLog {
  readonly start: MatchStartRecord;
  readonly events: readonly MatchEventRecord[];
  /** Null while the match is still running, or when the crash took the end record with it. */
  readonly end: MatchEndRecord | null;
  /** A crash caught the file mid-write: its last line was incomplete and has been discarded. */
  readonly droppedTruncatedLastLine: boolean;
}

function isCompleteRecord(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/**
 * Separates the records a reader can trust from a trailing fragment a crash left behind. Every line the
 * sink writes ends with a newline, so a healthy file splits into a last empty segment. A non-empty one
 * is only a truncation if it does not parse: a complete record with the final newline missing (a log
 * copied by hand, say) is a whole line, not a fragment, and dropping it would hide a finished match.
 */
function splitCompleteLines(jsonl: string): { complete: string[]; droppedTruncatedLastLine: boolean } {
  const segments = jsonl.split('\n');
  const last = segments[segments.length - 1];
  if (last === '') {
    return { complete: segments.slice(0, segments.length - 1), droppedTruncatedLastLine: false };
  }
  return isCompleteRecord(last)
    ? { complete: segments, droppedTruncatedLastLine: false }
    : { complete: segments.slice(0, segments.length - 1), droppedTruncatedLastLine: true };
}

const RECORD_KINDS: readonly MatchLogRecord['kind'][] = ['matchStart', 'action', 'endTurn', 'matchEnd'];

function isRecordKind(kind: unknown): kind is MatchLogRecord['kind'] {
  return RECORD_KINDS.includes(kind as MatchLogRecord['kind']);
}

// The kind is checked here rather than left to the caller: an unknown one would otherwise travel on as
// an event and die much later inside `deserializeAction`, as an engine error with no bearing on the
// real problem, which is that this line is not a record this reader understands.
function parseRecord(line: string, lineNumber: number): MatchLogRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    throw new Error(`match log: malformed record on line ${lineNumber}.`, { cause });
  }
  const kind = (parsed as { kind?: unknown }).kind;
  if (!isRecordKind(kind)) {
    throw new Error(`match log: unknown record kind ${JSON.stringify(kind)} on line ${lineNumber}.`);
  }
  return parsed as MatchLogRecord;
}

// A log written by a different build of the app describes a different record shape, so reading it as if
// it were ours would produce a plausible-looking but wrong reconstruction. Said here, once, at the only
// line that carries the version.
function checkSchemaVersion(start: MatchStartRecord): void {
  if (start.schemaVersion !== MATCH_LOG_SCHEMA_VERSION) {
    const found = start.schemaVersion === undefined ? 'none' : String(start.schemaVersion);
    throw new Error(
      `match log: schema version ${found}, but this build reads version ${MATCH_LOG_SCHEMA_VERSION}.`,
    );
  }
}

/**
 * Reads a whole log file. A crash can only ever cut the last line short, so that one line is dropped
 * and reported; a malformed line anywhere else means the file is corrupt and is an error, as is a
 * missing start record or anything written after the end record.
 */
export function parseMatchLog(jsonl: string): ParsedMatchLog {
  const { complete, droppedTruncatedLastLine } = splitCompleteLines(jsonl);

  if (complete.length === 0) {
    throw new Error('match log: the first line must be a matchStart record; the file has none.');
  }

  const start = parseRecord(complete[0], 1);
  if (start.kind !== 'matchStart') {
    throw new Error(`match log: the first line must be a matchStart record, found "${start.kind}".`);
  }
  checkSchemaVersion(start);

  const events: MatchEventRecord[] = [];
  let end: MatchEndRecord | null = null;
  for (let index = 1; index < complete.length; index++) {
    const record = parseRecord(complete[index], index + 1);
    if (end !== null) {
      throw new Error(`match log: line ${index + 1} follows the matchEnd record.`);
    }
    if (record.kind === 'matchEnd') {
      end = record;
    } else if (record.kind === 'matchStart') {
      throw new Error(`match log: a second matchStart record on line ${index + 1}.`);
    } else {
      events.push(record);
    }
  }

  return { start, events, end, droppedTruncatedLastLine };
}

/**
 * Converts a parsed log into a portable replay. The turn, actor and controller are dropped on purpose:
 * the replay derives the actor from the battle it is rebuilding, so keeping a second copy would let the
 * two representations drift apart in silence. Use `replayMatchLog` when you want them checked.
 */
export function toReplay(parsed: ParsedMatchLog): BattleReplay {
  const events = parsed.events.map<SerializedEvent>((record) =>
    record.kind === 'endTurn' ? { kind: 'endTurn' } : { kind: 'action', action: record.action },
  );
  return { choice: parsed.start.choice, events };
}

/**
 * Replays a parsed log, using the recorded actor as a corruption detector: at every step the actor the
 * log names must be the combatant the rebuilt battle has on turn. A mismatch means the log was edited,
 * came from a different engine build, or interleaves two matches — all of which fail loud here rather
 * than producing a plausible-looking but wrong reconstruction.
 */
export function replayMatchLog(parsed: ParsedMatchLog): Battle {
  const battle = newBattleFromChoice(deserializeChoice(parsed.start.choice));
  for (const [index, record] of parsed.events.entries()) {
    const onTurn = battle.combatants.indexOf(battle.currentActor);
    if (record.actorIndex !== onTurn) {
      throw new Error(
        `match log: event ${index + 1} names actor ${record.actorIndex}, but ${onTurn} is on turn.`,
      );
    }
    if (record.kind === 'endTurn') {
      battle.endTurn();
    } else {
      battle.execute(deserializeAction(record.action, battle.combatants));
    }
  }
  return battle;
}
