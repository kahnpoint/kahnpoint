import { combinePatterns } from "../core/patterns";
import { cellKey, DIRECTIONS } from "../core/types";
import type {
  Board,
  Cell,
  Direction,
  Evaluation,
  Pattern,
  Take,
} from "../core/types";
import { seenFrom } from "./sight";

type GraphNode = {
  key: string;
  cell: Cell;
  source: Pattern | null;
  target: Pattern | null;
  seen: SeenNode[];
};

type SeenNode = { side: Direction; node: GraphNode };

function buildGraph(board: Board): GraphNode[] {
  const nodes = new Map<string, GraphNode>();
  for (const [key, terrain] of board.terrain) {
    if (terrain.type === "pillar") continue;
    const [x, y] = key.split(",").map(Number);
    const isSource = terrain.type === "source";
    nodes.set(key, {
      key,
      cell: { x, y },
      source: isSource ? terrain.pattern : null,
      target: isSource ? null : terrain.pattern,
      seen: [],
    });
  }
  for (const [key, gate] of board.gates) {
    if (!nodes.has(key))
      nodes.set(key, {
        key,
        cell: gate.cell,
        source: null,
        target: null,
        seen: [],
      });
  }
  for (const node of nodes.values()) {
    if (node.source !== null) continue;
    for (const side of DIRECTIONS) {
      const target = seenFrom(board, node.cell, side);
      const found = target ? nodes.get(cellKey(target)) : undefined;
      if (found) node.seen.push({ side, node: found });
    }
  }
  return [...nodes.values()];
}

export function evaluateBoard(board: Board): Evaluation {
  const graph = buildGraph(board);
  const steps = new Map<string, number>();
  const given = new Map<string, Pattern>();
  const takes = new Map<string, Take[]>();
  const settledGives = new Map<string, Pattern>();
  const fedTargets = new Set<string>();
  for (const node of graph) {
    if (node.source === null) continue;
    steps.set(node.key, 0);
    given.set(node.key, node.source);
  }
  const giversSeen = (node: GraphNode, below = Infinity): SeenNode[] =>
    node.seen.filter(
      (entry) =>
        given.has(entry.node.key) &&
        (steps.get(entry.node.key) as number) < below,
    );
  const feedersOf = (node: GraphNode, below = Infinity): SeenNode[] =>
    giversSeen(node, below).filter(
      (entry) =>
        node.target === null || given.get(entry.node.key) === node.target,
    );
  const takeOf = (entry: SeenNode, pattern: Pattern): Take => ({
    side: entry.side,
    pattern,
  });
  const inSideOrder = (list: Take[]): Take[] =>
    list.sort(
      (a, b) => DIRECTIONS.indexOf(a.side) - DIRECTIONS.indexOf(b.side),
    );

  for (;;) {
    let step = Infinity;
    let batch: GraphNode[] = [];
    for (const node of graph) {
      if (node.source !== null || steps.has(node.key)) continue;
      const givers = feedersOf(node);
      if (givers.length === 0) continue;
      const candidate =
        1 +
        Math.min(...givers.map((entry) => steps.get(entry.node.key) as number));
      if (candidate < step) {
        step = candidate;
        batch = [node];
      } else if (candidate === step) {
        batch.push(node);
      }
    }
    if (batch.length === 0) break;
    for (const node of batch) {
      steps.set(node.key, step);
      if (node.target !== null) {
        takes.set(
          node.key,
          inSideOrder(
            feedersOf(node, step).map((entry) =>
              takeOf(entry, node.target as Pattern),
            ),
          ),
        );
        fedTargets.add(node.key);
        continue;
      }
      const lower = giversSeen(node, step);
      const patterns = lower.map(
        (entry) => given.get(entry.node.key) as Pattern,
      );
      takes.set(
        node.key,
        inSideOrder(
          lower.map((entry, index) =>
            takeOf(entry, patterns[index] as Pattern),
          ),
        ),
      );
      settledGives.set(node.key, combinePatterns(patterns));
    }
    for (const node of batch) {
      if (node.target === null)
        given.set(node.key, settledGives.get(node.key) as Pattern);
    }
  }

  const evaluation: Evaluation = new Map();
  for (const node of graph) {
    const gives = given.get(node.key) ?? null;
    evaluation.set(node.key, {
      cell: node.cell,
      wants: node.target,
      gives,
      lit: gives !== null || fedTargets.has(node.key),
      step: steps.get(node.key),
      takes: takes.get(node.key) ?? [],
    });
  }
  return evaluation;
}
