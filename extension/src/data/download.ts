import {
  MAX_PACK_BYTES,
  resolveMirror,
  type CataloguePack,
  type FetchLike
} from "./catalogue.js";
import { DataError, DownloadError } from "./errors.js";
import { equalHexDigest, isRealSha256Hex, sha256Hex } from "./hash.js";

export interface DownloadProgress {
  mirrorIndex: number;
  mirrorUrl: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  /** Per-mirror timeout; the plan fixes this at 60 seconds. */
  timeoutMs?: number;
  /** Optional stricter ceiling; never above MAX_PACK_BYTES. */
  maxBytes?: number;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface MirrorFailure {
  mirror: string;
  code: string;
  message: string;
}

export class PackDownloadError extends DataError {
  readonly attempts: readonly MirrorFailure[];

  constructor(packId: string, attempts: readonly MirrorFailure[]) {
    const detail = attempts
      .map((attempt) => `${attempt.mirror}: ${attempt.message}`)
      .join("; ");
    super(
      "download-failed",
      `data pack ${packId} could not be downloaded and verified from any mirror (${detail})`
    );
    this.attempts = attempts.slice();
  }
}

function errorCode(error: unknown): string {
  if (error instanceof DataError) return error.code;
  if (error instanceof Error) return error.name || "error";
  return "error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readResponseBytes(
  response: Response,
  mirrorUrl: string,
  expectedBytes: number,
  onChunk: (receivedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new DownloadError(
        "invalid-content-length",
        `${mirrorUrl} returned an invalid Content-Length`
      );
    }
    if (declared !== expectedBytes) {
      throw new DownloadError(
        "content-length-mismatch",
        `${mirrorUrl} declares ${declared} bytes, catalogue expects ${expectedBytes}`
      );
    }
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength !== expectedBytes) {
      throw new DownloadError(
        "size-mismatch",
        `${mirrorUrl} returned ${buffer.byteLength} bytes, expected ${expectedBytes}`
      );
    }
    onChunk(buffer.byteLength, expectedBytes);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > expectedBytes) {
        await reader.cancel();
        throw new DownloadError(
          "size-exceeded",
          `${mirrorUrl} sent more than the catalogued ${expectedBytes} bytes`
        );
      }
      chunks.push(result.value);
      onChunk(received, expectedBytes);
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedBytes) {
    throw new DownloadError(
      "size-mismatch",
      `${mirrorUrl} returned ${received} bytes, expected ${expectedBytes}`
    );
  }
  const output = new Uint8Array(received);
  let writable = 0;
  for (const chunk of chunks) {
    output.set(chunk, writable);
    writable += chunk.byteLength;
  }
  return output;
}

async function downloadVerifiedMirror(
  pack: CataloguePack,
  mirrorIndex: number,
  mirrorUrl: string,
  options: Required<Pick<DownloadOptions, "fetchImpl" | "timeoutMs">> &
    Pick<DownloadOptions, "signal" | "onProgress">
): Promise<Uint8Array> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      throw new DataError("download-aborted", "download was aborted");
    }
    options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const response = await options.fetchImpl(mirrorUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      headers: { accept: "application/octet-stream" },
      signal: controller.signal
    });
    if (response.status !== 200) {
      throw new DownloadError(
        "http-status",
        `${mirrorUrl} returned HTTP ${response.status}`
      );
    }
    const bytes = await readResponseBytes(
      response,
      mirrorUrl,
      pack.bytes,
      (receivedBytes, totalBytes) => {
        options.onProgress?.({
          mirrorIndex,
          mirrorUrl,
          receivedBytes,
          totalBytes
        });
      }
    );
    const digest = await sha256Hex(bytes);
    if (!equalHexDigest(digest, pack.sha256)) {
      throw new DownloadError(
        "sha256-mismatch",
        `${mirrorUrl} served SHA-256 ${digest}, catalogue expects ${pack.sha256}`
      );
    }
    return bytes;
  } catch (error) {
    if (options.signal?.aborted) {
      throw new DataError("download-aborted", "download was aborted", {
        cause: error
      });
    }
    if (timedOut) {
      throw new DownloadError(
        "timeout",
        `${mirrorUrl} timed out after ${options.timeoutMs} ms`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

function assertDownloadablePack(pack: CataloguePack, maxBytes: number): void {
  if (!Number.isSafeInteger(pack.bytes) || pack.bytes <= 0) {
    throw new DownloadError(
      "invalid-pack",
      `pack ${String(pack.id)} has an invalid byte count`
    );
  }
  if (pack.bytes > maxBytes) {
    throw new DownloadError(
      "pack-too-large",
      `pack ${pack.id} is ${pack.bytes} bytes, limit is ${maxBytes}`
    );
  }
  if (!isRealSha256Hex(pack.sha256)) {
    throw new DownloadError(
      "invalid-pack",
      `pack ${String(pack.id)} has no real SHA-256`
    );
  }
  if (!Array.isArray(pack.mirrors) || pack.mirrors.length === 0) {
    throw new DownloadError(
      "no-mirrors",
      `pack ${String(pack.id)} has no download mirrors`
    );
  }
}

/**
 * Try catalogue mirrors in order, one 60-second attempt each. Only bytes that
 * match the catalogued length and SHA-256 are returned; an exhausted list is a
 * hard failure, never a fallback to a different pack or an unverified file.
 */
export async function downloadPack(
  pack: CataloguePack,
  options: DownloadOptions = {}
): Promise<Uint8Array> {
  const effectiveMax = Math.min(options.maxBytes ?? MAX_PACK_BYTES, MAX_PACK_BYTES);
  assertDownloadablePack(pack, effectiveMax);
  const fetchImpl =
    options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DownloadError("invalid-options", "timeoutMs must be positive");
  }
  const attempts: MirrorFailure[] = [];
  for (const [mirrorIndex, template] of pack.mirrors.entries()) {
    if (options.signal?.aborted) {
      throw new DataError("download-aborted", "download was aborted");
    }
    let mirrorUrl: string;
    try {
      mirrorUrl = resolveMirror(template, pack);
    } catch (error) {
      attempts.push({
        mirror: template,
        code: errorCode(error),
        message: errorMessage(error)
      });
      continue;
    }
    try {
      return await downloadVerifiedMirror(pack, mirrorIndex, mirrorUrl, {
        fetchImpl,
        timeoutMs,
        signal: options.signal,
        onProgress: options.onProgress
      });
    } catch (error) {
      if (error instanceof DataError && error.code === "download-aborted") {
        throw error;
      }
      attempts.push({
        mirror: mirrorUrl,
        code: errorCode(error),
        message: errorMessage(error)
      });
    }
  }
  throw new PackDownloadError(pack.id, attempts);
}
