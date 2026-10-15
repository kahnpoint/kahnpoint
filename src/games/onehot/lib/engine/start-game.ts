import { AUTO, Core, Game, Scale } from "phaser";
import type { Types } from "phaser";
import { MAX_PIXEL_RATIO } from "../../constants";

function deviceSize(container: HTMLElement): {
  width: number;
  height: number;
  zoom: number;
} {
  const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  return {
    width: Math.max(1, Math.round(container.clientWidth * ratio)),
    height: Math.max(1, Math.round(container.clientHeight * ratio)),
    zoom: 1 / ratio,
  };
}

export function startGame(
  scene: Types.Scenes.SceneType,
  container: HTMLElement,
): Game {
  const game = new Game({
    type: AUTO,
    parent: container,
    backgroundColor: "#ffffff",
    render: { roundPixels: false },
    input: { gamepad: true, keyboard: true, touch: false, mouse: false },
    scale: { mode: Scale.NONE, ...deviceSize(container) },
    scene: [scene],
  });
  const resizeObserver = new ResizeObserver(() => {
    const { width, height, zoom } = deviceSize(container);
    game.scale.resize(width, height);
    game.scale.setZoom(zoom);
  });
  resizeObserver.observe(container);
  game.events.once(Core.Events.DESTROY, () => resizeObserver.disconnect());
  return game;
}
