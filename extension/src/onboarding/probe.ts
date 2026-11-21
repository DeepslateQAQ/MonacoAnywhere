/*
 * Real setup probes: toolchain-pack installation and fixture validation.
 *
 * Pack preparation uses the shared catalogue/download/install pipeline: bytes
 * are mirror-fetched, length- and SHA-256-verified, unpacked, manifest-checked,
 * and only then stored in IndexedDB. Validation opens the real offscreen
 * language-service backend, performs a minimal LSP handshake, opens a built-in
 * C++ fixture, and issues one textDocument/completion request. No Monaco code
 * is imported here and no completion count is synthesized.
 */

import {
  getSettings,
  type BackendChoice,
  type Settings
} from "../background/state.js";
import {
  loadBundledCatalogue,
  type Catalogue,
  type CataloguePack
} from "../data/catalogue.js";
import {
  downloadAndInstallPack,
  listInstalledPacks,
  type InstalledPackSummary
} from "../data/pack.js";
import { isRecord } from "../lsp/json.js";
import { openPortBackend } from "../lsp/port-backend.js";
import type { Backend } from "../lsp/backend.js";
import {
  buildCompileCommand,
  remapCompileCommand,
  type CompileEngine
} from "../profiles/commands.js";
import type { CompilerProfile } from "../profiles/types.js";

export const NATIVE_HOST_NAME = "com.monacoanywhere.host";

const PRIMARY_PACK_INDEX = 0;
const BACKEND_START_TIMEOUT_MS = 30_000;
const INITIALIZE_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 30_000;
const DISPOSE_TIMEOUT_MS = 5_000;

const VALIDATION_FILE_PATH = "/workspace/ma-onboarding/main.cpp";
const VALIDATION_DIRECTORY = "/workspace/ma-onboarding";
const VALIDATION_WORKSPACE_URI = "file:///workspace/ma-onboarding";
const VALIDATION_FILE_URI = `${VALIDATION_WORKSPACE_URI}/main.cpp`;

const VALIDATION_FIXTURE = `#include <vector>

int main() {
    std::vector<int> values;
    values.
    return 0;
}
`;

const COMPLETION_POSITION = { line: 4, character: 11 } as const;

/** Local validation profile: C++17 is supported by clangd 17 and pack toolchains. */
const VALIDATION_PROFILE: CompilerProfile = {
  id: "onboarding:fixture:c++17",
  standard: "c++17",
  dialect: "c++",
  label: "C++17 setup fixture",
  optionId: "onboarding",
  args: [],
  defines: {},
  macros: [],
  provenance: {
    source: "MonacoAnywhere onboarding fixture",
    verified: "unverified",
    note: "Used only to verify that the selected backend can return completions."
  }
};

export interface WasmPackStatus {
  packId: string;
  version: string;
  assetBytes: number;
  sha256: string;
  installed: boolean;
  downloaded: boolean;
  fileCount: number | null;
  unpackedBytes?: number;
}

export interface WasmPackProgress {
  packId: string;
  version: string;
  receivedBytes: number;
  totalBytes: number;
  mirrorIndex: number;
  mirrorCount: number;
}

export interface InstallWasmPackOptions {
  onProgress?: (progress: WasmPackProgress) => void;
}

export type PackErrorKind =
  | "catalogue"
  | "all-mirrors-failed"
  | "checksum-mismatch"
  | "verification"
  | "storage"
  | "other";

export interface PackErrorDescription {
  kind: PackErrorKind;
  message: string;
  details?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

interface DownloadAttempt {
  mirror: string;
  code: string;
}

function readDownloadAttempts(error: unknown): DownloadAttempt[] {
  if (
    typeof error !== "object" ||
    error === null ||
    !("attempts" in error)
  ) {
    return [];
  }
  const raw = error.attempts;
  if (!Array.isArray(raw)) {
    return [];
  }
  const attempts: DownloadAttempt[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.code !== "string") continue;
    attempts.push({
      mirror:
        typeof candidate.mirror === "string" ? candidate.mirror : "mirror",
      code: candidate.code
    });
  }
  return attempts;
}

function mirrorLabel(mirror: string): string {
  try {
    return new URL(mirror).host;
  } catch {
    return mirror.slice(0, 80);
  }
}

function isVerificationCode(code: string): boolean {
  return (
    code.startsWith("manifest") ||
    code.startsWith("archive") ||
    code === "pack-sha256-mismatch" ||
    code === "file-sha256-mismatch" ||
    code === "header-tree-mismatch" ||
    code === "pack-size-mismatch" ||
    code === "pack-catalogue-mismatch" ||
    code === "engine-build-mismatch" ||
    code === "engine-abi-mismatch" ||
    code === "index-missing"
  );
}

/**
 * Classify a pack-install failure so the UI can show an actionable message.
 * Verification and mirror failures are never reported as a successful install.
 */
export function describePackError(error: unknown): PackErrorDescription {
  const message = errorMessage(error);
  const code = getErrorCode(error);

  if (code !== null && code.startsWith("catalogue")) {
    return { kind: "catalogue", message };
  }

  if (code === "download-failed") {
    const attempts = readDownloadAttempts(error);
    const details =
      attempts.length === 0
        ? undefined
        : attempts
            .slice(0, 6)
            .map((attempt) => `${mirrorLabel(attempt.mirror)}: ${attempt.code}`)
            .join("; ");
    const allChecksumMismatch =
      attempts.length > 0 &&
      attempts.every((attempt) => attempt.code === "sha256-mismatch");
    return {
      kind: allChecksumMismatch ? "checksum-mismatch" : "all-mirrors-failed",
      message,
      ...(details === undefined ? {} : { details })
    };
  }

  if (code !== null && isVerificationCode(code)) {
    return { kind: "verification", message };
  }

  if (
    code !== null &&
    (code.startsWith("indexeddb") ||
      code.startsWith("pack-store") ||
      code === "pack-corrupt" ||
      code === "invalid-pack-id")
  ) {
    return { kind: "storage", message };
  }

  return { kind: "other", message };
}

async function loadPrimaryPack(): Promise<{
  catalogue: Catalogue;
  pack: CataloguePack;
}> {
  const catalogue = await loadBundledCatalogue();
  const pack = catalogue.packs[PRIMARY_PACK_INDEX];
  if (!pack) {
    throw new Error("The bundled catalogue has no toolchain packs.");
  }
  return { catalogue, pack };
}

function matchingInstallation(
  installed: readonly InstalledPackSummary[],
  pack: CataloguePack
): InstalledPackSummary | null {
  return (
    installed.find(
      (entry) => entry.id === pack.id && entry.version === pack.version
    ) ?? null
  );
}

/**
 * Check the locally installed pack without downloading anything. A matching id
 * and version means the resource step can continue without a new download.
 */
export async function inspectWasmPack(): Promise<WasmPackStatus> {
  const { pack } = await loadPrimaryPack();
  const installed = await listInstalledPacks();
  const match = matchingInstallation(installed, pack);
  return {
    packId: pack.id,
    version: pack.version,
    assetBytes: pack.bytes,
    sha256: pack.sha256,
    installed: match !== null,
    downloaded: false,
    fileCount: match?.fileCount ?? null
  };
}

/**
 * Download, verify, and install the primary toolchain pack, unless the exact
 * same id and version is already installed. Progress is byte-accurate and
 * comes from the download layer; only verified installations are returned.
 */
export async function installWasmPack(
  options: InstallWasmPackOptions = {}
): Promise<WasmPackStatus> {
  const { catalogue, pack } = await loadPrimaryPack();
  const installed = await listInstalledPacks();
  const match = matchingInstallation(installed, pack);
  if (match) {
    return {
      packId: pack.id,
      version: pack.version,
      assetBytes: pack.bytes,
      sha256: pack.sha256,
      installed: true,
      downloaded: false,
      fileCount: match.fileCount
    };
  }

  const installedPack = await downloadAndInstallPack(pack, {
    catalogue,
    onProgress(progress) {
      options.onProgress?.({
        packId: pack.id,
        version: pack.version,
        receivedBytes: progress.receivedBytes,
        totalBytes: progress.totalBytes,
        mirrorIndex: progress.mirrorIndex,
        mirrorCount: pack.mirrors.length
      });
    }
  });

  return {
    packId: installedPack.id,
    version: installedPack.version,
    assetBytes: pack.bytes,
    sha256: pack.sha256,
    installed: true,
    downloaded: true,
    fileCount: installedPack.fileCount,
    unpackedBytes: installedPack.unpackedBytes
  };
}

export type ValidationStage =
  | "starting"
  | "initializing"
  | "opening"
  | "completing";

export type ValidationFailureReason =
  | "pack-missing"
  | "catalogue"
  | "pack-store"
  | "settings"
  | "backend"
  | "zero-items"
  | "error";

export type FixtureValidationFailure =
  | {
      ok: false;
      reason: "pack-missing";
      packId: string;
      packVersion: string;
    }
  | {
      ok: false;
      reason: Exclude<ValidationFailureReason, "pack-missing">;
      message: string;
    };

export type FixtureValidationOutcome =
  | { ok: true; count: number }
  | FixtureValidationFailure;

export interface FixtureValidationOptions {
  onStage?: (stage: ValidationStage) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
}

interface RpcConnection {
  request(
    method: string,
    params: unknown,
    timeoutMs: number
  ): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  dispose(): Promise<void>;
}

interface SetupRpc extends RpcConnection {
  setConfiguration(configuration: Record<string, unknown>): void;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function completionCount(result: unknown): number {
  if (Array.isArray(result)) {
    return result.length;
  }
  if (isRecord(result) && Array.isArray(result.items)) {
    return result.items.length;
  }
  return 0;
}

function serverRequestResult(
  method: string,
  params: unknown,
  configuration: Record<string, unknown>
): unknown {
  switch (method) {
    case "workspace/configuration": {
      const items =
        isRecord(params) && Array.isArray(params.items) ? params.items : [];
      return items.map(() => configuration);
    }
    case "workspace/workspaceFolders":
      return [{ uri: VALIDATION_WORKSPACE_URI, name: "ma-onboarding" }];
    case "workspace/applyEdit":
      return {
        applied: false,
        failureReason: "Onboarding validation does not apply workspace edits."
      };
    default:
      return null;
  }
}

/**
 * Minimal JSON-RPC client over the shared Backend transport. It answers
 * server-initiated requests so clangd cannot block waiting for a response, and
 * every request has a hard timeout. dispose() tears down the backend too.
 */
function createRpc(backend: Backend): SetupRpc {
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let disposed = false;
  let closed = false;
  let initialized = false;
  let currentConfiguration: Record<string, unknown> = {};

  const failPending = (error: Error): void => {
    for (const [id, request] of pending) {
      pending.delete(id);
      request.cancelTimer();
      request.reject(error);
    }
  };

  const unsubscribeMessage = backend.onMessage((message: unknown) => {
    if (!isRecord(message)) return;
    if (typeof message.method === "string") {
      const id = message.id;
      if (id !== undefined) {
        try {
          backend.send({
            jsonrpc: "2.0",
            id,
            result: serverRequestResult(
              message.method,
              message.params,
              currentConfiguration
            )
          });
        } catch {
          // A closed transport already rejects pending requests.
        }
      }
      return;
    }

    const id = message.id;
    if (typeof id !== "number") return;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    request.cancelTimer();

    if (message.error !== undefined) {
      const error = message.error;
      const text =
        isRecord(error) && typeof error.message === "string"
          ? `${typeof error.code === "number" ? `${error.code}: ` : ""}${error.message}`
          : "JSON-RPC request failed";
      request.reject(new Error(text));
      return;
    }
    request.resolve(message.result);
  });

  const unsubscribeClose = backend.onClose((reason) => {
    closed = true;
    failPending(new Error(`language backend closed: ${reason}`));
  });

  const send = (message: object): boolean => {
    if (disposed || closed) return false;
    try {
      backend.send(message);
      return true;
    } catch {
      return false;
    }
  };

  return {
    request(method, params, timeoutMs) {
      if (disposed || closed) {
        return Promise.reject(new Error("language backend is closed"));
      }
      const { promise, resolve, reject } = Promise.withResolvers<unknown>();
      const id = nextId++;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve,
        reject,
        cancelTimer: () => clearTimeout(timer)
      });
      if (!send({ jsonrpc: "2.0", id, method, params })) {
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error("could not send JSON-RPC request"));
        return promise;
      }
      return promise.then((result) => {
        if (method === "initialize") {
          initialized = true;
        }
        return result;
      });
    },
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params: params ?? null });
    },
    setConfiguration(configuration) {
      currentConfiguration = configuration;
    },
    async dispose() {
      if (disposed) return;
      if (initialized) {
        try {
          backend.send({
            jsonrpc: "2.0",
            id: nextId++,
            method: "shutdown",
            params: null
          });
          backend.send({ jsonrpc: "2.0", method: "exit", params: null });
        } catch {
          // The transport may already be closed; disposal continues below.
        }
      }
      disposed = true;
      failPending(new Error("language backend disposed"));
      unsubscribeMessage();
      unsubscribeClose();
      await withTimeout(
        backend.dispose(),
        DISPOSE_TIMEOUT_MS,
        "language backend disposal timed out"
      ).catch(() => undefined);
    }
  };
}

interface InitializationConfiguration {
  compilationDatabaseChanges: Record<string, unknown>;
  clangdFileStatus: boolean;
}

function initializationParams(
  configuration: InitializationConfiguration
): Record<string, unknown> {
  return {
    processId: null,
    clientInfo: { name: "MonacoAnywhere setup validation" },
    rootUri: VALIDATION_WORKSPACE_URI,
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: {
        synchronization: { dynamicRegistration: false },
        completion: { completionItem: { snippetSupport: true } }
      },
      general: { positionEncodings: ["utf-16"] }
    },
    workspaceFolders: [
      { uri: VALIDATION_WORKSPACE_URI, name: "ma-onboarding" }
    ],
    initializationOptions: {
      clangdFileStatus: true,
      compilationDatabaseChanges: configuration.compilationDatabaseChanges
    }
  };
}

function compilationConfiguration(
  compileCommand: readonly string[]
): InitializationConfiguration {
  return {
    compilationDatabaseChanges: {
      [VALIDATION_FILE_PATH]: {
        workingDirectory: VALIDATION_DIRECTORY,
        compilationCommand: [...compileCommand]
      }
    },
    clangdFileStatus: true
  };
}

type CompileEngineResolution =
  | { ok: true; engine: CompileEngine }
  | FixtureValidationFailure;

async function resolveCompileEngine(
  backend: BackendChoice,
  settings: Settings
): Promise<CompileEngineResolution> {
  if (backend === "native") {
    return {
      ok: true,
      engine: { includeDirectories: settings.extraIncludeDirs }
    };
  }

  let catalogue: Catalogue;
  try {
    catalogue = await loadBundledCatalogue();
  } catch (error) {
    return { ok: false, reason: "catalogue", message: errorMessage(error) };
  }
  const pack = catalogue.packs[PRIMARY_PACK_INDEX];
  if (!pack) {
    return {
      ok: false,
      reason: "catalogue",
      message: "The bundled catalogue has no toolchain packs."
    };
  }

  let installed: InstalledPackSummary[];
  try {
    installed = await listInstalledPacks();
  } catch (error) {
    return { ok: false, reason: "pack-store", message: errorMessage(error) };
  }
  if (!matchingInstallation(installed, pack)) {
    return {
      ok: false,
      reason: "pack-missing",
      packId: pack.id,
      packVersion: pack.version
    };
  }

  return {
    ok: true,
    engine: {
      targetTriple: pack.toolchain.targetTriple,
      sysroot: "/sysroot",
      includeDirectories: pack.toolchain.includeDirectories,
      noStdIncCxx: true
    }
  };
}

/**
 * Run one real fixture completion against the selected backend. Returns a
 * count only when the backend actually answered; failures never write state.
 */
export async function validateFixtureBackend(
  backend: BackendChoice,
  options: FixtureValidationOptions = {}
): Promise<FixtureValidationOutcome> {
  let settings: Settings;
  try {
    settings = await getSettings();
  } catch (error) {
    return { ok: false, reason: "settings", message: errorMessage(error) };
  }
  if (settings.backend !== backend) {
    return {
      ok: false,
      reason: "settings",
      message: "The selected backend changed; run validation again."
    };
  }

  const engineResult = await resolveCompileEngine(backend, settings);
  if (!engineResult.ok) {
    return engineResult;
  }

  const compileCommand = remapCompileCommand(
    buildCompileCommand(VALIDATION_PROFILE, engineResult.engine),
    VALIDATION_FILE_PATH,
    VALIDATION_DIRECTORY
  ).command;
  const configuration = compilationConfiguration(compileCommand);
  const initialize = initializationParams(configuration);

  options.onStage?.("starting");
  let transport: Backend;
  try {
    transport = await withTimeout(
      openPortBackend(`onboarding:${crypto.randomUUID()}`),
      BACKEND_START_TIMEOUT_MS,
      "starting the offscreen language backend timed out"
    );
  } catch (error) {
    return { ok: false, reason: "backend", message: errorMessage(error) };
  }

  let rpc: SetupRpc | null = null;
  try {
    rpc = createRpc(transport);
    rpc.setConfiguration({ ...configuration });

    options.onStage?.("initializing");
    await rpc.request(
      "initialize",
      initialize,
      INITIALIZE_TIMEOUT_MS
    );
    rpc.notify("initialized", {});
    rpc.notify("workspace/didChangeConfiguration", {
      settings: configuration
    });

    options.onStage?.("opening");
    rpc.notify("textDocument/didOpen", {
      textDocument: {
        uri: VALIDATION_FILE_URI,
        languageId: "cpp",
        version: 1,
        text: VALIDATION_FIXTURE
      }
    });

    options.onStage?.("completing");
    const result = await rpc.request(
      "textDocument/completion",
      {
        textDocument: { uri: VALIDATION_FILE_URI },
        position: {
          line: COMPLETION_POSITION.line,
          character: COMPLETION_POSITION.character
        }
      },
      COMPLETION_TIMEOUT_MS
    );

    const count = completionCount(result);
    if (count === 0) {
      return {
        ok: false,
        reason: "zero-items",
        message: "clangd returned 0 completion items"
      };
    }
    return { ok: true, count };
  } catch (error) {
    return { ok: false, reason: "error", message: errorMessage(error) };
  } finally {
    if (rpc) {
      await rpc.dispose();
    } else {
      await withTimeout(
        transport.dispose(),
        DISPOSE_TIMEOUT_MS,
        "language backend disposal timed out"
      ).catch(() => undefined);
    }
  }
}

export type NativeDetection =
  | { status: "missing"; error: string }
  | { status: "empty" }
  | { status: "failed"; error: string }
  | { status: "responded"; summary: string };

const NATIVE_PROBE_TIMEOUT_MS = 4000;

function safeToken(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/**
 * Summarize a host response without exposing ports, tokens, file paths or
 * arbitrary host content. Only a bounded type/code/version is surfaced.
 */
function summarizeNativeResponse(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return typeof value;
  }
  const response = value as Record<string, unknown>;
  const type = safeToken(response.type, /^[A-Za-z][A-Za-z0-9/._-]{0,63}$/u);
  const code = safeToken(response.code, /^[a-z0-9][a-z0-9-]{0,63}$/u);
  const version =
    safeToken(
      response.clangdVersion,
      /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,79}$/u
    ) ?? safeToken(response.version, /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,79}$/u);
  return [
    type === null ? "unknown" : type,
    code === null ? null : `code=${code}`,
    version === null ? null : `version=${version}`
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Attempt a real Native Messaging request. With no installed host Chrome
 * reports an error, which is shown as not detected. A host that answers is
 * reported honestly; validation still has to start a real clangd session.
 */
export function detectNativeHost(): Promise<NativeDetection> {
  const { promise, resolve } = Promise.withResolvers<NativeDetection>();
  let settled = false;
  const finish = (result: NativeDetection): void => {
    if (settled) {
      return;
    }
    settled = true;
    window.clearTimeout(timer);
    resolve(result);
  };

  const timer = window.setTimeout(() => {
    finish({
      status: "failed",
      error: `no response within ${NATIVE_PROBE_TIMEOUT_MS} ms`
    });
  }, NATIVE_PROBE_TIMEOUT_MS);

  try {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { __ma: 1, type: "ma/probe", protocol: 1 },
      (response: unknown) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          finish({
            status: "missing",
            error: lastError.message ?? "native messaging failed"
          });
        } else if (response === null || response === undefined) {
          finish({ status: "empty" });
        } else {
          finish({
            status: "responded",
            summary: summarizeNativeResponse(response)
          });
        }
      }
    );
  } catch (error: unknown) {
    finish({
      status: "failed",
      error: errorMessage(error)
    });
  }

  return promise;
}
