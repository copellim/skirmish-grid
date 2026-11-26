import type { Position } from './position';

/**
 * A rectangular battle grid of 5-foot squares. Movement follows the SRD 3.5 alternating diagonal
 * rule: the first diagonal costs 5 ft, the next 10 ft, then 5, and so on. Port of `Grid`.
 */
export class Grid {
  private static readonly FEET_PER_SQUARE = 5;
  private static readonly FEET_PER_DIAGONAL_PAIR = Grid.FEET_PER_SQUARE * 3; // 5 + 10

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    if (width < 1) {
      throw new RangeError('Grid width must be at least 1.');
    }
    if (height < 1) {
      throw new RangeError('Grid height must be at least 1.');
    }
    this.width = width;
    this.height = height;
  }

  contains(position: Position): boolean {
    return (
      position.x >= 0 && position.x < this.width && position.y >= 0 && position.y < this.height
    );
  }

  static movementCost(from: Position, to: Position): number {
    const horizontal = Math.abs(to.x - from.x);
    const vertical = Math.abs(to.y - from.y);

    const diagonalSteps = Math.min(horizontal, vertical);
    const straightSteps = Math.abs(horizontal - vertical);

    // Each diagonal pair (5 + 10) costs 15 ft; a leftover odd diagonal is the cheap 5 ft one.
    const diagonalCost =
      Math.floor(diagonalSteps / 2) * Grid.FEET_PER_DIAGONAL_PAIR +
      (diagonalSteps % 2) * Grid.FEET_PER_SQUARE;

    return straightSteps * Grid.FEET_PER_SQUARE + diagonalCost;
  }

  static areAdjacent(a: Position, b: Position): boolean {
    if (a.x === b.x && a.y === b.y) {
      return false;
    }
    return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  }
}
