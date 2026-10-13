export type Vector = { x: number; y: number };

export type Cell = { x: number; y: number };

export type Direction = "right" | "down" | "left" | "up";

export const DIRECTIONS: readonly Direction[] = ["right", "down", "left", "up"];

export const DIRECTION_STEP: Readonly<Record<Direction, Cell>> = {
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
};

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

export function addCells(a: Cell, b: Cell): Cell {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function isSameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function tileOf(position: Vector): Cell {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}
