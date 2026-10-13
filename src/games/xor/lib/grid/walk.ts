import {
  BODY_ACROSS,
  OVERLAP_EPSILON,
  PERPENDICULAR_PULL,
  PERPENDICULAR_SNAP,
  REST_EPSILON,
  SETTLE_LOOKAHEAD,
  SETTLE_PULL,
  SETTLE_SNAP,
  TAP_SECONDS,
  TIME_EPSILON,
  WALK_DAMPING,
  WALK_SPEED,
} from "../../constants";
import { addCells, tileOf } from "./grid";
import type { Cell, Vector } from "./grid";

export type WalkControl = {
  moveHeldSeconds: number;
  easeTarget: Cell | null;
};

export type Walker = {
  position: Vector;
  velocity: Vector;
  control: WalkControl;
};

export type ClosedTest = (cell: Cell) => boolean;

type MovementMemory = {
  previousMove: Vector;
  startTile: Cell;
  tapEligible: boolean;
};

const MEMORY = new WeakMap<Walker, MovementMemory>();

function memoryOf(player: Walker): MovementMemory {
  let memory = MEMORY.get(player);
  if (!memory) {
    memory = {
      previousMove: { x: 0, y: 0 },
      startTile: tileOf(player.position),
      tapEligible: false,
    };
    MEMORY.set(player, memory);
  }
  return memory;
}

function moveAxis(
  isClosedCell: ClosedTest,
  player: Walker,
  axis: "x" | "y",
  delta: number,
): boolean {
  if (delta === 0) return false;
  const old = player.position[axis];
  if (bodyHitsTerrain(isClosedCell, player.position, axis)) {
    const error = Math.round(old) - old;
    const reach = Math.min(Math.abs(delta), Math.abs(error));
    player.position[axis] =
      reach === Math.abs(error)
        ? Math.round(old)
        : old + Math.sign(error) * reach;
    player.velocity[axis] = 0;
    return Math.sign(delta) !== Math.sign(error);
  }
  const next = old + delta;
  player.position[axis] = next;
  if (!bodyHitsTerrain(isClosedCell, player.position, axis)) return false;
  const limit =
    delta > 0
      ? Math.max(old, Math.floor(next))
      : Math.min(old, Math.ceil(next));
  player.position[axis] = limit + 0;
  player.velocity[axis] = 0;
  return true;
}

function overlappedCells(center: number, halfWidth: number): number[] {
  const low = Math.floor(center - halfWidth + 0.5 + OVERLAP_EPSILON);
  const high = Math.ceil(center + halfWidth - 0.5 - OVERLAP_EPSILON);
  const cells: number[] = [];
  for (let value = low; value <= high; value++) cells.push(value);
  return cells;
}

function bodyHitsTerrain(
  isClosedCell: ClosedTest,
  position: Vector,
  axis: "x" | "y",
): boolean {
  const halfX = axis === "x" ? 0.5 : BODY_ACROSS / 2;
  const halfY = axis === "y" ? 0.5 : BODY_ACROSS / 2;
  for (const x of overlappedCells(position.x, halfX)) {
    for (const y of overlappedCells(position.y, halfY)) {
      if (isClosedCell({ x, y })) return true;
    }
  }
  return false;
}

function driveHeldAxes(
  isClosedCell: ClosedTest,
  player: Walker,
  move: Vector,
  seconds: number,
  damping: number,
): void {
  const topSpeed = WALK_SPEED / Math.hypot(move.x, move.y);
  const decay = Math.exp(-damping * seconds);
  for (const axis of ["x", "y"] as const) {
    const target = move[axis] * topSpeed;
    player.velocity[axis] = target + (player.velocity[axis] - target) * decay;
  }
  for (const axis of ["x", "y"] as const) {
    moveAxis(isClosedCell, player, axis, player.velocity[axis] * seconds);
  }
  const heldAxes = (move.x !== 0 ? 1 : 0) + (move.y !== 0 ? 1 : 0);
  if (heldAxes !== 1) return;
  const other = move.x !== 0 ? "y" : "x";
  const error = Math.round(player.position[other]) - player.position[other];
  const pull =
    Math.abs(error) < PERPENDICULAR_SNAP ? error : error * PERPENDICULAR_PULL;
  const walked = Math.hypot(player.velocity.x, player.velocity.y) * seconds;
  const spare = Math.sqrt(
    Math.max(0, (WALK_SPEED * seconds) ** 2 - walked ** 2),
  );
  moveAxis(
    isClosedCell,
    player,
    other,
    Math.sign(pull) * Math.min(Math.abs(pull), spare),
  );
}

function isAtRest(player: Walker): boolean {
  const { position, velocity } = player;
  return (
    position.x === Math.round(position.x) &&
    position.y === Math.round(position.y) &&
    velocity.x === 0 &&
    velocity.y === 0
  );
}

function settleTargetAxis(position: number, velocity: number): number {
  let target = Math.round(position + SETTLE_LOOKAHEAD * velocity);
  if (velocity > 0 && target < position)
    target = Math.ceil(position - REST_EPSILON);
  if (velocity < 0 && target > position)
    target = Math.floor(position + REST_EPSILON);
  return target;
}

function chooseSettleTarget(isClosedCell: ClosedTest, player: Walker): Cell {
  const ahead = {
    x: settleTargetAxis(player.position.x, player.velocity.x),
    y: settleTargetAxis(player.position.y, player.velocity.y),
  };
  return !isClosedCell(ahead) ? ahead : tileOf(player.position);
}

type SettleResult = "arrived" | "moving" | "blocked";

function settleAxis(
  isClosedCell: ClosedTest,
  player: Walker,
  axis: "x" | "y",
  target: number,
  seconds: number,
  cap: number,
): SettleResult {
  const error = target - player.position[axis];
  if (error === 0) {
    player.velocity[axis] = 0;
    return "arrived";
  }
  const sign = Math.sign(error);
  const carry =
    Math.max(0, player.velocity[axis] * sign) *
    Math.exp(-WALK_DAMPING * seconds) *
    seconds;
  const step = Math.min(
    Math.abs(error),
    cap,
    Math.max(Math.abs(error) * SETTLE_PULL, carry),
  );
  const landing =
    Math.abs(error) - step < SETTLE_SNAP && Math.abs(error) <= cap;
  if (moveAxis(isClosedCell, player, axis, landing ? error : sign * step))
    return "blocked";
  if (landing) {
    player.position[axis] = target + 0;
    player.velocity[axis] = 0;
    return "arrived";
  }
  player.velocity[axis] = (sign * step) / seconds;
  return "moving";
}

function settleToCentre(
  isClosedCell: ClosedTest,
  player: Walker,
  seconds: number,
): void {
  if (!player.control.easeTarget) {
    if (isAtRest(player)) return;
    player.control.easeTarget = chooseSettleTarget(isClosedCell, player);
  }
  const target = player.control.easeTarget;
  const error = {
    x: target.x - player.position.x,
    y: target.y - player.position.y,
  };
  const reach =
    (WALK_SPEED * seconds) /
    Math.max(Math.hypot(error.x, error.y), REST_EPSILON);
  const xResult = settleAxis(
    isClosedCell,
    player,
    "x",
    target.x,
    seconds,
    Math.abs(error.x) * reach,
  );
  const yResult = settleAxis(
    isClosedCell,
    player,
    "y",
    target.y,
    seconds,
    Math.abs(error.y) * reach,
  );
  if (xResult === "arrived" && yResult === "arrived")
    player.control.easeTarget = null;
  else if (xResult === "blocked" || yResult === "blocked")
    player.control.easeTarget = null;
}

function startTapIfAny(
  isClosedCell: ClosedTest,
  player: Walker,
  previous: Vector,
): void {
  const { control } = player;
  const memory = memoryOf(player);
  if (
    !memory.tapEligible ||
    control.moveHeldSeconds >= TAP_SECONDS - TIME_EPSILON
  )
    return;
  const target = addCells(memory.startTile, { x: previous.x, y: previous.y });
  if (!isClosedCell(target)) control.easeTarget = target;
}

export function bodyFits(isClosedCell: ClosedTest, position: Vector): boolean {
  return (
    !bodyHitsTerrain(isClosedCell, position, "x") &&
    !bodyHitsTerrain(isClosedCell, position, "y")
  );
}

export function stepWalk(
  player: Walker,
  heldMove: Vector,
  seconds: number,
  isClosedCell: ClosedTest,
  damping = WALK_DAMPING,
): void {
  const memory = memoryOf(player);
  const { control } = player;
  const previous = memory.previousMove;
  const move = { x: Math.sign(heldMove.x), y: Math.sign(heldMove.y) };
  const anyHeld = move.x !== 0 || move.y !== 0;
  const wasHeld = previous.x !== 0 || previous.y !== 0;

  if (anyHeld) {
    if (!wasHeld) {
      memory.startTile = control.easeTarget ?? tileOf(player.position);
      memory.tapEligible = (move.x !== 0) !== (move.y !== 0);
      control.moveHeldSeconds = 0;
    } else if (move.x !== previous.x || move.y !== previous.y) {
      memory.tapEligible = false;
    }
    control.easeTarget = null;
    control.moveHeldSeconds += seconds;
    driveHeldAxes(isClosedCell, player, move, seconds, damping);
  } else {
    if (wasHeld) {
      startTapIfAny(isClosedCell, player, previous);
      control.moveHeldSeconds = 0;
    }
    settleToCentre(isClosedCell, player, seconds);
  }
  memory.previousMove = move;
}
