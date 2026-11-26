import { describe, it, expect } from 'vitest';
import { SeededRandom, SequenceRandom } from '../src/engine/random';
import prngGolden from './golden/prng.json';

describe('SeededRandom reproduces its golden d20 sequences', () => {
  // The sequences were dumped from the C# engine's own xorshift64*; `npm run golden` regenerates
  // them from this one, byte for byte. Bit-exact determinism here is what every other golden test
  // stands on: same seed → same fight.
  for (const [seed, expected] of Object.entries(prngGolden as Record<string, number[]>)) {
    it(`seed ${seed} reproduces the C# d20 sequence`, () => {
      const rng = new SeededRandom(Number(seed));
      const actual = Array.from({ length: expected.length }, () => rng.next(1, 21));
      expect(actual).toEqual(expected);
    });
  }

  it('rejects an empty or inverted range', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.next(5, 5)).toThrow(RangeError);
    expect(() => rng.next(5, 1)).toThrow(RangeError);
  });
});

describe('SequenceRandom', () => {
  it('hands back queued faces in order and counts draws', () => {
    const rng = new SequenceRandom(3, 7, 1);
    expect(rng.next(1, 21)).toBe(3);
    expect(rng.next(1, 21)).toBe(7);
    expect(rng.next(1, 21)).toBe(1);
    expect(rng.drawCount).toBe(3);
  });

  it('throws when a queued face is out of range', () => {
    const rng = new SequenceRandom(25);
    expect(() => rng.next(1, 21)).toThrow();
  });

  it('throws when it runs out of faces', () => {
    const rng = new SequenceRandom();
    expect(() => rng.next(1, 21)).toThrow();
  });
});
