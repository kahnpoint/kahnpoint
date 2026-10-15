export type GateDepthNode = {
  gives: number | null;
  step: number | undefined;
};

export const GATE_DEPTH_BLACK = 0x1b1b1b;
export const GATE_DEPTH_LIGHT = 0xcfcfcf;

export function maxPoweredGateDepth(
  gateKeys: Iterable<string>,
  evaluation: ReadonlyMap<string, GateDepthNode>,
): number {
  let maximum = 0;
  for (const key of gateKeys) {
    const node = evaluation.get(key);
    if (node?.gives === null || node?.gives === undefined) continue;
    if (node.step !== undefined && Number.isFinite(node.step))
      maximum = Math.max(maximum, node.step);
  }
  return maximum;
}

export function gateDepthColor(step: number, maximum: number): number {
  const progress =
    maximum <= 1 ? 0 : Math.max(0, Math.min(1, (step - 1) / (maximum - 1)));
  const darkest = GATE_DEPTH_BLACK & 0xff;
  const lightest = GATE_DEPTH_LIGHT & 0xff;
  const shade = Math.round(darkest + (lightest - darkest) * progress);
  return shade * 0x010101;
}

export function cssGateDepthColor(step: number, maximum: number): string {
  return `#${gateDepthColor(step, maximum).toString(16).padStart(6, "0")}`;
}
