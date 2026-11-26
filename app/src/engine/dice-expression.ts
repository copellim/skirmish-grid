/**
 * Parsed dice notation in the form `NdS±M` (e.g. `1d8`, `2d6+3`, `1d20-1`). Count and Sides
 * are at least 1; the modifier may be negative or omitted. Port of `DiceExpression`
 * (the C# engine's DiceExpression.cs).
 */
export class DiceExpression {
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;

  constructor(count: number, sides: number, modifier: number) {
    if (count < 1) {
      throw new RangeError('Dice count must be at least 1.');
    }
    if (sides < 1) {
      throw new RangeError('Dice sides must be at least 1.');
    }

    this.count = count;
    this.sides = sides;
    this.modifier = modifier;
  }

  static parse(notation: string): DiceExpression {
    if (!notation || notation.trim().length === 0) {
      throw new Error('Dice notation is empty.');
    }

    const match = /^(\d+)?d(\d+)([+-]\d+)?$/i.exec(notation.replace(/ /g, ''));
    if (!match) {
      throw new Error(
        `'${notation}' is not valid dice notation (expected NdS, NdS+M or NdS-M).`,
      );
    }

    const count = match[1] !== undefined ? parseInt(match[1], 10) : 1;
    const sides = parseInt(match[2], 10);
    const modifier = match[3] !== undefined ? parseInt(match[3], 10) : 0;

    if (count < 1 || sides < 1) {
      throw new Error(`'${notation}' must have at least 1 die and 1 side.`);
    }

    return new DiceExpression(count, sides, modifier);
  }

  toString(): string {
    if (this.modifier === 0) {
      return `${this.count}d${this.sides}`;
    }
    const sign = this.modifier >= 0 ? '+' : '-';
    return `${this.count}d${this.sides}${sign}${Math.abs(this.modifier)}`;
  }
}
