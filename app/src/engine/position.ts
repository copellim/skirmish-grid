/** A square on the battle grid, in 5-foot tiles. Port of the `Position` record struct. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

export function position(x: number, y: number): Position {
  return { x, y };
}

/** Structural equality — C# records compare by value; JS objects do not. */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}
