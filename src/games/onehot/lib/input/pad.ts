import type { Vector } from "../grid/grid";

export type ButtonInput = {
  held: boolean;
  pressed: boolean;
};

export const PAD_BUTTONS = ["a", "b", "x", "y"] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];

export type PadInput = {
  move: Vector;
} & Record<PadButton, ButtonInput>;

export class ButtonLatch {
  private down = false;
  private sampled = false;
  private changes: boolean[] = [];

  press(): void {
    this.setDown(true);
  }

  release(): void {
    this.setDown(false);
  }

  setDown(isDown: boolean): void {
    if (isDown !== this.down) this.changes.push(isDown);
    this.down = isDown;
  }

  sample(): ButtonInput {
    const held = this.changes.shift() ?? this.down;
    const pressed = held && !this.sampled;
    this.sampled = held;
    return { held, pressed };
  }
}

export type PadLatches = Record<
  "left" | "right" | "up" | "down" | PadButton,
  ButtonLatch
>;

export function createPadLatches(): PadLatches {
  return {
    left: new ButtonLatch(),
    right: new ButtonLatch(),
    up: new ButtonLatch(),
    down: new ButtonLatch(),
    a: new ButtonLatch(),
    b: new ButtonLatch(),
    x: new ButtonLatch(),
    y: new ButtonLatch(),
  };
}

export function samplePadLatches(latches: PadLatches): PadInput {
  const left = latches.left.sample().held;
  const right = latches.right.sample().held;
  const up = latches.up.sample().held;
  const down = latches.down.sample().held;
  return {
    move: {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0),
    },
    a: latches.a.sample(),
    b: latches.b.sample(),
    x: latches.x.sample(),
    y: latches.y.sample(),
  };
}

export type PadSource = {
  poll?: () => void;
  sample: () => PadInput;
};

export function neutralPadInput(): PadInput {
  const idle = (): ButtonInput => ({ held: false, pressed: false });
  return { move: { x: 0, y: 0 }, a: idle(), b: idle(), x: idle(), y: idle() };
}

function mergeButtons(first: ButtonInput, second: ButtonInput): ButtonInput {
  return {
    held: first.held || second.held,
    pressed: first.pressed || second.pressed,
  };
}

export function mergePadInputs(inputs: readonly PadInput[]): PadInput {
  const merged = neutralPadInput();
  for (const input of inputs) {
    merged.move.x = Math.max(-1, Math.min(1, merged.move.x + input.move.x));
    merged.move.y = Math.max(-1, Math.min(1, merged.move.y + input.move.y));
    for (const button of PAD_BUTTONS)
      merged[button] = mergeButtons(merged[button], input[button]);
  }
  return merged;
}

export type PadOverride = {
  move?: Partial<PadInput["move"]>;
} & Partial<Record<PadButton, Partial<ButtonInput>>>;

function overrideButton(
  button: Partial<ButtonInput> | undefined,
  firstStep: boolean,
): ButtonInput {
  if (!button) return { held: false, pressed: false };
  const pressed = firstStep && button.pressed === true;
  return { held: button.held ?? button.pressed === true, pressed };
}

export function padInputFromOverride(
  override: PadOverride,
  firstStep: boolean,
): PadInput {
  return {
    move: { x: override.move?.x ?? 0, y: override.move?.y ?? 0 },
    a: overrideButton(override.a, firstStep),
    b: overrideButton(override.b, firstStep),
    x: overrideButton(override.x, firstStep),
    y: overrideButton(override.y, firstStep),
  };
}
