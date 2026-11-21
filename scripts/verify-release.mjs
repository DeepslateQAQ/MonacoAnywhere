#!/usr/bin/env node
/*
 * Downloads the catalogue's pack from its first working mirror and verifies
 * the exact byte length and SHA-256 recorded in the catalogue.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogue = JSON.parse(
  await readFile(path.join(ROOT, "extension", "src", "data", "catalogue.json"), "utf8"),
);

for (const pack of catalogue.packs) {
  const failures = [];
  for (const template of pack.mirrors) {
    const url = template
      .replaceAll("{tag}", pack.releaseTag)
      .replaceAll("{asset}", pack.asset);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== pack.bytes) {
        throw new Error(`size ${bytes.byteLength} != ${pack.bytes}`);
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== pack.sha256) throw new Error(`sha256 ${digest}`);
      console.log(JSON.stringify({ pack: pack.id, url, bytes: bytes.byteLength, sha256: digest, ok: true }, null, 2));
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length === pack.mirrors.length) {
    console.error(JSON.stringify({ pack: pack.id, failures, ok: false }, null, 2));
    process.exitCode = 1;
  }
}
