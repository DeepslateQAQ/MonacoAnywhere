import {
  ENGINE_ABI,
  MAX_FILE_BYTES,
  MAX_UNPACKED_BYTES,
  TOOLCHAIN_MANIFEST_SCHEMA,
  validateIndexDescriptor,
  validateRelativeDataPath,
  validateToolchainDescriptor,
  type Catalogue,
  type CataloguePack,
  type ToolchainDescriptor,
  type ToolchainIndexDescriptor
} from "./catalogue.js";
import { ManifestError } from "./errors.js";
import { isRealSha256Hex, sha256Hex } from "./hash.js";

export interface ToolchainFileEntry {
  /** Manifest-relative path, e.g. sysroot/usr/include/c++/15/vector. */
  name: string;
  bytes: number;
  sha256: string;
}

export interface ToolchainManifest {
  schema: typeof TOOLCHAIN_MANIFEST_SCHEMA;
  id: string;
  version: string;
  engine: {
    abi: typeof ENGINE_ABI;
    buildId: string;
  };
  toolchain: ToolchainDescriptor;
  /** Digest over the sorted sysroot path/hash pairs. */
  headerTreeSha256: string;
  indexes: ToolchainIndexDescriptor[];
  files: ToolchainFileEntry[];
}

export interface ValidateManifestOptions {
  /** Catalogue entry this manifest must belong to. */
  pack?: CataloguePack;
  /** Full catalogue; when present it is authoritative for engine and pack metadata. */
  catalogue?: Catalogue;
  /** Exact engine build id when no catalogue is supplied. */
  expectedEngineBuildId?: string;
  expectedEngineAbi?: string;
  path?: string;
}

type RecordValue = Record<string, unknown>;

function fail(code: string, message: string): never {
  throw new ManifestError(code, message);
}

function expectRecord(value: unknown, path: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("manifest-invalid", `${path} must be an object`);
  }
  return value as RecordValue;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("manifest-invalid", `${path} must be a non-empty string`);
  }
  return value;
}

function expectPositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail("manifest-invalid", `${path} must be a positive integer`);
  }
  return value as number;
}

function expectRealSha(value: unknown, path: string): string {
  if (!isRealSha256Hex(value)) {
    fail(
      "manifest-invalid",
      `${path} must be a real lowercase SHA-256 (placeholders are rejected)`
    );
  }
  return value;
}

function validateManifestPath(value: unknown, path: string): string {
  let name: string;
  try {
    name = validateRelativeDataPath(value, path);
  } catch (error) {
    throw new ManifestError(
      "manifest-invalid",
      error instanceof Error ? error.message : `${path} is invalid`
    );
  }
  if (name === "manifest.json") {
    fail("manifest-invalid", `${path} must not hash the manifest itself`);
  }
  const allowed =
    name === "LICENSE" ||
    name === "NOTICE" ||
    name === "provenance.json" ||
    name.startsWith("licenses/") ||
    name.startsWith("sysroot/") ||
    name.startsWith("sysroot-index/");
  if (!allowed) {
    fail("manifest-invalid", `${path} is outside the toolchain pack layout`);
  }
  return name;
}

export function toolchainDescriptorsEqual(
  a: ToolchainDescriptor,
  b: ToolchainDescriptor
): boolean {
  if (a.targetTriple !== b.targetTriple) return false;
  if (a.gccVersion !== b.gccVersion) return false;
  if (a.glibcVersion !== b.glibcVersion) return false;
  if (a.kernelVersion !== b.kernelVersion) return false;
  if (a.resourceDir !== b.resourceDir) return false;
  if (a.includeDirectories.length !== b.includeDirectories.length) return false;
  return a.includeDirectories.every(
    (directory, index) => directory === b.includeDirectories[index]
  );
}

function indexDescriptorsEqual(
  a: ToolchainIndexDescriptor,
  b: ToolchainIndexDescriptor
): boolean {
  return (
    a.standard === b.standard &&
    a.file === b.file &&
    a.bytes === b.bytes &&
    a.sha256 === b.sha256 &&
    a.configurationSha256 === b.configurationSha256 &&
    a.headerTreeSha256 === b.headerTreeSha256
  );
}

function checkCatalogueIndexes(
  pack: CataloguePack,
  manifestIndexes: ToolchainIndexDescriptor[]
): void {
  if (pack.indexes.length !== manifestIndexes.length) {
    fail(
      "manifest-invalid",
      `manifest index count ${manifestIndexes.length} does not match catalogue metadata ${pack.indexes.length}`
    );
  }
  const byFile = new Map(
    manifestIndexes.map((entry) => [entry.file, entry] as const)
  );
  for (const expected of pack.indexes) {
    const actual = byFile.get(expected.file);
    if (!actual || !indexDescriptorsEqual(expected, actual)) {
      fail(
        "manifest-invalid",
        `manifest index ${expected.file} does not match catalogue metadata`
      );
    }
  }
}

export interface HeaderTreeInput {
  name: string;
  sha256: string;
}

/**
 * Canonical header-tree digest shared with scripts/build-pack.mjs:
 * sorted sysroot paths, each as `name\0sha256\n`, hashed with SHA-256.
 */
export async function computeHeaderTreeSha256(
  files: readonly HeaderTreeInput[]
): Promise<string> {
  const sysroot = files
    .filter((file) => file.name.startsWith("sysroot/"))
    .slice()
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  let canonical = "";
  for (const file of sysroot) {
    canonical += `${file.name}\u0000${file.sha256}\n`;
  }
  return sha256Hex(canonical);
}

export async function validateManifest(
  value: unknown,
  options: ValidateManifestOptions = {}
): Promise<ToolchainManifest> {
  const path = options.path ?? "manifest";
  const record = expectRecord(value, path);
  if (record.schema !== TOOLCHAIN_MANIFEST_SCHEMA) {
    fail(
      "manifest-invalid",
      `${path}.schema must be ${TOOLCHAIN_MANIFEST_SCHEMA}`
    );
  }
  const id = expectString(record.id, `${path}.id`);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) {
    fail("manifest-invalid", `${path}.id is not a stable pack id`);
  }
  const version = expectString(record.version, `${path}.version`);
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) {
    fail("manifest-invalid", `${path}.version is not concrete`);
  }

  const engineRecord = expectRecord(record.engine, `${path}.engine`);
  if (engineRecord.abi !== ENGINE_ABI) {
    fail("manifest-invalid", `${path}.engine.abi must be ${ENGINE_ABI}`);
  }
  const engineBuildId = expectRealSha(
    engineRecord.buildId,
    `${path}.engine.buildId`
  );
  if (
    options.expectedEngineAbi !== undefined &&
    options.expectedEngineAbi !== ENGINE_ABI
  ) {
    fail(
      "engine-abi-mismatch",
      `expected engine ABI ${options.expectedEngineAbi}, manifest declares ${ENGINE_ABI}`
    );
  }
  if (
    options.expectedEngineBuildId !== undefined &&
    options.expectedEngineBuildId !== engineBuildId
  ) {
    fail(
      "engine-build-mismatch",
      `manifest was built for engine ${engineBuildId}, active engine is ${options.expectedEngineBuildId}`
    );
  }

  let toolchain: ToolchainDescriptor;
  try {
    toolchain = validateToolchainDescriptor(
      record.toolchain,
      `${path}.toolchain`
    );
  } catch (error) {
    throw new ManifestError(
      "manifest-invalid",
      error instanceof Error ? error.message : `${path}.toolchain is invalid`
    );
  }

  const expectedPack =
    options.catalogue !== undefined
      ? options.catalogue.packs.find((entry) => entry.id === id)
      : options.pack;
  if (options.catalogue !== undefined && !expectedPack) {
    fail(
      "manifest-pack-unknown",
      `manifest pack ${id} is not present in the catalogue`
    );
  }
  if (expectedPack) {
    if (expectedPack.id !== id || expectedPack.version !== version) {
      fail(
        "manifest-pack-mismatch",
        `manifest ${id}/${version} does not match catalogue pack ${expectedPack.id}/${expectedPack.version}`
      );
    }
    if (!toolchainDescriptorsEqual(expectedPack.toolchain, toolchain)) {
      fail(
        "manifest-pack-mismatch",
        "manifest toolchain does not match the catalogue toolchain"
      );
    }
  }
  if (options.catalogue) {
    if (options.catalogue.engineAbi !== ENGINE_ABI) {
      fail(
        "engine-abi-mismatch",
        `catalogue engine ABI ${options.catalogue.engineAbi} is unsupported`
      );
    }
    if (options.catalogue.engineBuildId !== engineBuildId) {
      fail(
        "engine-build-mismatch",
        `manifest engine ${engineBuildId} does not match catalogue engine ${options.catalogue.engineBuildId}`
      );
    }
  }

  const fileValues = record.files;
  if (!Array.isArray(fileValues) || fileValues.length === 0) {
    fail("manifest-invalid", `${path}.files must be a non-empty array`);
  }
  const files: ToolchainFileEntry[] = [];
  const names = new Set<string>();
  let totalBytes = 0;
  fileValues.forEach((entry, index) => {
    const entryPath = `${path}.files[${index}]`;
    const fileRecord = expectRecord(entry, entryPath);
    const name = validateManifestPath(fileRecord.name, `${entryPath}.name`);
    if (names.has(name)) {
      fail("manifest-invalid", `${entryPath} duplicates ${name}`);
    }
    names.add(name);
    const bytes = expectPositiveInteger(fileRecord.bytes, `${entryPath}.bytes`);
    if (bytes > MAX_FILE_BYTES) {
      fail("manifest-invalid", `${entryPath}.bytes exceeds the file limit`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_UNPACKED_BYTES) {
      fail("manifest-invalid", `${path}.files exceeds the total size limit`);
    }
    files.push({
      name,
      bytes,
      sha256: expectRealSha(fileRecord.sha256, `${entryPath}.sha256`)
    });
  });
  if (!files.some((file) => file.name.startsWith("sysroot/usr/include/"))) {
    fail("manifest-invalid", `${path} contains no sysroot headers`);
  }
  for (const required of ["LICENSE", "NOTICE", "provenance.json"]) {
    if (!names.has(required)) {
      fail("manifest-invalid", `${path} is missing ${required}`);
    }
  }
  if (!files.some((file) => file.name.startsWith("licenses/"))) {
    fail("manifest-invalid", `${path} contains no per-source license files`);
  }

  const rawIndexes = record.indexes ?? [];
  if (!Array.isArray(rawIndexes)) {
    fail("manifest-invalid", `${path}.indexes must be an array`);
  }
  const indexes: ToolchainIndexDescriptor[] = [];
  const indexStandards = new Set<string>();
  const indexFiles = new Set<string>();
  const fileByName = new Map<string, ToolchainFileEntry>();
  for (const file of files) fileByName.set(file.name, file);
  rawIndexes.forEach((entry, index) => {
    const entryPath = `${path}.indexes[${index}]`;
    let descriptor: ToolchainIndexDescriptor;
    try {
      descriptor = validateIndexDescriptor(entry, entryPath);
    } catch (error) {
      throw new ManifestError(
        "manifest-invalid",
        error instanceof Error ? error.message : `${entryPath} is invalid`
      );
    }
    if (indexStandards.has(descriptor.standard)) {
      fail("manifest-invalid", `${entryPath} duplicates a standard`);
    }
    indexStandards.add(descriptor.standard);
    if (indexFiles.has(descriptor.file)) {
      fail("manifest-invalid", `${entryPath} duplicates an index file`);
    }
    indexFiles.add(descriptor.file);
    if (!descriptor.file.startsWith("sysroot-index/")) {
      fail(
        "manifest-invalid",
        `${entryPath}.file must live under sysroot-index/`
      );
    }
    const listed = fileByName.get(descriptor.file);
    if (!listed) {
      fail(
        "manifest-invalid",
        `${entryPath}.file is not listed in ${path}.files`
      );
    }
    if (listed.bytes !== descriptor.bytes || listed.sha256 !== descriptor.sha256) {
      fail(
        "manifest-invalid",
        `${entryPath} metadata does not match its file entry`
      );
    }
    indexes.push(descriptor);
  });
  for (const file of files) {
    if (
      file.name.startsWith("sysroot-index/") &&
      !indexFiles.has(file.name)
    ) {
      fail(
        "manifest-invalid",
        `${file.name} is not referenced by any index descriptor`
      );
    }
  }
  if (expectedPack) {
    checkCatalogueIndexes(expectedPack, indexes);
  }

  const computedHeaderTree = await computeHeaderTreeSha256(files);
  let headerTreeSha256 = computedHeaderTree;
  if (record.headerTreeSha256 !== undefined) {
    const declared = expectRealSha(
      record.headerTreeSha256,
      `${path}.headerTreeSha256`
    );
    if (declared !== computedHeaderTree) {
      fail(
        "header-tree-mismatch",
        `${path}.headerTreeSha256 does not match the listed sysroot files`
      );
    }
    headerTreeSha256 = declared;
  }

  return {
    schema: TOOLCHAIN_MANIFEST_SCHEMA,
    id,
    version,
    engine: { abi: ENGINE_ABI, buildId: engineBuildId },
    toolchain,
    headerTreeSha256,
    indexes,
    files
  };
}

/**
 * Ensure the decompressed archive contains exactly the manifest files plus the
 * manifest itself. Byte and hash checks happen after this structural check.
 */
export function validateArchiveAgainstManifest(
  manifest: ToolchainManifest,
  archive: ReadonlyMap<string, Uint8Array>
): void {
  if (!archive.has("/manifest.json")) {
    fail("manifest-missing", "archive does not contain /manifest.json");
  }
  const expected = new Set(
    manifest.files.map((file) => `/${file.name}`)
  );
  for (const key of archive.keys()) {
    if (key !== "/manifest.json" && !expected.has(key)) {
      fail("archive-unlisted-file", `archive contains unlisted file ${key}`);
    }
  }
  for (const file of manifest.files) {
    const bytes = archive.get(`/${file.name}`);
    if (!bytes) {
      fail("archive-missing-file", `archive is missing ${file.name}`);
    }
    if (bytes.byteLength !== file.bytes) {
      fail(
        "archive-size-mismatch",
        `${file.name} is ${bytes.byteLength} bytes, manifest says ${file.bytes}`
      );
    }
  }
  const manifestBytes = archive.get("/manifest.json");
  if (!manifestBytes || manifestBytes.byteLength === 0) {
    fail("manifest-missing", "archive manifest is empty");
  }
}

/**
 * Normalize a header-viewer path to `/sysroot/...`. Returns null for paths
 * outside the mounted sysroot; callers answer "not found" for those.
 */
export function normalizeSysrootReadPath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  let normalized = path;
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (!normalized.startsWith("/sysroot/")) return null;
  if (normalized.includes("\\") || normalized.endsWith("/")) return null;
  const segments = normalized.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === "" || segment === "." || segment === "..") {
      return null;
    }
  }
  return normalized;
}
