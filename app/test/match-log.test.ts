import { describe, it, expect } from 'vitest';
import { replayBattle } from '../src/game/replay';
import {
  matchStartRecord,
  toJsonLines,
  parseMatchLog,
  toReplay,
  replayMatchLog,
  MATCH_LOG_SCHEMA_VERSION,
  type MatchStartRecord,
} from '../src/game/match-log';
import type { Battle } from '../src/engine/battle';
import {
  MATCH_ID,
  STARTED_AT,
  martialChoice,
  sorcererChoice,
  freshBattle,
  playedMatch,
} from './support/played-match';
import type { LoadoutChoice } from '../src/game/loadout';

// The match log is the diagnostic counterpart of the replay: a JSONL file whose first line carries the
// whole match setup and whose following lines carry every applied action and turn end, appended as the
// fight goes. Its contract is that a log read back off disk — even one a crash truncated mid-write —
// replays to exactly the state the original match reached.

interface Outcome {
  /** Every log entry with its round and message. The messages spell out each die roll, so two matches
   *  agreeing here rolled the same dice in the same order — not merely landed on the same HP. */
  transcript: string[];
  finalState: { name: string; hp: number; status: string; position: string }[];
  winningSide: string | null;
}

function outcomeOf(battle: Battle): Outcome {
  return {
    transcript: battle.log.map((entry) => `${entry.turn}|${entry.event}|${entry.message}`),
    finalState: battle.combatants.map((c) => ({
      name: c.name,
      hp: c.currentHitPoints,
      status: c.vitalStatus,
      position: `${c.position.x},${c.position.y}`,
    })),
    winningSide: battle.winningSide,
  };
}

describe('match log records a whole match', () => {
  it('opens with the full setup, the seed, and a snapshot of every combatant', () => {
    const choice = martialChoice(42);
    const { battle, jsonl } = playedMatch(choice);

    const parsed = parseMatchLog(jsonl);

    expect(parsed.start.matchId).toBe(MATCH_ID);
    expect(parsed.start.startedAt).toBe(STARTED_AT);
    expect(parsed.start.choice.seed).toBe(42);
    expect(parsed.start.choice.weapon).toBe('Longsword');
    expect(parsed.start.combatants).toEqual(
      battle.combatants.map((c, index) => ({
        index,
        name: c.name,
        side: c.side,
        controller: c.side === 'A' ? 'human' : 'cpu',
      })),
    );
  });

  it('records every action and turn end with its round, actor and controller', () => {
    const choice = martialChoice(42);
    const { battle, jsonl } = playedMatch(choice);

    const parsed = parseMatchLog(jsonl);

    expect(parsed.events).toHaveLength(battle.executedEvents.length);
    expect(parsed.events.map((e) => e.kind)).toEqual(battle.executedEvents.map((e) => e.kind));
    for (const [index, record] of parsed.events.entries()) {
      const event = battle.executedEvents[index];
      expect(record.turn).toBe(event.turn);
      expect(record.actorIndex).toBe(battle.combatants.indexOf(event.actor));
      expect(record.controller).toBe(event.actor.side === 'A' ? 'human' : 'cpu');
    }
    // A CPU-side fight must actually exercise the cpu controller, or the assertion above proves nothing.
    expect(parsed.events.some((e) => e.controller === 'cpu')).toBe(true);
  });

  it('closes with the winner and the final state of every combatant', () => {
    const choice = martialChoice(42);
    const { battle, jsonl } = playedMatch(choice);

    const parsed = parseMatchLog(jsonl);

    expect(parsed.end).not.toBeNull();
    expect(parsed.end?.winningSide).toBe(battle.winningSide);
    expect(parsed.end?.combatants).toEqual(
      battle.combatants.map((c, index) => ({
        index,
        name: c.name,
        hitPoints: c.currentHitPoints,
        vitalStatus: c.vitalStatus,
      })),
    );
  });

  const cases: [string, (seed: number) => LoadoutChoice][] = [
    ['martial', martialChoice],
    ['sorcerer', sorcererChoice],
  ];

  for (const [label, makeChoice] of cases) {
    for (const seed of [1, 42, 1337]) {
      it(`${label} seed ${seed} replays from its log move for move and roll for roll`, () => {
        const choice = makeChoice(seed);
        const { battle, jsonl } = playedMatch(choice);
        const expected = outcomeOf(battle);

        // Guards the comparison itself: an empty or roll-free transcript would make the equality below
        // pass for the wrong reason. (A 1v1 sorcerer duel can be over in a handful of entries.)
        expect(expected.transcript.length).toBeGreaterThan(4);
        expect(expected.transcript.some((entry) => /d\d+:/.test(entry))).toBe(true);

        expect(outcomeOf(replayBattle(toReplay(parseMatchLog(jsonl))))).toEqual(expected);
        expect(outcomeOf(replayMatchLog(parseMatchLog(jsonl)))).toEqual(expected);
      });
    }
  }
});

describe('match log survives a crash mid-match', () => {
  it('replays a log cut off halfway up to its last recorded move', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const lines = jsonl.split('\n').filter((l) => l !== '');
    const halfway = lines.slice(0, Math.floor(lines.length / 2)).join('\n') + '\n';

    const parsed = parseMatchLog(halfway);

    expect(parsed.end).toBeNull();
    expect(parsed.droppedTruncatedLastLine).toBe(false);
    // Same prefix of moves as the original match, so the state must match move for move.
    const partial = replayMatchLog(parsed);
    expect(partial.executedEvents).toHaveLength(parsed.events.length);
  });

  it('drops a last line cut off mid-write and reports it', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const truncated = jsonl.slice(0, jsonl.length - 40);

    const parsed = parseMatchLog(truncated);

    expect(parsed.droppedTruncatedLastLine).toBe(true);
    expect(parsed.end).toBeNull();
    expect(() => replayMatchLog(parsed)).not.toThrow();
  });

  it('does not mistake the trailing newline of a healthy file for truncation', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);

    expect(jsonl.endsWith('\n')).toBe(true);
    expect(parseMatchLog(jsonl).droppedTruncatedLastLine).toBe(false);
  });

  it('keeps the last record of a complete log whose final newline is missing', () => {
    const choice = martialChoice(42);
    const { battle, jsonl } = playedMatch(choice);
    const withoutFinalNewline = jsonl.slice(0, -1);

    const parsed = parseMatchLog(withoutFinalNewline);

    // The line is whole, only its terminator is gone: dropping it would report a finished match as
    // crash-truncated and lose the winner.
    expect(parsed.droppedTruncatedLastLine).toBe(false);
    expect(parsed.end?.winningSide).toBe(battle.winningSide);
  });

  it('accepts a log that crashed right after the start line', () => {
    const choice = martialChoice(42);
    const battle = freshBattle(choice);
    const startOnly = toJsonLines([matchStartRecord(MATCH_ID, STARTED_AT, choice, battle)]).join('');

    const parsed = parseMatchLog(startOnly);

    expect(parsed.events).toHaveLength(0);
    expect(parsed.end).toBeNull();
    expect(replayMatchLog(parsed).executedEvents).toHaveLength(0);
  });
});

describe('match log rejects a corrupt file', () => {
  it('fails on a malformed line that is not the last one', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const lines = jsonl.split('\n').filter((l) => l !== '');
    lines.splice(2, 0, '{ not json');

    expect(() => parseMatchLog(lines.join('\n') + '\n')).toThrow(/line 3/);
  });

  it('fails when the first line is not a match start', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const lines = jsonl.split('\n').filter((l) => l !== '');

    expect(() => parseMatchLog(lines.slice(1).join('\n') + '\n')).toThrow(/matchStart/);
    expect(() => parseMatchLog('')).toThrow(/matchStart/);
  });

  it('fails on a record whose kind it does not know', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const lines = jsonl.split('\n').filter((l) => l !== '');
    lines.splice(2, 0, JSON.stringify({ kind: 'castRitual', turn: 1 }));

    // Left through, it would ride along as an event and die inside deserializeAction as an engine error.
    expect(() => parseMatchLog(lines.join('\n') + '\n')).toThrow(/unknown record kind "castRitual" on line 3/);
  });

  it('fails when the log was written by a build with a different schema version', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const lines = jsonl.split('\n').filter((l) => l !== '');
    const start = JSON.parse(lines[0]) as MatchStartRecord;

    expect(start.schemaVersion).toBe(MATCH_LOG_SCHEMA_VERSION);
    const fromTheFuture = [JSON.stringify({ ...start, schemaVersion: 99 }), ...lines.slice(1)];
    expect(() => parseMatchLog(fromTheFuture.join('\n') + '\n')).toThrow(/schema version 99/);

    const { schemaVersion, ...withoutVersion } = start;
    const fromBeforeVersioning = [JSON.stringify(withoutVersion), ...lines.slice(1)];
    expect(() => parseMatchLog(fromBeforeVersioning.join('\n') + '\n')).toThrow(/schema version none/);
  });

  it('fails when a record follows the match end', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const lines = jsonl.split('\n').filter((l) => l !== '');
    const [start, ...rest] = lines;
    const end = rest[rest.length - 1];

    expect(() => parseMatchLog([start, end, ...rest].join('\n') + '\n')).toThrow(/matchEnd/);
  });

  it('fails when an action targets a combatant the battle does not have', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const parsed = parseMatchLog(jsonl);
    const targetedIndex = parsed.events.findIndex((e) => e.kind === 'action' && 'targetIndex' in e.action);
    const targeted = parsed.events[targetedIndex] as { kind: 'action'; action: { targetIndex: number } };
    const events = [...parsed.events];
    events[targetedIndex] = { ...targeted, action: { ...targeted.action, targetIndex: 99 } } as never;

    expect(() => replayMatchLog({ ...parsed, events })).toThrow(/no combatant at index 99/);
  });

  it('fails when a recorded actor is not the combatant on turn', () => {
    const choice = martialChoice(42);
    const { jsonl } = playedMatch(choice);
    const parsed = parseMatchLog(jsonl);
    const [first, ...rest] = parsed.events;
    const corrupted = {
      ...parsed,
      events: [{ ...first, actorIndex: first.actorIndex === 0 ? 1 : 0 }, ...rest],
    };

    expect(() => replayMatchLog(corrupted)).toThrow(/actor/);
  });
});
