import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  decompressGzip,
  extractPackArchive,
  untar
} from "../extension/src/data/untar";

const BLOCK = 512;
const encoder = new TextEncoder();

interface TarSpec {
  name: string;
  data?: string | Uint8Array;
  type?: string;
  prefix?: string;
  linkname?: string;
  magic?: string;
  version?: string;
  size?: number;
  checksum?: number;
}

function bytesOf(value: string | Uint8Array | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array(0);
  return typeof value === "string" ? encoder.encode(value) : value;
}

function writeField(
  header: Uint8Array,
  text: string,
  offset: number,
  length: number
): void {
  const encoded = encoder.encode(text);
  if (encoded.byteLength > length) {
    throw new Error(`test field ${text} does not fit`);
  }
  header.set(encoded, offset);
}

function writeOctal(
  header: Uint8Array,
  value: number,
  offset: number,
  length: number
): void {
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length > length - 1) throw new Error("test octal overflow");
  header.set(encoder.encode(text), offset);
  header[offset + length - 1] = 0;
}

function makeTar(
  specs: TarSpec[],
  options: { trailer?: boolean; trailingGarbage?: boolean } = {}
): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const spec of specs) {
    const header = new Uint8Array(BLOCK);
    const data = bytesOf(spec.data);
    writeField(header, spec.name, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, spec.size ?? data.byteLength, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    header[156] = (spec.type ?? "0").charCodeAt(0);
    if (spec.linkname) writeField(header, spec.linkname, 157, 100);
    writeField(header, spec.magic ?? "ustar", 257, 6);
    writeField(header, spec.version ?? "00", 263, 3);
    if (spec.prefix) writeField(header, spec.prefix, 345, 155);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeOctal(header, spec.checksum ?? checksum, 148, 7);
    header[155] = 0x20;
    blocks.push(header);
    if (data.byteLength > 0) blocks.push(data);
    const padding = data.byteLength % BLOCK;
    if (padding !== 0) blocks.push(new Uint8Array(BLOCK - padding));
  }
  if (options.trailer !== false) {
    blocks.push(new Uint8Array(BLOCK), new Uint8Array(BLOCK));
  }
  if (options.trailingGarbage) {
    const garbage = new Uint8Array(BLOCK);
    garbage[0] = 0x41;
    blocks.push(garbage);
  }
  const total = blocks.reduce((sum, block) => sum + block.byteLength, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.byteLength;
  }
  return archive;
}

function expectCode(action: () => unknown, code: string): void {
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

const VALID_SYSROOT = "sysroot/usr/include/c++/15/vector";

describe("USTAR extraction", () => {
  it("extracts regular files with canonical /sysroot keys", () => {
    const archive = makeTar([
      { name: VALID_SYSROOT, data: "#pragma once\n" },
      { name: "sysroot/usr/include/stdio.h", data: "int printf();\n" },
      { name: "LICENSE", data: "license" }
    ]);
    const files = untar(archive);
    expect([...files.keys()].sort()).toEqual([
      "/LICENSE",
      "/sysroot/usr/include/c++/15/vector",
      "/sysroot/usr/include/stdio.h"
    ]);
    expect(new TextDecoder().decode(files.get(`/${VALID_SYSROOT}`))).toBe(
      "#pragma once\n"
    );
  });

  it("accepts a USTAR prefix split", () => {
    const archive = makeTar([
      {
        name: "vector",
        prefix: "sysroot/usr/include/c++/15",
        data: "v"
      }
    ]);
    expect(untar(archive).has(`/${VALID_SYSROOT}`)).toBe(true);
  });

  it("rejects PAX and GNU long-name entry types", () => {
    expectCode(
      () => untar(makeTar([{ name: "PaxHeader", type: "x", data: "x" }])),
      "pax-not-supported"
    );
    expectCode(
      () => untar(makeTar([{ name: "././@LongLink", type: "L", data: "x" }])),
      "gnu-long-names-not-supported"
    );
  });

  it("rejects links, devices and link target fields", () => {
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/link", type: "2", linkname: "target" }
          ])
        ),
      "link-not-allowed"
    );
    expectCode(
      () => untar(makeTar([{ name: "sysroot/dev", type: "3" }])),
      "special-file"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            {
              name: "sysroot/a.h",
              data: "x",
              linkname: "hidden-target"
            }
          ])
        ),
      "link-not-allowed"
    );
  });

  it("canonicalizes harmless leading ./ entries from tar -C .", () => {
    const files = untar(
      makeTar([
        { name: "./", type: "5" },
        { name: "./sysroot/usr/include/a.h", data: "a" }
      ])
    );
    expect([...files.keys()]).toEqual(["/sysroot/usr/include/a.h"]);
  });

  it("rejects absolute and dot-dot paths", () => {
    expectCode(
      () => untar(makeTar([{ name: "/etc/passwd", data: "x" }])),
      "absolute-path"
    );
    expectCode(
      () => untar(makeTar([{ name: "sysroot/../../etc/passwd", data: "x" }])),
      "unsafe-path"
    );
    expectCode(
      () => untar(makeTar([{ name: "sysroot/./include/a.h", data: "x" }])),
      "unsafe-path"
    );
    expectCode(
      () => untar(makeTar([{ name: "sysroot\\usr\\include\\a.h", data: "x" }])),
      "unsafe-path"
    );
  });

  it("rejects duplicate entries and file/directory conflicts", () => {
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/a.h", data: "a" },
            { name: "sysroot/a.h", data: "b" }
          ])
        ),
      "duplicate-entry"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/a.h", data: "a" },
            { name: "sysroot/a.h/b.h", data: "b" }
          ])
        ),
      "path-conflict"
    );
  });

  it("rejects corrupt checksums, magic and version", () => {
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/a.h", data: "a", checksum: 0 }
          ])
        ),
      "checksum-mismatch"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/a.h", data: "a", magic: "ustar " }
          ])
        ),
      "not-ustar"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/a.h", data: "a", version: "  " }
          ])
        ),
      "not-ustar"
    );
  });

  it("rejects unlisted files and unexpected directories", () => {
    const archive = makeTar([
      { name: "sysroot/usr/include/a.h", data: "a" },
      { name: "sysroot/usr/include/extra.h", data: "b" }
    ]);
    expectCode(
      () =>
        untar(archive, {
          allowedFiles: ["sysroot/usr/include/a.h"]
        }),
      "unlisted-file"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/other/", type: "5" },
            { name: "sysroot/usr/include/a.h", data: "a" }
          ]),
          { allowedFiles: ["/sysroot/usr/include/a.h"] }
        ),
      "unlisted-directory"
    );
  });

  it("accepts directories that are ancestors of allowed files", () => {
    const files = untar(
      makeTar([
        { name: "sysroot/", type: "5" },
        { name: "sysroot/usr/", type: "5" },
        { name: "sysroot/usr/include/", type: "5" },
        { name: "sysroot/usr/include/a.h", data: "a" }
      ]),
      { allowedFiles: ["/sysroot/usr/include/a.h"] }
    );
    expect([...files.keys()]).toEqual(["/sysroot/usr/include/a.h"]);
  });

  it("rejects executable payloads regardless of name", () => {
    expectCode(
      () =>
        untar(
          makeTar([
            {
              name: "sysroot/usr/include/evil.h",
              data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46])
            }
          ])
        ),
      "executable-payload"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            {
              name: "sysroot/usr/include/evil.h",
              data: new Uint8Array([0x4d, 0x5a])
            }
          ])
        ),
      "executable-payload"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            {
              name: "sysroot/usr/include/evil.h",
              data: new Uint8Array([0x00, 0x61, 0x73, 0x6d])
            }
          ])
        ),
      "executable-payload"
    );
  });

  it("enforces per-file and total size limits", () => {
    expectCode(
      () =>
        untar(
          makeTar([{ name: "sysroot/a.h", data: "12345" }]),
          { maxFileBytes: 4 }
        ),
      "file-too-large"
    );
    expectCode(
      () =>
        untar(
          makeTar([
            { name: "sysroot/a.h", data: "123" },
            { name: "sysroot/b.h", data: "456" }
          ]),
          { maxTotalBytes: 5 }
        ),
      "archive-too-large"
    );
  });

  it("rejects truncated archives and missing trailers", () => {
    expectCode(
      () => untar(makeTar([{ name: "sysroot/a.h", data: "a" }], { trailer: false })),
      "missing-trailer"
    );
    const valid = makeTar([{ name: "sysroot/a.h", data: "abcdef" }]);
    expectCode(
      () => untar(valid.subarray(0, valid.byteLength - 600)),
      "not-block-aligned"
    );
    expectCode(
      () => untar(valid.subarray(0, 512 + 2)),
      "not-block-aligned"
    );
    const truncatedData = makeTar(
      [{ name: "sysroot/a.h", data: "abcdef", size: 600 }],
      { trailer: false }
    );
    expectCode(() => untar(truncatedData), "truncated");
  });

  it("rejects data after the end marker", () => {
    expectCode(
      () =>
        untar(
          makeTar([{ name: "sysroot/a.h", data: "a" }], {
            trailingGarbage: true
          })
        ),
      "trailing-data"
    );
  });
});

describe("gzip pack extraction", () => {
  it("inflates a gzip archive and extracts it strictly", async () => {
    const archive = makeTar([
      { name: "manifest.json", data: '{"schema":"x"}' },
      { name: VALID_SYSROOT, data: "#pragma once\n" }
    ]);
    const compressed = gzipSync(archive);
    const inflated = await decompressGzip(compressed);
    expect(Buffer.from(inflated).equals(Buffer.from(archive))).toBe(true);
    const files = await extractPackArchive(compressed);
    expect(files.has(`/${VALID_SYSROOT}`)).toBe(true);
  });

  it("rejects non-gzip input and oversized decompression", async () => {
    await expect(
      decompressGzip(new TextEncoder().encode("not gzip"))
    ).rejects.toMatchObject({ code: "invalid-gzip" });
    const compressed = gzipSync(new Uint8Array(4096));
    await expect(
      decompressGzip(compressed, { maxBytes: 1024 })
    ).rejects.toMatchObject({ code: "archive-too-large" });
  });
});
