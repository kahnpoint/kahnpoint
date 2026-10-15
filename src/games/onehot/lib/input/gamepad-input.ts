import type * as Phaser from "phaser";
import { STICK_AXIS_SLOPE, STICK_DEAD_ZONE } from "../../constants";
import { createPadLatches, PAD_BUTTONS, samplePadLatches } from "./pad";
import type { PadSource } from "./pad";

const FACE_BUTTONS = { a: "A", b: "B", x: "X", y: "Y" } as const;

export function createGamepadInput(
  scene: Phaser.Scene,
  onUse: () => void,
): PadSource {
  const latches = createPadLatches();
  return {
    poll: () => {
      const pad = scene.input.gamepad
        ?.getAll()
        .find((candidate) => candidate.connected);
      const stick = pad?.leftStick ?? { x: 0, y: 0 };
      const stickLength = Math.hypot(stick.x, stick.y);
      const stickHeld = stickLength >= STICK_DEAD_ZONE;
      const stickX = stickHeld ? stick.x / stickLength : 0;
      const stickY = stickHeld ? stick.y / stickLength : 0;
      latches.left.setDown(pad?.left === true || stickX < -STICK_AXIS_SLOPE);
      latches.right.setDown(pad?.right === true || stickX > STICK_AXIS_SLOPE);
      latches.up.setDown(pad?.up === true || stickY < -STICK_AXIS_SLOPE);
      latches.down.setDown(pad?.down === true || stickY > STICK_AXIS_SLOPE);
      let anyDown =
        stickHeld || pad?.left || pad?.right || pad?.up || pad?.down;
      for (const button of PAD_BUTTONS) {
        const isDown = pad?.[FACE_BUTTONS[button]] === true;
        latches[button].setDown(isDown);
        anyDown ||= isDown;
      }
      if (anyDown) onUse();
    },
    sample: () => samplePadLatches(latches),
  };
}
