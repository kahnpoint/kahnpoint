#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  init,
  killThreads,
  type BitVec as Z3BitVec,
  type Bool as Z3Bool,
} from "z3-solver";

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

const sourceFile = fileURLToPath(import.meta.url);
let projectRoot = dirname(sourceFile);
while (
  !existsSync(join(projectRoot, "src/games/onehot/board/core/demo-board.ts"))
) {
  const parent = dirname(projectRoot);
  if (parent === projectRoot)
    throw new Error("cannot find the One Hot source tree");
  projectRoot = parent;
}
const { createDemoBoard, DEMO_SOURCES } = (await import(
  pathToFileURL(join(projectRoot, "src/games/onehot/board/core/demo-board.ts"))
    .href
)) as typeof import("../../../src/games/onehot/board/core/demo-board");
const { evaluateBoard } = (await import(
  pathToFileURL(join(projectRoot, "src/games/onehot/board/rules/evaluate.ts"))
    .href
)) as typeof import("../../../src/games/onehot/board/rules/evaluate");
const { DEMO_WIDTH, DEMO_HEIGHT } = (await import(
  pathToFileURL(join(projectRoot, "src/games/onehot/constants.ts")).href
)) as typeof import("../../../src/games/onehot/constants");

const BOARD_SIDE = DEMO_WIDTH;
const RECORD_BYTES = 136;
const sourceCells = DEMO_SOURCES.map(({ cell, pattern }) => ({
  x: cell.x,
  y: cell.y,
  pattern,
}));
const initialBoard = createDemoBoard(() => 0);
const targetCells = [...initialBoard.terrain.entries()]
  .filter(([, terrain]) => terrain.type === "target")
  .map(([key]) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });
const fixedCells = [...sourceCells, ...targetCells];
const fixedKeys = new Set(fixedCells.map(({ x, y }) => `${x},${y}`));

assert.equal(BOARD_SIDE, 32);
assert.equal(DEMO_HEIGHT, 32);
assert.equal(sourceCells.length, 5);
assert.equal(targetCells.length, 4);
for (const sourceCell of sourceCells)
  for (const targetCell of targetCells)
    assert.ok(sourceCell.x !== targetCell.x && sourceCell.y !== targetCell.y);

type Witness = {
  pattern: number;
  gateCount: number;
  gates: { x: number; y: number }[];
  outputCell: number;
  outputDepth: number;
  target: { x: number; y: number };
};

type Options = {
  command: "check" | "minimum" | "enumerate";
  gates: number;
  pattern?: number;
  output?: string;
  checkReceipt?: string;
  connectedLowerBounds?: string;
  excludes: string[];
  minimal: boolean;
  transpose: boolean;
  randomSeed?: number;
  timeoutMs: number;
};

type ImproveOptions = {
  pattern?: number;
  input: string;
  output: string;
  remove: number;
  add: number;
  intersections: boolean;
  freshAxisPairs: boolean;
  neutralDouble: boolean;
  limit?: number;
};

const helpText = [
  "One Hot physical board solver",
  "",
  "Exact search:",
  "  check --gates N --pattern 0xFFFF [--output record.bin] [--check-receipt receipt.json] [--connected-lower-bounds table.bin] [--timeout-ms MS]",
  "  minimum --gates N --pattern 0xFFFF [--output record.bin] [--timeout-ms MS]",
  "  enumerate --gates N --output records.bin [--exclude completed.bin] [--minimal] [--transpose] [--seed INTEGER] [--timeout-ms MS]",
  "",
  "Local improvement:",
  "  improve --pattern 0xFFFF --input archive.bin.gz --output record.bin [--remove 2] [--add 1] [--intersections]",
  "  improve --input archive.bin.gz --output archive.bin.gz --limit 100 [--remove 2] [--add 1] [--intersections]",
  "  improve --pattern 0xFFFF --input archive.bin.gz --output record.bin --remove 3 --add 2 --fresh-axis-pairs",
  "  improve --pattern 0xFFFF --input archive.bin.gz --output record.bin --neutral-double",
  "  invert --pattern 0xFFFF --input archive.bin.gz --output record.bin [--max-checks N] [--timeout-ms MS]",
  "",
  "Exact minimum claims require SAT at N and UNSAT for every smaller count.",
  "An UNKNOWN result does not prove a lower bound. Improve writes a verified witness, not a minimum proof.",
].join("\n");

function parseImproveOptions(argv: string[]): ImproveOptions {
  let pattern: number | undefined;
  let input: string | undefined;
  let output: string | undefined;
  let remove = 2;
  let add = 1;
  let intersections = false;
  let freshAxisPairs = false;
  let neutralDouble = false;
  let limit: number | undefined;
  for (let index = 1; index < argv.length; index++) {
    const option = argv[index];
    if (option === "--pattern") pattern = Number(argv[++index]);
    else if (option === "--input") input = argv[++index];
    else if (option === "--output") output = argv[++index];
    else if (option === "--remove") remove = Number(argv[++index]);
    else if (option === "--add") add = Number(argv[++index]);
    else if (option === "--intersections") intersections = true;
    else if (option === "--fresh-axis-pairs") freshAxisPairs = true;
    else if (option === "--neutral-double") neutralDouble = true;
    else if (option === "--limit") limit = Number(argv[++index]);
    else throw new Error(`unknown improve option ${option}`);
  }
  if (!input || !output) throw new Error("improve needs --input and --output");
  if (
    pattern !== undefined &&
    (!Number.isInteger(pattern) || pattern < 0 || pattern > 65535)
  )
    throw new Error("--pattern must be a 16-bit integer");
  if (
    pattern === undefined &&
    (!Number.isInteger(limit) || limit! < 1 || limit! > 65536)
  )
    throw new Error("batch improve needs --limit from 1 through 65536");
  if (pattern !== undefined && limit !== undefined)
    throw new Error("--limit applies only when --pattern is omitted");
  if (
    !Number.isInteger(remove) ||
    !Number.isInteger(add) ||
    remove <= add ||
    add < 0
  )
    throw new Error("improve needs integer --remove > --add >= 0");
  if (freshAxisPairs && (intersections || add !== 2))
    throw new Error(
      "--fresh-axis-pairs needs --add 2 and excludes --intersections",
    );
  if (
    neutralDouble &&
    (pattern === undefined ||
      limit !== undefined ||
      remove !== 2 ||
      add !== 1 ||
      intersections ||
      freshAxisPairs)
  )
    throw new Error(
      "--neutral-double needs one pattern and no other improve search options",
    );
  return {
    pattern,
    input,
    output,
    remove,
    add,
    intersections,
    freshAxisPairs,
    neutralDouble,
    limit,
  };
}

function parseOptions(argv: string[]): Options {
  const command = argv[0];
  if (command !== "check" && command !== "minimum" && command !== "enumerate")
    throw new Error("command must be check, minimum, or enumerate");
  let gates: number | undefined;
  let pattern: number | undefined;
  let output: string | undefined;
  let checkReceipt: string | undefined;
  let connectedLowerBounds: string | undefined;
  let minimal = false;
  let transpose = false;
  let randomSeed: number | undefined;
  let timeoutMs = 0;
  const excludes: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    const option = argv[index];
    if (option === "--minimal") minimal = true;
    else if (option === "--transpose") transpose = true;
    else if (option === "--seed") randomSeed = Number(argv[++index]);
    else if (option === "--gates") gates = Number(argv[++index]);
    else if (option === "--pattern") pattern = Number(argv[++index]);
    else if (option === "--output") output = argv[++index];
    else if (option === "--check-receipt") checkReceipt = argv[++index];
    else if (option === "--connected-lower-bounds") {
      connectedLowerBounds = argv[++index];
      if (!connectedLowerBounds || connectedLowerBounds.startsWith("--"))
        throw new Error("--connected-lower-bounds needs a table path");
    } else if (option === "--exclude") excludes.push(argv[++index]!);
    else if (option === "--timeout-ms") timeoutMs = Number(argv[++index]);
    else throw new Error(`unknown option ${option}`);
  }
  if (!Number.isInteger(gates) || gates! < 1 || gates! > 1015)
    throw new Error("--gates must be an integer from 1 through 1015");
  if (
    pattern !== undefined &&
    (!Number.isInteger(pattern) || pattern < 0 || pattern > 65535)
  )
    throw new Error("--pattern must be a 16-bit integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0)
    throw new Error("--timeout-ms must be a nonnegative integer");
  if (
    checkReceipt !== undefined &&
    (!checkReceipt || checkReceipt.startsWith("--"))
  )
    throw new Error("--check-receipt needs a file path");
  if (checkReceipt && output && resolve(checkReceipt) === resolve(output))
    throw new Error("--check-receipt and --output need distinct paths");
  if (connectedLowerBounds && (command !== "check" || !checkReceipt))
    throw new Error(
      "--connected-lower-bounds needs a table path and check --check-receipt",
    );
  if (
    randomSeed !== undefined &&
    (!Number.isInteger(randomSeed) || randomSeed < 0 || randomSeed > 2147483647)
  )
    throw new Error("--seed must be an integer from 0 through 2147483647");
  if (command === "enumerate") {
    if (
      !output ||
      pattern !== undefined ||
      checkReceipt ||
      connectedLowerBounds
    )
      throw new Error("enumerate needs --output and no --pattern");
    if (minimal && excludes.length === 0)
      throw new Error("--minimal needs completed lower-cost exclusions");
  } else {
    if (command === "minimum" && (checkReceipt || connectedLowerBounds))
      throw new Error(
        "receipt and connected bound options apply only to check",
      );
    if (pattern === undefined || excludes.length || minimal || transpose)
      throw new Error(
        `${command} needs --pattern and cannot take --exclude, --minimal, or --transpose`,
      );
  }
  return {
    command,
    gates: gates!,
    pattern,
    output,
    checkReceipt,
    connectedLowerBounds,
    excludes,
    minimal,
    transpose,
    randomSeed,
    timeoutMs,
  };
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const reviewedLowerBoundHash =
  "9858b855bad5c18ad7ed6234214612d633d1a34f7b415c974534dd39a795ef6f";
const reviewedBoardSourceHashes = {
  "src/games/onehot/board/core/demo-board.ts":
    "4445f919265515a67a6fd2b611dc6ec32416321924eda440ca67c7fa3c0ebaf7",
  "src/games/onehot/board/rules/evaluate.ts":
    "1ec6c55884d408d01534c4bdef9aec1259fd9cb1ee2514286ef8c366bb4e0328",
  "src/games/onehot/board/rules/sight.ts":
    "1f88c7e5abd1b5c8d68d6f02dfd6a3b523d13999c0c3084c96f9fb7aa1771893",
  "src/games/onehot/board/core/patterns.ts":
    "d3d78b741520139768dc03d051171e7294276d620981abc8288964967d88e7a0",
};

function checkedConnectedLowerBounds(
  path: string,
  pattern: number,
  gates: number,
): { path: string; sha256: string; pattern_lower_bound: number } {
  const resolvedPath = resolve(path);
  const tableBytes = readFileSync(resolvedPath);
  assert.equal(tableBytes.length, 65536);
  const tableHash = sha256Bytes(tableBytes);
  assert.equal(tableHash, reviewedLowerBoundHash);
  assert.equal(tableBytes[pattern], gates);
  const manifest = JSON.parse(readFileSync(`${resolvedPath}.json`, "utf8")) as {
    lowerBoundsSha256: string;
    boardSourceSha256: Record<string, string>;
    sourceCells: typeof sourceCells;
    targetCells: typeof targetCells;
  };
  assert.equal(manifest.lowerBoundsSha256, tableHash);
  assert.deepEqual(manifest.sourceCells, sourceCells);
  assert.deepEqual(manifest.targetCells, targetCells);
  for (const [sourcePath, expectedHash] of Object.entries(
    reviewedBoardSourceHashes,
  )) {
    assert.equal(manifest.boardSourceSha256[sourcePath], expectedHash);
    assert.equal(
      sha256Bytes(readFileSync(join(projectRoot, sourcePath))),
      expectedHash,
    );
  }
  return { path: resolvedPath, sha256: tableHash, pattern_lower_bound: gates };
}

function sourceIdentity(): { path: string; hash: string } {
  const sourceBytes = readFileSync(sourceFile);
  return {
    path: relative(process.cwd(), sourceFile),
    hash: sha256Bytes(sourceBytes),
  };
}

function parseRecords(
  path: string,
  expectedGates?: number,
): Map<number, Buffer> {
  const bytes = readFileSync(path);
  if (bytes.length % RECORD_BYTES)
    throw new Error(`${path} has an incomplete record`);
  const records = new Map<number, Buffer>();
  for (let offset = 0; offset < bytes.length; offset += RECORD_BYTES) {
    const record = Buffer.from(bytes.subarray(offset, offset + RECORD_BYTES));
    const pattern = record.readUInt16LE(0);
    const gates = record.readUInt16LE(6);
    if (expectedGates !== undefined && gates !== expectedGates)
      throw new Error(
        `${path} has a ${gates}-gate record, expected ${expectedGates}`,
      );
    if (records.has(pattern))
      throw new Error(`${path} repeats pattern ${pattern}`);
    verifyRecord(record);
    records.set(pattern, record);
  }
  return records;
}

function verifyRecord(record: Buffer): void {
  const pattern = record.readUInt16LE(0);
  const outputCell = record.readUInt16LE(2);
  const depth = record.readUInt16LE(4);
  const gates = record.readUInt16LE(6);
  if (outputCell >= BOARD_SIDE * DEMO_HEIGHT || depth < 1 || depth > gates)
    throw new Error(`invalid output cell or depth for ${pattern}`);
  const board = createDemoBoard(() => 0);
  for (const terrain of board.terrain.values())
    if (terrain.type === "target") terrain.pattern = pattern;
  for (let cell = 0; cell < BOARD_SIDE * DEMO_HEIGHT; cell++) {
    if (!(record[8 + (cell >> 3)]! & (1 << (cell & 7)))) continue;
    const x = cell % BOARD_SIDE;
    const y = Math.floor(cell / BOARD_SIDE);
    const key = `${x},${y}`;
    if (fixedKeys.has(key)) throw new Error(`gate on terrain at ${key}`);
    board.gates.set(key, { id: board.gates.size + 1, cell: { x, y } });
  }
  if (board.gates.size !== gates)
    throw new Error(`wrong gate count for ${pattern}`);
  const evaluation = evaluateBoard(board);
  const outputKey = `${outputCell % BOARD_SIDE},${Math.floor(outputCell / BOARD_SIDE)}`;
  const output = evaluation.get(outputKey);
  if (!output || output.gives !== pattern || output.step !== depth)
    throw new Error(`invalid output for ${pattern}`);
  if (
    !targetCells.some(({ x, y }) => {
      const target = evaluation.get(`${x},${y}`);
      return (
        target?.lit && target.takes.some((take) => take.pattern === pattern)
      );
    })
  )
    throw new Error(`pattern ${pattern} does not reach a target`);
}

function recordOf(witness: Witness): Buffer {
  const record = Buffer.alloc(RECORD_BYTES);
  record.writeUInt16LE(witness.pattern, 0);
  record.writeUInt16LE(witness.outputCell, 2);
  record.writeUInt16LE(witness.outputDepth, 4);
  record.writeUInt16LE(witness.gateCount, 6);
  for (const { x, y } of witness.gates) {
    const cell = x + BOARD_SIDE * y;
    record[8 + (cell >> 3)]! |= 1 << (cell & 7);
  }
  verifyRecord(record);
  return record;
}

function transposePattern(pattern: number): number {
  let transposed = 0;
  for (let index = 0; index < 16; index++) {
    const swapped = (index & ~6) | ((index & 2) << 1) | ((index & 4) >> 1);
    transposed |= ((pattern >> index) & 1) << swapped;
  }
  return transposed;
}

function assertTransposeSymmetry(): void {
  for (const source of sourceCells)
    assert.ok(
      sourceCells.some(
        (candidate) =>
          candidate.x === source.y &&
          candidate.y === source.x &&
          candidate.pattern === transposePattern(source.pattern),
      ),
      "sources must be symmetric under board transpose",
    );
  for (const target of targetCells)
    assert.ok(
      targetCells.some(
        (candidate) => candidate.x === target.y && candidate.y === target.x,
      ),
      "targets must be symmetric under board transpose",
    );
}

function transposeRecord(record: Buffer): Buffer {
  const transposed = Buffer.alloc(RECORD_BYTES);
  transposed.writeUInt16LE(transposePattern(record.readUInt16LE(0)), 0);
  const outputCell = record.readUInt16LE(2);
  transposed.writeUInt16LE(
    Math.floor(outputCell / BOARD_SIDE) +
      BOARD_SIDE * (outputCell % BOARD_SIDE),
    2,
  );
  record.copy(transposed, 4, 4, 8);
  for (let cell = 0; cell < BOARD_SIDE * DEMO_HEIGHT; cell++) {
    if (!(record[8 + (cell >> 3)]! & (1 << (cell & 7)))) continue;
    const swapped =
      Math.floor(cell / BOARD_SIDE) + BOARD_SIDE * (cell % BOARD_SIDE);
    transposed[8 + (swapped >> 3)]! |= 1 << (swapped & 7);
  }
  verifyRecord(transposed);
  return transposed;
}

function completedExclusion(path: string): {
  gates: number;
  records: Map<number, Buffer>;
  hash: string;
} {
  const completionPath = `${path}.complete.json`;
  const completion = JSON.parse(readFileSync(completionPath, "utf8"));
  const hash = sha256Bytes(readFileSync(path));
  if (completion.result !== "unsat" || completion.records_sha256 !== hash)
    throw new Error(`${path} lacks matching UNSAT completion metadata`);
  if (!Number.isInteger(completion.gates) || completion.gates < 1)
    throw new Error(`${path} has invalid gate count metadata`);
  const records = parseRecords(path, completion.gates);
  if (completion.new_patterns !== records.size)
    throw new Error(`${path} completion count differs from records`);
  return { gates: completion.gates, records, hash };
}

function improveRecord(
  seed: Buffer,
  pattern: number,
  remove: number,
  add: number,
  intersections: boolean,
  freshAxisPairs: boolean,
  acceptCandidate?: (record: Buffer) => boolean,
): {
  record: Buffer | null;
  checked: number;
  milliseconds: number;
  additionPositions: number;
  additionPairs: number;
} {
  verifyRecord(seed);
  const cellCount = BOARD_SIDE * DEMO_HEIGHT;
  const occupied = new Uint8Array(cellCount);
  const positions: number[] = [];
  for (let cell = 0; cell < cellCount; cell++) {
    if (!(seed[8 + (cell >> 3)]! & (1 << (cell & 7)))) continue;
    occupied[cell] = 1;
    positions.push(cell);
  }
  const sourceIndexes = sourceCells.map(({ x, y }) => x + BOARD_SIDE * y);
  const targetIndexes = targetCells.map(({ x, y }) => x + BOARD_SIDE * y);
  for (const cell of sourceIndexes) occupied[cell] = 2;
  for (const cell of targetIndexes) occupied[cell] = 3;
  const fixedAndPlaced = [...positions, ...sourceIndexes, ...targetIndexes];
  const usedX = [
    ...new Set(fixedAndPlaced.map((cell) => cell % BOARD_SIDE)),
  ].sort((first, second) => first - second);
  const usedY = [
    ...new Set(fixedAndPlaced.map((cell) => Math.floor(cell / BOARD_SIDE))),
  ].sort((first, second) => first - second);
  const additionPairs: [number, number][] = [];
  if (freshAxisPairs) {
    for (let x = 0; x < BOARD_SIDE; x++) {
      if (usedX.includes(x)) continue;
      for (let first = 0; first < usedY.length; first++)
        for (let second = first + 1; second < usedY.length; second++)
          additionPairs.push([
            x + BOARD_SIDE * usedY[first]!,
            x + BOARD_SIDE * usedY[second]!,
          ]);
    }
    for (let y = 0; y < DEMO_HEIGHT; y++) {
      if (usedY.includes(y)) continue;
      for (let first = 0; first < usedX.length; first++)
        for (let second = first + 1; second < usedX.length; second++)
          additionPairs.push([
            usedX[first]! + BOARD_SIDE * y,
            usedX[second]! + BOARD_SIDE * y,
          ]);
    }
  }
  const additionCells = intersections
    ? usedX
        .flatMap((x) => usedY.map((y) => x + BOARD_SIDE * y))
        .sort((a, b) => a - b)
    : freshAxisPairs
      ? []
      : Array.from({ length: cellCount }, (_, cell) => cell);
  const neighbors = new Int16Array(cellCount * 4);
  const steps = new Int16Array(cellCount);
  const values = new Uint16Array(cellCount);
  const queue = new Int16Array(cellCount);
  let checked = 0;
  let found: { cell: number; depth: number } | null = null;

  function candidateRecord(witness: { cell: number; depth: number }): Buffer {
    const record = Buffer.alloc(RECORD_BYTES);
    record.writeUInt16LE(pattern, 0);
    record.writeUInt16LE(witness.cell, 2);
    record.writeUInt16LE(witness.depth, 4);
    let gates = 0;
    for (let cell = 0; cell < cellCount; cell++) {
      if (occupied[cell] !== 1) continue;
      gates++;
      record[8 + (cell >> 3)]! |= 1 << (cell & 7);
    }
    record.writeUInt16LE(gates, 6);
    verifyRecord(record);
    return record;
  }

  function evaluateCandidate(): { cell: number; depth: number } | null {
    for (let y = 0; y < DEMO_HEIGHT; y++) {
      let previous = -1;
      for (let x = 0; x < BOARD_SIDE; x++) {
        const cell = x + BOARD_SIDE * y;
        if (!occupied[cell]) continue;
        neighbors[cell * 4] = previous;
        neighbors[cell * 4 + 1] = -1;
        if (previous >= 0) neighbors[previous * 4 + 1] = cell;
        previous = cell;
      }
    }
    for (let x = 0; x < BOARD_SIDE; x++) {
      let previous = -1;
      for (let y = 0; y < DEMO_HEIGHT; y++) {
        const cell = x + BOARD_SIDE * y;
        if (!occupied[cell]) continue;
        neighbors[cell * 4 + 2] = previous;
        neighbors[cell * 4 + 3] = -1;
        if (previous >= 0) neighbors[previous * 4 + 3] = cell;
        previous = cell;
      }
    }
    steps.fill(-1);
    let length = 0;
    for (let index = 0; index < sourceIndexes.length; index++) {
      const cell = sourceIndexes[index]!;
      steps[cell] = 0;
      values[cell] = sourceCells[index]!.pattern;
      queue[length++] = cell;
    }
    for (let cursor = 0; cursor < length; cursor++) {
      const cell = queue[cursor]!;
      if (occupied[cell] === 1) {
        let once = 0;
        let repeated = 0;
        for (let side = 0; side < 4; side++) {
          const giver = neighbors[cell * 4 + side]!;
          if (giver < 0 || steps[giver] !== steps[cell] - 1) continue;
          repeated |= once & values[giver]!;
          once |= values[giver]!;
        }
        values[cell] = once & ~repeated;
        if (values[cell] === pattern)
          for (let side = 0; side < 4; side++) {
            const seen = neighbors[cell * 4 + side]!;
            if (seen >= 0 && occupied[seen] === 3) {
              const witness = { cell, depth: steps[cell]! };
              if (acceptCandidate && !acceptCandidate(candidateRecord(witness)))
                continue;
              return witness;
            }
          }
      }
      for (let side = 0; side < 4; side++) {
        const next = neighbors[cell * 4 + side]!;
        if (next < 0 || occupied[next] !== 1 || steps[next] >= 0) continue;
        steps[next] = steps[cell]! + 1;
        queue[length++] = next;
      }
    }
    return null;
  }

  function chooseAdditions(start: number, left: number): void {
    if (found) return;
    if (freshAxisPairs) {
      for (const [first, second] of additionPairs) {
        if (occupied[first] !== 0 || occupied[second] !== 0) continue;
        occupied[first] = 1;
        occupied[second] = 1;
        checked++;
        found = evaluateCandidate();
        if (found) return;
        occupied[first] = 0;
        occupied[second] = 0;
      }
      return;
    }
    if (left === 0) {
      checked++;
      found = evaluateCandidate();
      return;
    }
    for (let index = start; index <= additionCells.length - left; index++) {
      const cell = additionCells[index]!;
      if (occupied[cell] !== 0) continue;
      occupied[cell] = 1;
      chooseAdditions(index + 1, left - 1);
      if (found) return;
      occupied[cell] = 0;
    }
  }

  function chooseRemovals(start: number, left: number): void {
    if (found) return;
    if (left === 0) {
      chooseAdditions(0, add);
      return;
    }
    for (let index = start; index <= positions.length - left; index++) {
      const cell = positions[index]!;
      occupied[cell] = 0;
      chooseRemovals(index + 1, left - 1);
      if (found) return;
      occupied[cell] = 1;
    }
  }

  const started = performance.now();
  chooseRemovals(0, remove);
  let record: Buffer | null = null;
  if (found !== null) {
    const witness = found as { cell: number; depth: number };
    record = candidateRecord(witness);
  }
  return {
    record,
    checked,
    milliseconds: Math.round(performance.now() - started),
    additionPositions: additionCells.length,
    additionPairs: additionPairs.length,
  };
}

function runImprove(argv: string[]): void {
  const options = parseImproveOptions(argv);
  const stored = readFileSync(options.input);
  const archive = options.input.endsWith(".gz") ? gunzipSync(stored) : stored;
  if (
    archive.length !== RECORD_BYTES &&
    archive.length !== 65536 * RECORD_BYTES
  )
    throw new Error(
      "improve input needs one record or an ordered full archive",
    );

  if (options.pattern !== undefined) {
    const offset =
      archive.length === RECORD_BYTES ? 0 : options.pattern * RECORD_BYTES;
    const seed = Buffer.from(archive.subarray(offset, offset + RECORD_BYTES));
    if (seed.readUInt16LE(0) !== options.pattern)
      throw new Error("improve input record has the wrong pattern");
    if (options.neutralDouble) {
      const seenBoards = new Set([seed.subarray(8).toString("hex")]);
      const improved = { record: null as Buffer | null };
      let neutralCandidates = 0;
      let strictCandidatesChecked = 0;
      const started = performance.now();
      const neutralSearch = improveRecord(
        seed,
        options.pattern,
        2,
        2,
        true,
        false,
        (candidate) => {
          const signature = candidate.subarray(8).toString("hex");
          if (seenBoards.has(signature)) return false;
          seenBoards.add(signature);
          neutralCandidates++;
          const strictSearch = improveRecord(
            candidate,
            options.pattern!,
            3,
            2,
            true,
            false,
          );
          strictCandidatesChecked += strictSearch.checked;
          if (!strictSearch.record) return false;
          improved.record = strictSearch.record;
          return true;
        },
      );
      if (improved.record) writeFileSync(options.output, improved.record);
      console.log(
        JSON.stringify({
          pattern: `0x${options.pattern.toString(16)}`,
          before: seed.readUInt16LE(6),
          after: improved.record?.readUInt16LE(6) ?? null,
          neutralCandidates,
          neutralCandidatesChecked: neutralSearch.checked,
          strictCandidatesChecked,
          milliseconds: Math.round(performance.now() - started),
          outputPath: improved.record ? options.output : null,
        }),
      );
      return;
    }
    const result = improveRecord(
      seed,
      options.pattern,
      options.remove,
      options.add,
      options.intersections,
      options.freshAxisPairs,
    );
    if (result.record) writeFileSync(options.output, result.record);
    console.log(
      JSON.stringify({
        pattern: `0x${options.pattern.toString(16)}`,
        before: seed.readUInt16LE(6),
        after: result.record?.readUInt16LE(6) ?? null,
        removed: options.remove,
        added: options.add,
        additionPositions: result.additionPositions,
        additionPairs: result.additionPairs,
        candidatesChecked: result.checked,
        milliseconds: result.milliseconds,
        outputPath: result.record ? options.output : null,
      }),
    );
    return;
  }

  if (archive.length !== 65536 * RECORD_BYTES)
    throw new Error("batch improve needs an ordered full archive");
  const gateCounts = new Uint16Array(65536);
  let gateSum = 0;
  for (let pattern = 0; pattern < gateCounts.length; pattern++) {
    const offset = pattern * RECORD_BYTES;
    const record = Buffer.from(archive.subarray(offset, offset + RECORD_BYTES));
    if (record.readUInt16LE(0) !== pattern)
      throw new Error(`archive record ${pattern} is out of order`);
    verifyRecord(record);
    gateCounts[pattern] = record.readUInt16LE(6);
    gateSum += gateCounts[pattern]!;
  }
  const selected = Array.from(
    { length: gateCounts.length },
    (_, pattern) => pattern,
  )
    .sort(
      (first, second) =>
        gateCounts[second]! - gateCounts[first]! || first - second,
    )
    .slice(0, options.limit!);
  let improvedMasks = 0;
  let improvements = 0;
  let candidatesChecked = 0;
  let wroteOutput = false;
  const started = performance.now();

  function checkpoint(): void {
    const bytes = options.output.endsWith(".gz")
      ? gzipSync(archive, { level: 9 })
      : archive;
    const temporary = `${options.output}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, options.output);
    wroteOutput = true;
  }

  for (const pattern of selected) {
    let changed = false;
    for (;;) {
      const offset = pattern * RECORD_BYTES;
      const seed = Buffer.from(archive.subarray(offset, offset + RECORD_BYTES));
      const result = improveRecord(
        seed,
        pattern,
        options.remove,
        options.add,
        options.intersections,
        options.freshAxisPairs,
      );
      candidatesChecked += result.checked;
      if (!result.record) break;
      const before = gateCounts[pattern]!;
      const after = result.record.readUInt16LE(6);
      if (after >= before)
        throw new Error(`improve failed to reduce pattern ${pattern}`);
      archive.set(result.record, offset);
      gateCounts[pattern] = after;
      gateSum -= before - after;
      improvements++;
      if (!changed) {
        changed = true;
        improvedMasks++;
      }
      checkpoint();
      console.log(
        JSON.stringify({
          pattern: `0x${pattern.toString(16)}`,
          before,
          after,
          candidatesChecked: result.checked,
          milliseconds: result.milliseconds,
        }),
      );
    }
  }
  if (!wroteOutput) checkpoint();
  const maximumGateCount = gateCounts.reduce(
    (maximum, count) => Math.max(maximum, count),
    0,
  );
  console.log(
    JSON.stringify({
      selectedMasks: selected.length,
      improvedMasks,
      improvements,
      maximumGateCount,
      masksAtMaximum: gateCounts.filter((count) => count === maximumGateCount)
        .length,
      gateSum,
      candidatesChecked,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      outputPath: options.output,
    }),
  );
}

function runInvert(argv: string[]): void {
  let pattern: number | undefined;
  let input: string | undefined;
  let output: string | undefined;
  let maxChecks = 20000;
  let timeoutMs = 5000;
  for (let index = 1; index < argv.length; index++) {
    const option = argv[index];
    if (option === "--pattern") pattern = Number(argv[++index]);
    else if (option === "--input") input = argv[++index];
    else if (option === "--output") output = argv[++index];
    else if (option === "--max-checks") maxChecks = Number(argv[++index]);
    else if (option === "--timeout-ms") timeoutMs = Number(argv[++index]);
    else throw new Error(`unknown invert option ${option}`);
  }
  if (
    !Number.isInteger(pattern) ||
    pattern! < 0 ||
    pattern! > 65535 ||
    !input ||
    !output ||
    !Number.isInteger(maxChecks) ||
    maxChecks < 1 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1
  )
    throw new Error(
      "invert needs --pattern, --input, --output, positive --max-checks, and positive --timeout-ms",
    );
  if (resolve(input) === resolve(output))
    throw new Error("invert input and output must differ");
  if (existsSync(output)) {
    const inputStat = statSync(input);
    const outputStat = statSync(output);
    if (
      realpathSync(input) === realpathSync(output) ||
      (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino)
    )
      throw new Error("invert input and output must differ");
  }
  const archiveBytes = readFileSync(input);
  const archive = input.endsWith(".gz")
    ? gunzipSync(archiveBytes)
    : archiveBytes;
  if (archive.length !== 65536 * RECORD_BYTES)
    throw new Error("invert needs an ordered full archive");
  const targetPattern = pattern!;
  const targetRecord = Buffer.from(
    archive.subarray(
      targetPattern * RECORD_BYTES,
      (targetPattern + 1) * RECORD_BYTES,
    ),
  );
  if (targetRecord.readUInt16LE(0) !== targetPattern)
    throw new Error("invert target record has the wrong pattern");
  verifyRecord(targetRecord);
  const oldCost = targetRecord.readUInt16LE(6);
  const donorPattern = targetPattern ^ 0xffff;
  const donor = Buffer.from(
    archive.subarray(
      donorPattern * RECORD_BYTES,
      (donorPattern + 1) * RECORD_BYTES,
    ),
  );
  if (donor.readUInt16LE(0) !== donorPattern)
    throw new Error("invert donor record has the wrong pattern");
  verifyRecord(donor);
  const donorCost = donor.readUInt16LE(6);
  const donorDepth = donor.readUInt16LE(4);
  const outputCell = donor.readUInt16LE(2);
  const outputX = outputCell % BOARD_SIDE;
  const outputY = Math.floor(outputCell / BOARD_SIDE);
  const board = createDemoBoard(() => 0);
  for (const terrain of board.terrain.values())
    if (terrain.type === "target") terrain.pattern = targetPattern;
  const oldKeys: string[] = [];
  for (let cell = 0; cell < BOARD_SIDE * DEMO_HEIGHT; cell++) {
    if (!(donor[8 + (cell >> 3)]! & (1 << (cell & 7)))) continue;
    const x = cell % BOARD_SIDE;
    const y = Math.floor(cell / BOARD_SIDE);
    const key = `${x},${y}`;
    board.gates.set(key, { id: board.gates.size + 1, cell: { x, y } });
    oldKeys.push(key);
  }
  const baseline = evaluateBoard(board);
  const original = oldKeys.map((key) => {
    const state = baseline.get(key);
    return { key, step: state?.step ?? null, gives: state?.gives ?? null };
  });
  const donorOutput = baseline.get(`${outputX},${outputY}`);
  if (donorOutput?.gives !== donorPattern || donorOutput.step !== donorDepth)
    throw new Error("invert donor output is invalid");
  const seeds = oldKeys
    .map((key) => {
      const state = baseline.get(key);
      return { key, step: state?.step ?? -1, gives: state?.gives };
    })
    .filter(
      (gate) =>
        gate.gives === 0xffff && gate.step >= 1 && gate.step <= donorDepth,
    )
    .sort((first, second) => second.step - first.step);
  const fullSource = sourceCells.find((source) => source.pattern === 0xffff);
  if (!fullSource) throw new Error("invert needs a FFFF source");
  seeds.push({
    key: `${fullSource.x},${fullSource.y}`,
    step: 0,
    gives: 0xffff,
  });
  type MergeCell = {
    x: number;
    y: number;
    key: string;
    targetDistance: number;
  };
  const mergeCells: MergeCell[] = [];
  for (const target of targetCells) {
    if (target.x !== outputX && target.y !== outputY) continue;
    const dx = Math.sign(target.x - outputX);
    const dy = Math.sign(target.y - outputY);
    for (
      let x = outputX + dx, y = outputY + dy;
      x !== target.x || y !== target.y;
      x += dx, y += dy
    ) {
      const key = `${x},${y}`;
      if (fixedKeys.has(key) || board.gates.has(key)) continue;
      mergeCells.push({
        x,
        y,
        key,
        targetDistance: Math.abs(target.x - x) + Math.abs(target.y - y),
      });
    }
  }
  mergeCells.sort(
    (first, second) =>
      first.targetDistance - second.targetDistance ||
      first.x - second.x ||
      first.y - second.y,
  );
  let checks = 0;
  let routes = 0;
  let budgetExhausted = false;
  let winner: Buffer | null = null;
  const started = performance.now();

  function sameDonorStates(
    evaluation: ReturnType<typeof evaluateBoard>,
  ): boolean {
    return original.every(({ key, step, gives }) => {
      const state = evaluation.get(key);
      return (state?.step ?? null) === step && (state?.gives ?? null) === gives;
    });
  }

  function addGate(x: number, y: number): boolean {
    const key = `${x},${y}`;
    if (fixedKeys.has(key) || board.gates.has(key)) return false;
    board.gates.set(key, { id: board.gates.size + 1, cell: { x, y } });
    return true;
  }

  function candidateRecord(cell: number): Buffer {
    const record = Buffer.alloc(RECORD_BYTES);
    record.writeUInt16LE(targetPattern, 0);
    record.writeUInt16LE(cell, 2);
    record.writeUInt16LE(donorDepth + 1, 4);
    record.writeUInt16LE(board.gates.size, 6);
    for (const gate of board.gates.values()) {
      const gateCell = gate.cell.x + BOARD_SIDE * gate.cell.y;
      record[8 + (gateCell >> 3)]! |= 1 << (gateCell & 7);
    }
    return record;
  }

  function relayCandidates(
    currentKey: string,
    merge: MergeCell,
    finalStep: boolean,
  ) {
    const [currentX, currentY] = currentKey.split(",").map(Number);
    const cells: { x: number; y: number }[] = [];
    for (let x = 0; x < BOARD_SIDE; x++)
      if (x !== currentX) cells.push({ x, y: currentY! });
    for (let y = 0; y < DEMO_HEIGHT; y++)
      if (y !== currentY) cells.push({ x: currentX!, y });
    return cells
      .filter(({ x, y }) => {
        const key = `${x},${y}`;
        return (
          !fixedKeys.has(key) &&
          !board.gates.has(key) &&
          (!finalStep || x === merge.x || y === merge.y)
        );
      })
      .sort((first, second) => {
        const firstAligned = first.x === merge.x || first.y === merge.y ? 0 : 1;
        const secondAligned =
          second.x === merge.x || second.y === merge.y ? 0 : 1;
        return (
          firstAligned - secondAligned ||
          Math.abs(first.x - merge.x) +
            Math.abs(first.y - merge.y) -
            Math.abs(second.x - merge.x) -
            Math.abs(second.y - merge.y) ||
          first.x - second.x ||
          first.y - second.y
        );
      });
  }

  function testMerge(merge: MergeCell): void {
    if (!addGate(merge.x, merge.y)) return;
    checks++;
    const evaluation = evaluateBoard(board);
    const state = evaluation.get(merge.key);
    if (
      sameDonorStates(evaluation) &&
      state?.step === donorDepth + 1 &&
      state.gives === targetPattern &&
      targetCells.some(({ x, y }) => {
        const target = evaluation.get(`${x},${y}`);
        return (
          target?.lit &&
          target.takes.some((take) => take.pattern === targetPattern)
        );
      })
    ) {
      const candidate = candidateRecord(merge.x + BOARD_SIDE * merge.y);
      verifyRecord(candidate);
      winner = candidate;
    }
    board.gates.delete(merge.key);
  }

  function explore(
    currentKey: string,
    step: number,
    merge: MergeCell,
    relays: { key: string; step: number }[],
  ): void {
    if (winner || budgetExhausted) return;
    if (checks >= maxChecks || performance.now() - started >= timeoutMs) {
      budgetExhausted = true;
      return;
    }
    if (step === donorDepth) {
      routes++;
      testMerge(merge);
      return;
    }
    const nextStep = step + 1;
    for (const { x, y } of relayCandidates(
      currentKey,
      merge,
      nextStep === donorDepth,
    )) {
      if (winner || budgetExhausted) return;
      const key = `${x},${y}`;
      addGate(x, y);
      checks++;
      const evaluation = evaluateBoard(board);
      const state = evaluation.get(key);
      if (
        sameDonorStates(evaluation) &&
        state?.step === nextStep &&
        state.gives === 0xffff &&
        relays.every(({ key: relayKey, step: relayStep }) => {
          const relay = evaluation.get(relayKey);
          return relay?.step === relayStep && relay.gives === 0xffff;
        })
      )
        explore(key, nextStep, merge, [...relays, { key, step: nextStep }]);
      board.gates.delete(key);
    }
  }

  for (const seed of seeds) {
    if (winner || budgetExhausted) break;
    if (donorCost + donorDepth - seed.step + 1 >= oldCost) continue;
    for (const merge of mergeCells) {
      if (winner || budgetExhausted) break;
      explore(seed.key, seed.step, merge, []);
    }
  }
  let winningRecord = winner as Buffer | null;
  let prunedGates = 0;
  if (winningRecord) {
    for (;;) {
      const result = improveRecord(
        winningRecord,
        targetPattern,
        1,
        0,
        false,
        false,
      );
      if (!result.record) break;
      winningRecord = result.record;
      prunedGates++;
    }
    verifyRecord(winningRecord);
    writeFileSync(output, winningRecord);
  }
  console.log(
    JSON.stringify({
      pattern: `0x${targetPattern.toString(16).padStart(4, "0")}`,
      donor: `0x${donorPattern.toString(16).padStart(4, "0")}`,
      before: oldCost,
      after: winningRecord?.readUInt16LE(6) ?? null,
      checks,
      routes,
      prunedGates,
      budgetExhausted,
      milliseconds: Math.round(performance.now() - started),
      outputPath: winningRecord ? output : null,
      outputSha256: winningRecord ? sha256Bytes(winningRecord) : null,
    }),
  );
}

function buildBoardSolver(
  z3Api: Awaited<ReturnType<typeof init>>,
  gateCount: number,
  minimal: boolean,
  timeoutMs: number,
  transposeCanonical = false,
  randomSeed?: number,
  connectedAncestry = false,
) {
  const context = new z3Api.Context("onehot");
  const { BitVec, Bool, And, Or, Not, If, Implies, Concat, AndThen } = context;
  const rankWidth = Math.ceil(Math.log2(gateCount + 2));
  const coordinate = (value: number) => BitVec.val(value, 5);
  const depth = (value: number) => BitVec.val(value, rankWidth);
  const gateX = Array.from({ length: gateCount }, (_, index) =>
    BitVec.const(`gate_${index}_x`, 5),
  );
  const gateY = Array.from({ length: gateCount }, (_, index) =>
    BitVec.const(`gate_${index}_y`, 5),
  );
  const gateRank = Array.from({ length: gateCount }, (_, index) =>
    BitVec.const(`gate_${index}_rank`, rankWidth),
  );
  const gatePattern = Array.from({ length: gateCount }, (_, index) =>
    BitVec.const(`gate_${index}_pattern`, 16),
  );
  const deliveredPattern = BitVec.const("delivered_pattern", 16);
  const nodeX = [...fixedCells.map(({ x }) => coordinate(x)), ...gateX];
  const nodeY = [...fixedCells.map(({ y }) => coordinate(y)), ...gateY];
  const visibleCache = new Map<string, Z3Bool<"onehot">>();
  const solver = AndThen(
    "simplify",
    "propagate-values",
    "solve-eqs",
    "bit-blast",
    "sat",
  ).solver();
  if (timeoutMs) solver.set("timeout", timeoutMs);
  if (randomSeed !== undefined) solver.set("random_seed", randomSeed);
  if (transposeCanonical) {
    const transposedPattern = deliveredPattern
      .and(BitVec.val(0x0c0c, 16))
      .shl(2)
      .or(deliveredPattern.and(BitVec.val(0x3030, 16)).lshr(2))
      .or(deliveredPattern.and(BitVec.val(0xc3c3, 16)));
    solver.add(deliveredPattern.ule(transposedPattern));
  }
  const one = depth(1);
  const gateLimit = depth(gateCount);
  const unreachable = depth(gateCount + 1);
  const zeroPattern = BitVec.val(0, 16);

  function unsignedBetween(
    first: (typeof gateX)[number],
    second: (typeof gateX)[number],
    middle: (typeof gateX)[number],
  ) {
    return Or(
      And(first.ult(middle), middle.ult(second)),
      And(second.ult(middle), middle.ult(first)),
    );
  }

  function visibleNodes(first: number, second: number): Z3Bool<"onehot"> {
    if (first === second) return Bool.val(false);
    const key = `${Math.min(first, second)},${Math.max(first, second)}`;
    const cached = visibleCache.get(key);
    if (cached) return cached;
    const ax = nodeX[first]!;
    const ay = nodeY[first]!;
    const bx = nodeX[second]!;
    const by = nodeY[second]!;
    const blockers: Z3Bool<"onehot">[] = [];
    for (let index = 0; index < nodeX.length; index++) {
      if (index === first || index === second) continue;
      const cx = nodeX[index]!;
      const cy = nodeY[index]!;
      blockers.push(
        Or(
          And(ax.eq(bx), cx.eq(ax), unsignedBetween(ay, by, cy)),
          And(ay.eq(by), cy.eq(ay), unsignedBetween(ax, bx, cx)),
        ),
      );
    }
    const visible = And(
      Or(ax.eq(bx), ay.eq(by)),
      ...blockers.map((blocker) => Not(blocker)),
    );
    visibleCache.set(key, visible);
    return visible;
  }

  for (let index = 0; index < gateCount; index++) {
    const x = gateX[index]!;
    const y = gateY[index]!;
    solver.add(
      gateRank[index]!.uge(one),
      gateRank[index]!.ule(minimal ? gateLimit : unreachable),
    );
    solver.add(
      Implies(
        gateRank[index]!.eq(one),
        Or(
          ...sourceCells.map(({ x: sourceX }) => x.eq(coordinate(sourceX))),
          ...sourceCells.map(({ y: sourceY }) => y.eq(coordinate(sourceY))),
        ),
      ),
    );
    for (const fixedCell of fixedCells)
      solver.add(
        Or(
          Not(x.eq(coordinate(fixedCell.x))),
          Not(y.eq(coordinate(fixedCell.y))),
        ),
      );
    for (let previous = 0; previous < index; previous++)
      solver.add(Or(Not(gateX[previous]!.eq(x)), Not(gateY[previous]!.eq(y))));
    if (index > 0) {
      solver.add(
        Or(
          gateRank[index - 1]!.ult(gateRank[index]!),
          And(
            gateRank[index - 1]!.eq(gateRank[index]!),
            Concat(gateY[index - 1]!, gateX[index - 1]!).ult(Concat(y, x)),
          ),
        ),
      );
      if (minimal)
        solver.add(gateRank[index]!.ule(gateRank[index - 1]!.add(one)));
    }
  }
  if (minimal) solver.add(gateRank[0]!.eq(one));

  const fixedAxis = [...new Set(fixedCells.flatMap(({ x, y }) => [x, y]))].sort(
    (a, b) => a - b,
  );
  const boundaries = [-1, ...fixedAxis, BOARD_SIDE];
  for (let interval = 0; interval + 1 < boundaries.length; interval++) {
    const left = boundaries[interval]!;
    const right = boundaries[interval + 1]!;
    for (let value = left + 2; value < right; value++)
      for (const axis of [gateX, gateY])
        solver.add(
          Implies(
            Or(...axis.map((item) => item.eq(coordinate(value)))),
            Or(...axis.map((item) => item.eq(coordinate(value - 1)))),
          ),
        );
  }

  if (minimal)
    for (let index = 0; index < gateCount; index++) {
      const node = fixedCells.length + index;
      for (let source = 0; source < sourceCells.length; source++)
        solver.add(
          Implies(visibleNodes(node, source), gateRank[index]!.eq(one)),
        );
      for (let previous = 0; previous < index; previous++)
        solver.add(
          Implies(
            visibleNodes(node, fixedCells.length + previous),
            gateRank[index]!.ule(gateRank[previous]!.add(one)),
          ),
        );
    }

  for (let index = 0; index < gateCount; index++) {
    const recipient = fixedCells.length + index;
    const feeders: {
      visible: Z3Bool<"onehot">;
      rank: Z3BitVec<number, "onehot">;
      pattern: Z3BitVec<number, "onehot">;
    }[] = sourceCells.map((source, sourceIndex) => ({
      visible: visibleNodes(recipient, sourceIndex),
      rank: depth(0),
      pattern: BitVec.val(source.pattern, 16),
    }));
    for (let previous = 0; previous < index; previous++)
      feeders.push({
        visible: visibleNodes(recipient, fixedCells.length + previous),
        rank: gateRank[previous]!,
        pattern: gatePattern[previous]!,
      });
    let minimum: Z3BitVec<number, "onehot"> = unreachable;
    for (const feeder of feeders)
      minimum = If(
        And(feeder.visible, feeder.rank.ult(minimum)),
        feeder.rank,
        minimum,
      );
    solver.add(
      gateRank[index]!.eq(
        If(minimum.uge(gateLimit), unreachable, minimum.add(one)),
      ),
    );
    let once: Z3BitVec<number, "onehot"> = zeroPattern;
    let twice: Z3BitVec<number, "onehot"> = zeroPattern;
    for (const feeder of feeders) {
      const take = If(
        And(feeder.visible, feeder.rank.eq(gateRank[index]!.sub(one))),
        feeder.pattern,
        zeroPattern,
      );
      twice = twice.or(once.and(take));
      once = once.or(take);
    }
    solver.add(gatePattern[index]!.eq(once.and(twice.not())));
  }

  const outputs = [];
  for (let index = 0; index < gateCount; index++)
    for (let target = 0; target < targetCells.length; target++)
      outputs.push(
        And(
          gateRank[index]!.ule(gateLimit),
          visibleNodes(fixedCells.length + index, sourceCells.length + target),
          deliveredPattern.eq(gatePattern[index]!),
        ),
      );
  solver.add(Or(...outputs));
  if (connectedAncestry) {
    const lastGate = gateCount - 1;
    solver.add(gateRank[lastGate]!.ule(gateLimit));
    solver.add(deliveredPattern.eq(gatePattern[lastGate]!));
    solver.add(
      Or(
        ...targetCells.map((_, target) =>
          visibleNodes(
            fixedCells.length + lastGate,
            sourceCells.length + target,
          ),
        ),
      ),
    );
    for (let previous = 0; previous < lastGate; previous++)
      solver.add(
        Or(
          ...gateX.slice(previous + 1).map((_, offset) => {
            const recipient = previous + offset + 1;
            return And(
              visibleNodes(
                fixedCells.length + previous,
                fixedCells.length + recipient,
              ),
              gateRank[recipient]!.eq(gateRank[previous]!.add(one)),
            );
          }),
        ),
      );
  }

  function numericValue(expression: Z3BitVec<number, "onehot">): number {
    return Number(
      (solver.model().eval(expression) as { value(): bigint }).value(),
    );
  }

  function witness(): Witness {
    const pattern = numericValue(deliveredPattern);
    const gates = gateX.map((x, index) => ({
      x: numericValue(x),
      y: numericValue(gateY[index]!),
    }));
    for (let index = 0; index < gateCount; index++) {
      const rank = numericValue(gateRank[index]!);
      if (rank > gateCount || numericValue(gatePattern[index]!) !== pattern)
        continue;
      for (let target = 0; target < targetCells.length; target++)
        if (
          context.isTrue(
            solver
              .model()
              .eval(
                visibleNodes(
                  fixedCells.length + index,
                  sourceCells.length + target,
                ),
              ),
          )
        ) {
          const result = {
            pattern,
            gateCount,
            gates,
            outputCell: gates[index]!.x + BOARD_SIDE * gates[index]!.y,
            outputDepth: rank,
            target: targetCells[target]!,
          };
          recordOf(result);
          return result;
        }
    }
    throw new Error("SAT model has no live output gate visible to a target");
  }

  return {
    solver,
    goal: deliveredPattern,
    goalValue: (pattern: number) => BitVec.val(pattern, 16),
    blockPattern: (pattern: number) =>
      solver.add(Not(deliveredPattern.eq(BitVec.val(pattern, 16)))),
    witness,
  };
}

async function runSolver(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.transpose) assertTransposeSymmetry();
  const connectedLowerBoundIdentity = options.connectedLowerBounds
    ? checkedConnectedLowerBounds(
        options.connectedLowerBounds,
        options.pattern!,
        options.gates,
      )
    : undefined;
  const solverSource = sourceIdentity();
  const z3Api = await init();
  try {
    const version = z3Api.getVersionString();
    const started = performance.now();

    if (options.command === "minimum") {
      for (let count = 1; count <= options.gates; count++) {
        const board = buildBoardSolver(
          z3Api,
          count,
          true,
          options.timeoutMs,
          false,
          options.randomSeed,
        );
        const result = await board.solver.check(
          board.goal.eq(board.goalValue(options.pattern!)),
        );
        console.log(
          `N=${count}: ${result}; ${((performance.now() - started) / 1000).toFixed(2)}s`,
        );
        if (result === "unknown")
          throw new Error(
            `N=${count} UNKNOWN: ${board.solver.reasonUnknown()}`,
          );
        if (result === "sat") {
          const witness = board.witness();
          assert.equal(witness.pattern, options.pattern);
          console.log(JSON.stringify(witness));
          if (options.output) {
            writeFileSync(options.output, recordOf(witness));
            writeFileSync(
              `${options.output}.minimum.json`,
              JSON.stringify({
                pattern: options.pattern,
                minimum_gates: count,
                unsat_gate_counts: Array.from(
                  { length: count - 1 },
                  (_, index) => index + 1,
                ),
                solver_sha256: solverSource.hash,
                solver_source_path: solverSource.path,
                solver_source_sha256: solverSource.hash,
                z3_version: version,
                argv: process.argv.slice(2),
                records_sha256: sha256Bytes(readFileSync(options.output)),
              }) + "\n",
            );
          }
          return;
        }
      }
      throw new Error(
        `pattern ${options.pattern} is UNSAT through ${options.gates} gates`,
      );
    }

    if (options.command === "check") {
      const board = buildBoardSolver(
        z3Api,
        options.gates,
        false,
        options.timeoutMs,
        false,
        options.randomSeed,
        connectedLowerBoundIdentity !== undefined,
      );
      const result = await board.solver.check(
        board.goal.eq(board.goalValue(options.pattern!)),
      );
      console.log(result);
      const unknownReason =
        result === "unknown" ? board.solver.reasonUnknown() : undefined;
      let witnessHash: string | undefined;
      if (result === "sat") {
        const witness = board.witness();
        assert.equal(witness.pattern, options.pattern);
        console.log(JSON.stringify(witness));
        const record = recordOf(witness);
        witnessHash = sha256Bytes(record);
        if (options.output) writeFileSync(options.output, record);
      }
      if (options.checkReceipt) {
        const receiptPath = resolve(options.checkReceipt);
        const temporary = `${receiptPath}.tmp`;
        const boardSourcePaths = [
          "src/games/onehot/board/core/demo-board.ts",
          "src/games/onehot/board/rules/evaluate.ts",
          "src/games/onehot/board/rules/sight.ts",
          "src/games/onehot/board/core/patterns.ts",
        ];
        const boardSourceHashes = Object.fromEntries(
          boardSourcePaths.map((path) => [
            path,
            sha256Bytes(readFileSync(join(projectRoot, path))),
          ]),
        );
        writeFileSync(
          temporary,
          JSON.stringify({
            version: 1,
            kind:
              result === "unsat"
                ? "fixed-pattern-unsat"
                : "fixed-pattern-check",
            pattern: options.pattern,
            pattern_hex: `0x${options.pattern!.toString(16).padStart(4, "0")}`,
            gates: options.gates,
            result,
            engine: "sat",
            ...(unknownReason ? { reason_unknown: unknownReason } : {}),
            solver_sha256: solverSource.hash,
            solver_source_path: solverSource.path,
            solver_source_sha256: solverSource.hash,
            board_source_sha256: boardSourceHashes,
            ...(connectedLowerBoundIdentity
              ? { connected_lower_bound_table: connectedLowerBoundIdentity }
              : {}),
            z3_version: version,
            argv: process.argv.slice(2),
            ...(witnessHash ? { witness_sha256: witnessHash } : {}),
            ...(witnessHash && options.output
              ? { witness_path: resolve(options.output) }
              : {}),
            seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
          }) + "\n",
        );
        renameSync(temporary, receiptPath);
      }
      if (result === "unknown") throw new Error(`UNKNOWN: ${unknownReason}`);
      return;
    }

    const exclusionFiles = options.excludes.map((path) => ({
      path,
      ...completedExclusion(path),
    }));
    if (exclusionFiles.some(({ gates }) => gates >= options.gates))
      throw new Error(
        "exclusion gate counts must be lower than the requested count",
      );
    if (options.minimal) {
      const excludedCounts = new Set(exclusionFiles.map(({ gates }) => gates));
      for (let count = 1; count < options.gates; count++)
        if (!excludedCounts.has(count))
          throw new Error(`missing completed exclusion for N=${count}`);
    }
    const output = resolve(options.output!);
    const found = existsSync(output)
      ? parseRecords(output, options.gates)
      : new Map<number, Buffer>();
    const excluded = new Set<number>();
    for (const exclusion of exclusionFiles)
      for (const pattern of exclusion.records.keys()) excluded.add(pattern);
    if (options.transpose)
      for (const pattern of excluded)
        if (!excluded.has(transposePattern(pattern)))
          throw new Error(`exclusions are not transpose closed at ${pattern}`);
    for (const pattern of found.keys())
      if (excluded.has(pattern))
        throw new Error(`output repeats excluded pattern ${pattern}`);
    if (options.transpose)
      for (const record of [...found.values()]) {
        const mirrored = transposeRecord(record);
        const pattern = mirrored.readUInt16LE(0);
        if (excluded.has(pattern))
          throw new Error(
            `transposed output repeats excluded pattern ${pattern}`,
          );
        if (found.has(pattern)) continue;
        appendFileSync(output, mirrored);
        found.set(pattern, mirrored);
      }
    const minimalBoard = buildBoardSolver(
      z3Api,
      options.gates,
      options.minimal,
      options.timeoutMs,
      options.transpose,
      options.randomSeed,
    );
    for (const pattern of [...excluded, ...found.keys()])
      minimalBoard.blockPattern(pattern);
    const completionPath = `${output}.complete.json`;
    if (existsSync(completionPath)) unlinkSync(completionPath);
    const outputHandle = openSync(output, "a");
    console.error(
      `built N=${options.gates} mode=${options.minimal ? "minimal" : "raw"}; resume=${found.size} excluded=${excluded.size}`,
    );
    try {
      for (;;) {
        const result = await minimalBoard.solver.check();
        if (result === "unknown")
          throw new Error(
            `UNKNOWN after ${found.size} records: ${minimalBoard.solver.reasonUnknown()}`,
          );
        if (result === "unsat") {
          const metadata = {
            gates: options.gates,
            new_patterns: found.size,
            excluded_patterns: excluded.size,
            minimal: options.minimal,
            mode: options.minimal ? "minimal" : "raw",
            engine: "sat",
            result: "unsat",
            solver_sha256: solverSource.hash,
            solver_source_path: solverSource.path,
            solver_source_sha256: solverSource.hash,
            z3_version: version,
            argv: process.argv.slice(2),
            records_sha256: sha256Bytes(readFileSync(output)),
            exclusions: exclusionFiles.map(({ path, hash }) => ({
              path,
              sha256: hash,
            })),
          };
          const temporary = `${completionPath}.tmp`;
          writeFileSync(temporary, JSON.stringify(metadata) + "\n");
          renameSync(temporary, completionPath);
          console.log(
            `complete N=${options.gates}: ${found.size} patterns; ${((performance.now() - started) / 1000).toFixed(2)}s`,
          );
          return;
        }
        const witness = minimalBoard.witness();
        if (found.has(witness.pattern) || excluded.has(witness.pattern))
          throw new Error(`SAT returned blocked pattern ${witness.pattern}`);
        const record = recordOf(witness);
        const mirrored = options.transpose ? transposeRecord(record) : null;
        const mirroredPattern = mirrored?.readUInt16LE(0);
        if (mirroredPattern !== undefined && excluded.has(mirroredPattern))
          throw new Error(
            `transposed SAT output repeats excluded pattern ${mirroredPattern}`,
          );
        writeSync(outputHandle, record);
        found.set(witness.pattern, record);
        minimalBoard.blockPattern(witness.pattern);
        if (
          mirrored &&
          mirroredPattern !== undefined &&
          !found.has(mirroredPattern)
        ) {
          writeSync(outputHandle, mirrored);
          found.set(mirroredPattern, mirrored);
          minimalBoard.blockPattern(mirroredPattern);
        }
        fsyncSync(outputHandle);
        if (found.size % 100 <= (mirrored ? 1 : 0))
          console.error(
            `N=${options.gates}: ${found.size} patterns; ${((performance.now() - started) / 1000).toFixed(1)}s`,
          );
      }
    } finally {
      closeSync(outputHandle);
    }
  } finally {
    await killThreads(z3Api.em);
  }
}

const commandLine = process.argv.slice(2);
if (
  commandLine.length === 0 ||
  commandLine.includes("--help") ||
  commandLine[0] === "help"
)
  console.log(helpText);
else if (commandLine[0] === "improve") runImprove(commandLine);
else if (commandLine[0] === "invert") runInvert(commandLine);
else {
  const solverKeepalive = setInterval(() => {}, 60_000);
  try {
    await runSolver();
  } finally {
    clearInterval(solverKeepalive);
  }
}
