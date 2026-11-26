import { describe, it, expect } from 'vitest';
import { DiceExpression } from '../src/engine/dice-expression';
import { rollDie, roll } from '../src/engine/dice';
import { rollD20Check } from '../src/engine/d20-check';
import { SequenceRandom } from '../src/engine/random';

describe('DiceExpression.parse', () => {
  it('parses NdS', () => {
    const e = DiceExpression.parse('2d6');
    expect([e.count, e.sides, e.modifier]).toEqual([2, 6, 0]);
  });

  it('parses NdS+M and NdS-M', () => {
    expect(DiceExpression.parse('1d8+3').modifier).toBe(3);
    expect(DiceExpression.parse('1d20-1').modifier).toBe(-1);
  });

  it('defaults a missing count to 1', () => {
    expect(DiceExpression.parse('d6').count).toBe(1);
  });

  it('round-trips through toString', () => {
    expect(DiceExpression.parse('2d6+3').toString()).toBe('2d6+3');
    expect(DiceExpression.parse('1d8').toString()).toBe('1d8');
    expect(DiceExpression.parse('1d20-1').toString()).toBe('1d20-1');
  });

  it('rejects junk', () => {
    expect(() => DiceExpression.parse('')).toThrow();
    expect(() => DiceExpression.parse('abc')).toThrow();
  });
});

describe('rollDie / roll', () => {
  it('rolls a single die in [1, sides]', () => {
    const rng = new SequenceRandom(4);
    expect(rollDie(rng, 6)).toBe(4);
  });

  it('sums every die plus the modifier', () => {
    const rng = new SequenceRandom(5, 2);
    expect(roll(rng, '2d6+3')).toBe(5 + 2 + 3);
  });

  it('accepts a notation string', () => {
    const rng = new SequenceRandom(8);
    expect(roll(rng, '1d8')).toBe(8);
  });
});

describe('rollD20Check', () => {
  it('returns natural roll and total', () => {
    const rng = new SequenceRandom(13);
    const result = rollD20Check(rng, 5);
    expect(result.naturalRoll).toBe(13);
    expect(result.total).toBe(18);
  });
});

describe('DiceExpression.parse — the awkward notations', () => {
  it.each([
    ['1d8', 1, 8, 0],
    ['2d6+3', 2, 6, 3],
    ['1d20-1', 1, 20, -1],
    ['D6', 1, 6, 0],
    ['  2d6 + 1  ', 2, 6, 1],
  ])('reads %s', (notation, count, sides, modifier) => {
    const expression = DiceExpression.parse(notation as string);
    expect([expression.count, expression.sides, expression.modifier]).toEqual([count, sides, modifier]);
  });

  it('normalises an implicit count and an upper-case d', () => {
    expect(DiceExpression.parse('D6').toString()).toBe('1d6');
  });

  it.each([[''], ['   '], ['abc'], ['0d6'], ['2d0'], ['2x6'], ['d']])('rejects %s', (notation) => {
    expect(() => DiceExpression.parse(notation as string)).toThrow();
  });
});

describe('rolling consumes exactly one draw per die', () => {
  it('draws three times for 3d6', () => {
    const random = new SequenceRandom(1, 2, 3);

    roll(random, '3d6');

    expect(random.drawCount).toBe(3);
  });

  it('subtracts a negative modifier from the sum', () => {
    expect(roll(new SequenceRandom(5, 2), '2d6-3')).toBe(4);
  });
});
