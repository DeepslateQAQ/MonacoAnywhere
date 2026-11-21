import { CatalogueError } from "./errors.js";
import { isRealSha256Hex } from "./hash.js";

export const CATALOGUE_SCHEMA = "monacoanywhere.catalogue/1";
export const ENGINE_ABI = "ma-clangd-wasm/1";
export const TOOLCHAIN_MANIFEST_SCHEMA = "monacoanywhere.toolchain-pack/1";

/** Hard ceilings from the approved data-pack plan. */
export const MAX_PACK_BYTES = 256 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export const SUPPORTED_TARGET_TRIPLES = ["x86_64-linux-gnu"] as const;
export const STANDARDS = [
  "c++98",
  "c++03",
  "c++11",
  "c++14",
  "c++17",
  "c++20",
  "c++23"
] as const;
export type StandardId = (typeof STANDARDS)[number];

/**
 * Mirror hosts allowed by the extension CSP. The GitHub release URL redirects
 * to objects.githubusercontent.com, which is a redirect target, not a mirror.
 */
export const ALLOWED_MIRROR_HOSTS: readonly string[] = [
  "github.com",
  "gh-proxy.org",
  "ghfast.top",
  "ghproxy.net"
];

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface ToolchainDescriptor {
  targetTriple: string;
  /** Absolute engine-visible paths, e.g. /sysroot/usr/include/c++/15. */
  includeDirectories: string[];
  /** Optional engine resource-header directory; absent when packaged separately. */
  resourceDir?: string;
  gccVersion: string;
  glibcVersion: string;
  kernelVersion: string;
}

export interface ToolchainIndexDescriptor {
  standard: StandardId;
  /** Manifest-relative path of the binary index inside the pack. */
  file: string;
  bytes: number;
  sha256: string;
  configurationSha256: string;
  /** Digest of the header tree the index was built against, when recorded. */
  headerTreeSha256?: string;
}

export interface CataloguePack {
  id: string;
  version: string;
  asset: string;
  bytes: number;
  sha256: string;
  releaseTag: string;
  mirrors: string[];
  toolchain: ToolchainDescriptor;
  /** Metadata only; an empty array means the pack ships no static index. */
  indexes: ToolchainIndexDescriptor[];
}

export interface Catalogue {
  schema: typeof CATALOGUE_SCHEMA;
  engineAbi: typeof ENGINE_ABI;
  engineBuildId: string;
  packs: CataloguePack[];
}

export interface CatalogueExpectations {
  /** Expected engine ABI; must equal ma-clangd-wasm/1. */
  engineAbi?: string;
  /** Exact uppercase/lowercase SHA-256 of the built clangd.wasm. */
  engineBuildId?: string;
}

export interface LoadCatalogueOptions extends CatalogueExpectations {
  fetchImpl?: FetchLike;
  /** Packaged catalogue URL; defaults to chrome-extension://<id>/data/catalogue.json. */
  url?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type RecordValue = Record<string, unknown>;

function fail(code: string, message: string): never {
  throw new CatalogueError(code, message);
}

function expectRecord(value: unknown, path: string): RecordValue {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    fail("catalogue-invalid", `${path} must be an object`);
  }
  return value as RecordValue;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("catalogue-invalid", `${path} must be a non-empty string`);
  }
  return value;
}

function expectPositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail("catalogue-invalid", `${path} must be a positive integer`);
  }
  return value as number;
}

function expectRealSha(value: unknown, path: string): string {
  if (!isRealSha256Hex(value)) {
    fail(
      "catalogue-invalid",
      `${path} must be a real lowercase SHA-256 (placeholders are rejected)`
    );
  }
  return value;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("catalogue-invalid", `${path} must be a non-empty array`);
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    result.push(expectString(item, `${path}[${index}]`));
  });
  return result;
}

function isControlFreeAscii(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Validate a manifest-relative data path. Leading slashes, empty segments,
 * backslashes, dot segments and control characters are rejected.
 */
export function validateRelativeDataPath(
  value: unknown,
  path: string
): string {
  const text = expectString(value, path);
  if (text.startsWith("/") || text.includes("\\")) {
    fail("catalogue-invalid", `${path} must be a relative POSIX path`);
  }
  if (!isControlFreeAscii(text)) {
    fail("catalogue-invalid", `${path} must not contain control characters`);
  }
  if (text.endsWith("/")) {
    fail("catalogue-invalid", `${path} must name a file, not a directory`);
  }
  for (const segment of text.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      fail("catalogue-invalid", `${path} contains an unsafe segment`);
    }
  }
  return text;
}

function validateAbsoluteSysrootPath(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (!text.startsWith("/sysroot/")) {
    fail("catalogue-invalid", `${path} must start with /sysroot/`);
  }
  if (text.endsWith("/") || text.includes("\\")) {
    fail("catalogue-invalid", `${path} must be a canonical directory path`);
  }
  if (!isControlFreeAscii(text)) {
    fail("catalogue-invalid", `${path} must not contain control characters`);
  }
  const segments = text.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === "" || segment === "." || segment === "..") {
      fail("catalogue-invalid", `${path} contains an unsafe segment`);
    }
  }
  return text;
}

function validateResourceDir(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (!text.startsWith("/lib/clang/")) {
    fail("catalogue-invalid", `${path} must be an engine resource directory`);
  }
  if (text.endsWith("/") || text.includes("\\")) {
    fail("catalogue-invalid", `${path} must be a canonical directory path`);
  }
  const segments = text.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === "" || segment === "." || segment === "..") {
      fail("catalogue-invalid", `${path} contains an unsafe segment`);
    }
  }
  return text;
}

function validateVersionString(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (!/^[0-9][0-9A-Za-z.+~_-]{0,63}$/.test(text)) {
    fail("catalogue-invalid", `${path} is not a version string`);
  }
  return text;
}

export function validateToolchainDescriptor(
  value: unknown,
  path = "toolchain"
): ToolchainDescriptor {
  const record = expectRecord(value, path);
  const targetTriple = expectString(record.targetTriple, `${path}.targetTriple`);
  if (
    !SUPPORTED_TARGET_TRIPLES.includes(
      targetTriple as (typeof SUPPORTED_TARGET_TRIPLES)[number]
    )
  ) {
    fail(
      "catalogue-invalid",
      `${path}.targetTriple ${targetTriple} is not a supported toolchain`
    );
  }
  const includeDirectories = expectStringArray(
    record.includeDirectories,
    `${path}.includeDirectories`
  ).map((entry, index) =>
    validateAbsoluteSysrootPath(entry, `${path}.includeDirectories[${index}]`)
  );
  if (new Set(includeDirectories).size !== includeDirectories.length) {
    fail(
      "catalogue-invalid",
      `${path}.includeDirectories contains duplicate directories`
    );
  }
  if (!includeDirectories.includes("/sysroot/usr/include")) {
    fail(
      "catalogue-invalid",
      `${path}.includeDirectories must include /sysroot/usr/include`
    );
  }
  if (
    !includeDirectories.some((entry) =>
      /^\/sysroot\/usr\/include\/c\+\+\/[0-9]+$/.test(entry)
    )
  ) {
    fail(
      "catalogue-invalid",
      `${path}.includeDirectories must include the libstdc++ headers`
    );
  }
  if (
    !includeDirectories.some((entry) =>
      /^\/sysroot\/usr\/include\/x86_64-linux-gnu\/c\+\+\/[0-9]+$/.test(entry)
    )
  ) {
    fail(
      "catalogue-invalid",
      `${path}.includeDirectories must include the target-specific libstdc++ headers`
    );
  }
  const result: ToolchainDescriptor = {
    targetTriple,
    includeDirectories,
    gccVersion: validateVersionString(record.gccVersion, `${path}.gccVersion`),
    glibcVersion: validateVersionString(
      record.glibcVersion,
      `${path}.glibcVersion`
    ),
    kernelVersion: validateVersionString(
      record.kernelVersion,
      `${path}.kernelVersion`
    )
  };
  if (record.resourceDir !== undefined) {
    result.resourceDir = validateResourceDir(
      record.resourceDir,
      `${path}.resourceDir`
    );
  }
  return result;
}

export function validateIndexDescriptor(
  value: unknown,
  path: string
): ToolchainIndexDescriptor {
  const record = expectRecord(value, path);
  const standard = expectString(record.standard, `${path}.standard`);
  if (!STANDARDS.includes(standard as StandardId)) {
    fail("catalogue-invalid", `${path}.standard is not a supported standard`);
  }
  const file = validateRelativeDataPath(record.file, `${path}.file`);
  if (!file.endsWith(".index")) {
    fail("catalogue-invalid", `${path}.file must end with .index`);
  }
  const bytes = expectPositiveInteger(record.bytes, `${path}.bytes`);
  if (bytes > MAX_FILE_BYTES) {
    fail("catalogue-invalid", `${path}.bytes exceeds the per-file limit`);
  }
  const result: ToolchainIndexDescriptor = {
    standard: standard as StandardId,
    file,
    bytes,
    sha256: expectRealSha(record.sha256, `${path}.sha256`),
    configurationSha256: expectRealSha(
      record.configurationSha256,
      `${path}.configurationSha256`
    )
  };
  if (record.headerTreeSha256 !== undefined) {
    result.headerTreeSha256 = expectRealSha(
      record.headerTreeSha256,
      `${path}.headerTreeSha256`
    );
  }
  return result;
}

function validateMirrorTemplate(value: unknown, path: string): string {
  const template = expectString(value, path);
  if (!isControlFreeAscii(template)) {
    fail("catalogue-invalid", `${path} must not contain control characters`);
  }
  if (!template.includes("{asset}") || !template.includes("{tag}")) {
    fail(
      "catalogue-invalid",
      `${path} must contain both {tag} and {asset} placeholders`
    );
  }
  const withoutTokens = template
    .replaceAll("{tag}", "")
    .replaceAll("{asset}", "");
  if (withoutTokens.includes("{") || withoutTokens.includes("}")) {
    fail("catalogue-invalid", `${path} contains an unknown placeholder`);
  }
  const resolved = template
    .replaceAll("{tag}", "data-validation")
    .replaceAll("{asset}", "pack-validation.tar.gz");
  validateResolvedMirror(resolved, path);
  return template;
}

function validateResolvedMirror(resolved: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    fail("catalogue-invalid", `${path} is not a valid URL`);
  }
  if (url.protocol !== "https:") {
    fail("catalogue-invalid", `${path} must use https`);
  }
  if (url.username !== "" || url.password !== "") {
    fail("catalogue-invalid", `${path} must not embed credentials`);
  }
  if (url.port !== "" && url.port !== "443") {
    fail("catalogue-invalid", `${path} must use the default https port`);
  }
  if (!ALLOWED_MIRROR_HOSTS.includes(url.hostname)) {
    fail(
      "catalogue-invalid",
      `${path} host ${url.hostname} is not an allowed mirror`
    );
  }
  if (url.hash !== "") {
    fail("catalogue-invalid", `${path} must not contain a fragment`);
  }
  return url;
}

export interface MirrorValues {
  releaseTag: string;
  asset: string;
}

/** Substitute the release tag and asset basename, then validate the result. */
export function resolveMirror(template: string, values: MirrorValues): string {
  if (
    typeof values.releaseTag !== "string" ||
    typeof values.asset !== "string" ||
    values.releaseTag.length === 0 ||
    values.asset.length === 0
  ) {
    fail("catalogue-invalid", "mirror substitution requires tag and asset");
  }
  const resolved = template
    .replaceAll("{tag}", values.releaseTag)
    .replaceAll("{asset}", values.asset);
  if (resolved.includes("{") || resolved.includes("}")) {
    fail("catalogue-invalid", "mirror template has unresolved placeholders");
  }
  validateResolvedMirror(resolved, "mirror");
  return resolved;
}

export function parsePackDescriptor(
  value: unknown,
  path = "pack"
): CataloguePack {
  const record = expectRecord(value, path);
  const id = expectString(record.id, `${path}.id`);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) {
    fail("catalogue-invalid", `${path}.id is not a stable pack id`);
  }
  const version = expectString(record.version, `${path}.version`);
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) {
    fail("catalogue-invalid", `${path}.version is not a concrete version`);
  }
  const asset = expectString(record.asset, `${path}.asset`);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/.test(asset) ||
    asset.includes("/") ||
    asset.includes("\\") ||
    /[{}<>]/.test(asset)
  ) {
    fail(
      "catalogue-invalid",
      `${path}.asset must be a concrete .tar.gz basename`
    );
  }
  const bytes = expectPositiveInteger(record.bytes, `${path}.bytes`);
  if (bytes > MAX_PACK_BYTES) {
    fail(
      "catalogue-invalid",
      `${path}.bytes exceeds the ${MAX_PACK_BYTES} byte pack limit`
    );
  }
  const sha256 = expectRealSha(record.sha256, `${path}.sha256`);
  const releaseTag = expectString(record.releaseTag, `${path}.releaseTag`);
  if (
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(releaseTag) ||
    /[{}<>]/.test(releaseTag)
  ) {
    fail("catalogue-invalid", `${path}.releaseTag is not a concrete tag`);
  }
  const mirrors = expectStringArray(record.mirrors, `${path}.mirrors`).map(
    (mirror, index) => validateMirrorTemplate(mirror, `${path}.mirrors[${index}]`)
  );
  if (new Set(mirrors).size !== mirrors.length) {
    fail("catalogue-invalid", `${path}.mirrors contains duplicates`);
  }
  const toolchain = validateToolchainDescriptor(
    record.toolchain,
    `${path}.toolchain`
  );
  const rawIndexes = record.indexes ?? [];
  if (!Array.isArray(rawIndexes)) {
    fail("catalogue-invalid", `${path}.indexes must be an array`);
  }
  const indexes: ToolchainIndexDescriptor[] = rawIndexes.map(
    (entry, index) =>
      validateIndexDescriptor(entry, `${path}.indexes[${index}]`)
  );
  const standards = new Set<string>();
  const indexFiles = new Set<string>();
  for (const index of indexes) {
    if (standards.has(index.standard)) {
      fail(
        "catalogue-invalid",
        `${path}.indexes has duplicate standard ${index.standard}`
      );
    }
    standards.add(index.standard);
    if (indexFiles.has(index.file)) {
      fail("catalogue-invalid", `${path}.indexes has duplicate file`);
    }
    indexFiles.add(index.file);
  }

  return {
    id,
    version,
    asset,
    bytes,
    sha256,
    releaseTag,
    mirrors,
    toolchain,
    indexes
  };
}

export interface CatalogueOptions extends CatalogueExpectations {
  /** Additional structural checks can use this label in error messages. */
  path?: string;
}

export function parseCatalogue(
  value: unknown,
  options: CatalogueOptions = {}
): Catalogue {
  const path = options.path ?? "catalogue";
  const record = expectRecord(value, path);
  if (record.schema !== CATALOGUE_SCHEMA) {
    fail(
      "catalogue-invalid",
      `${path}.schema must be ${CATALOGUE_SCHEMA}`
    );
  }
  if (record.engineAbi !== ENGINE_ABI) {
    fail(
      "catalogue-invalid",
      `${path}.engineAbi must be ${ENGINE_ABI}`
    );
  }
  if (options.engineAbi !== undefined && options.engineAbi !== ENGINE_ABI) {
    fail(
      "engine-abi-mismatch",
      `expected engine ABI ${options.engineAbi}, this build implements ${ENGINE_ABI}`
    );
  }
  const engineBuildId = expectRealSha(
    record.engineBuildId,
    `${path}.engineBuildId`
  );
  if (
    options.engineBuildId !== undefined &&
    options.engineBuildId !== engineBuildId
  ) {
    fail(
      "engine-build-mismatch",
      `catalogue was built for engine ${engineBuildId}, but the active engine is ${options.engineBuildId}`
    );
  }
  const packValues = record.packs;
  if (!Array.isArray(packValues) || packValues.length === 0) {
    fail("catalogue-invalid", `${path}.packs must be a non-empty array`);
  }
  const packs: CataloguePack[] = [];
  const ids = new Set<string>();
  packValues.forEach((entry, index) => {
    const pack = parsePackDescriptor(entry, `${path}.packs[${index}]`);
    if (ids.has(pack.id)) {
      fail("catalogue-invalid", `${path} has duplicate pack id ${pack.id}`);
    }
    ids.add(pack.id);
    packs.push(pack);
  });
  return {
    schema: CATALOGUE_SCHEMA,
    engineAbi: ENGINE_ABI,
    engineBuildId,
    packs
  };
}

export function selectPack(catalogue: Catalogue, id: string): CataloguePack {
  const pack = catalogue.packs.find((entry) => entry.id === id);
  if (!pack) {
    throw new CatalogueError(
      "pack-not-in-catalogue",
      `data pack ${id} is not present in this catalogue`
    );
  }
  return pack;
}

function defaultCatalogueUrl(): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL("data/catalogue.json");
  }
  return "data/catalogue.json";
}

/**
 * Load and validate the catalogue packaged with the extension. This is an
 * extension-origin read of a packaged resource; pages never fetch it.
 */
export async function loadBundledCatalogue(
  options: LoadCatalogueOptions = {}
): Promise<Catalogue> {
  const url = options.url ?? defaultCatalogueUrl();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw new CatalogueError(
        "catalogue-aborted",
        "catalogue load was aborted"
      );
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new CatalogueError(
        "catalogue-fetch-failed",
        `could not read ${url}: HTTP ${response.status}`
      );
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CatalogueError(
        "catalogue-invalid-json",
        `${url} is not valid JSON`
      );
    }
    return parseCatalogue(parsed, {
      engineAbi: options.engineAbi,
      engineBuildId: options.engineBuildId,
      path: "catalogue"
    });
  } catch (error) {
    if (timedOut) {
      throw new CatalogueError(
        "catalogue-timeout",
        `timed out after ${timeoutMs} ms reading ${url}`
      );
    }
    if (options.signal?.aborted) {
      throw new CatalogueError(
        "catalogue-aborted",
        "catalogue load was aborted"
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Local static assertion that keeps the catalogue constant type checked. */
export function assertCatalogueEngine(
  catalogue: Catalogue,
  engineAbi: string,
  engineBuildId: string
): void {
  if (catalogue.engineAbi !== engineAbi) {
    throw new CatalogueError(
      "engine-abi-mismatch",
      `catalogue engine ABI ${catalogue.engineAbi} does not match ${engineAbi}`
    );
  }
  if (catalogue.engineBuildId !== engineBuildId) {
    throw new CatalogueError(
      "engine-build-mismatch",
      `catalogue engine build ${catalogue.engineBuildId} does not match ${engineBuildId}`
    );
  }
}
