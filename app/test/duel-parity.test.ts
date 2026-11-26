import { describe, it, expect } from 'vitest';
import { DUEL_SEEDS, runDuel, type GoldenDuel } from './support/duel';
import duelGolden from './golden/duel.json';

// The widest net over the engine: a full DumbAi-vs-DumbAi fight is determined entirely by the seed,
// so a stored transcript pins the event sequence, the final HP and status of every combatant and the
// winner, all at once. Any rule change that moves a die moves this file.
//
// These transcripts were dumped from the C# engine while it was the parity oracle. That engine is
// gone: they are now a regression snapshot of this engine, seeded by the last state the two agreed
// on. Regenerate with `npm run golden` — see `tools/generate-golden.ts` for when that is honest.

describe('DumbAi-vs-DumbAi duels reproduce their golden transcript', () => {
  const stored = duelGolden as GoldenDuel[];

  it('has a stored transcript for every seed, and no stale extras', () => {
    expect(stored.map((duel) => duel.seed)).toEqual([...DUEL_SEEDS]);
  });

  for (const golden of stored) {
    it(`seed ${golden.seed} replays identically`, () => {
      const actual = runDuel(golden.seed);
      expect(actual.events).toEqual(golden.events);
      expect(actual.finalState).toEqual(golden.finalState);
      expect(actual.winningSide).toEqual(golden.winningSide);
    });
  }
});
