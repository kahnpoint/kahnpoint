import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".")) {
      for (const suffix of [".ts", "/index.ts"]) {
        const candidate = new URL(specifier + suffix, context.parentURL);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { createDemoBoard } =
  await import("../../../src/games/onehot/board/core/demo-board.ts");
const { evaluateBoard } =
  await import("../../../src/games/onehot/board/rules/evaluate.ts");
const certificatePath = process.argv[2] ?? "/tmp/onehot-board-witnesses.bin";
const stored = readFileSync(certificatePath);
const bytes = certificatePath.endsWith(".gz") ? gunzipSync(stored) : stored;
assert.equal(bytes.length % 136, 0, "incomplete board certificate");
const board = createDemoBoard(() => 0);
const seen = new Set<number>();
const histogram: Record<number, number> = {};
const gateCountHistogram: Record<number, number> = {};
let smallestWitness = Infinity;
let largestWitness = 0;
const started = performance.now();
const deliveryMode = process.argv.includes("--deliver");

for (let offset = 0; offset + 136 <= bytes.length; offset += 136) {
  const pattern = bytes.readUInt16LE(offset);
  const outputCell = bytes.readUInt16LE(offset + 2);
  const expectedDepth = bytes.readUInt16LE(offset + 4);
  const expectedGates = bytes.readUInt16LE(offset + 6);
  assert.ok(!seen.has(pattern), `duplicate certificate for ${pattern}`);
  seen.add(pattern);
  board.gates.clear();
  for (let cell = 0; cell < 1024; cell++) {
    if (!(bytes[offset + 8 + Math.floor(cell / 8)] & (1 << (cell % 8))))
      continue;
    const position = { x: cell % 32, y: Math.floor(cell / 32) };
    const key = `${position.x},${position.y}`;
    assert.ok(!board.terrain.has(key));
    board.gates.set(key, { id: board.gates.size + 1, cell: position });
  }
  assert.equal(board.gates.size, expectedGates);
  const outputKey = `${outputCell % 32},${Math.floor(outputCell / 32)}`;
  if (deliveryMode) {
    for (const terrain of board.terrain.values())
      if (terrain.type === "target") terrain.pattern = pattern;
  }
  const evaluation = evaluateBoard(board);
  const output = evaluation.get(outputKey);
  assert.equal(
    output?.gives,
    pattern,
    `wrong output for pattern ${pattern} at ${outputKey}`,
  );
  assert.equal(
    output?.step,
    expectedDepth,
    `wrong depth for pattern ${pattern}`,
  );
  if (deliveryMode) {
    assert.ok(
      [...board.terrain.entries()].some(
        ([key, terrain]) =>
          terrain.type === "target" &&
          evaluation.get(key)?.lit &&
          evaluation.get(key).takes.some((take) => take.pattern === pattern),
      ),
      `pattern ${pattern} does not reach any target`,
    );
  }
  histogram[expectedDepth] = (histogram[expectedDepth] ?? 0) + 1;
  gateCountHistogram[expectedGates] =
    (gateCountHistogram[expectedGates] ?? 0) + 1;
  smallestWitness = Math.min(smallestWitness, expectedGates);
  largestWitness = Math.max(largestWitness, expectedGates);
  if (seen.size % 10000 === 0)
    console.log(`Verified ${seen.size} actual board states`);
}

const report = {
  patterns: seen.size,
  deliveryMode,
  smallestWitness,
  largestWitness,
  depthHistogram: histogram,
  gateCountHistogram,
  seconds: (performance.now() - started) / 1000,
};
console.log(JSON.stringify(report, null, 2));
if (!process.argv.includes("--partial")) assert.equal(seen.size, 65536);
if (process.env.ONEHOT_PROOF_REPORT)
  writeFileSync(
    process.env.ONEHOT_PROOF_REPORT,
    JSON.stringify(report, null, 2) + "\n",
  );
