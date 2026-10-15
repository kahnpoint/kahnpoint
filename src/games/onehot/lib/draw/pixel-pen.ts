import type * as Phaser from "phaser";
import { BOUNDS_COLOR, INK_COLOR, PAPER_COLOR } from "../../constants";
import type { FrameClock } from "../engine/step-scene";
import type { Vector } from "../grid/grid";

export class PixelPen {
  readonly graphics: Phaser.GameObjects.Graphics;
  readonly cellCssPixels: number;
  cellPixels: number;
  private originX = 0;
  private originY = 0;

  constructor(
    scene: Phaser.Scene,
    readonly tilePixels: number,
  ) {
    this.graphics = scene.add.graphics().setDepth(0);
    this.cellCssPixels = tilePixels * Math.round(48 / tilePixels);
    this.cellPixels = this.cellCssPixels;
  }

  startFrame(clock: FrameClock): void {
    this.cellPixels = this.cellCssPixels * clock.pixelRatio;
    this.originX = clock.width / 2 - clock.camera.x * this.cellPixels;
    this.originY = clock.height / 2 - clock.camera.y * this.cellPixels;
    this.graphics.clear();
  }

  get pixel(): number {
    return this.cellPixels / this.tilePixels;
  }

  screenX(x: number): number {
    return this.originX + x * this.cellPixels;
  }

  screenY(y: number): number {
    return this.originY + y * this.cellPixels;
  }

  drawBounds(width: number, height: number): void {
    this.graphics.lineStyle(Math.max(1, this.cellPixels / 24), BOUNDS_COLOR, 1);
    this.graphics.strokeRect(
      this.screenX(-0.5),
      this.screenY(-0.5),
      width * this.cellPixels,
      height * this.cellPixels,
    );
  }

  fillSquare(center: Vector, size: number, color: number, alpha = 1): void {
    const side = size * this.cellPixels;
    this.graphics.fillStyle(color, alpha);
    this.graphics.fillRect(
      this.screenX(center.x) - side / 2,
      this.screenY(center.y) - side / 2,
      side,
      side,
    );
  }

  strokeFrame(center: Vector, color: number, alpha = 1): void {
    const pixel = this.pixel;
    const left = this.screenX(center.x) - this.cellPixels / 2;
    const top = this.screenY(center.y) - this.cellPixels / 2;
    const far = this.cellPixels - pixel;
    this.graphics.fillStyle(color, alpha);
    this.graphics.fillRect(left, top, this.cellPixels, pixel);
    this.graphics.fillRect(left, top + far, this.cellPixels, pixel);
    this.graphics.fillRect(left, top + pixel, pixel, far - pixel);
    this.graphics.fillRect(left + far, top + pixel, pixel, far - pixel);
  }

  fillCorners(center: Vector, color: number): void {
    const pixel = this.pixel;
    const half = this.cellPixels / 2;
    this.graphics.fillStyle(color, 1);
    for (const x of [-half, half - pixel]) {
      for (const y of [-half, half - pixel])
        this.graphics.fillRect(
          this.screenX(center.x) + x,
          this.screenY(center.y) + y,
          pixel,
          pixel,
        );
    }
  }

  drawFace(center: Vector, lean: Vector): void {
    this.fillSquare(center, 1, INK_COLOR);
    this.fillSquare(center, 1 - 2 / this.tilePixels, PAPER_COLOR);
    this.fillCorners(center, PAPER_COLOR);
    const inside = this.tilePixels - 2;
    const near = Math.floor(inside / 4);
    const far = inside - 1 - near;
    const pixel = this.pixel;
    const left =
      this.screenX(center.x) - this.cellPixels / 2 + (1 + lean.x) * pixel;
    const top =
      this.screenY(center.y) - this.cellPixels / 2 + (1 + lean.y) * pixel;
    this.graphics.fillStyle(INK_COLOR, 1);
    this.graphics.fillRect(
      left + near * pixel,
      top + near * pixel,
      pixel,
      pixel,
    );
    this.graphics.fillRect(
      left + far * pixel,
      top + near * pixel,
      pixel,
      pixel,
    );
    this.graphics.fillRect(
      left + near * pixel,
      top + far * pixel,
      (far - near + 1) * pixel,
      pixel,
    );
  }
}
