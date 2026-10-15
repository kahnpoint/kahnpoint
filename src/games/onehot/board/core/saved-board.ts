import { DEMO_HEIGHT, DEMO_WIDTH, PATTERN_SIDE } from "../../constants";
import { createPlayer } from "../player";
import { createDemoBoard, DEMO_SOURCES } from "./demo-board";
import { pixelCountOf } from "./patterns";
import { TARGETS_PER_STAGE, TOTAL_LEVELS } from "./target-patterns";
import { cellKey, tileOf } from "./types";
import type { Board, Cell, Gate, Pattern, Terrain, Vector } from "./types";

export const SAVED_BOARD_STORAGE_KEY = "onehot.saved-board";

const SAVE_VERSION = 1;
const PIXEL_COUNT = PATTERN_SIDE * PATTERN_SIDE;
const MAX_PATTERN = 2 ** PIXEL_COUNT - 1;
type BoardMode = "levels" | "complete" | "endless";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type SavedTerrain = [string, Terrain][];
type SavedGate = [string, Gate][];

type SavedBoard = {
  version: number;
  mode: BoardMode;
  width: number;
  height: number;
  terrain: SavedTerrain;
  gates: SavedGate;
  player: Vector;
  score: number;
  completedTargets: number;
  seconds: number;
  nextGateId: number;
};

function storageOrNull(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerIn(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function isCell(value: unknown, width: number, height: number): value is Cell {
  return (
    isRecord(value) &&
    isIntegerIn(value.x, 0, width - 1) &&
    isIntegerIn(value.y, 0, height - 1)
  );
}

function isPosition(
  value: unknown,
  width: number,
  height: number,
): value is Vector {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number"
  )
    return false;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return false;
  return (
    value.x >= 0 &&
    value.y >= 0 &&
    value.x < width &&
    value.y < height &&
    isCell(tileOf(value), width, height)
  );
}

function isPattern(value: unknown): value is Pattern {
  return isIntegerIn(value, 0, MAX_PATTERN);
}

function isTerrain(value: unknown): value is Terrain {
  if (!isRecord(value)) return false;
  if (value.type === "source") return isPattern(value.pattern);
  if (value.type === "target") {
    return (
      isPattern(value.pattern) &&
      value.pattern !== 0 &&
      isIntegerIn(value.filled, 0, pixelCountOf(value.pattern))
    );
  }
  return false;
}

function isSavedEntries<T>(value: unknown): value is [string, T][] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string",
    )
  );
}

function isValidSavedBoard(value: unknown): value is SavedBoard {
  if (!isRecord(value)) return false;
  if (
    value.version !== SAVE_VERSION ||
    (value.mode !== "levels" &&
      value.mode !== "complete" &&
      value.mode !== "endless") ||
    value.width !== DEMO_WIDTH ||
    value.height !== DEMO_HEIGHT ||
    !isSavedEntries(value.terrain) ||
    !isSavedEntries(value.gates) ||
    !isPosition(value.player, DEMO_WIDTH, DEMO_HEIGHT) ||
    !isIntegerIn(value.score, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntegerIn(value.completedTargets, 0, Number.MAX_SAFE_INTEGER) ||
    typeof value.seconds !== "number" ||
    !Number.isFinite(value.seconds) ||
    value.seconds < 0 ||
    !isIntegerIn(value.nextGateId, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }
  const finished = value.completedTargets >= TARGETS_PER_STAGE * TOTAL_LEVELS;
  if ((value.mode === "levels") === finished) return false;

  const terrain = value.terrain;
  const terrainByKey = new Map<string, Terrain>();
  let targetCount = 0;
  for (const [key, tile] of terrain) {
    if (!isTerrain(tile) || terrainByKey.has(key)) return false;
    const [xText, yText, ...rest] = key.split(",");
    if (rest.length > 0) return false;
    const cell = { x: Number(xText), y: Number(yText) };
    if (!isCell(cell, DEMO_WIDTH, DEMO_HEIGHT) || cellKey(cell) !== key)
      return false;
    terrainByKey.set(key, tile);
    if (tile.type === "target") targetCount++;
  }
  if (targetCount !== 4) return false;
  for (const source of DEMO_SOURCES) {
    const tile = terrainByKey.get(cellKey(source.cell));
    if (tile?.type !== "source" || tile.pattern !== source.pattern)
      return false;
  }
  if (
    [...terrainByKey.values()].filter((tile) => tile.type === "source")
      .length !== DEMO_SOURCES.length
  )
    return false;

  const gateEntries = value.gates;
  const ids = new Set<number>();
  const gateCells = new Set<string>();
  let maxGateId = 0;
  for (const [key, gate] of gateEntries) {
    if (!isRecord(gate) || !isIntegerIn(gate.id, 1, Number.MAX_SAFE_INTEGER))
      return false;
    if (
      !isCell(gate.cell, DEMO_WIDTH, DEMO_HEIGHT) ||
      cellKey(gate.cell) !== key
    )
      return false;
    if (terrainByKey.has(key) || gateCells.has(key) || ids.has(gate.id))
      return false;
    gateCells.add(key);
    ids.add(gate.id);
    maxGateId = Math.max(maxGateId, gate.id);
  }
  if (value.nextGateId <= maxGateId) return false;

  const playerCellKey = cellKey(tileOf(value.player));
  return !terrainByKey.has(playerCellKey);
}

export function loadBoard(storage?: StorageLike): Board | null {
  const targetStorage = storageOrNull(storage);
  if (!targetStorage) return null;
  try {
    const raw = targetStorage.getItem(SAVED_BOARD_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSavedBoard(parsed)) return null;

    const board = createDemoBoard(() => 0);
    board.terrain = new Map(
      parsed.terrain.map(([key, tile]) => [key, { ...tile }]),
    );
    board.gates = new Map(
      parsed.gates.map(([key, gate]) => [
        key,
        { id: gate.id, cell: { ...gate.cell } },
      ]),
    );
    board.players = [createPlayer(tileOf(parsed.player))];
    board.players[0]!.position = { ...parsed.player };
    board.width = parsed.width;
    board.height = parsed.height;
    board.nextGateId = parsed.nextGateId;
    board.score = parsed.score;
    board.completedTargets = parsed.completedTargets;
    board.seconds = parsed.seconds;
    board.cues = [];
    board.mode = parsed.mode;
    return board;
  } catch {
    return null;
  }
}

export function saveBoard(board: Board, storage?: StorageLike): boolean {
  const targetStorage = storageOrNull(storage);
  if (!targetStorage) return false;
  try {
    const saved: SavedBoard = {
      version: SAVE_VERSION,
      mode: board.mode,
      width: board.width,
      height: board.height,
      terrain: [...board.terrain].map(([key, tile]) => [key, { ...tile }]),
      gates: [...board.gates].map(([key, gate]) => [
        key,
        { id: gate.id, cell: { ...gate.cell } },
      ]),
      player: { ...board.players[0]!.position },
      score: board.score,
      completedTargets: board.completedTargets,
      seconds: board.seconds,
      nextGateId: board.nextGateId,
    };
    targetStorage.setItem(SAVED_BOARD_STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedBoard(storage?: StorageLike): boolean {
  const targetStorage = storageOrNull(storage);
  if (!targetStorage) return false;
  try {
    targetStorage.removeItem(SAVED_BOARD_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
