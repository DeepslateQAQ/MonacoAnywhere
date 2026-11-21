import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ENGINE_ABI,
  MAX_FILE_BYTES,
  parseCatalogue,
  parsePackDescriptor,
  resolveMirror,
  type Catalogue,
  type CataloguePack
} from "../extension/src/data/catalogue";
import {
  computeHeaderTreeSha256,
  normalizeSysrootReadPath,
  validateArchiveAgainstManifest,
  validateManifest,
  type ToolchainFileEntry,
  type ToolchainManifest
} from "../extension/src/data/manifest";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function syncCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      expect(error.code).toBe(code);
      return;
    }
    throw error;
  }
  throw new Error(`expected failure with code ${code}`);
}

const engineBuildId = digest("engine.clangd.wasm");
const packSha256 = digest("pack-asset");
const configurationSha256 = digest("clangd-configuration");

function makeFiles(): ToolchainFileEntry[] {
  const contents = new Map<string, string>([
    ["LICENSE", "AGPL-3.0-only\n"],
    ["NOTICE", "third-party notices\n"],
    ["provenance.json", '{"schema":"monacoanywhere.pack-provenance/1"}\n'],
    [
      "licenses/libc6-dev.copyright",
      "GNU C Library copyright and LGPL text\n"
    ],
    ["sysroot/usr/include/stdio.h", "#pragma once\nint printf();\n"],
    [
      "sysroot/usr/include/x86_64-linux-gnu/bits/errno.h",
      "#define EAGAIN 11\n"
    ],
    ["sysroot/usr/include/c++/15/vector", "#pragma once\nnamespace std {}\n"]
  ]);
  return [...contents].map(([name, text]) => ({
    name,
    bytes: Buffer.byteLength(text),
    sha256: digest(text)
  }));
}

function independentHeaderTree(files: readonly ToolchainFileEntry[]): string {
  const sysroot = files
    .filter((file) => file.name.startsWith("sysroot/"))
    .slice()
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
  const hash = createHash("sha256");
  for (const file of sysroot) {
    hash.update(`${file.name}\u0000${file.sha256}\n`);
  }
  return hash.digest("hex");
}

const toolchain = {
  targetTriple: "x86_64-linux-gnu",
  includeDirectories: [
    "/sysroot/usr/include/c++/15",
    "/sysroot/usr/include/x86_64-linux-gnu/c++/15",
    "/sysroot/usr/include/x86_64-linux-gnu",
    "/sysroot/usr/include"
  ],
  gccVersion: "15.2.0",
  glibcVersion: "2.42",
  kernelVersion: "7.2.15"
};

function makePack(): CataloguePack {
  return {
    id: "debian-gcc15.2-x86_64-linux-gnu",
    version: "2026.11.1",
    asset: "pack-debian-gcc15.2-x86_64-linux-gnu-2026.11.1.tar.gz",
    bytes: 12_345,
    sha256: packSha256,
    releaseTag: "data-2026.11.1",
    mirrors: [
      "https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/{tag}/{asset}",
      "https://gh-proxy.org/https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/{tag}/{asset}"
    ],
    toolchain,
    indexes: []
  };
}

function makeCatalogue(): Catalogue {
  return {
    schema: "monacoanywhere.catalogue/1",
    engineAbi: ENGINE_ABI,
    engineBuildId,
    packs: [makePack()]
  };
}

function makeManifest(): ToolchainManifest {
  const files = makeFiles();
  return {
    schema: "monacoanywhere.toolchain-pack/1",
    id: "debian-gcc15.2-x86_64-linux-gnu",
    version: "2026.11.1",
    engine: { abi: ENGINE_ABI, buildId: engineBuildId },
    toolchain,
    headerTreeSha256: independentHeaderTree(files),
    indexes: [],
    files
  };
}

describe("catalogue validation", () => {
  it("accepts a well-formed catalogue and enforces the exact engine identity", () => {
    const catalogue = parseCatalogue(makeCatalogue(), {
      engineAbi: ENGINE_ABI,
      engineBuildId
    });
    expect(catalogue.engineBuildId).toBe(engineBuildId);
    expect(catalogue.packs[0]?.id).toBe("debian-gcc15.2-x86_64-linux-gnu");
  });

  it("rejects a different engine build id and ABI", () => {
    syncCode(
      () =>
        parseCatalogue(makeCatalogue(), {
          engineBuildId: digest("another-engine")
        }),
      "engine-build-mismatch"
    );
    syncCode(
      () =>
        parseCatalogue(makeCatalogue(), {
          engineAbi: "ma-clangd-wasm/2"
        }),
      "engine-abi-mismatch"
    );
  });

  it("rejects placeholder digests instead of treating them as real hashes", () => {
    const zero = clone(makeCatalogue());
    zero.packs[0]!.sha256 = "0".repeat(64);
    syncCode(() => parseCatalogue(zero), "catalogue-invalid");

    const repeated = clone(makeCatalogue());
    repeated.engineBuildId = "a".repeat(64);
    syncCode(() => parseCatalogue(repeated), "catalogue-invalid");
  });

  it("rejects invalid asset names, sizes and duplicate pack ids", () => {
    const traversal = clone(makeCatalogue());
    traversal.packs[0]!.asset = "../pack.tar.gz";
    syncCode(() => parseCatalogue(traversal), "catalogue-invalid");

    const zeroBytes = clone(makeCatalogue());
    zeroBytes.packs[0]!.bytes = 0;
    syncCode(() => parseCatalogue(zeroBytes), "catalogue-invalid");

    const duplicate = clone(makeCatalogue());
    duplicate.packs.push(clone(duplicate.packs[0]!));
    syncCode(() => parseCatalogue(duplicate), "catalogue-invalid");
  });

  it("validates mirror templates and substitutes only tag and asset", () => {
    const pack = makePack();
    expect(resolveMirror(pack.mirrors[0]!, pack)).toBe(
      "https://github.com/DeepslateQAQ/MonacoAnywhere/releases/download/data-2026.11.1/pack-debian-gcc15.2-x86_64-linux-gnu-2026.11.1.tar.gz"
    );
    expect(
      resolveMirror("https://ghproxy.net/https://github.com/x/{tag}/{asset}", {
        releaseTag: "data-2",
        asset: "p.tar.gz"
      })
    ).toBe(
      "https://ghproxy.net/https://github.com/x/data-2/p.tar.gz"
    );
  });

  it("rejects insecure, unknown-host and unknown-placeholder mirrors", () => {
    for (const mirror of [
      "http://github.com/x/{tag}/{asset}",
      "https://evil.example/{tag}/{asset}",
      "https://github.com/x/{tag}/{version}/{asset}",
      "https://github.com/x/{tag}/pack.tar.gz"
    ]) {
      const catalogue = clone(makeCatalogue());
      catalogue.packs[0]!.mirrors = [mirror];
      syncCode(() => parseCatalogue(catalogue), "catalogue-invalid");
    }
  });

  it("rejects unsafe or incomplete include directory lists", () => {
    const traversal = clone(makeCatalogue());
    traversal.packs[0]!.toolchain.includeDirectories[3] =
      "/sysroot/usr/../include";
    syncCode(() => parseCatalogue(traversal), "catalogue-invalid");

    const outside = clone(makeCatalogue());
    outside.packs[0]!.toolchain.includeDirectories[3] = "/usr/include";
    syncCode(() => parseCatalogue(outside), "catalogue-invalid");

    const missingCxx = clone(makeCatalogue());
    missingCxx.packs[0]!.toolchain.includeDirectories = [
      "/sysroot/usr/include",
      "/sysroot/usr/include/x86_64-linux-gnu"
    ];
    syncCode(() => parseCatalogue(missingCxx), "catalogue-invalid");
  });

  it("validates index metadata shape", () => {
    const catalogue = clone(makeCatalogue());
    catalogue.packs[0]!.indexes = [
      {
        standard: "c++26" as never,
        file: "sysroot-index/system.index",
        bytes: 10,
        sha256: digest("index"),
        configurationSha256
      }
    ];
    syncCode(() => parseCatalogue(catalogue), "catalogue-invalid");

    const unsafe = clone(makeCatalogue());
    unsafe.packs[0]!.indexes = [
      {
        standard: "c++17",
        file: "../system.index",
        bytes: 10,
        sha256: digest("index"),
        configurationSha256
      }
    ];
    syncCode(() => parseCatalogue(unsafe), "catalogue-invalid");
  });

  it("accepts the pack descriptor on its own", () => {
    const pack = parsePackDescriptor(makePack());
    expect(pack.id).toBe("debian-gcc15.2-x86_64-linux-gnu");
  });
});

describe("toolchain manifest validation", () => {
  it("computes the canonical header-tree digest independently", async () => {
    const files = makeFiles();
    expect(await computeHeaderTreeSha256(files)).toBe(
      independentHeaderTree(files)
    );
  });

  it("accepts a manifest that matches the catalogue", async () => {
    const manifest = await validateManifest(makeManifest(), {
      pack: makePack(),
      catalogue: makeCatalogue()
    });
    expect(manifest.files).toHaveLength(makeFiles().length);
    expect(manifest.indexes).toEqual([]);
  });

  it("rejects engine and header-tree mismatches", async () => {
    const wrongEngine = clone(makeManifest());
    wrongEngine.engine.buildId = digest("other-engine");
    await expect(
      validateManifest(wrongEngine, {
        pack: makePack(),
        catalogue: makeCatalogue()
      })
    ).rejects.toMatchObject({ code: "engine-build-mismatch" });

    const wrongTree = clone(makeManifest());
    wrongTree.headerTreeSha256 = digest("wrong-tree");
    await expect(
      validateManifest(wrongTree, {
        pack: makePack(),
        catalogue: makeCatalogue()
      })
    ).rejects.toMatchObject({ code: "header-tree-mismatch" });
  });

  it("rejects duplicate, self-referential and out-of-layout files", async () => {
    const duplicate = clone(makeManifest());
    duplicate.files.push(clone(duplicate.files[0]!));
    await expect(
      validateManifest(duplicate, { pack: makePack() })
    ).rejects.toMatchObject({ code: "manifest-invalid" });

    const self = clone(makeManifest());
    self.files.push({
      name: "manifest.json",
      bytes: 2,
      sha256: digest("{}")
    });
    await expect(
      validateManifest(self, { pack: makePack() })
    ).rejects.toMatchObject({ code: "manifest-invalid" });

    const outside = clone(makeManifest());
    outside.files.push({
      name: "../escape",
      bytes: 1,
      sha256: digest("x")
    });
    await expect(
      validateManifest(outside, { pack: makePack() })
    ).rejects.toMatchObject({ code: "manifest-invalid" });
  });

  it("requires license, notice, provenance and sysroot headers", async () => {
    for (const missing of ["LICENSE", "NOTICE", "provenance.json"]) {
      const manifest = clone(makeManifest());
      manifest.files = manifest.files.filter((file) => file.name !== missing);
      await expect(
        validateManifest(manifest, { pack: makePack() })
      ).rejects.toMatchObject({ code: "manifest-invalid" });
    }
    const noHeaders = clone(makeManifest());
    noHeaders.files = noHeaders.files.filter(
      (file) => !file.name.startsWith("sysroot/")
    );
    await expect(
      validateManifest(noHeaders, { pack: makePack() })
    ).rejects.toMatchObject({ code: "manifest-invalid" });
  });

  it("enforces per-file size ceilings", async () => {
    const manifest = clone(makeManifest());
    manifest.files[0]!.bytes = MAX_FILE_BYTES + 1;
    await expect(
      validateManifest(manifest, { pack: makePack() })
    ).rejects.toMatchObject({ code: "manifest-invalid" });
  });

  it("rejects index metadata that the catalogue does not declare", async () => {
    const manifest = clone(makeManifest());
    const indexBytes = "RIFFindex";
    manifest.files.push({
      name: "sysroot-index/system.index",
      bytes: Buffer.byteLength(indexBytes),
      sha256: digest(indexBytes)
    });
    manifest.indexes = [
      {
        standard: "c++17",
        file: "sysroot-index/system.index",
        bytes: Buffer.byteLength(indexBytes),
        sha256: digest(indexBytes),
        configurationSha256
      }
    ];
    await expect(
      validateManifest(manifest, { pack: makePack() })
    ).rejects.toMatchObject({ code: "manifest-invalid" });
  });

  it("requires exactly the manifest file set in an archive", () => {
    const manifest = makeManifest();
    const archive = new Map<string, Uint8Array>();
    archive.set("/manifest.json", new TextEncoder().encode("{}"));
    for (const file of manifest.files) {
      const raw = makeFiles().find((entry) => entry.name === file.name);
      if (!raw) throw new Error("fixture mismatch");
      switch (file.name) {
        case "LICENSE":
          archive.set(`/${file.name}`, new TextEncoder().encode("AGPL-3.0-only\n"));
          break;
        case "NOTICE":
          archive.set(`/${file.name}`, new TextEncoder().encode("third-party notices\n"));
          break;
        case "provenance.json":
          archive.set(
            `/${file.name}`,
            new TextEncoder().encode(
              '{"schema":"monacoanywhere.pack-provenance/1"}\n'
            )
          );
          break;
        case "licenses/libc6-dev.copyright":
          archive.set(
            `/${file.name}`,
            new TextEncoder().encode("GNU C Library copyright and LGPL text\n")
          );
          break;
        case "sysroot/usr/include/stdio.h":
          archive.set(
            `/${file.name}`,
            new TextEncoder().encode("#pragma once\nint printf();\n")
          );
          break;
        case "sysroot/usr/include/x86_64-linux-gnu/bits/errno.h":
          archive.set(`/${file.name}`, new TextEncoder().encode("#define EAGAIN 11\n"));
          break;
        case "sysroot/usr/include/c++/15/vector":
          archive.set(
            `/${file.name}`,
            new TextEncoder().encode("#pragma once\nnamespace std {}\n")
          );
          break;
        default:
          throw new Error(`unexpected fixture path ${file.name}`);
      }
    }
    expect(() => validateArchiveAgainstManifest(manifest, archive)).not.toThrow();
    archive.set("/unlisted", new Uint8Array(0));
    expect(() => validateArchiveAgainstManifest(manifest, archive)).toThrowError(
      /unlisted/
    );
  });

  it("normalizes only header-viewer sysroot paths", () => {
    expect(normalizeSysrootReadPath("/sysroot/usr/include/stdio.h")).toBe(
      "/sysroot/usr/include/stdio.h"
    );
    expect(normalizeSysrootReadPath("sysroot/usr/include/stdio.h")).toBe(
      "/sysroot/usr/include/stdio.h"
    );
    expect(normalizeSysrootReadPath("/etc/passwd")).toBeNull();
    expect(normalizeSysrootReadPath("/sysroot/../etc/passwd")).toBeNull();
    expect(normalizeSysrootReadPath("/sysroot/x\\y")).toBeNull();
  });
});
