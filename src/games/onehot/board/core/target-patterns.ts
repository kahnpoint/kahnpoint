import verifiedCosts from "../../data/pattern-costs.json" with { type: "json" };
import { FULL_PATTERN } from "./patterns";
import type { Pattern } from "./types";

export const TARGETS_PER_STAGE = 4;
export function buildLevelGateCaps(
  costs: readonly number[],
): readonly number[] {
  const available = [...new Set(costs)].sort((left, right) => left - right);
  if (!available.length)
    throw new Error("No verified gate costs are available.");
  const maximum = available[available.length - 1]!;
  const caps: number[] = [];
  for (const requested of [
    1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20,
  ]) {
    const cap = Math.min(requested, maximum);
    const previous = caps[caps.length - 1] ?? 0;
    if (available.some((cost) => cost > previous && cost <= cap))
      caps.push(cap);
  }
  const remaining = available.filter(
    (cost) => cost > (caps[caps.length - 1] ?? 0),
  );
  const groups = Math.min(20 - caps.length, remaining.length);
  for (let group = 1; group <= groups; group++)
    caps.push(remaining[Math.ceil((group * remaining.length) / groups) - 1]!);
  return caps;
}

export const LEVEL_GATE_CAPS = buildLevelGateCaps(verifiedCosts);
export const TOTAL_LEVELS = LEVEL_GATE_CAPS.length;

let cachedLevel = 0;
let cachedPatterns: Pattern[] = [];

export function targetLevelFor(completedTargets: number): number {
  const completed = Number.isFinite(completedTargets)
    ? Math.max(0, Math.floor(completedTargets))
    : 0;
  return Math.min(TOTAL_LEVELS, 1 + Math.floor(completed / TARGETS_PER_STAGE));
}

export function targetComplexityFor(completedTargets: number): number {
  return LEVEL_GATE_CAPS[targetLevelFor(completedTargets) - 1]!;
}

export function targetLevelForGateCost(gateCost: number): number {
  const level = LEVEL_GATE_CAPS.findIndex((cap) => gateCost <= cap);
  return level < 0 ? TOTAL_LEVELS : level + 1;
}

export function verifiedGateCount(pattern: Pattern): number | null {
  return Number.isInteger(pattern) && pattern >= 0 && pattern <= FULL_PATTERN
    ? verifiedCosts[pattern]
    : null;
}

export function targetPatternsFor(
  completedTargets: number,
): readonly Pattern[] {
  const level = targetLevelFor(completedTargets);
  const gateCap = LEVEL_GATE_CAPS[level - 1]!;
  const previousCap = LEVEL_GATE_CAPS[level - 2] ?? 0;
  if (cachedLevel !== level) {
    cachedPatterns = [];
    for (let pattern = 0; pattern <= FULL_PATTERN; pattern++) {
      const gateCost = verifiedCosts[pattern];
      if (gateCost > previousCap && gateCost <= gateCap)
        cachedPatterns.push(pattern);
    }
    cachedLevel = level;
  }
  return cachedPatterns;
}

export function chooseEndlessPattern(
  random: () => number,
  existingPatterns: readonly Pattern[] = [],
): Pattern {
  let pattern = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    pattern = Math.min(
      FULL_PATTERN,
      Math.max(0, Math.floor(random() * (FULL_PATTERN + 1))),
    );
    if (!existingPatterns.includes(pattern)) break;
  }
  return pattern;
}

export function chooseTargetPattern(
  completedTargets: number,
  random: () => number,
  excludedPatterns: readonly Pattern[] = [],
): Pattern {
  const patterns = targetPatternsFor(completedTargets);
  const excluded = new Set(excludedPatterns);
  let candidates = patterns.filter((pattern) => !excluded.has(pattern));
  if (candidates.length === 0) candidates = [...patterns];
  if (candidates.length === 0)
    throw new Error("No verified target is available at this level.");
  const sample = random();
  const index = Number.isFinite(sample)
    ? Math.min(
        candidates.length - 1,
        Math.max(0, Math.floor(sample * candidates.length)),
      )
    : 0;
  return candidates[index];
}
