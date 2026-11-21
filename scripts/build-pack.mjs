#!/usr/bin/env node
/*
 * Builds the deterministic Debian GCC 15.2.0 / glibc 2.42 / Linux 7.2.15
 * header pack and the catalogue that pins it to the locally built engine.
 *
 * Inputs are the immutable Debian snapshot packages extracted under
 * .build/sysroot. No prebuilt clangd index is produced; the manifest declares
 * an empty index list and clangd uses its dynamic index.
 */
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SYSROOT = path.join(ROOT, ".build", "sysroot");
const STAGE = path.join(ROOT, ".build", "pack-stage");
const RELEASE = path.join(ROOT, ".build", "release");
const ENGINE_DIR = path.join(ROOT, "extension", "wasm", "dist");
const CATALOGUE_PATH = path.join(
  ROOT,
  "extension",
  "src",
  "data",
  "catalogue.json",
);

const PACK_ID = "debian-gcc15.2-x86_64-linux-gnu";
const PACK_VERSION = "2026.11.1";
const RELEASE_TAG = "data-2026.11.1";
const ASSET = `pack-${PACK_ID}-${PACK_VERSION}.tar.gz`;
const TOOLCHAIN = {
  targetTriple: "x86_64-linux-gnu",
  includeDirectories: [
    "/sysroot/usr/include/c++/15",
    "/sysroot/usr/include/x86_64-linux-gnu/c++/15",
    "/sysroot/usr/include/x86_64-linux-gnu",
    "/sysroot/usr/include",
  ],
  gccVersion: "15.2.0",
  glibcVersion: "2.42",
  kernelVersion: "7.2.15",
};

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function blobSha1(buffer) {
  return createHash("sha1")
    .update(`blob ${buffer.byteLength}\0`)
    .update(buffer)
    .digest("hex");
}

async function* walk(absolute, relative, visited = new Set()) {
  const info = await stat(absolute);
  if (info.isSymbolicLink()) {
    throw new Error(`Unresolved symlink ${absolute}`);
  }
  if (info.isFile()) {
    yield { absolute, relative };
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`Unsupported file type in header tree: ${absolute}`);
  }
  const real = await realpath(absolute);
  if (visited.has(real)) return;
  visited.add(real);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const childAbsolute = path.join(absolute, entry.name);
    const childRelative = `${relative}/${entry.name}`;
    const childInfo = await lstat(childAbsolute);
    if (childInfo.isSymbolicLink()) {
      const target = await realpath(childAbsolute);
      const allowedRoots = [
        path.join(SYSROOT, "usr", "include"),
        path.join(SYSROOT, "usr", "lib", "linux", "uapi"),
      ];
      if (!allowedRoots.some((root) => target === root || target.startsWith(`${root}${path.sep}`))) {
        throw new Error(`Header symlink escapes the include tree: ${childAbsolute}`);
      }
      yield* walk(target, childRelative, visited);
    } else if (childInfo.isDirectory()) {
      yield* walk(childAbsolute, childRelative, visited);
    } else if (childInfo.isFile()) {
      yield { absolute: childAbsolute, relative: childRelative };
    } else {
      throw new Error(`Unsupported file type in header tree: ${childAbsolute}`);
    }
  }
}

async function engineBuildId() {
  const wasm = await readFile(path.join(ENGINE_DIR, "clangd.wasm"));
  const buildInfo = JSON.parse(
    await readFile(path.join(ENGINE_DIR, "engine-build.json"), "utf8"),
  );
  if (buildInfo.buildId !== sha256(wasm)) {
    throw new Error("engine-build.json does not match clangd.wasm");
  }
  return buildInfo.buildId;
}

async function main() {
  const buildId = await engineBuildId();
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(path.join(STAGE, "sysroot"), { recursive: true });
  await mkdir(path.join(STAGE, "licenses"), { recursive: true });
  await mkdir(RELEASE, { recursive: true });

  // Copy only headers: the packs must not contain executables or libraries.
  const includeRoots = [
    "usr/include/c++/15",
    "usr/include/x86_64-linux-gnu/c++/15",
    "usr/include/x86_64-linux-gnu",
    "usr/include",
  ];
  const files = [];
  const visited = new Set();
  for (const root of includeRoots) {
    const absoluteRoot = path.join(SYSROOT, root);
    for await (const entry of walk(absoluteRoot, root, visited)) {
      const name = `sysroot/${entry.relative}`;
      if (!name.startsWith("sysroot/usr/include/")) {
        throw new Error(`Unexpected header path ${name}`);
      }
      const target = path.join(STAGE, name);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(entry.absolute, target);
      const buffer = await readFile(entry.absolute);
      if (!files.some((file) => file.name === name)) {
        files.push({ name, bytes: buffer.byteLength, sha256: sha256(buffer) });
      }
    }
  }
  files.sort((left, right) => (left.name < right.name ? -1 : 1));

  const licenseSources = [
    ["usr/share/doc/libc6-dev/copyright", "licenses/libc6-dev-copyright"],
    ["usr/share/doc/linux-libc-dev/copyright", "licenses/linux-libc-dev-copyright"],
    ["pack-licenses/GPL-3.0.txt", "licenses/GPL-3.0.txt"],
    ["pack-licenses/GCC-RUNTIME-EXCEPTION-3.1.txt", "licenses/GCC-RUNTIME-EXCEPTION-3.1.txt"],
  ];
  for (const [source, name] of licenseSources) {
    const sourcePath = source.startsWith("pack-licenses/")
      ? path.join(ROOT, "extension", "src", "data", source)
      : path.join(SYSROOT, source);
    const buffer = await readFile(sourcePath);
    await writeFile(path.join(STAGE, name), buffer);
    files.push({ name, bytes: buffer.byteLength, sha256: sha256(buffer) });
  }
  files.sort((left, right) => (left.name < right.name ? -1 : 1));

  const provenance = {
    schema: "monacoanywhere.pack-provenance/1",
    packId: PACK_ID,
    debianSnapshotPackages: [
      {
        name: "libstdc++-15-dev_15.2.0-17_amd64.deb",
        sha1: "d5121e50a5b2f586369a89fd5d164440a7695e84",
      },
      {
        name: "libc6-dev_2.42-12_amd64.deb",
        sha1: "2f697ebbb8f1ff1549ca3242d841eca16240a647",
      },
      {
        name: "linux-libc-dev_7.2.15-1_all.deb",
        sha1: "72514a07be4fb6145fbde7fc79d8ef5c0a3b85f4",
      },
    ],
    notes:
      "Headers only. No index is included; clangd uses the dynamic index. Exact Debian package bytes are recorded by hash above.",
  };
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(path.join(STAGE, "provenance.json"), provenanceBytes);
  await cp(path.join(ROOT, "LICENSE"), path.join(STAGE, "LICENSE"));
  const notice = [
    "MonacoAnywhere toolchain data pack",
    "",
    "This pack contains only header files and license texts extracted from",
    "immutable Debian snapshot packages. The headers retain their upstream",
    "licenses; see licenses/ and provenance.json.",
    "",
    "No executable code, static clangd index, or compiled library is included.",
  ].join("\n");
  await writeFile(path.join(STAGE, "NOTICE"), `${notice}\n`);
  for (const name of ["LICENSE", "NOTICE", "provenance.json"]) {
    const buffer = await readFile(path.join(STAGE, name));
    files.push({ name, bytes: buffer.byteLength, sha256: sha256(buffer) });
  }
  files.sort((left, right) => (left.name < right.name ? -1 : 1));

  const headerTreeSha256 = sha256(
    files
      .filter((file) => file.name.startsWith("sysroot/"))
      .map((file) => `${file.name}\0${file.sha256}\n`)
      .join(""),
  );

  const manifest = {
    schema: "monacoanywhere.toolchain-pack/1",
    id: PACK_ID,
    version: PACK_VERSION,
    engine: { abi: "ma-clangd-wasm/1", buildId },
    toolchain: TOOLCHAIN,
    headerTreeSha256,
    indexes: [],
    files,
  };
  await writeFile(
    path.join(STAGE, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const assetPath = path.join(RELEASE, ASSET);
  const tarPath = `${assetPath}.tmp.tar`;
  const run = promisify(execFile);
  await run("tar", [
    "--format=ustar",
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-cf",
    tarPath,
    "-C",
    STAGE,
    "LICENSE",
    "NOTICE",
    "manifest.json",
    "provenance.json",
    "licenses",
    "sysroot",
  ]);
  const gz = await run("gzip", ["-n", "-9", "-c", tarPath], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: "buffer",
  });
  const asset = gz.stdout;
  await writeFile(assetPath, asset);
  await rm(tarPath, { force: true });

  const catalogue = {
    schema: "monacoanywhere.catalogue/1",
    engineAbi: "ma-clangd-wasm/1",
    engineBuildId: buildId,
    packs: [
      {
        id: PACK_ID,
        version: PACK_VERSION,
        asset: ASSET,
        bytes: asset.byteLength,
        sha256: sha256(asset),
        releaseTag: RELEASE_TAG,
        mirrors: [
          `https://gh-proxy.org/https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/{tag}/{asset}`,
          `https://ghfast.top/https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/{tag}/{asset}`,
          `https://ghproxy.net/https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/{tag}/{asset}`,
          `https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/{tag}/{asset}`,
        ],
        toolchain: TOOLCHAIN,
        indexes: [],
      },
    ],
  };
  await writeFile(
    CATALOGUE_PATH,
    `${JSON.stringify(catalogue, null, 2)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        asset: path.relative(ROOT, assetPath),
        bytes: asset.byteLength,
        sha256: sha256(asset),
        files: files.length,
        headerTreeSha256,
        engineBuildId: buildId,
        engineBuildBlobSha1: blobSha1(await readFile(path.join(ENGINE_DIR, "clangd.wasm"))),
      },
      null,
      2,
    ),
  );
}

await main();
