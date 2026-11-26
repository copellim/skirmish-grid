import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMatchLog, type ParsedMatchLog } from '../src/game/match-log';
import {
  describeAction,
  filterMoves,
  listingLines,
  moveLines,
  replayLines,
  summaryLines,
} from '../tools/match-log-report';
import { martialChoice, playedMatch } from './support/played-match';

// The views the match-log CLI prints. They are checked against a log file that is checked in, so the
// tool is exercised on the same bytes an inspector would open — not on a hand-written object that
// could drift from what the app actually writes.

const FIXTURE = join(__dirname, 'fixtures', 'match-log-sample.jsonl');
const FIXTURE_SEED = 42;

function sampleLog(): string {
  return readFileSync(FIXTURE, 'utf8');
}

function parsedSample(): ParsedMatchLog {
  return parseMatchLog(sampleLog());
}

describe('the checked-in sample log', () => {
  it('is exactly the log this engine writes today', () => {
    const written = playedMatch(martialChoice(FIXTURE_SEED)).jsonl;

    // Regenerate after a deliberate rule or format change: UPDATE_MATCH_LOG_FIXTURE=1 npx vitest run
    if (process.env.UPDATE_MATCH_LOG_FIXTURE === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, written);
    }

    expect(sampleLog()).toBe(written);
  });
});

describe('match summary', () => {
  it('reports the setup, the seed, both teams and the outcome', () => {
    const lines = summaryLines(parsedSample()).join('\n');

    expect(lines).toContain('seed        42');
    expect(lines).toContain('Fighter 3');
    expect(lines).toContain('Longsword, Chainmail, no shield');
    expect(lines).toContain('sides       A 2 vs B 2');
    expect(lines).toMatch(/side [AB] wins/);
    expect(lines).toMatch(/rounds {6}\d+/);
    // Every combatant appears twice: in the roster and in the final state.
    for (const combatant of parsedSample().start.combatants) {
      expect(lines.split(combatant.name).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('warns about a log the crash cut short instead of reporting an outcome', () => {
    const truncated = parseMatchLog(sampleLog().slice(0, sampleLog().length - 40));

    const lines = summaryLines(truncated).join('\n');

    expect(lines).toContain('the last line was cut off mid-write');
    expect(lines).toContain('no matchEnd record');
    expect(lines).toContain('result      unknown');
  });
});

describe('move list', () => {
  it('gives every move its round, actor, controller and a readable description', () => {
    const parsed = parsedSample();

    const lines = moveLines(parsed);

    expect(lines).toHaveLength(parsed.events.length);
    expect(lines[0]).toMatch(/^r\s+1\s+\[\d+\] \S.*\s(human|cpu)\s+\S/);
    expect(lines.some((line) => line.includes('human'))).toBe(true);
    expect(lines.some((line) => line.includes('cpu'))).toBe(true);
    expect(lines.some((line) => line.includes('ends the turn'))).toBe(true);
  });

  it('filters by round and by combatant, index or name alike', () => {
    const parsed = parsedSample();
    const combatants = parsed.start.combatants;

    const roundTwo = filterMoves(parsed.events, combatants, { round: 2 });
    expect(roundTwo.length).toBeGreaterThan(0);
    expect(roundTwo.every((record) => record.turn === 2)).toBe(true);

    const byIndex = filterMoves(parsed.events, combatants, { actor: '0' });
    const byName = filterMoves(parsed.events, combatants, { actor: combatants[0].name.toLowerCase() });
    expect(byIndex.length).toBeGreaterThan(0);
    expect(byIndex.every((record) => record.actorIndex === 0)).toBe(true);
    expect(byName).toEqual(byIndex);

    expect(moveLines(parsed, { actor: 'nobody' })).toEqual(['no move matches the filter']);
  });

  it('describes every kind of action in words rather than as a dump', () => {
    const combatants = parsedSample().start.combatants;
    const target = combatants[1].name;

    expect(describeAction({ kind: 'attack', targetIndex: 1, powerAttackPenalty: 0 }, combatants)).toBe(
      `attacks [1] ${target}`,
    );
    expect(describeAction({ kind: 'attack', targetIndex: 1, powerAttackPenalty: -2 }, combatants)).toContain(
      'Power Attack 2',
    );
    expect(describeAction({ kind: 'move', destination: { x: 3, y: 4 } }, combatants)).toBe('moves to (3,4)');
    expect(
      describeAction(
        { kind: 'castSpell', spellName: 'Fireball', targetIndex: null, areaCenter: { x: 5, y: 6 }, defensive: true },
        combatants,
      ),
    ).toBe('casts Fireball centred on (5,6), defensively');
    expect(describeAction({ kind: 'standUp' }, combatants)).toBe('stands up');
    expect(describeAction({ kind: 'setOverrunStance', avoids: true }, combatants)).toBe(
      'will step aside from an overrun',
    );
  });
});

describe('replay of a stored log', () => {
  it('reaches the recorded outcome and says so', () => {
    const lines = replayLines(parsedSample()).join('\n');

    expect(lines).toContain('matches the recorded matchEnd');
    expect(lines).not.toContain('DIFFERS');
    for (const combatant of parsedSample().end?.combatants ?? []) {
      expect(lines).toContain(`${combatant.hitPoints} hp, ${combatant.vitalStatus}`);
    }
  });

  it('calls out a log whose recorded outcome the engine no longer reproduces', () => {
    const parsed = parsedSample();
    const end = parsed.end;
    if (end === null) {
      throw new Error('the sample log must carry a matchEnd record');
    }
    const tampered = {
      ...parsed,
      end: { ...end, combatants: end.combatants.map((c) => ({ ...c, hitPoints: c.hitPoints + 1 })) },
    };

    expect(replayLines(tampered).join('\n')).toContain('DIFFERS from the recorded matchEnd');
  });

  it('replays a truncated log up to its last good move and warns instead of comparing', () => {
    const truncated = parseMatchLog(sampleLog().slice(0, sampleLog().length - 40));

    const lines = replayLines(truncated).join('\n');

    expect(lines).toContain('cut off mid-write');
    expect(lines).toContain('nothing recorded to compare against');
  });
});

describe('listing a directory of logs', () => {
  it('summarizes each log on one line and reports the unreadable ones in place', () => {
    const lines = listingLines(
      [
        { name: 'good.jsonl', jsonl: sampleLog() },
        { name: 'broken.jsonl', jsonl: '{"kind":"matchStart"}\n' },
      ],
      parseMatchLog,
    );

    expect(lines[0]).toMatch(/^good\.jsonl {2}seed 42 {2}\d+ rounds {2}\d+ events {2}side [AB]$/);
    expect(lines[1]).toContain('UNREADABLE');
    expect(lines[1]).toContain('schema version none');
  });

  it('says so when there is nothing to list', () => {
    expect(listingLines([], parseMatchLog)).toEqual(['no match log found']);
  });
});
