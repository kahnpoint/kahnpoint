import { FIXED_STEP_SECONDS, PLACE_LABEL, REMOVE_LABEL } from "../../constants";
import { blendVectors, StepScene } from "../../lib/engine/step-scene";
import type { FrameClock } from "../../lib/engine/step-scene";
import { MOVE_KEYS } from "../../lib/input/keyboard-input";
import { neutralPadInput } from "../../lib/input/pad";
import type { PadOverride } from "../../lib/input/pad";
import { createDemoBoard } from "../core/demo-board";
import { clearSavedBoard, loadBoard, saveBoard } from "../core/saved-board";
import { targetLevelFor, TOTAL_LEVELS } from "../core/target-patterns";
import { cellKey, tileOf } from "../core/types";
import type { Board, Cell, Evaluation, PadInput, Vector } from "../core/types";
import { stepPlayer } from "../player";
import { evaluateBoard, fillTargets, togglePreviewOf } from "../rules";
import type { TogglePreview } from "../rules";
import { BoardDrawing } from "./board-drawing";

const BOARD_KEYS = { ...MOVE_KEYS, Q: "b", E: "x", X: "a" } as const;
const TOUCH_BUTTONS = [
  { button: "b", label: PLACE_LABEL, row: 1 },
  { button: "x", label: REMOVE_LABEL, row: 0 },
] as const;

export type BoardHandle = {
  board: Board;
  readonly evaluation: Evaluation;
  readonly playerScreen: Vector;
  press: (input: PadOverride, steps: number) => void;
  restartGame: () => void;
  continueEndless: () => void;
};

declare global {
  interface Window {
    __board?: BoardHandle;
  }
}

export class BoardScene extends StepScene {
  private board = loadBoard() ?? createDemoBoard();
  private lastSavedSeconds = 0;
  private lastHudState = "";
  private evaluation: Evaluation = new Map();
  private preview: TogglePreview | null = null;
  private toggledTile: Cell | null = null;
  private drawing!: BoardDrawing;
  private previousPositions: Vector[] = [];
  private heldMove: Vector = { x: 0, y: 0 };

  constructor() {
    super({ key: "BoardScene" });
  }

  create(): void {
    this.drawing = new BoardDrawing(this);
    this.previousPositions = this.board.players.map((each) => ({
      ...each.position,
    }));
    this.evaluation = evaluateBoard(this.board);
    this.startInput(BOARD_KEYS, TOUCH_BUTTONS);
    this.showUsableButtons();

    const scene = this;
    window.__board = {
      get board() {
        return scene.board;
      },
      get evaluation() {
        return scene.evaluation;
      },
      get playerScreen() {
        return scene.drawing.playerScreen;
      },
      press: (input, steps) => this.press(input, steps),
      restartGame: () => this.restartGame(),
      continueEndless: () => this.continueEndless(),
    };
    const teardown = new AbortController();
    const persist = (): void => {
      saveBoard(this.board);
    };
    window.addEventListener("pagehide", persist, { signal: teardown.signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) persist();
      },
      { signal: teardown.signal },
    );
    this.events.once("destroy", () => {
      persist();
      teardown.abort();
    });
    saveBoard(this.board);
    this.updateHud();
  }

  private restartGame(): void {
    clearSavedBoard();
    this.board = createDemoBoard();
    this.evaluation = evaluateBoard(this.board);
    this.preview = null;
    this.toggledTile = null;
    this.heldMove = { x: 0, y: 0 };
    this.previousPositions = this.board.players.map((player) => ({
      ...player.position,
    }));
    this.lastSavedSeconds = 0;
    this.drawing.clearEffects();
    this.resetView();
    saveBoard(this.board);
    this.showUsableButtons();
    this.updateHud();
  }

  private continueEndless(): void {
    if (this.board.mode !== "complete") return;
    this.board.mode = "endless";
    saveBoard(this.board);
    this.updateHud();
  }

  private updateHud(): void {
    const detail = {
      points: this.board.score,
      level: targetLevelFor(this.board.completedTargets),
      totalLevels: TOTAL_LEVELS,
      mode: this.board.mode,
    };
    const state = JSON.stringify(detail);
    if (state === this.lastHudState) return;
    this.lastHudState = state;
    document.dispatchEvent(new CustomEvent("onehot-progress", { detail }));
  }

  private playerPositionsAt(blend: number): Vector[] {
    return this.board.players.map((player, index) =>
      blendVectors(
        this.previousPositions[index] ?? player.position,
        player.position,
        blend,
      ),
    );
  }

  protected cameraFocus(blend: number): Vector {
    return this.playerPositionsAt(blend)[0];
  }

  protected drawFrame(clock: FrameClock): void {
    this.drawing.draw({
      ...clock,
      board: this.board,
      evaluation: this.evaluation,
      preview: this.preview,
      playerPositions: this.playerPositionsAt(clock.blend),
      heldMove: this.heldMove,
      streamSeconds: this.board.seconds + this.secondsIntoStep,
    });
  }

  protected runStep(input: PadInput): void {
    if (this.board.mode === "complete") return;
    this.heldMove = { x: Math.sign(input.move.x), y: Math.sign(input.move.y) };
    this.previousPositions = this.board.players.map((player) => ({
      ...player.position,
    }));
    this.board.players.forEach((player, index) => {
      stepPlayer(
        this.board,
        player,
        index === 0 ? input : neutralPadInput(),
        FIXED_STEP_SECONDS,
      );
    });
    const before = this.evaluation;
    this.evaluation = evaluateBoard(this.board);
    const arrived = fillTargets(
      this.board,
      this.evaluation,
      FIXED_STEP_SECONDS,
      Math.random,
    );
    if (arrived.length > 0) this.evaluation = evaluateBoard(this.board);
    for (const cell of arrived) this.drawing.showLitChange(cell);
    this.board.seconds += FIXED_STEP_SECONDS;
    for (const [key, node] of this.evaluation) {
      const wasLit = before.get(key)?.lit === true;
      if (node.lit !== wasLit && (node.lit || before.has(key)))
        this.drawing.showLitChange(node.cell);
    }
    const tile = tileOf(this.board.players[0].position);
    for (const cue of this.board.cues) {
      if (cue.type === "stamp" || cue.type === "remove")
        this.toggledTile = cue.cell;
    }
    if (
      this.toggledTile &&
      (this.toggledTile.x !== tile.x || this.toggledTile.y !== tile.y)
    )
      this.toggledTile = null;
    this.preview = this.toggledTile
      ? null
      : togglePreviewOf(this.board, this.evaluation, tile);
    for (const cue of this.board.cues) this.drawing.showCue(cue);
    if (
      this.board.cues.length > 0 ||
      this.board.seconds - this.lastSavedSeconds >= 1
    ) {
      saveBoard(this.board);
      this.lastSavedSeconds = this.board.seconds;
    }
    this.board.cues.length = 0;
    this.showUsableButtons();
    this.updateHud();
  }

  private showUsableButtons(): void {
    const key = cellKey(tileOf(this.board.players[0].position));
    const hasGate = this.board.gates.has(key);
    this.setTouchButtonEnabled("b", !hasGate && !this.board.terrain.has(key));
    this.setTouchButtonEnabled("x", hasGate);
  }
}
