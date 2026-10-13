import {
  TOUCH_AXIS_SLOPE,
  TOUCH_BAND_HEIGHT_PX,
  TOUCH_BUTTON_SIZE_PX,
  TOUCH_DEAD_ZONE,
  TOUCH_MARGIN_PX,
  TOUCH_PAD_SIZE_PX,
  TOUCH_SHAPE_COLOR,
} from "../../constants";
import { ButtonLatch, createPadLatches, samplePadLatches } from "./pad";
import type { PadButton, PadSource } from "./pad";

export type TouchInput = PadSource & {
  hide: () => void;
};

export type TouchButton = {
  button: PadButton;
  shape: string;
  right: number;
  bottom: number;
};

export const TOUCH_SHAPES = {
  filled: `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="8" y="8" width="32" height="32" rx="3" fill="${TOUCH_SHAPE_COLOR}"/></svg>`,
  outline: `<svg viewBox="0 0 48 48" width="44" height="44"><rect x="9" y="9" width="30" height="30" rx="3" fill="none" stroke="${TOUCH_SHAPE_COLOR}" stroke-width="4"/></svg>`,
  ring: `<svg viewBox="0 0 48 48" width="44" height="44"><circle cx="24" cy="24" r="17" fill="none" stroke="${TOUCH_SHAPE_COLOR}" stroke-width="4"/></svg>`,
} as const;
export const PAD_SHAPE = `<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="46" fill="none" stroke="${TOUCH_SHAPE_COLOR}" stroke-width="3"/>
  <polygon points="50,14 59,28 41,28" fill="${TOUCH_SHAPE_COLOR}"/><polygon points="50,86 59,72 41,72" fill="${TOUCH_SHAPE_COLOR}"/>
  <polygon points="14,50 28,41 28,59" fill="${TOUCH_SHAPE_COLOR}"/><polygon points="86,50 72,41 72,59" fill="${TOUCH_SHAPE_COLOR}"/></svg>`;

function createZone(
  markup: string,
  left: string | null,
  right: string | null,
  bottom: string,
  size: number,
): HTMLDivElement {
  const zone = document.createElement("div");
  zone.innerHTML = markup;
  Object.assign(zone.style, {
    position: "absolute",
    width: `${size}px`,
    height: `${size}px`,
    bottom,
    left: left ?? "",
    right: right ?? "",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
    touchAction: "none",
    userSelect: "none",
    webkitUserSelect: "none",
  });
  return zone;
}

function bindButton(
  zone: HTMLElement,
  latch: ButtonLatch,
  signal: AbortSignal,
): void {
  const release = (): void => latch.release();
  zone.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      zone.setPointerCapture(event.pointerId);
      latch.press();
    },
    { signal },
  );
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    zone.addEventListener(name, release, { signal });
}

export function createTouchInput(
  root: HTMLElement,
  stage: HTMLElement,
  signal: AbortSignal,
  buttons: readonly TouchButton[],
): TouchInput {
  const latches = createPadLatches();
  const layer = document.createElement("div");
  Object.assign(layer.style, {
    position: "fixed",
    left: "0",
    right: "0",
    bottom: "0",
    height: "0",
    display: "none",
    pointerEvents: "none",
    background: "#ffffff",
    zIndex: "2",
  });
  root.appendChild(layer);

  const pad = createZone(
    PAD_SHAPE,
    `${TOUCH_MARGIN_PX}px`,
    null,
    `${TOUCH_MARGIN_PX}px`,
    TOUCH_PAD_SIZE_PX,
  );
  layer.appendChild(pad);
  const step = TOUCH_BUTTON_SIZE_PX + 8;
  for (const { button, shape, right, bottom } of buttons) {
    const zone = createZone(
      shape,
      null,
      `${TOUCH_MARGIN_PX + right * step}px`,
      `${TOUCH_MARGIN_PX + bottom * step}px`,
      TOUCH_BUTTON_SIZE_PX,
    );
    layer.appendChild(zone);
    bindButton(zone, latches[button], signal);
  }

  const setDirections = (x: number, y: number): void => {
    latches.left.setDown(x < 0);
    latches.right.setDown(x > 0);
    latches.up.setDown(y < 0);
    latches.down.setDown(y > 0);
  };
  const aim = (event: PointerEvent): void => {
    const box = pad.getBoundingClientRect();
    const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
    const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
    const length = Math.hypot(dx, dy);
    if (length < TOUCH_DEAD_ZONE) return setDirections(0, 0);
    const axis = (value: number): number =>
      value / length > TOUCH_AXIS_SLOPE
        ? 1
        : value / length < -TOUCH_AXIS_SLOPE
          ? -1
          : 0;
    setDirections(axis(dx), axis(dy));
  };
  pad.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      pad.setPointerCapture(event.pointerId);
      aim(event);
    },
    { signal },
  );
  pad.addEventListener(
    "pointermove",
    (event) => {
      if (pad.hasPointerCapture(event.pointerId)) aim(event);
    },
    { signal },
  );
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    pad.addEventListener(name, () => setDirections(0, 0), { signal });

  let visible = window.matchMedia("(pointer: coarse)").matches;
  const layout = (): void => {
    if (!visible) {
      layer.style.display = "none";
      stage.style.bottom = "0";
      return;
    }
    const portrait = window.innerHeight > window.innerWidth;
    layer.style.display = "block";
    layer.style.height = portrait ? `${TOUCH_BAND_HEIGHT_PX}px` : "100%";
    layer.style.background = portrait ? "#ffffff" : "transparent";
    layer.style.top = portrait ? "" : "0";
    stage.style.bottom = portrait ? `${TOUCH_BAND_HEIGHT_PX}px` : "0";
  };
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch" || visible) return;
      visible = true;
      layout();
    },
    { signal, capture: true },
  );
  window.addEventListener("resize", layout, { signal });
  layout();

  return {
    sample: () => samplePadLatches(latches),
    hide: () => {
      if (!visible) return;
      visible = false;
      layout();
    },
  };
}
