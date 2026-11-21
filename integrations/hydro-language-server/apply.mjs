#!/usr/bin/env node
/*
 * Applies the MonacoAnywhere cooperative C++ patch to @hydrooj/language-server.
 *
 * Only Node.js built-in modules are used. The source file is accepted only when
 * its git blob SHA-1 matches the pinned revision; otherwise nothing is written.
 */
import { createHash } from "node:crypto";
import {
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPATIBILITY = JSON.parse(
  await readFile(path.join(HERE, "compatibility.json"), "utf8"),
);
const PATCH_PATH = path.join(
  HERE,
  "patches",
  `${COMPATIBILITY.upstreamRevision}.patch`,
);
const STATE_FILE = path.join(HERE, "state.json");

function usage() {
  console.error(
    "Usage: node apply.mjs --addon <dir> [--check | --apply | --revert]",
  );
  process.exit(64);
}

function parseArgs(argv) {
  const result = { addon: null, action: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--addon") {
      result.addon = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--check" || arg === "--apply" || arg === "--revert") {
      if (result.action) usage();
      result.action = arg.slice(2);
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }
  if (!result.addon) usage();
  return { addon: path.resolve(result.addon), action: result.action ?? "apply" };
}

function gitBlobSha1(buffer) {
  return createHash("sha1")
    .update(`blob ${buffer.byteLength}\0`)
    .update(buffer)
    .digest("hex");
}

function parsePatch(text) {
  const lines = text.split("\n");
  const files = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }
    const oldLabel = lines[index].slice(4);
    const newHeader = lines[index + 1] ?? "";
    if (!newHeader.startsWith("+++ ")) {
      throw new Error("Malformed patch header");
    }
    const newLabel = newHeader.slice(4);
    index += 2;
    const hunks = [];
    while (index < lines.length && lines[index].startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]);
      if (!match) throw new Error(`Malformed hunk header: ${lines[index]}`);
      const oldStart = Number(match[1]);
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      index += 1;
      const body = [];
      while (index < lines.length && !lines[index].startsWith("@@ ")) {
        if (lines[index].startsWith("--- ")) break;
        body.push(lines[index]);
        index += 1;
      }
      while (body.length > 0 && body.at(-1) === "") body.pop();
      hunks.push({ oldStart, oldCount, newStart, newCount, body });
    }
    files.push({ oldLabel, newLabel, hunks });
  }
  return files;
}

function stripPrefix(label) {
  return label.replace(/^[ab]\//, "");
}

function applyHunks(source, hunks) {
  const sourceLines = source.split("\n");
  const output = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (start < cursor || start > sourceLines.length) {
      throw new Error("Hunk position is outside the file");
    }
    output.push(...sourceLines.slice(cursor, start));
    let oldIndex = start;
    let expectedOld = 0;
    let expectedNew = 0;
    for (const line of hunk.body) {
      const marker = line[0];
      const content = line.slice(1);
      if (marker === " ") {
        if (sourceLines[oldIndex] !== content) {
          throw new Error(`Context mismatch at line ${oldIndex + 1}`);
        }
        output.push(content);
        oldIndex += 1;
        expectedOld += 1;
        expectedNew += 1;
      } else if (marker === "-") {
        if (sourceLines[oldIndex] !== content) {
          throw new Error(`Deleted line mismatch at line ${oldIndex + 1}`);
        }
        oldIndex += 1;
        expectedOld += 1;
      } else if (marker === "+") {
        output.push(content);
        expectedNew += 1;
      } else if (marker === "\\") {
        // "\ No newline at end of file" marker.
      } else {
        throw new Error(`Unknown patch line: ${line}`);
      }
    }
    if (expectedOld !== hunk.oldCount) {
      throw new Error(`Hunk old-line count mismatch at ${hunk.oldStart}`);
    }
    if (expectedNew !== hunk.newCount) {
      throw new Error(`Hunk new-line count mismatch at ${hunk.oldStart}`);
    }
    cursor = oldIndex;
  }
  output.push(...sourceLines.slice(cursor));
  return output.join("\n");
}

function reversePatch(hunks) {
  return hunks.map((hunk) => ({
    oldStart: hunk.newStart,
    oldCount: hunk.newCount,
    newStart: hunk.oldStart,
    newCount: hunk.oldCount,
    body: hunk.body.map((line) => {
      if (line.startsWith("+")) return `-${line.slice(1)}`;
      if (line.startsWith("-")) return `+${line.slice(1)}`;
      return line;
    }),
  }));
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(file, data) {
  const temporary = `${file}.ma-${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

async function main() {
  const { addon, action } = parseArgs(process.argv.slice(2));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(addon, "package.json"), "utf8"));
  } catch {
    console.error(`Not an addon directory (package.json unreadable): ${addon}`);
    process.exit(2);
  }
  if (manifest.name !== COMPATIBILITY.package) {
    console.error(
      `Wrong package: expected ${COMPATIBILITY.package}, found ${String(manifest.name)}`,
    );
    process.exit(2);
  }

  const patch = parsePatch(await readFile(PATCH_PATH, "utf8"));
  if (patch.length === 0) {
    console.error("Patch contains no files");
    process.exit(2);
  }

  const files = patch.map((entry) => ({
    relative: stripPrefix(entry.newLabel),
    oldLabel: entry.oldLabel,
    hunks: entry.hunks,
  }));
  for (const file of files) {
    if (!(file.relative in COMPATIBILITY.blobSha1)) {
      console.error(`Patch targets an unpinned file: ${file.relative}`);
      process.exit(2);
    }
  }

  const current = new Map();
  let allBefore = true;
  let allAfter = true;
  for (const file of files) {
    const buffer = await readFile(path.join(addon, file.relative));
    const sha1 = gitBlobSha1(buffer);
    current.set(file.relative, { buffer, sha1 });
    allBefore &&= sha1 === COMPATIBILITY.blobSha1[file.relative];
    allAfter &&= sha1 === COMPATIBILITY.patchedBlobSha1[file.relative];
    if (!allBefore && !allAfter) break;
  }
  if (!allBefore && !allAfter) {
    console.error(
      "Source file does not match the pinned upstream revision; refusing to write anything.",
    );
    process.exit(2);
  }

  if (action === "check") {
    if (allAfter) {
      console.log("已应用 (patch applied)");
    } else {
      console.log("可应用 (patch is applicable)");
    }
    return;
  }

  if (action === "revert") {
    if (allBefore) {
      console.log("未打补丁 (patch not applied)");
      return;
    }
    const state = await readState();
    if (!state) {
      console.error("state.json is missing; refusing to revert unknown content.");
      process.exit(2);
    }
    for (const file of files) {
      const entry = current.get(file.relative);
      const reverted = applyHunks(entry.buffer.toString("utf8"), reversePatch(file.hunks));
      const buffer = Buffer.from(reverted, "utf8");
      if (gitBlobSha1(buffer) !== COMPATIBILITY.blobSha1[file.relative]) {
        console.error(`Reverted content hash mismatch: ${file.relative}`);
        process.exit(2);
      }
      const target = path.join(addon, file.relative);
      await writeAtomic(target, buffer);
    }
    await rm(STATE_FILE, { force: true });
    console.log("已还原到固定上游版本 (reverted)");
    return;
  }

  if (allAfter) {
    console.log("已应用 (patch already applied)");
    return;
  }

  const outputs = [];
  for (const file of files) {
    const entry = current.get(file.relative);
    const patched = applyHunks(entry.buffer.toString("utf8"), file.hunks);
    const buffer = Buffer.from(patched, "utf8");
    if (gitBlobSha1(buffer) !== COMPATIBILITY.patchedBlobSha1[file.relative]) {
      console.error(`Patched content hash mismatch: ${file.relative}`);
      process.exit(2);
    }
    outputs.push({ target: path.join(addon, file.relative), buffer });
  }
  for (const output of outputs) {
    await writeAtomic(output.target, output.buffer);
  }
  await writeAtomic(
    STATE_FILE,
    `${JSON.stringify(
      {
        schema: "monacoanywhere.hydro-patch-state/1",
        appliedAt: new Date().toISOString(),
        upstreamRevision: COMPATIBILITY.upstreamRevision,
        patchVersion: COMPATIBILITY.patchVersion,
        files: files.map((file) => ({
          path: file.relative,
          beforeSha1: COMPATIBILITY.blobSha1[file.relative],
          afterSha1: COMPATIBILITY.patchedBlobSha1[file.relative],
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log("已应用 (patch applied)");
}

await main();
