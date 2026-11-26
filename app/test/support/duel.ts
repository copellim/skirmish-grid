// The DumbAi-vs-DumbAi duel the golden transcripts are made of. Shared by `duel-parity.test.ts`,
// which asserts the stored transcript, and by `tools/generate-golden.ts`, which writes it: a roster
// or a play loop duplicated between the two would let the file and the test drift apart silently.
//
// The roster and the seeds are the ones the C# engine was dumped with. They are kept verbatim now
// that the C# engine is gone: the stored transcripts are its last word on these rules, and changing
// the setup here would throw that away.

import { Battle } from '../../src/engine/battle';
import { Grid } from '../../src/engine/grid';
import { SeededRandom } from '../../src/engine/random';
import { Character } from '../../src/engine/character';
import { AbilitySet, AbilityScore } from '../../src/engine/ability';
import { Weapons, Armors } from '../../src/engine/catalogs';
import { playToEnd } from './ai-play';

const ARENA_SIZE = 12;

export const DUEL_SEEDS = [1, 2, 3, 7, 42, 99, 123, 777, 2024, 31337] as const;

/** The seeds the d20 sequence is dumped for, including the extremes of a 32-bit seed. */
export const PRNG_SEEDS = [0, 1, 42, -1, 1337, 2147483647, -2147483648] as const;
export const PRNG_DRAWS = 50;

export interface FinalState {
  name: string;
  hp: number;
  status: string;
}

export interface GoldenDuel {
  seed: number;
  events: string[];
  finalState: FinalState[];
  winningSide: string | null;
}

const abilities = (strength: number, dexterity: number, constitution: number) =>
  new AbilitySet(
    new AbilityScore(strength),
    new AbilityScore(dexterity),
    new AbilityScore(constitution),
    new AbilityScore(10),
    new AbilityScore(10),
    new AbilityScore(10),
  );

export function duelRoster(): Character[] {
  return [
    new Character('A1', abilities(16, 12, 12), 30, 3, 30, Weapons.longsword(), { x: 1, y: 5 }, 'A', Armors.chainmail(), null, 3, 1, 1),
    new Character('A2', abilities(12, 16, 12), 24, 2, 30, Weapons.shortbow(), { x: 1, y: 6 }, 'A', Armors.leather(), null, 0, 3, 0),
    new Character('B1', abilities(18, 10, 14), 36, 6, 30, Weapons.greatsword(), { x: 10, y: 5 }, 'B', null, null, 5, 2, 2),
    new Character('B2', abilities(12, 16, 10), 24, 2, 30, Weapons.shortsword(), { x: 10, y: 6 }, 'B', Armors.leather(), null, 0, 3, 0, 2),
  ];
}

/** Plays one duel to its end and reports it the way the golden file stores it. */
export function runDuel(seed: number): GoldenDuel {
  const battle = new Battle(new Grid(ARENA_SIZE, ARENA_SIZE), new SeededRandom(seed), duelRoster());
  playToEnd(battle);
  return {
    seed,
    events: battle.log.map((entry) => entry.event),
    finalState: battle.combatants.map((c) => ({ name: c.name, hp: c.currentHitPoints, status: c.vitalStatus })),
    winningSide: battle.winningSide,
  };
}

/** The first `PRNG_DRAWS` d20 faces of a seed, the sequence `prng.json` stores. */
export function d20Sequence(seed: number, draws = PRNG_DRAWS): number[] {
  const rng = new SeededRandom(seed);
  return Array.from({ length: draws }, () => rng.next(1, 21));
}
