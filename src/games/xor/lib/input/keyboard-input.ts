import * as Phaser from "phaser";
import { createPadLatches, samplePadLatches } from "./pad";
import type { PadLatches, PadSource } from "./pad";

export type KeyBindings = Readonly<Record<string, keyof PadLatches>>;

export const MOVE_KEYS: KeyBindings = {
  LEFT: "left",
  RIGHT: "right",
  UP: "up",
  DOWN: "down",
  A: "left",
  D: "right",
  W: "up",
  S: "down",
};

type Side = "left" | "right" | "up" | "down";
const OPPOSITE: Record<Side, Side> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
};
const AXIS: Record<Side, "x" | "y"> = {
  left: "x",
  right: "x",
  up: "y",
  down: "y",
};

export function createKeyboardInput(
  scene: Phaser.Scene,
  bindings: KeyBindings,
  onUse: () => void,
): PadSource {
  const keyboard = scene.input.keyboard;
  if (!keyboard) throw new Error("The scene has no keyboard input.");
  const latches = createPadLatches();
  const latest: { x?: Side; y?: Side } = {};
  const keys = Object.entries(bindings).map(([name, latch]) => ({
    key: keyboard.addKey(name),
    latch,
  }));
  return {
    poll: () => {
      const down = new Set<keyof PadLatches>();
      for (const { key, latch } of keys) {
        if (Phaser.Input.Keyboard.JustDown(key)) {
          latches[latch].press();
          if (latch in OPPOSITE) latest[AXIS[latch as Side]] = latch as Side;
          onUse();
        }
        if (key.isDown) down.add(latch);
      }
      for (const side of Object.values(latest)) {
        if (side && down.has(side)) down.delete(OPPOSITE[side]);
      }
      for (const latch of new Set(Object.values(bindings)))
        latches[latch].setDown(down.has(latch));
    },
    sample: () => samplePadLatches(latches),
  };
}
