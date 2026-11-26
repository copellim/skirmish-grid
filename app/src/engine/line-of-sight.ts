import type { Position } from './position';
import { positionsEqual } from './position';

/**
 * The squares a straight move crosses between two positions, in order, endpoints excluded
 * (Bresenham). One walk for every rule that cares about the route: the charge's line of approach
 * and the withdraw's threatened squares. Port of `LineOfSight`.
 */
export function squaresBetween(start: Position, end: Position): Position[] {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const stepX = Math.sign(end.x - start.x);
  const stepY = Math.sign(end.y - start.y);
  let error = dx - dy;

  const crossed: Position[] = [];
  let current = start;
  while (!positionsEqual(current, end)) {
    const doubledError = error * 2;
    if (doubledError > -dy) {
      error -= dy;
      current = { x: current.x + stepX, y: current.y };
    } else if (doubledError < dx) {
      error += dx;
      current = { x: current.x, y: current.y + stepY };
    }

    if (!positionsEqual(current, end)) {
      crossed.push(current);
    }
  }
  return crossed;
}

/**
 * Grid line-of-sight: reports whether the straight line between two squares is clear. Endpoints are
 * excluded; a square is blocked per the supplied predicate. Used for the charge line of approach.
 */
export function isLineOfSightClear(
  start: Position,
  end: Position,
  isBlocked: (position: Position) => boolean,
): boolean {
  return !squaresBetween(start, end).some((square) => isBlocked(square));
}
