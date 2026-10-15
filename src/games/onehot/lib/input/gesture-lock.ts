import { TAP_SLOP_PX } from "../../constants";

const TAPPABLE = "a, button, dialog";
const SCROLLABLE = "dialog";
const NATIVE_CONTROLS = "input, textarea, select, [contenteditable]";

type GestureEvent = Event & { scale?: number };

function closestOf(
  target: EventTarget | null,
  selector: string,
): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

export function lockTouchGestures(signal?: AbortSignal): void {
  const active = { passive: false, capture: true, signal } as const;
  let start: { x: number; y: number } | null = null;

  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      const single = event.touches.length === 1 && touch;
      start = single ? { x: touch.clientX, y: touch.clientY } : null;
      if (!event.cancelable) return;
      if (!single || !closestOf(event.target, TAPPABLE)) event.preventDefault();
    },
    active,
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (!event.cancelable) return;
      const scrolls =
        event.touches.length === 1 && closestOf(event.target, SCROLLABLE);
      if (!scrolls) event.preventDefault();
    },
    active,
  );

  document.addEventListener(
    "touchend",
    (event) => {
      const began = start;
      start = null;
      if (!event.cancelable || closestOf(event.target, NATIVE_CONTROLS)) return;
      event.preventDefault();
      const touch = event.changedTouches[0];
      if (!began || !touch || event.touches.length > 0) return;
      const moved = Math.hypot(
        touch.clientX - began.x,
        touch.clientY - began.y,
      );
      if (moved > TAP_SLOP_PX) return;
      if (
        event.target instanceof HTMLElement &&
        closestOf(event.target, TAPPABLE)
      )
        event.target.click();
    },
    active,
  );

  for (const name of [
    "gesturestart",
    "gesturechange",
    "gestureend",
    "dblclick",
  ])
    document.addEventListener(
      name,
      (event: GestureEvent) => {
        if (event.cancelable) event.preventDefault();
      },
      active,
    );
}
