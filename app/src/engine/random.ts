/**
 * Source of randomness for all rule resolution. Single primitive so dice rolls are
 * reproducible: a seeded implementation makes fights deterministic, while a test double
 * can return a fixed sequence. Port of `IRandom` (the C# engine's IRandom.cs).
 */
export interface Random {
  /** Uniform integer in [minInclusive, maxExclusive). */
  next(minInclusive: number, maxExclusive: number): number;
}

const MASK_64 = (1n << 64n) - 1n;
const MASK_32 = 0xffffffffn;

// xorshift64* constants (Vigna). The multiplier scrambles the low bits the raw xorshift
// leaves weakly mixed.
const SCRAMBLE_MULTIPLIER = 0x2545f4914f6cdd1dn;

// Any non-zero start works; xorshift collapses permanently if the state ever hits 0.
const NON_ZERO_SEED_FALLBACK = 0x9e3779b97f4a7c15n;

const UINT32_MAX = 0xffffffff;

/**
 * Deterministic {@link Random} backed by a hand-rolled xorshift64* generator. A given seed
 * always yields the same sequence, independent of platform, so fights are fully reproducible.
 * Port of `SeededRandom` (the C# engine's SeededRandom.cs). The 64-bit state lives in a
 * `bigint` because JS `number` cannot hold the wrap-around arithmetic bit-for-bit.
 */
export class SeededRandom implements Random {
  private state: bigint;

  constructor(seed: number) {
    // Reinterpret the signed 32-bit seed as unsigned, matching C# `unchecked((ulong)seed)`.
    const unsignedSeed = BigInt.asUintN(64, BigInt(seed));
    this.state = unsignedSeed === 0n ? NON_ZERO_SEED_FALLBACK : unsignedSeed;
  }

  next(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      throw new RangeError(
        `maxExclusive (${maxExclusive}) must be greater than minInclusive (${minInclusive}).`,
      );
    }

    const range = maxExclusive - minInclusive;

    // Rejection sampling: discard the unevenly-covered tail so every value in the range is
    // equally likely (modulo alone would bias toward the low end).
    const rejectionLimit = UINT32_MAX - (UINT32_MAX % range);
    let sample: number;
    do {
      sample = this.nextUInt32();
    } while (sample >= rejectionLimit);

    return minInclusive + (sample % range);
  }

  private nextUInt32(): number {
    let s = this.state;
    s = (s ^ (s >> 12n)) & MASK_64;
    s = (s ^ (s << 25n)) & MASK_64;
    s = (s ^ (s >> 27n)) & MASK_64;
    this.state = s;
    const scrambled = ((s * SCRAMBLE_MULTIPLIER) & MASK_64) >> 32n;
    return Number(scrambled & MASK_32);
  }
}

/**
 * Test double that hands back a fixed sequence of die faces, so dice math can be asserted
 * exactly. Port of the NUnit `SequenceRandom` test helper.
 */
export class SequenceRandom implements Random {
  private readonly faces: number[];
  private cursor = 0;
  drawCount = 0;

  constructor(...faces: number[]) {
    this.faces = faces;
  }

  next(minInclusive: number, maxExclusive: number): number {
    if (this.cursor >= this.faces.length) {
      throw new Error('SequenceRandom ran out of queued faces.');
    }

    const face = this.faces[this.cursor++];
    if (face < minInclusive || face >= maxExclusive) {
      throw new Error(
        `Queued face ${face} is outside the requested range [${minInclusive}, ${maxExclusive}).`,
      );
    }

    this.drawCount++;
    return face;
  }
}
