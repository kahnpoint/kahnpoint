import { STREAM_CELLS_PER_SECOND, STREAM_SPACING_CELLS } from "../../constants";
import { pixelCountOf } from "../core/patterns";
import { cellKey, tileOf } from "../core/types";
import type {
  Board,
  Cell,
  Evaluation,
  NodeState,
  Pattern,
} from "../core/types";
import { evaluateBoard } from "./evaluate";
import { seenFrom } from "./sight";

function isOpenCell(board: Board, cell: Cell): boolean {
  if (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= board.width ||
    cell.y >= board.height
  )
    return false;
  const key = cellKey(cell);
  return !board.terrain.has(key) && !board.gates.has(key);
}

export type Flow = { pattern: Pattern; giver: Cell; taker: Cell };

export function flowsOf(board: Board, evaluation: Evaluation): Flow[] {
  const flows: Flow[] = [];
  for (const node of evaluation.values()) {
    for (const take of node.takes) {
      const giver = seenFrom(board, node.cell, take.side);
      if (giver) flows.push({ pattern: take.pattern, giver, taker: node.cell });
    }
  }
  return flows;
}

export type TogglePreview = {
  removes: boolean;
  gives: Pattern | null;
  flows: Flow[];
  removed: Flow[];
  changed: NodeState[];
};

export const flowKey = (flow: Flow): string =>
  `${cellKey(flow.giver)}>${cellKey(flow.taker)}:${flow.pattern}`;

export function togglePreviewOf(
  board: Board,
  evaluation: Evaluation,
  cell: Cell,
): TogglePreview | null {
  const key = cellKey(cell);
  const removes = board.gates.has(key);
  if (!removes && !isOpenCell(board, cell)) return null;
  const gates = new Map(board.gates);
  if (removes) gates.delete(key);
  else gates.set(key, { id: 0, cell });
  const imagined: Board = { ...board, gates };
  const after = evaluateBoard(imagined);
  const now = flowsOf(board, evaluation);
  const then = flowsOf(imagined, after);
  const existing = new Set(now.map(flowKey));
  const remaining = new Set(then.map(flowKey));
  const flows = then.filter((flow) => !existing.has(flowKey(flow)));
  const removed = now.filter((flow) => !remaining.has(flowKey(flow)));
  const changed: NodeState[] = [];
  for (const [nodeKey, node] of after) {
    const before = evaluation.get(nodeKey);
    if (before && (before.gives !== node.gives || before.lit !== node.lit))
      changed.push(node);
  }
  return {
    removes,
    gives: after.get(key)?.gives ?? null,
    flows,
    removed,
    changed,
  };
}

function freshWantsOf(board: Board): Pattern[] {
  const sources: Pattern[] = [];
  const wanted = new Set<Pattern>();
  for (const terrain of board.terrain.values()) {
    if (terrain.type === "source") sources.push(terrain.pattern);
    if (terrain.type === "target") wanted.add(terrain.pattern);
  }
  const fresh = new Set<Pattern>();
  for (let chosen = 1; chosen < 1 << sources.length; chosen++) {
    if ((chosen & (chosen - 1)) === 0) continue;
    const pattern = sources.reduce(
      (made, source, index) => (chosen & (1 << index) ? made ^ source : made),
      0,
    );
    if (pattern !== 0 && !wanted.has(pattern) && !sources.includes(pattern))
      fresh.add(pattern);
  }
  return [...fresh];
}

function arrivalsBetween(cells: number, from: number, to: number): number {
  const reached = (seconds: number): number =>
    Math.floor(
      (seconds * STREAM_CELLS_PER_SECOND - (cells - 0.5)) /
        STREAM_SPACING_CELLS,
    );
  return reached(to) - reached(from);
}

export function fillTargets(
  board: Board,
  evaluation: Evaluation,
  seconds: number,
  random: () => number,
): Cell[] {
  const arrived: Cell[] = [];
  for (const [key, node] of evaluation) {
    const target = board.terrain.get(key);
    if (target?.type !== "target" || !node.lit) continue;
    const pixels = pixelCountOf(target.pattern);
    let moves = false;
    for (const take of node.takes) {
      const from = seenFrom(board, node.cell, take.side) as Cell;
      const cells =
        Math.abs(from.x - node.cell.x) + Math.abs(from.y - node.cell.y);
      for (
        let left = arrivalsBetween(
          cells,
          board.seconds,
          board.seconds + seconds,
        );
        left > 0;
        left--
      ) {
        if (target.filled >= pixels) {
          moves = true;
          continue;
        }
        let pixel = 0;
        for (let skip = target.filled; ; pixel++) {
          if (!(target.pattern & (1 << pixel))) continue;
          if (skip-- === 0) break;
        }
        target.filled++;
        board.score++;
        board.cues.push({ type: "fill", cell: node.cell, from, pixel });
      }
    }
    if (!moves) continue;
    const taken = new Set(
      board.players.map((player) => cellKey(tileOf(player.position))),
    );
    const open: Cell[] = [];
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        if (isOpenCell(board, { x, y }) && !taken.has(cellKey({ x, y })))
          open.push({ x, y });
      }
    }
    const cell = open[Math.floor(random() * open.length)];
    if (!cell) continue;
    const wants = freshWantsOf(board);
    board.terrain.delete(key);
    board.terrain.set(cellKey(cell), {
      type: "target",
      pattern: wants[Math.floor(random() * wants.length)] ?? target.pattern,
      filled: 0,
    });
    arrived.push(cell);
  }
  return arrived;
}
