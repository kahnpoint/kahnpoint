import { stepWalk } from "../../lib/grid/walk";
import type { Board, Cell, PadInput, Player } from "../core/types";
import { cellKey } from "../core/types";
import { stepHand } from "./hand";

export function createPlayer(tile: Cell): Player {
  return {
    position: { x: tile.x, y: tile.y },
    velocity: { x: 0, y: 0 },
    control: {
      moveHeldSeconds: 0,
      easeTarget: null,
      stampedTile: null,
      pickedTile: null,
      toggledTile: null,
    },
  };
}

export function stepPlayer(
  board: Board,
  player: Player,
  input: PadInput,
  seconds: number,
): void {
  stepHand(board, player, input);
  const isClosedCell = (cell: Cell): boolean =>
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= board.width ||
    cell.y >= board.height ||
    board.terrain.has(cellKey(cell));
  stepWalk(player, input.move, seconds, isClosedCell);
}
