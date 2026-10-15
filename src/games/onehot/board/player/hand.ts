import { cellKey, tileOf } from "../core/types";
import type { Board, Cell, PadInput, Player } from "../core/types";

export function stepHand(board: Board, player: Player, input: PadInput): void {
  const { control } = player;
  const { x: pick, b: drop, a: toggle } = input;
  const tile = tileOf(player.position);
  const key = cellKey(tile);
  const isNewTile = (last: Cell | null): boolean =>
    !last || last.x !== tile.x || last.y !== tile.y;

  if (!pick.held) control.pickedTile = null;
  else if (isNewTile(control.pickedTile)) {
    control.pickedTile = tile;
    if (board.gates.delete(key))
      board.cues.push({ type: "remove", cell: tile });
  }

  const stamp = (pressed: boolean): void => {
    if (!board.terrain.has(key) && !board.gates.has(key)) {
      board.gates.set(key, { id: board.nextGateId++, cell: tile });
      board.cues.push({ type: "stamp", cell: tile });
    } else if (pressed) {
      board.cues.push({ type: "refuse", cell: tile });
    }
  };

  if (!drop.held) control.stampedTile = null;
  else if (isNewTile(control.stampedTile)) {
    control.stampedTile = tile;
    stamp(drop.pressed);
  }

  if (!toggle.held) control.toggledTile = null;
  else if (isNewTile(control.toggledTile)) {
    control.toggledTile = tile;
    if (board.gates.delete(key))
      board.cues.push({ type: "remove", cell: tile });
    else stamp(toggle.pressed);
  }
}
