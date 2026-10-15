import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const RECORD_BYTES = 136;
const PATTERN_COUNT = 65536;
type SourceManifestEntry = { sha256: string; records: number };
type CellPattern = { x: number; y: number; pattern: number };
type Cell = { x: number; y: number };
const inputs: string[] = [];
let outputDirectory: string | undefined;

for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === "--help" || argument === "-h") {
    console.log("Usage: pnpm onehot:build WITNESS_ARCHIVE... --output-dir DIR");
    process.exit(0);
  }
  if (argument === "--output-dir") {
    outputDirectory = process.argv[++index];
    assert.ok(outputDirectory, "Supply a path after --output-dir");
  } else {
    assert.ok(!argument.startsWith("-"), "Unknown option " + argument);
    inputs.push(argument);
  }
}

assert.ok(inputs.length > 0, "Supply one or more verified witness archives");
assert.ok(
  outputDirectory,
  "Supply --output-dir so the build cannot overwrite the locked public distribution",
);
const outputRoot = resolve(outputDirectory);
assert.ok(
  !existsSync(outputRoot),
  "Output directory already exists: " + outputRoot,
);
const records: (Buffer | undefined)[] = new Array(PATTERN_COUNT);
const sourceManifest: SourceManifestEntry[] = [];

for (const input of inputs) {
  const stored = readFileSync(input);
  const bytes = input.endsWith(".gz") ? gunzipSync(stored) : stored;
  assert.equal(
    bytes.length % RECORD_BYTES,
    0,
    "Incomplete witness record in " + input,
  );
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += RECORD_BYTES) {
    const pattern = bytes.readUInt16LE(offset);
    assert.ok(pattern < PATTERN_COUNT);
    const record = Buffer.from(bytes.subarray(offset, offset + RECORD_BYTES));
    const previous = records[pattern];
    if (
      !previous ||
      record.readUInt16LE(6) < previous.readUInt16LE(6) ||
      (record.readUInt16LE(6) === previous.readUInt16LE(6) &&
        record.readUInt16LE(4) < previous.readUInt16LE(4))
    )
      records[pattern] = record;
    count++;
  }
  sourceManifest.push({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    records: count,
  });
}

assert.equal(
  records.filter(Boolean).length,
  PATTERN_COUNT,
  "Witness inputs must cover all 65,536 patterns",
);

const completeRecords = records as Buffer[];
for (const original of completeRecords) {
  const pattern = original.readUInt16LE(0);
  let transposedPattern = 0;
  for (let pixel = 0; pixel < 16; pixel++) {
    const transposedPixel =
      (pixel & 9) | ((pixel & 2) << 1) | ((pixel & 4) >> 1);
    if (pattern & (1 << pixel)) transposedPattern |= 1 << transposedPixel;
  }
  const previous = records[transposedPattern]!;
  if (previous.readUInt16LE(6) <= original.readUInt16LE(6)) continue;
  const transposedRecord = Buffer.alloc(RECORD_BYTES);
  transposedRecord.writeUInt16LE(transposedPattern, 0);
  const outputCell = original.readUInt16LE(2);
  transposedRecord.writeUInt16LE(
    (outputCell % 32) * 32 + Math.floor(outputCell / 32),
    2,
  );
  original.copy(transposedRecord, 4, 4, 8);
  for (let cell = 0; cell < 1024; cell++) {
    if (!(original[8 + (cell >> 3)] & (1 << (cell & 7)))) continue;
    const transposedCell = (cell % 32) * 32 + Math.floor(cell / 32);
    transposedRecord[8 + (transposedCell >> 3)] |= 1 << (transposedCell & 7);
  }
  records[transposedPattern] = transposedRecord;
}

const costs = completeRecords.map((record, pattern) => {
  assert.equal(record.readUInt16LE(0), pattern, "Witness index mismatch");
  return record.readUInt16LE(6);
});
const histogram: Record<number, number> = {};
for (const cost of costs) histogram[cost] = (histogram[cost] ?? 0) + 1;
const bytes = Buffer.concat(completeRecords);
const compressed = gzipSync(bytes, { level: 9 });
const sources: CellPattern[] = [
  { x: 12, y: 12, pattern: 0xaaaa },
  { x: 20, y: 12, pattern: 0xcccc },
  { x: 12, y: 20, pattern: 0xf0f0 },
  { x: 20, y: 20, pattern: 0xff00 },
  { x: 16, y: 16, pattern: 0xffff },
];
const targets: Cell[] = [
  { x: 6, y: 6 },
  { x: 25, y: 6 },
  { x: 6, y: 25 },
  { x: 25, y: 25 },
];
const manifest = {
  version: 1,
  width: 32,
  height: 32,
  patterns: PATTERN_COUNT,
  minimumPrimitiveCount: 5,
  primitiveLowerBound:
    "Four sources provide at most fifteen distinct nonzero pixel signatures; sixteen independently selectable pixels require at least five.",
  sources,
  targets,
  recordBytes: RECORD_BYTES,
  recordOrder: "pattern",
  recordFields: [
    "pattern:uint16le",
    "outputCell:uint16le",
    "outputDepth:uint16le",
    "placedGates:uint16le",
    "gateCells:1024bits-lsb-first",
  ],
  sha256: createHash("sha256").update(bytes).digest("hex"),
  archiveGzipSha256: createHash("sha256").update(compressed).digest("hex"),
  difficulty:
    "Placed gates in the selected verified target-delivery witness; gate counts do not claim global optimality.",
  minimumGateCount: Math.min(...costs),
  maximumGateCount: Math.max(...costs),
  gateCountHistogram: histogram,
  witnessInputs: sourceManifest,
};

mkdirSync(outputRoot, { recursive: true });
writeFileSync(
  join(outputRoot, "pattern-costs.json"),
  JSON.stringify(costs) + "\n",
);
writeFileSync(join(outputRoot, "boards.bin.gz"), compressed);
writeFileSync(
  join(outputRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    patterns: costs.length,
    minimum: manifest.minimumGateCount,
    maximum: manifest.maximumGateCount,
    compressedBytes: compressed.length,
    outputDirectory: outputRoot,
  }),
);
