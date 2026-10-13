import * as Phaser from "phaser";
import {
  CAMERA_CLOSE_PER_STEP,
  FIXED_STEP_SECONDS,
  MAX_STEPS_PER_FRAME,
  PAUSED_KEY,
} from "../../constants";
import type { Vector } from "../grid/grid";
import { createGamepadInput } from "../input/gamepad-input";
import { createKeyboardInput } from "../input/keyboard-input";
import type { KeyBindings } from "../input/keyboard-input";
import { mergePadInputs, padInputFromOverride } from "../input/pad";
import type { PadInput, PadOverride, PadSource } from "../input/pad";
import { createTouchInput } from "../input/touch-input";
import type { TouchButton } from "../input/touch-input";

export type FrameClock = {
  blend: number;
  seconds: number;
  camera: Vector;
  width: number;
  height: number;
  pixelRatio: number;
};

export abstract class StepScene extends Phaser.Scene {
  private sources: PadSource[] = [];
  private camera: Vector | null = null;
  private accumulatedSeconds = 0;
  private teardown = new AbortController();
  protected cameraClosePerStep = CAMERA_CLOSE_PER_STEP;

  protected get secondsIntoStep(): number {
    return this.accumulatedSeconds;
  }

  protected startInput(
    keys: KeyBindings,
    touchButtons: readonly TouchButton[],
  ): void {
    const container = this.game.canvas.parentElement;
    if (!container) throw new Error("The game canvas has no parent element.");
    const touch = createTouchInput(
      document.body,
      container,
      this.teardown.signal,
      touchButtons,
    );
    const keyboard = createKeyboardInput(this, keys, () => touch.hide());
    const gamepad = createGamepadInput(this, () => touch.hide());
    this.sources = [keyboard, gamepad, touch];
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown.abort());
  }

  protected press(input: PadOverride, steps: number): void {
    for (let step = 0; step < steps; step++)
      this.runStep(padInputFromOverride(input, step === 0));
  }

  update(time: number, deltaMs: number): void {
    for (const source of this.sources) source.poll?.();
    const paused = this.registry.get(PAUSED_KEY) === true;
    if (paused) for (const source of this.sources) source.sample();
    const frameSeconds = paused ? 0 : Math.min(deltaMs / 1000, 0.25);
    this.accumulatedSeconds += frameSeconds;
    let steps = 0;
    while (
      this.accumulatedSeconds >= FIXED_STEP_SECONDS &&
      steps < MAX_STEPS_PER_FRAME
    ) {
      this.runStep(
        mergePadInputs(this.sources.map((source) => source.sample())),
      );
      this.accumulatedSeconds -= FIXED_STEP_SECONDS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulatedSeconds = 0;

    const blend = this.accumulatedSeconds / FIXED_STEP_SECONDS;
    const focus = this.cameraFocus(blend);
    this.camera ??= { ...focus };
    const close =
      1 -
      Math.pow(1 - this.cameraClosePerStep, frameSeconds / FIXED_STEP_SECONDS);
    this.camera.x += (focus.x - this.camera.x) * close;
    this.camera.y += (focus.y - this.camera.y) * close;
    this.drawFrame({
      blend,
      seconds: time / 1000,
      camera: this.camera,
      width: this.scale.width,
      height: this.scale.height,
      pixelRatio: 1 / this.scale.zoom,
    });
  }

  protected abstract runStep(input: PadInput): void;
  protected abstract cameraFocus(blend: number): Vector;
  protected abstract drawFrame(clock: FrameClock): void;
}

export function blendVectors(
  previous: Vector,
  current: Vector,
  blend: number,
): Vector {
  return {
    x: previous.x + (current.x - previous.x) * blend,
    y: previous.y + (current.y - previous.y) * blend,
  };
}
