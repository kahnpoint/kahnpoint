import { DEMO_HEIGHT, DEMO_WIDTH } from "../../constants";
import { createPlayer } from "../player";
import { sourcePatternsOf } from "./patterns";
import { cellKey } from "./types";
import type { Board, Cell, Pattern, Terrain } from "./types";

const SOURCES = sourcePatternsOf();
const LAST = SOURCES.rows.length - 1;

export const columnSourceCell = (band: number): Cell => ({
  x: 14 + 2 * band,
  y: 10,
});
export const rowSourceCell = (band: number): Cell => ({
  x: 12,
  y: 12 + 2 * band,
});

export const DEMO_SOURCES: readonly { cell: Cell; pattern: Pattern }[] = [
  ...SOURCES.columns.map((pattern, band) => ({
    cell: columnSourceCell(band),
    pattern,
  })),
  ...SOURCES.rows.map((pattern, band) => ({
    cell: rowSourceCell(band),
    pattern,
  })),
];

export const DEMO_TARGETS: readonly { cell: Cell; pattern: Pattern }[] = [
  { cell: { x: 14, y: 20 }, pattern: SOURCES.columns[0]! ^ SOURCES.rows[0]! },
  {
    cell: { x: 20 + 2 * LAST, y: 12 + 2 * LAST },
    pattern: SOURCES.columns[LAST]! ^ SOURCES.rows[LAST]!,
  },
  { cell: { x: 15, y: 4 }, pattern: SOURCES.columns[0]! ^ SOURCES.columns[1]! },
  { cell: { x: 6, y: 13 }, pattern: SOURCES.rows[0]! ^ SOURCES.rows[1]! },
];

const DEMO_START: Cell = { x: 15, y: 13 };

export function createDemoBoard(): Board {
  const terrain = new Map<string, Terrain>();
  for (const source of DEMO_SOURCES)
    terrain.set(cellKey(source.cell), {
      type: "source",
      pattern: source.pattern,
    });
  for (const target of DEMO_TARGETS)
    terrain.set(cellKey(target.cell), {
      type: "target",
      pattern: target.pattern,
      filled: 0,
    });
  return {
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
    terrain,
    gates: new Map(),
    players: [createPlayer(DEMO_START)],
    nextGateId: 1,
    score: 0,
    seconds: 0,
    cues: [],
  };
}
