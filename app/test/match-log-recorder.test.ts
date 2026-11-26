import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { chooseAction } from '../src/engine/dumb-ai';
import { CharacterClasses } from '../src/engine/character-class';
import { Weapons, Armors } from '../src/engine/catalogs';
import { singleClassLoadout, type LoadoutChoice } from '../src/game/loadout';
import { newBattleFromChoice, replayBattle } from '../src/game/replay';
import { parseMatchLog, toReplay } from '../src/game/match-log';
import { MatchLogRecorder } from '../src/game/match-log-recorder';

// The recorder is what turns a live battle into an append-only stream of lines: it must write the setup
// once, each event once, the end once, and nothing at all when the battle has not moved. Durability
// depends on that — a log that is only written at the end is worthless to a crash.

function martialChoice(seed: number): LoadoutChoice {
  return {
    loadout: singleClassLoadout(CharacterClasses.fighter(), 3, Weapons.longsword(), Armors.chainmail(), null),
    partySize: 2,
    enemyCount: 2,
    seed,
  };
}

/** Collects what the recorder appends, in order, exactly as a file would accumulate it. */
function recordingSink() {
  const appended: string[][] = [];
  return {
    appended,
    text: () => appended.flat().join(''),
    appendMatchLogLines: async (_matchId: string, lines: readonly string[]) => {
      appended.push([...lines]);
    },
  };
}

function playOneTurn(battle: Battle): void {
  let loops = 0;
  for (;;) {
    const action = chooseAction(battle);
    if (action === null || battle.isOver || loops++ > 50) {
      break;
    }
    battle.execute(action);
  }
  if (!battle.isOver) {
    battle.endTurn();
  }
}

describe('match log recorder appends as the match goes', () => {
  it('writes the setup line on the first flush, before any move is played', async () => {
    const choice = martialChoice(42);
    const battle = newBattleFromChoice(choice);
    const sink = recordingSink();
    const recorder = new MatchLogRecorder(choice, sink.appendMatchLogLines);

    await recorder.flush(battle);

    const parsed = parseMatchLog(sink.text());
    expect(parsed.start.choice.seed).toBe(42);
    expect(parsed.events).toHaveLength(0);
    expect(parsed.end).toBeNull();
  });

  it('appends only the moves played since the previous flush', async () => {
    const choice = martialChoice(42);
    const battle = newBattleFromChoice(choice);
    const sink = recordingSink();
    const recorder = new MatchLogRecorder(choice, sink.appendMatchLogLines);

    await recorder.flush(battle);
    playOneTurn(battle);
    await recorder.flush(battle);
    const afterFirstTurn = battle.executedEvents.length;
    playOneTurn(battle);
    await recorder.flush(battle);

    const written = parseMatchLog(sink.text());
    expect(written.events).toHaveLength(battle.executedEvents.length);
    // The second flush carried exactly the moves of the second turn, not the whole history again.
    expect(sink.appended[2]).toHaveLength(battle.executedEvents.length - afterFirstTurn);
  });

  it('writes nothing when the battle has not moved since the last flush', async () => {
    const choice = martialChoice(42);
    const battle = newBattleFromChoice(choice);
    const sink = recordingSink();
    const recorder = new MatchLogRecorder(choice, sink.appendMatchLogLines);

    await recorder.flush(battle);
    const writesAfterStart = sink.appended.length;
    await recorder.flush(battle);
    await recorder.flush(battle);

    expect(sink.appended).toHaveLength(writesAfterStart);
  });

  it('closes the log once when the battle is over, however many flushes follow', async () => {
    const choice = martialChoice(42);
    const battle = newBattleFromChoice(choice);
    const sink = recordingSink();
    const recorder = new MatchLogRecorder(choice, sink.appendMatchLogLines);

    let guard = 0;
    while (!battle.isOver && guard++ < 500) {
      await recorder.flush(battle);
      playOneTurn(battle);
    }
    await recorder.flush(battle);
    await recorder.flush(battle);

    expect(battle.isOver).toBe(true);
    const parsed = parseMatchLog(sink.text());
    expect(parsed.end?.winningSide).toBe(battle.winningSide);
  });

  it('produces a log that replays to the same outcome as the live match', async () => {
    const choice = martialChoice(1337);
    const battle = newBattleFromChoice(choice);
    const sink = recordingSink();
    const recorder = new MatchLogRecorder(choice, sink.appendMatchLogLines);

    let guard = 0;
    while (!battle.isOver && guard++ < 500) {
      await recorder.flush(battle);
      playOneTurn(battle);
    }
    await recorder.flush(battle);

    const replayed = replayBattle(toReplay(parseMatchLog(sink.text())));
    expect(replayed.combatants.map((c) => [c.name, c.currentHitPoints, c.vitalStatus])).toEqual(
      battle.combatants.map((c) => [c.name, c.currentHitPoints, c.vitalStatus]),
    );
    expect(replayed.winningSide).toBe(battle.winningSide);
  });

  it('keeps a failing sink from taking the match down, and stops writing after it', async () => {
    const choice = martialChoice(42);
    const battle = newBattleFromChoice(choice);
    let calls = 0;
    const recorder = new MatchLogRecorder(choice, async () => {
      calls++;
      throw new Error('disk full');
    });

    await recorder.flush(battle);
    playOneTurn(battle);
    await recorder.flush(battle);

    expect(calls).toBe(1);
    expect(recorder.lastError?.message).toMatch(/disk full/);
  });
});
