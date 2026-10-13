import {
  INK_COLOR,
  LIGHT_TONE,
  PAPER_COLOR,
  TOUCH_AXIS_SLOPE,
  TOUCH_BAND_HEIGHT_PX,
  TOUCH_BUTTON_BORDER_PX,
  TOUCH_BUTTON_GAP_PX,
  TOUCH_BUTTON_HEIGHT_PX,
  TOUCH_BUTTON_WIDTH_PX,
  TOUCH_DEAD_ZONE,
  TOUCH_MARGIN_PX,
  TOUCH_PAD_SIZE_PX,
  TOUCH_SHAPE_COLOR,
} from "../../constants";
import { ButtonLatch, createPadLatches, samplePadLatches } from "./pad";
import type { PadButton, PadSource } from "./pad";

export type TouchInput = PadSource & {
  hide: () => void;
  setEnabled: (button: PadButton, enabled: boolean) => void;
};

export type TouchButton = {
  button: PadButton;
  label: string;
  row: number;
};

const cssColorOf = (color: number): string =>
  `#${color.toString(16).padStart(6, "0")}`;
const INK = cssColorOf(INK_COLOR);
const PAPER = cssColorOf(PAPER_COLOR);
const FADED = cssColorOf(LIGHT_TONE);

export const PAD_SHAPE = `<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="46" fill="none" stroke="${TOUCH_SHAPE_COLOR}" stroke-width="3"/>
  <polygon points="50,14 59,28 41,28" fill="${TOUCH_SHAPE_COLOR}"/><polygon points="50,86 59,72 41,72" fill="${TOUCH_SHAPE_COLOR}"/>
  <polygon points="14,50 28,41 28,59" fill="${TOUCH_SHAPE_COLOR}"/><polygon points="86,50 72,41 72,59" fill="${TOUCH_SHAPE_COLOR}"/></svg>`;

function createZone(size: number): HTMLDivElement {
  const zone = document.createElement("div");
  Object.assign(zone.style, {
    position: "absolute",
    width: `${size}px`,
    height: `${size}px`,
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

type ButtonZone = {
  setEnabled: (enabled: boolean) => void;
};

function createButtonZone(
  layer: HTMLElement,
  { label, row }: TouchButton,
  latch: ButtonLatch,
  signal: AbortSignal,
): ButtonZone {
  const zone = createZone(0);
  zone.textContent = label;
  zone.setAttribute("role", "button");
  Object.assign(zone.style, {
    right: `${TOUCH_MARGIN_PX}px`,
    bottom: `${TOUCH_MARGIN_PX + row * (TOUCH_BUTTON_HEIGHT_PX + TOUCH_BUTTON_GAP_PX)}px`,
    width: `min(${TOUCH_BUTTON_WIDTH_PX}px, calc(100vw - ${TOUCH_PAD_SIZE_PX + 3 * TOUCH_MARGIN_PX}px))`,
    height: `${TOUCH_BUTTON_HEIGHT_PX}px`,
    boxSizing: "border-box",
    border: `${TOUCH_BUTTON_BORDER_PX}px solid`,
    fontWeight: "700",
    whiteSpace: "nowrap",
  });
  layer.appendChild(zone);

  let enabled = true;
  let held = false;
  const paint = (): void => {
    const tone = enabled ? INK : FADED;
    zone.style.borderColor = tone;
    zone.style.color = held ? PAPER : tone;
    zone.style.background = held ? tone : PAPER;
    zone.setAttribute("aria-disabled", String(!enabled));
  };
  paint();

  zone.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      zone.setPointerCapture(event.pointerId);
      latch.press();
      held = true;
      paint();
    },
    { signal },
  );
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    zone.addEventListener(
      name,
      () => {
        latch.release();
        held = false;
        paint();
      },
      { signal },
    );

  return {
    setEnabled: (next) => {
      if (next === enabled) return;
      enabled = next;
      paint();
    },
  };
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

  const pad = createZone(TOUCH_PAD_SIZE_PX);
  pad.innerHTML = PAD_SHAPE;
  pad.style.left = `${TOUCH_MARGIN_PX}px`;
  pad.style.bottom = `${TOUCH_MARGIN_PX}px`;
  layer.appendChild(pad);
  const zones = new Map<PadButton, ButtonZone>();
  for (const button of buttons)
    zones.set(
      button.button,
      createButtonZone(layer, button, latches[button.button], signal),
    );

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
    setEnabled: (button, enabled) => zones.get(button)?.setEnabled(enabled),
    hide: () => {
      if (!visible) return;
      visible = false;
      layout();
    },
  };
}
