import { cellKey, DIRECTION_STEP } from "../core/types";
import type { Board, Cell, Direction } from "../core/types";

export function occupantAt(
  board: Board,
  cell: Cell,
): "terrain" | "gate" | null {
  if (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= board.width ||
    cell.y >= board.height
  )
    return "terrain";
  const key = cellKey(cell);
  const terrain = board.terrain.get(key);
  if (terrain) return "terrain";
  return board.gates.has(key) ? "gate" : null;
}

export function seenFrom(board: Board, cell: Cell, direction: Direction): Cell {
  const step = DIRECTION_STEP[direction];
  for (let distance = 1; ; distance += 1) {
    const target = {
      x: cell.x + step.x * distance,
      y: cell.y + step.y * distance,
    };
    if (occupantAt(board, target) !== null) return target;
  }
}
