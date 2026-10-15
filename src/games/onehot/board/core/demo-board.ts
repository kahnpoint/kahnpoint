import { DEMO_HEIGHT, DEMO_WIDTH } from "../../constants";
import { createPlayer } from "../player";
import { sourcePatternsOf } from "./patterns";
import { chooseTargetPattern } from "./target-patterns";
import { cellKey } from "./types";
import type { Board, Cell, Pattern, Terrain } from "./types";

const SOURCES = sourcePatternsOf();
const SOURCE_CELLS: readonly Cell[] = [
  { x: 12, y: 12 },
  { x: 20, y: 12 },
  { x: 12, y: 20 },
  { x: 20, y: 20 },
  { x: 16, y: 16 },
];

export const DEMO_SOURCES: readonly { cell: Cell; pattern: Pattern }[] = [
  ...SOURCES.map((pattern, index) => ({
    cell: SOURCE_CELLS[index]!,
    pattern,
  })),
];

const TARGET_CELLS: readonly Cell[] = [
  { x: 6, y: 6 },
  { x: 25, y: 6 },
  { x: 6, y: 25 },
  { x: 25, y: 25 },
];

const DEMO_START: Cell = { x: 15, y: 13 };

export function createDemoBoard(random: () => number = Math.random): Board {
  const terrain = new Map<string, Terrain>();
  for (const source of DEMO_SOURCES)
    terrain.set(cellKey(source.cell), {
      type: "source",
      pattern: source.pattern,
    });
  const wantedPatterns: Pattern[] = [];
  for (const cell of TARGET_CELLS) {
    const pattern = chooseTargetPattern(0, random, wantedPatterns);
    wantedPatterns.push(pattern);
    terrain.set(cellKey(cell), {
      type: "target",
      pattern,
      filled: 0,
    });
  }
  return {
    mode: "levels",
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
    terrain,
    gates: new Map(),
    players: [createPlayer(DEMO_START)],
    nextGateId: 1,
    score: 0,
    completedTargets: 0,
    seconds: 0,
    cues: [],
  };
}
