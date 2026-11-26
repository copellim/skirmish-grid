// Writes the golden transcripts in `test/golden/`: the duel transcripts and the d20 sequences the
// parity tests assert against. Run it with `npm run golden`.
//
// These files were originally dumped from the C# engine, which was the parity oracle. That engine is
// gone, so they are no longer parity with anything external: they are a regression snapshot of this
// engine, seeded by the last state the two engines agreed on. A rule change that shifts a fight will
// show up here as a diff — regenerating is how you accept it, and the diff belongs in the commit that
// changed the rule, explained. Regenerating to make a red test green is how the snapshot loses its
// meaning.
//
// The fight itself lives in `test/support/duel.ts`, shared with `test/duel-parity.test.ts`.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DUEL_SEEDS, PRNG_SEEDS, d20Sequence, runDuel, type GoldenDuel } from '../test/support/duel';

// Compiled to `tools/.build/tools/`, so the app directory is three levels up (see tools/tsconfig.json).
const GOLDEN_DIRECTORY = join(__dirname, '..', '..', '..', 'test', 'golden');

/** One duel per line: the transcripts are long, and a line-per-fight diff stays readable. */
function formatDuels(duels: GoldenDuel[]): string {
  return `[\n${duels.map((duel) => `  ${JSON.stringify(duel)}`).join(',\n')}\n]\n`;
}

/** One seed per line, its faces inline — same reason. */
function formatSequences(sequences: Map<number, number[]>): string {
  const lines = [...sequences].map(([seed, faces]) => `  "${seed}": [${faces.join(',')}]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

function write(fileName: string, content: string): void {
  const path = join(GOLDEN_DIRECTORY, fileName);
  writeFileSync(path, content, 'utf8');
  console.log(`wrote ${path}`);
}

write('duel.json', formatDuels(DUEL_SEEDS.map(runDuel)));
write('prng.json', formatSequences(new Map(PRNG_SEEDS.map((seed) => [seed, d20Sequence(seed)]))));
