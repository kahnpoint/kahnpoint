import type * as Phaser from "phaser";
import {
  FACE_EASE_PER_SECOND,
  FILL_SECONDS,
  FLASH_SECONDS,
  FRAME_SHARE,
  GATE_SCALE,
  IDLE_GATE_COLOR,
  INK_COLOR,
  INSIDE_PIXELS,
  LIGHT_TONE,
  LINE_COLOR,
  LINE_PIXELS,
  MID_TONE,
  PAPER_COLOR,
  PATTERN_SHARE,
  PATTERN_SIDE,
  POP_GROWTH,
  POP_SECONDS,
  SCORE_CENTRE_CSS_PIXELS,
  SCORE_PIXELS_PER_CELL,
  STREAM_CELLS_PER_SECOND,
  STREAM_SPACING_CELLS,
  TILE_PIXELS,
} from "../../constants";
import { PixelPen } from "../../lib/draw/pixel-pen";
import type { FrameClock } from "../../lib/engine/step-scene";
import { isPixelLit } from "../core/patterns";
import { cellKey, tileOf } from "../core/types";
import type {
  Board,
  Cell,
  Cue,
  Evaluation,
  Pattern,
  Vector,
} from "../core/types";
import { flowKey, flowsOf } from "../rules";
import type { TogglePreview } from "../rules";

const DIGIT_ROWS: readonly (readonly number[])[] = [
  [0b111, 0b101, 0b101, 0b101, 0b111],
  [0b010, 0b110, 0b010, 0b010, 0b111],
  [0b111, 0b001, 0b111, 0b100, 0b111],
  [0b111, 0b001, 0b111, 0b001, 0b111],
  [0b101, 0b101, 0b111, 0b001, 0b001],
  [0b111, 0b100, 0b111, 0b001, 0b111],
  [0b111, 0b100, 0b111, 0b101, 0b111],
  [0b111, 0b001, 0b001, 0b001, 0b001],
  [0b111, 0b101, 0b111, 0b101, 0b111],
  [0b111, 0b101, 0b111, 0b001, 0b111],
];

const GATE_TONE = MID_TONE;
const TARGET_TONE = LIGHT_TONE;
const PILLAR_COLOR = GATE_TONE;
type Effect =
  | { type: "pop" | "flash"; cell: Cell; start: number | null }
  | {
      type: "fill";
      cell: Cell;
      from: Cell;
      pixel: number;
      start: number | null;
    };
const EFFECT_SECONDS = {
  pop: POP_SECONDS,
  flash: FLASH_SECONDS,
  fill: FILL_SECONDS,
};

export type FrameView = FrameClock & {
  board: Board;
  evaluation: Evaluation;
  preview: TogglePreview | null;
  playerPositions: Vector[];
  heldMove: Vector;
  streamSeconds: number;
};

export class BoardDrawing {
  private readonly pen: PixelPen;
  private effects: Effect[] = [];
  private seconds = 0;
  private streamSeconds = 0;
  private faceShift: Vector = { x: 0, y: 0 };
  playerScreen: Vector = { x: 0, y: 0 };

  constructor(scene: Phaser.Scene) {
    this.pen = new PixelPen(scene, TILE_PIXELS);
  }

  showCue(cue: Cue): void {
    if (cue.type === "fill") this.effects.push({ ...cue, start: null });
    else
      this.effects.push({
        type: cue.type === "stamp" ? "pop" : "flash",
        cell: cue.cell,
        start: null,
      });
  }

  showLitChange(cell: Cell): void {
    this.effects.push({ type: "pop", cell, start: null });
  }

  draw(view: FrameView): void {
    const { board, evaluation, preview } = view;
    const frameSeconds = Math.min(
      0.1,
      Math.max(0, view.seconds - this.seconds),
    );
    this.seconds = view.seconds;
    this.streamSeconds = view.streamSeconds;
    const faceClose = 1 - Math.exp(-FACE_EASE_PER_SECOND * frameSeconds);
    this.faceShift.x += (view.heldMove.x - this.faceShift.x) * faceClose;
    this.faceShift.y += (view.heldMove.y - this.faceShift.y) * faceClose;
    for (const effect of this.effects) effect.start ??= view.seconds;
    this.effects = this.effects.filter(
      (effect) =>
        view.seconds - (effect.start as number) < EFFECT_SECONDS[effect.type],
    );
    this.pen.startFrame(view);
    const first = view.playerPositions[0];
    if (first)
      this.playerScreen = {
        x: this.pen.screenX(first.x) / view.pixelRatio,
        y: this.pen.screenY(first.y) / view.pixelRatio,
      };
    this.pen.drawBounds(board.width, board.height);

    const going = new Set((preview?.removed ?? []).map(flowKey));
    const flows = [
      ...flowsOf(board, evaluation).filter((flow) => !going.has(flowKey(flow))),
      ...(preview?.flows ?? []),
    ];
    for (const flow of flows) {
      this.drawLine(flow.giver, flow.taker, LINE_COLOR, 1);
      this.drawStream(flow.giver, flow.taker);
    }

    const changed = new Map(
      (preview?.changed ?? []).map((node) => [cellKey(node.cell), node]),
    );
    for (const [key, terrain] of board.terrain) {
      const cell = parseCell(key);
      const size = Math.min(1, GATE_SCALE * this.popScaleAt(cell));
      if (terrain.type === "pillar") {
        this.pen.fillSquare(cell, 1, PILLAR_COLOR, 1);
      } else if (terrain.type === "source") {
        this.drawTile(cell, terrain.pattern, size, INK_COLOR);
      } else {
        const arriving = this.effects.filter(
          (effect) =>
            effect.type === "fill" &&
            effect.cell.x === cell.x &&
            effect.cell.y === cell.y,
        );
        let filled = 0;
        let toFill = terrain.filled - arriving.length;
        for (let bit = 1; toFill > 0; bit <<= 1) {
          if (!(terrain.pattern & bit)) continue;
          filled |= bit;
          toFill--;
        }
        this.drawTile(
          cell,
          null,
          size,
          evaluation.get(key)?.lit ? INK_COLOR : TARGET_TONE,
        );
        this.drawPattern(
          cell,
          terrain.pattern & ~filled,
          size,
          changed.get(key)?.lit ? GATE_TONE : TARGET_TONE,
        );
        this.drawPattern(cell, filled, size, INK_COLOR);
        for (const effect of arriving) {
          if (effect.type !== "fill") continue;
          const share =
            (this.seconds - (effect.start as number)) / EFFECT_SECONDS.fill;
          const edge = {
            x: Math.sign(effect.from.x - cell.x) * (0.5 - FRAME_SHARE / 2),
            y: Math.sign(effect.from.y - cell.y) * (0.5 - FRAME_SHARE / 2),
          };
          const slot = {
            x:
              ((effect.pixel % PATTERN_SIDE) - (PATTERN_SIDE - 1) / 2) *
              (PATTERN_SHARE / PATTERN_SIDE),
            y:
              (Math.floor(effect.pixel / PATTERN_SIDE) -
                (PATTERN_SIDE - 1) / 2) *
              (PATTERN_SHARE / PATTERN_SIDE),
          };
          const at = {
            x: cell.x + edge.x + (slot.x - edge.x) * share,
            y: cell.y + edge.y + (slot.y - edge.y) * share,
          };
          this.pen.fillSquare(at, PATTERN_SHARE / PATTERN_SIDE, GATE_TONE, 1);
        }
      }
    }
    for (const [key, gate] of board.gates) {
      const size = Math.min(1, GATE_SCALE * this.popScaleAt(gate.cell));
      const gives = evaluation.get(key)?.gives ?? null;
      const after = changed.get(key);
      if (after) this.drawWouldBe(gate.cell, after.gives, size);
      else this.drawGate(gate.cell, gives, size);
    }

    board.players.forEach((player, index) => {
      const position = view.playerPositions[index] ?? player.position;
      const open = !board.gates.has(cellKey(tileOf(player.position)));
      if (open && index === 0 && preview && preview.gives !== null) {
        this.drawTile(position, null, GATE_SCALE, INK_COLOR);
        this.pen.fillCorners(position, PAPER_COLOR);
        this.drawPattern(position, preview.gives, GATE_SCALE, GATE_TONE);
      } else if (open || index !== 0) {
        this.pen.drawFace(position, this.faceShift);
      } else {
        this.pen.strokeFrame(position, INK_COLOR, 1);
        this.pen.fillCorners(position, PAPER_COLOR);
      }
    });
    for (const effect of this.effects) {
      if (effect.type !== "flash") continue;
      const age = this.seconds - (effect.start as number);
      this.pen.strokeFrame(effect.cell, GATE_TONE, 1 - age / FLASH_SECONDS);
    }
    this.drawScore(Math.floor(board.score), view.width, view.pixelRatio);
  }

  private drawScore(points: number, width: number, pixelRatio: number): void {
    const pixel = Math.round(this.pen.cellPixels / SCORE_PIXELS_PER_CELL);
    const digits = [...String(points)];
    const left = Math.round((width - (digits.length * 4 - 1) * pixel) / 2);
    const top = Math.round(SCORE_CENTRE_CSS_PIXELS * pixelRatio - 2.5 * pixel);
    this.pen.graphics.fillStyle(INK_COLOR, 1);
    digits.forEach((digit, place) => {
      const rows = DIGIT_ROWS[Number(digit)] as readonly number[];
      rows.forEach((row, y) => {
        for (let x = 0; x < 3; x++) {
          if (row & (0b100 >> x))
            this.pen.graphics.fillRect(
              left + (place * 4 + x) * pixel,
              top + y * pixel,
              pixel,
              pixel,
            );
        }
      });
    });
  }

  private popScaleAt(cell: Cell): number {
    const pop = this.effects.find(
      (effect) =>
        effect.type === "pop" &&
        effect.cell.x === cell.x &&
        effect.cell.y === cell.y,
    );
    if (!pop) return 1;
    return (
      1 +
      POP_GROWTH * (1 - (this.seconds - (pop.start as number)) / POP_SECONDS)
    );
  }

  private drawLine(from: Cell, to: Cell, color: number, alpha: number): void {
    const half = (LINE_PIXELS * this.pen.cellPixels) / TILE_PIXELS / 2;
    const left = this.pen.screenX(Math.min(from.x, to.x)) - half;
    const top = this.pen.screenY(Math.min(from.y, to.y)) - half;
    this.pen.graphics.fillStyle(color, alpha);
    this.pen.graphics.fillRect(
      left,
      top,
      Math.abs(to.x - from.x) * this.pen.cellPixels + 2 * half,
      Math.abs(to.y - from.y) * this.pen.cellPixels + 2 * half,
    );
  }

  private drawStream(giver: Cell, taker: Cell): void {
    const length = Math.abs(taker.x - giver.x) + Math.abs(taker.y - giver.y);
    const step = {
      x: Math.sign(taker.x - giver.x),
      y: Math.sign(taker.y - giver.y),
    };
    const square = (LINE_PIXELS * this.pen.cellPixels) / TILE_PIXELS;
    this.pen.graphics.fillStyle(GATE_TONE, 1);
    for (
      let along =
        (this.streamSeconds * STREAM_CELLS_PER_SECOND) % STREAM_SPACING_CELLS;
      along < length;
      along += STREAM_SPACING_CELLS
    ) {
      this.pen.graphics.fillRect(
        this.pen.screenX(giver.x + step.x * along) - square / 2,
        this.pen.screenY(giver.y + step.y * along) - square / 2,
        square,
        square,
      );
    }
  }

  private drawPattern(
    center: Vector,
    pattern: Pattern,
    size: number,
    color = INK_COLOR,
  ): void {
    const pixel = (size * PATTERN_SHARE * this.pen.cellPixels) / PATTERN_SIDE;
    const left = this.pen.screenX(center.x) - (pixel * PATTERN_SIDE) / 2;
    const top = this.pen.screenY(center.y) - (pixel * PATTERN_SIDE) / 2;
    this.pen.graphics.fillStyle(color, 1);
    for (let row = 0; row < PATTERN_SIDE; row++) {
      for (let column = 0; column < PATTERN_SIDE; column++) {
        if (isPixelLit(pattern, row, column))
          this.pen.graphics.fillRect(
            left + column * pixel,
            top + row * pixel,
            pixel,
            pixel,
          );
      }
    }
  }

  private drawTile(
    center: Vector,
    pattern: Pattern | null,
    size: number,
    frameColor: number,
    paperColor = PAPER_COLOR,
  ): void {
    this.pen.fillSquare(center, size, frameColor, 1);
    this.pen.fillSquare(center, size * (1 - 2 * FRAME_SHARE), paperColor, 1);
    if (pattern !== null) this.drawPattern(center, pattern, size);
  }

  private drawGate(center: Vector, gives: Pattern | null, size: number): void {
    this.drawTile(
      center,
      gives,
      size,
      GATE_TONE,
      gives === null ? IDLE_GATE_COLOR : PAPER_COLOR,
    );
    this.pen.fillCorners(center, PAPER_COLOR);
  }

  private drawWouldBe(
    center: Vector,
    after: Pattern | null,
    size: number,
  ): void {
    this.drawTile(
      center,
      null,
      size,
      GATE_TONE,
      after === null ? IDLE_GATE_COLOR : PAPER_COLOR,
    );
    this.pen.fillCorners(center, PAPER_COLOR);
    if (after !== null) this.drawPattern(center, after, size, GATE_TONE);
  }
}

function parseCell(key: string): Cell {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}
