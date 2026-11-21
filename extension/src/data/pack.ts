import {
  MAX_FILE_BYTES,
  MAX_UNPACKED_BYTES,
  loadBundledCatalogue,
  parsePackDescriptor,
  selectPack,
  type Catalogue,
  type CataloguePack,
  type FetchLike,
  type StandardId
} from "./catalogue.js";
import {
  downloadPack,
  type DownloadOptions
} from "./download.js";
import { DataError, ManifestError, PackStoreError } from "./errors.js";
import { equalHexDigest, isRealSha256Hex, sha256Hex } from "./hash.js";
import {
  computeHeaderTreeSha256,
  normalizeSysrootReadPath,
  validateArchiveAgainstManifest,
  validateManifest,
  type ToolchainFileEntry,
  type ToolchainManifest
} from "./manifest.js";
import { decompressGzip, untar } from "./untar.js";

export const PACK_DATABASE_NAME = "monacoanywhere-packs";
export const PACK_DATABASE_VERSION = 1;
export const PACK_STORE_NAME = "packs";

export interface StoredPackFile {
  name: string;
  blob: Blob;
}

export interface StoredPackRecord {
  id: string;
  version: string;
  manifest: ToolchainManifest;
  files: StoredPackFile[];
  installedAt: number;
  assetSha256: string;
  assetBytes: number;
  headerTreeSha256: string;
}

export interface InstalledPack {
  id: string;
  version: string;
  manifest: ToolchainManifest;
  fileCount: number;
  unpackedBytes: number;
  indexIncluded: boolean;
  indexIssue?: string;
}

export interface VerifiedPack {
  manifest: ToolchainManifest;
  /** Archive map with `/sysroot/...` and pack-root paths. */
  files: Map<string, Uint8Array>;
  headerTreeSha256: string;
  index?: Uint8Array;
  indexFile?: string;
  indexIssue?: string;
}

export interface InstallPackOptions {
  catalogue?: Catalogue;
  dbFactory?: IDBFactory;
  expectedEngineBuildId?: string;
}

export interface VerifyPackOptions {
  catalogue?: Catalogue;
  expectedEngineBuildId?: string;
  standard?: StandardId;
}

export interface LoadPackOptions {
  catalogue?: Catalogue;
  standard?: StandardId;
  dbFactory?: IDBFactory;
  /** Re-hash every stored file; off by default because install verified them. */
  reverify?: boolean;
  fetchImpl?: FetchLike;
}

export type DownloadAndInstallOptions = DownloadOptions &
  InstallPackOptions;

export interface LoadedPack {
  sysrootFiles: Map<string, Uint8Array>;
  index?: Uint8Array;
  manifest: ToolchainManifest;
  headerTreeSha256: string;
  indexIssue?: string;
  readFile(path: string): string | null;
}

function failStore(code: string, message: string, cause?: unknown): never {
  throw new PackStoreError(code, message, { cause });
}

function requireIndexedDb(factory?: IDBFactory): IDBFactory {
  const database = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : null);
  if (!database) {
    failStore(
      "indexeddb-unavailable",
      "IndexedDB is unavailable; a verified pack cannot be stored or loaded"
    );
  }
  return database;
}

function openPackDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  let settled = false;
  const request = factory.open(PACK_DATABASE_NAME, PACK_DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(PACK_STORE_NAME)) {
      database.createObjectStore(PACK_STORE_NAME, { keyPath: "id" });
    }
  };
  request.onsuccess = () => {
    if (settled) {
      request.result.close();
      return;
    }
    settled = true;
    const database = request.result;
    database.onversionchange = () => database.close();
    resolve(database);
  };
  request.onerror = () => {
    if (settled) return;
    settled = true;
    reject(
      new PackStoreError(
        "indexeddb-open-failed",
        "could not open the toolchain pack database",
        { cause: request.error }
      )
    );
  };
  request.onblocked = () => {
    if (settled) return;
    settled = true;
    reject(
      new PackStoreError(
        "indexeddb-blocked",
        "the toolchain pack database is blocked by another context"
      )
    );
  };
  return promise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () =>
    reject(
      new PackStoreError(
        "indexeddb-request-failed",
        "toolchain pack database request failed",
        { cause: request.error }
      )
    );
  return promise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let settled = false;
  transaction.oncomplete = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  transaction.onabort = () => {
    if (settled) return;
    settled = true;
    reject(
      new PackStoreError(
        "indexeddb-transaction-aborted",
        "toolchain pack transaction was aborted",
        { cause: transaction.error }
      )
    );
  };
  transaction.onerror = () => {
    if (settled) return;
    settled = true;
    reject(
      new PackStoreError(
        "indexeddb-transaction-failed",
        "toolchain pack transaction failed",
        { cause: transaction.error }
      )
    );
  };
  return promise;
}

function isBlobLike(value: unknown): value is Blob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Blob>;
  return (
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
  );
}

function parseStoredRecord(value: unknown): StoredPackRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failStore("pack-corrupt", "stored pack record is not an object");
  }
  const record = value as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.length === 0) {
    failStore("pack-corrupt", "stored pack record has no id");
  }
  const version = record.version;
  if (typeof version !== "string" || version.length === 0) {
    failStore("pack-corrupt", "stored pack record has no version");
  }
  const manifestValue = record.manifest;
  if (typeof manifestValue !== "object" || manifestValue === null) {
    failStore("pack-corrupt", "stored pack record has no manifest");
  }
  const assetSha256 = record.assetSha256;
  if (!isRealSha256Hex(assetSha256)) {
    failStore("pack-corrupt", "stored pack record has no asset digest");
  }
  const assetBytes = record.assetBytes;
  if (!Number.isSafeInteger(assetBytes) || (assetBytes as number) <= 0) {
    failStore("pack-corrupt", "stored pack record has no asset size");
  }
  const headerTreeSha256 = record.headerTreeSha256;
  if (!isRealSha256Hex(headerTreeSha256)) {
    failStore("pack-corrupt", "stored pack record has no header-tree digest");
  }
  const fileValues = record.files;
  if (!Array.isArray(fileValues)) {
    failStore("pack-corrupt", "stored pack record has no file list");
  }
  const files: StoredPackFile[] = [];
  for (const entry of fileValues) {
    if (typeof entry !== "object" || entry === null) {
      failStore("pack-corrupt", "stored pack file entry is invalid");
    }
    const file = entry as Record<string, unknown>;
    const fileName = file.name;
    if (typeof fileName !== "string" || fileName.length === 0) {
      failStore("pack-corrupt", "stored pack file entry has no name");
    }
    const blob = file.blob;
    if (!isBlobLike(blob)) {
      failStore("pack-corrupt", `stored pack file ${fileName} has no bytes`);
    }
    files.push({ name: fileName, blob });
  }
  return {
    id,
    version,
    manifest: manifestValue as ToolchainManifest,
    files,
    installedAt:
      typeof record.installedAt === "number" ? record.installedAt : 0,
    assetSha256,
    assetBytes: assetBytes as number,
    headerTreeSha256
  };
}

function selectedIndex(
  manifest: ToolchainManifest,
  standard: StandardId | undefined,
  headerTreeSha256: string
): {
  descriptor?: ToolchainManifest["indexes"][number];
  issue?: string;
} {
  if (manifest.indexes.length === 0) return {};
  const descriptor = standard
    ? manifest.indexes.find((entry) => entry.standard === standard)
    : manifest.indexes[0];
  if (!descriptor) {
    return { issue: "standard-not-indexed" };
  }
  if (
    descriptor.headerTreeSha256 !== undefined &&
    descriptor.headerTreeSha256 !== headerTreeSha256
  ) {
    return { descriptor, issue: "header-tree-mismatch" };
  }
  return { descriptor };
}

/**
 * Verify a downloaded (or locally imported) pack byte-for-byte before any
 * extraction result is trusted or stored.
 */
export async function verifyPackBytes(
  pack: CataloguePack,
  bytes: Uint8Array,
  options: VerifyPackOptions = {}
): Promise<VerifiedPack> {
  const validatedPack = parsePackDescriptor(pack);
  if (options.catalogue) {
    const expected = selectPack(options.catalogue, validatedPack.id);
    if (
      expected.version !== validatedPack.version ||
      expected.bytes !== validatedPack.bytes ||
      expected.sha256 !== validatedPack.sha256 ||
      expected.asset !== validatedPack.asset
    ) {
      throw new DataError(
        "pack-catalogue-mismatch",
        `pack ${validatedPack.id} does not match the supplied catalogue`
      );
    }
    if (
      options.expectedEngineBuildId !== undefined &&
      options.expectedEngineBuildId !== options.catalogue.engineBuildId
    ) {
      throw new DataError(
        "engine-build-mismatch",
        `expected engine ${options.expectedEngineBuildId}, catalogue says ${options.catalogue.engineBuildId}`
      );
    }
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new DataError(
      "pack-size-mismatch",
      `pack ${validatedPack.id} has no byte buffer`
    );
  }
  if (bytes.byteLength !== validatedPack.bytes) {
    throw new DataError(
      "pack-size-mismatch",
      `pack ${validatedPack.id} is ${bytes.byteLength} bytes, catalogue expects ${validatedPack.bytes}`
    );
  }
  const digest = await sha256Hex(bytes);
  if (!equalHexDigest(digest, validatedPack.sha256)) {
    throw new DataError(
      "pack-sha256-mismatch",
      `pack ${validatedPack.id} has SHA-256 ${digest}, catalogue expects ${validatedPack.sha256}`
    );
  }

  const tarBytes = await decompressGzip(bytes, {
    maxBytes: MAX_UNPACKED_BYTES
  });
  const archive = untar(tarBytes, {
    maxFileBytes: MAX_FILE_BYTES,
    maxTotalBytes: MAX_UNPACKED_BYTES
  });
  const manifestBytes = archive.get("/manifest.json");
  if (!manifestBytes) {
    throw new ManifestError(
      "manifest-missing",
      `pack ${validatedPack.id} has no manifest.json`
    );
  }
  let manifestRaw: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      manifestBytes
    );
    manifestRaw = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(
      "manifest-invalid-json",
      `pack ${validatedPack.id} manifest.json is invalid`,
      { cause: error }
    );
  }
  const manifest = await validateManifest(manifestRaw, {
    pack: validatedPack,
    catalogue: options.catalogue,
    expectedEngineBuildId: options.expectedEngineBuildId
  });
  validateArchiveAgainstManifest(manifest, archive);

  const actualFileHashes: ToolchainFileEntry[] = [];
  for (const file of manifest.files) {
    const data = archive.get(`/${file.name}`);
    if (!data) {
      throw new ManifestError(
        "archive-missing-file",
        `pack ${validatedPack.id} is missing ${file.name}`
      );
    }
    const fileDigest = await sha256Hex(data);
    if (!equalHexDigest(fileDigest, file.sha256)) {
      throw new DataError(
        "file-sha256-mismatch",
        `${file.name} in pack ${validatedPack.id} does not match its manifest digest`
      );
    }
    actualFileHashes.push({
      name: file.name,
      bytes: file.bytes,
      sha256: fileDigest
    });
  }
  const headerTreeSha256 = await computeHeaderTreeSha256(actualFileHashes);
  if (headerTreeSha256 !== manifest.headerTreeSha256) {
    throw new DataError(
      "header-tree-mismatch",
      `pack ${validatedPack.id} headers do not match the manifest digest`
    );
  }

  const choice = selectedIndex(
    manifest,
    options.standard,
    headerTreeSha256
  );
  let index: Uint8Array | undefined;
  if (choice.descriptor && choice.issue === undefined) {
    index = archive.get(`/${choice.descriptor.file}`);
    if (!index) {
      throw new DataError(
        "index-missing",
        `pack ${validatedPack.id} is missing ${choice.descriptor.file}`
      );
    }
  }
  return {
    manifest,
    files: archive,
    headerTreeSha256,
    index,
    indexFile:
      index && choice.descriptor ? choice.descriptor.file : undefined,
    indexIssue: choice.issue
  };
}

function toBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice().buffer], {
    type: "application/octet-stream"
  });
}

export async function installPackBytes(
  pack: CataloguePack,
  bytes: Uint8Array,
  options: InstallPackOptions = {}
): Promise<InstalledPack> {
  const verified = await verifyPackBytes(pack, bytes, {
    catalogue: options.catalogue,
    expectedEngineBuildId: options.expectedEngineBuildId
  });
  const storedFiles: StoredPackFile[] = [];
  let unpackedBytes = 0;
  for (const file of verified.manifest.files) {
    const data = verified.files.get(`/${file.name}`);
    if (!data) {
      failStore("pack-corrupt", `verified pack is missing ${file.name}`);
    }
    storedFiles.push({ name: file.name, blob: toBlob(data) });
    unpackedBytes += file.bytes;
  }
  const record: StoredPackRecord = {
    id: verified.manifest.id,
    version: verified.manifest.version,
    manifest: verified.manifest,
    files: storedFiles,
    installedAt: Date.now(),
    assetSha256: pack.sha256,
    assetBytes: pack.bytes,
    headerTreeSha256: verified.headerTreeSha256
  };
  const factory = requireIndexedDb(options.dbFactory);
  const database = await openPackDatabase(factory);
  try {
    const transaction = database.transaction(PACK_STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(PACK_STORE_NAME).put(record);
    await done;
  } catch (error) {
    if (error instanceof PackStoreError) throw error;
    failStore(
      "pack-store-failed",
      `could not store data pack ${pack.id}`,
      error
    );
  } finally {
    database.close();
  }
  return {
    id: record.id,
    version: record.version,
    manifest: record.manifest,
    fileCount: record.files.length,
    unpackedBytes,
    indexIncluded: verified.index !== undefined,
    indexIssue: verified.indexIssue
  };
}

async function readStoredRecord(
  database: IDBDatabase,
  id: string
): Promise<StoredPackRecord> {
  const transaction = database.transaction(PACK_STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(PACK_STORE_NAME).get(id);
  const [value] = await Promise.all([requestResult(request), done]);
  if (value === undefined) {
    throw new PackStoreError(
      "pack-not-installed",
      `data pack ${id} is not installed`
    );
  }
  const record = parseStoredRecord(value);
  if (record.id !== id) {
    failStore("pack-corrupt", `stored pack id ${record.id} does not match ${id}`);
  }
  return record;
}

/**
 * Load a verified pack from IndexedDB. Manifest metadata is revalidated against
 * the catalogue; hashes are only re-read when `reverify` is requested.
 */
export async function loadPack(
  id: string,
  options: LoadPackOptions = {}
): Promise<LoadedPack> {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) {
    throw new PackStoreError("invalid-pack-id", `invalid data pack id ${String(id)}`);
  }
  const factory = requireIndexedDb(options.dbFactory);
  const database = await openPackDatabase(factory);
  let record: StoredPackRecord;
  try {
    record = await readStoredRecord(database, id);
  } finally {
    database.close();
  }
  const catalogue =
    options.catalogue ??
    (await loadBundledCatalogue({ fetchImpl: options.fetchImpl }));
  const pack = selectPack(catalogue, id);
  const manifest = await validateManifest(record.manifest, {
    pack,
    catalogue,
    path: "stored manifest"
  });
  if (record.version !== pack.version) {
    throw new PackStoreError(
      "pack-catalogue-mismatch",
      `installed pack version ${record.version} does not match catalogue ${pack.version}`
    );
  }
  if (
    record.assetSha256 !== pack.sha256 ||
    record.assetBytes !== pack.bytes
  ) {
    failStore(
      "pack-catalogue-mismatch",
      `installed pack ${id} does not match the catalogue asset digest`
    );
  }
  const byName = new Map(record.files.map((file) => [file.name, file] as const));
  const sysrootFiles = new Map<string, Uint8Array>();
  for (const file of manifest.files) {
    const stored = byName.get(file.name);
    if (!stored) {
      failStore("pack-corrupt", `installed pack is missing ${file.name}`);
    }
    const data = new Uint8Array(await stored.blob.arrayBuffer());
    if (data.byteLength !== file.bytes) {
      failStore(
        "pack-corrupt",
        `${file.name} is ${data.byteLength} bytes, manifest says ${file.bytes}`
      );
    }
    if (options.reverify) {
      const digest = await sha256Hex(data);
      if (!equalHexDigest(digest, file.sha256)) {
        failStore(
          "pack-corrupt",
          `${file.name} no longer matches its manifest digest`
        );
      }
    }
    if (file.name.startsWith("sysroot/")) {
      sysrootFiles.set(`/${file.name}`, data);
    }
  }
  const choice = selectedIndex(manifest, options.standard, record.headerTreeSha256);
  let index: Uint8Array | undefined;
  let indexIssue = choice.issue;
  if (choice.descriptor && choice.issue === undefined) {
    const stored = byName.get(choice.descriptor.file);
    if (!stored) {
      indexIssue = "index-missing";
    } else {
      index = new Uint8Array(await stored.blob.arrayBuffer());
      if (index.byteLength !== choice.descriptor.bytes) {
        indexIssue = "index-size-mismatch";
        index = undefined;
      }
    }
  }
  const readFile = (path: string): string | null => {
    const normalized = normalizeSysrootReadPath(path);
    if (!normalized) return null;
    const data = sysrootFiles.get(normalized);
    if (!data) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      return null;
    }
  };
  return {
    sysrootFiles,
    index,
    manifest,
    headerTreeSha256: record.headerTreeSha256,
    indexIssue,
    readFile
  };
}

/**
 * Read one installed sysroot file without materializing the whole pack. Used by
 * the header viewer, which must answer "not found" rather than invent content.
 */
export async function readFile(
  id: string,
  path: string,
  options: Pick<LoadPackOptions, "dbFactory"> = {}
): Promise<string | null> {
  const normalized = normalizeSysrootReadPath(path);
  if (!normalized) return null;
  const name = normalized.slice(1);
  const factory = requireIndexedDb(options.dbFactory);
  const database = await openPackDatabase(factory);
  let record: StoredPackRecord;
  try {
    record = await readStoredRecord(database, id);
  } finally {
    database.close();
  }
  const stored = record.files.find((file) => file.name === name);
  if (!stored) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(await stored.blob.arrayBuffer())
    );
  } catch {
    return null;
  }
}

export async function removePack(
  id: string,
  options: Pick<LoadPackOptions, "dbFactory"> = {}
): Promise<void> {
  const factory = requireIndexedDb(options.dbFactory);
  const database = await openPackDatabase(factory);
  try {
    const transaction = database.transaction(PACK_STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(PACK_STORE_NAME).delete(id);
    await done;
  } finally {
    database.close();
  }
}

export interface InstalledPackSummary {
  id: string;
  version: string;
  fileCount: number;
  installedAt: number;
}

export async function listInstalledPacks(
  options: Pick<LoadPackOptions, "dbFactory"> = {}
): Promise<InstalledPackSummary[]> {
  const factory = requireIndexedDb(options.dbFactory);
  const database = await openPackDatabase(factory);
  try {
    const transaction = database.transaction(PACK_STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(PACK_STORE_NAME).getAll();
    const [values] = await Promise.all([requestResult(request), done]);
    return values.map((value) => {
      const record = parseStoredRecord(value);
      return {
        id: record.id,
        version: record.version,
        fileCount: record.files.length,
        installedAt: record.installedAt
      };
    });
  } finally {
    database.close();
  }
}

/**
 * Download, verify, store and return the pack. The raw asset buffer is wiped
 * after installation; only verified file blobs remain in IndexedDB.
 */
export async function downloadAndInstallPack(
  pack: CataloguePack,
  options: DownloadAndInstallOptions = {}
): Promise<InstalledPack> {
  const bytes = await downloadPack(pack, options);
  try {
    return await installPackBytes(pack, bytes, options);
  } finally {
    bytes.fill(0);
  }
}
