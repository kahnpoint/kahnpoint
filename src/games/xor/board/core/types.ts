import type { Cell, Direction, Vector } from "../../lib/grid/grid";
import type { WalkControl } from "../../lib/grid/walk";

export * from "../../lib/grid/grid";
export type { ButtonInput, PadInput } from "../../lib/input/pad";

export type Pattern = number;

export type Terrain =
  | { type: "source"; pattern: Pattern }
  | { type: "pillar" }
  | { type: "target"; pattern: Pattern; filled: number };

export type Gate = {
  id: number;
  cell: Cell;
};

export type Player = {
  position: Vector;
  velocity: Vector;
  control: PlayerControl;
};

export type PlayerControl = WalkControl & {
  stampedTile: Cell | null;
  pickedTile: Cell | null;
  toggledTile: Cell | null;
};

export type Board = {
  width: number;
  height: number;
  terrain: Map<string, Terrain>;
  gates: Map<string, Gate>;
  players: Player[];
  nextGateId: number;
  score: number;
  seconds: number;
  cues: Cue[];
};

export type Cue =
  | { type: "stamp" | "remove" | "refuse"; cell: Cell }
  | { type: "fill"; cell: Cell; from: Cell; pixel: number };

export type Take = {
  side: Direction;
  pattern: Pattern;
};

export type NodeState = {
  cell: Cell;
  wants: Pattern | null;
  gives: Pattern | null;
  lit: boolean;
  step: number | undefined;
  takes: Take[];
};

export type Evaluation = Map<string, NodeState>;
