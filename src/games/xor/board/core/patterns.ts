import { PATTERN_SIDE } from "../../constants";
import type { Pattern } from "./types";

const PIXEL_COUNT = PATTERN_SIDE * PATTERN_SIDE;
const MIDDLE = Math.floor(PATTERN_SIDE / 2);

export const EMPTY_PATTERN: Pattern = 0;
export const FULL_PATTERN: Pattern = 2 ** PIXEL_COUNT - 1;
export const LEFT_COLUMN_PATTERN: Pattern = bandPatternOf("column", 0, 1);
export const TOP_ROW_PATTERN: Pattern = bandPatternOf("row", 0, 1);
export const CENTRE_PATTERN: Pattern = 1 << (MIDDLE * PATTERN_SIDE + MIDDLE);

function bandPatternOf(
  across: "row" | "column",
  first: number,
  width: number,
  side = PATTERN_SIDE,
): Pattern {
  let pattern = 0;
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const place = across === "row" ? row : column;
      if (place >= first && place < first + width)
        pattern |= 1 << (row * side + column);
    }
  }
  return pattern;
}

export function sourcePatternsOf(side = PATTERN_SIDE): {
  rows: Pattern[];
  columns: Pattern[];
} {
  const bands = Math.ceil((side + 1) / 2);
  const width = side - bands + 1;
  const firsts = Array.from({ length: bands }, (_, band) => band);
  return {
    rows: firsts.map((first) => bandPatternOf("row", first, width, side)),
    columns: firsts.map((first) => bandPatternOf("column", first, width, side)),
  };
}

export function combinePatterns(patterns: readonly Pattern[]): Pattern {
  let seen = 0;
  let seenTwice = 0;
  for (const pattern of patterns) {
    seenTwice |= seen & pattern;
    seen |= pattern;
  }
  return seen & ~seenTwice;
}

export function pixelCountOf(pattern: Pattern): number {
  let count = 0;
  for (let rest = pattern; rest !== 0; rest &= rest - 1) count++;
  return count;
}

export function isPixelLit(
  pattern: Pattern,
  row: number,
  column: number,
): boolean {
  return ((pattern >> (row * PATTERN_SIDE + column)) & 1) === 1;
}
