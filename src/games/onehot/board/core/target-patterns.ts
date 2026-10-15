import { combinePatterns, FULL_PATTERN, sourcePatternsOf } from "./patterns";
import type { Pattern } from "./types";

export const TARGETS_PER_STAGE = 4;

const MAX_PATTERN = FULL_PATTERN;
const patternSteps = new Int32Array(MAX_PATTERN + 1);
patternSteps.fill(-1);
const patternsByStep: Pattern[][] = [[]];
const sources = sourcePatternsOf();
const sourceSet = new Set(sources);
let allPatterns: Pattern[] | undefined;
const levelBudgets: number[] = [];

type RecipeNode = { pattern: Pattern; inputs: number[] };

function fallbackRecipeCosts(): Map<Pattern, number> {
  const nodes: RecipeNode[] = sources.map((pattern) => ({
    pattern,
    inputs: [],
  }));
  const fullId = sources.indexOf(FULL_PATTERN);
  const interned = new Map<string, number>();

  const addGate = (inputs: number[]): number => {
    const ordered = [...inputs].sort((a, b) => a - b);
    const key = ordered.join(",");
    const existing = interned.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push({
      pattern: combinePatterns(ordered.map((input) => nodes[input].pattern)),
      inputs: ordered,
    });
    interned.set(key, id);
    return id;
  };

  const negatedCoordinates = sources
    .slice(0, 4)
    .map((_, index) => addGate([fullId, index]));
  const pixels: number[] = [];
  for (let pixel = 0; pixel < 16; pixel++) {
    let result = -1;
    for (let bit = 0; bit < 4; bit++) {
      const literal = pixel & (1 << bit) ? bit : negatedCoordinates[bit];
      if (result < 0) {
        result = literal;
        continue;
      }
      const notResult = addGate([fullId, result]);
      const notLiteral = addGate([fullId, literal]);
      result = addGate([fullId, notResult, notLiteral]);
    }
    pixels.push(result);
  }

  const costs = new Map<Pattern, number>();
  for (let pattern = 1; pattern <= MAX_PATTERN; pattern++) {
    if (patternSteps[pattern] >= 0) continue;
    const selectedPixels = pixels.filter((_, pixel) => pattern & (1 << pixel));
    let result = selectedPixels[0];
    for (let pixel = 1; pixel < selectedPixels.length; pixel++) {
      result = addGate([result, selectedPixels[pixel]]);
    }
    if (nodes[result].pattern !== pattern) {
      throw new Error(`Fallback recipe did not produce pattern ${pattern}.`);
    }

    const visited = new Set<number>();
    const visit = (node: number) => {
      if (visited.has(node)) return;
      visited.add(node);
      for (const input of nodes[node].inputs) visit(input);
    };
    visit(result);
    let gateCount = 0;
    for (const node of visited) {
      if (nodes[node].inputs.length > 0) gateCount++;
    }
    costs.set(pattern, Math.max(3, gateCount));
  }
  return costs;
}

function buildRecipePools(): void {
  if (allPatterns) return;

  const queue: Pattern[] = [];
  for (const source of sources) patternSteps[source] = 0;

  for (let first = 0; first < sources.length; first++) {
    for (let second = first + 1; second < sources.length; second++) {
      const pattern = combinePatterns([sources[first], sources[second]]);
      if (patternSteps[pattern] < 0) {
        patternSteps[pattern] = 1;
        (patternsByStep[1] ??= []).push(pattern);
        queue.push(pattern);
      }
    }
  }

  for (let index = 0; index < queue.length; index++) {
    const previous = queue[index];
    const previousStep = patternSteps[previous];
    const nextStep = previousStep + 1;
    const add = (pattern: Pattern) => {
      if (patternSteps[pattern] >= 0) return;
      patternSteps[pattern] = nextStep;
      (patternsByStep[nextStep] ??= []).push(pattern);
      queue.push(pattern);
    };

    for (const source of sources) {
      add(combinePatterns([previous, source]));
    }

    if (previousStep >= 2) {
      for (let first = 0; first < sources.length; first++) {
        for (let second = first + 1; second < sources.length; second++) {
          add(combinePatterns([previous, sources[first], sources[second]]));
        }
      }
    }
  }

  for (const [pattern, cost] of fallbackRecipeCosts()) {
    patternSteps[pattern] = cost;
    (patternsByStep[cost] ??= []).push(pattern);
  }

  allPatterns = [];
  for (let step = 1; step < patternsByStep.length; step++) {
    allPatterns.push(...(patternsByStep[step] ?? []));
    if ((patternsByStep[step] ?? []).some((pattern) => pattern !== 0))
      levelBudgets.push(step);
  }
}

export const TOTAL_LEVELS = (() => {
  buildRecipePools();
  return levelBudgets.length;
})();

export function targetLevelFor(completedTargets: number): number {
  const completed = Number.isFinite(completedTargets)
    ? Math.max(0, Math.floor(completedTargets))
    : 0;
  return Math.min(TOTAL_LEVELS, 1 + Math.floor(completed / TARGETS_PER_STAGE));
}

export function chooseEndlessPattern(
  random: () => number,
  existingPatterns: readonly Pattern[] = [],
): Pattern {
  let pattern = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    pattern =
      1 +
      Math.min(
        FULL_PATTERN - 1,
        Math.max(0, Math.floor(random() * FULL_PATTERN)),
      );
    if (!existingPatterns.includes(pattern)) break;
  }
  return pattern;
}

function isEligibleTarget(pattern: Pattern): boolean {
  return pattern !== 0;
}

function unlockedPatterns(completedTargets: number): Pattern[] {
  buildRecipePools();
  const complexity = targetComplexityFor(completedTargets);
  const patterns: Pattern[] = [];
  for (let step = 1; step <= complexity; step++) {
    for (const pattern of patternsByStep[step] ?? []) {
      if (
        isEligibleTarget(pattern) &&
        (complexity >= 3 || !sourceSet.has(pattern))
      ) {
        patterns.push(pattern);
      }
    }
  }
  if (complexity >= 3) {
    for (const source of sources) {
      if (!patterns.includes(source)) patterns.push(source);
    }
  }
  return patterns;
}

export function targetComplexityFor(completedTargets: number): number {
  return levelBudgets[targetLevelFor(completedTargets) - 1];
}

export function targetPatternsFor(
  completedTargets: number,
): readonly Pattern[] {
  return unlockedPatterns(completedTargets);
}

export function recipeStepCount(pattern: Pattern): number | null {
  buildRecipePools();
  if (!Number.isInteger(pattern) || pattern < 0 || pattern > MAX_PATTERN)
    return null;
  return patternSteps[pattern] < 0 ? null : patternSteps[pattern];
}

export function chooseTargetPattern(
  completedTargets: number,
  random: () => number,
  excludedPatterns: readonly number[] = [],
): Pattern {
  const patterns = unlockedPatterns(completedTargets);
  const excluded = new Set(excludedPatterns);
  let candidates = patterns.filter((pattern) => !excluded.has(pattern));

  if (candidates.length === 0) candidates = patterns;
  if (candidates.length === 0) {
    throw new Error(
      "No target recipe is available at the current progression stage.",
    );
  }

  const sample = random();
  const index = Number.isFinite(sample)
    ? Math.min(
        candidates.length - 1,
        Math.max(0, Math.floor(sample * candidates.length)),
      )
    : 0;
  return candidates[index];
}
